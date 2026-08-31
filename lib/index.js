/**
 * dsh-font-settings — host half.
 *
 * Owns the `ui-font` settings namespace (persisted into $DSH_HOME/settings.yaml
 * through the Host settings service) and serves it to the browser through a
 * small same-origin HTTP route set:
 *
 *   GET  /font-settings          → { ok, value: { uiFont, uiFontValue, codeFont, codeFontValue } }
 *   POST /font-settings          → { uiFont?, uiFontValue?, codeFont?, codeFontValue? } → { ok, value }
 *   GET  /font-settings/fonts    → { ok, fonts: ["Family Name", ...] }  (installed system fonts)
 *
 * The api-proxy settings domain is allowlisted (ui-theme etc.); a namespace
 * registered outside that list is not readable/writable through the browser
 * settings wire, so this plugin cannot rely on the client settingsScope
 * transport. The Host half, by contrast, owns the namespace and reads/writes
 * it directly through the registered owner scope — same durable document,
 * no allowlist involved.
 *
 * The font override itself is applied purely on the client: the theme
 * service's overrideTokens() stacks the two root CSS variables
 * (--dsw-font-family / --ds-font-family-code) that every --dsw-font-*
 * typography token references, and ui-layout's theme presenter writes them as
 * inline variables on <body>.
 *
 * System-font enumeration: browsers cannot list installed fonts, and the
 * registry display names ("SF Mono Regular", "UbuntuSansMonoNerdFontMono-
 * Regular") often differ from the CSS family names recorded inside the font
 * files ("SF Mono Nerd Font", "Ubuntu Sans Mono Nerd Font Mono"). The Host
 * therefore scans the machine + per-user font directories and parses each
 * file's sfnt name table (nameID 1, UTF-16BE) for the REAL family name —
 * that is what `font-family` must use. TTC collections are read at their
 * first face. Elsewhere (no Windows font dirs) the list is empty and the
 * client falls back to the custom input.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import z from "@deepseek-ai/schemastery";

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-font-settings";

/** The routes need the web server; the settings service stays optional. */
export const inject = ["webServer"];

/** Settings namespace owned by this plugin. */
const FONT_SETTINGS_NAMESPACE = "ui-font";

/**
 * Durable font schema. Each font slot is (mode, value):
 *  - mode "default"  → stock font stacks (no override)
 *  - mode "system"   → value = one family name from the system-font list
 *  - mode "custom"   → value = a user-supplied CSS font-family stack
 */
const FontSettingsSchema = z.object({
  uiFont: z.string().default("default"),
  uiFontValue: z.string().default(""),
  codeFont: z.string().default("default"),
  codeFontValue: z.string().default("")
});

/** A single family name: letters, digits, CJK, spaces, dots, dashes. */
const FAMILY_NAME_RE = /^[A-Za-z0-9\u4e00-\u9fff .-]{1,64}$/;
/** A CSS font-family stack: families/commas/quotes; nothing CSS-injectable. */
const FONT_STACK_RE = /^[A-Za-z0-9\u4e00-\u9fff .,'"()-]{1,200}$/;

const MAX_BODY_BYTES = 1 << 20;

//#region font enumeration (sfnt name-table parsing)
/**
 * Parse an sfnt `name` table for the font identity:
 *  - family  — the CSS font-family name the browser will actually match on
 *    Windows: DirectWrite registers the typographic family (nameID 16) when
 *    present, so it wins; otherwise nameID 1 (English 0x0409 first, then
 *    Chinese, then any; Mac platform as a latin1 fallback).
 *  - aliases — every other nameID 16/1 record (other languages included).
 *    Nerd Fonts keep the original family in nameID 1 ("SF Mono") and put
 *    "… Nerd Font" in nameID 16 ("SFMono Nerd Font") — using nameID 1 there
 *    fails to match in the browser, which is why `family` prefers nameID 16.
 * @param buf - the `name` table bytes.
 * @returns { family, aliases } or null when no family is present.
 */
function parseNameTable(buf) {
  if (buf.length < 6) return null;
  const count = buf.readUInt16BE(2);
  const stringOffset = buf.readUInt16BE(4);
  const familyCandidates = [];
  const typoCandidates = [];
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const languageID = buf.readUInt16BE(rec + 4);
    const nameID = buf.readUInt16BE(rec + 6);
    if (nameID !== 1 && nameID !== 16) continue;
    const len = buf.readUInt16BE(rec + 8);
    const off = stringOffset + buf.readUInt16BE(rec + 10);
    if (off + len > buf.length || len === 0) continue;
    let name;
    if (platformID === 3) {
      const u16 = Buffer.from(buf.subarray(off, off + len));
      u16.swap16(); // BE → LE for utf16le
      name = u16.toString("utf16le");
    } else if (platformID === 1) {
      name = buf.toString("latin1", off, off + len);
    } else {
      continue;
    }
    name = name.replace(/\0+$/, "").trim();
    if (name.length === 0 || name.length > 64) continue;
    const priority = platformID === 3 && (encodingID === 1 || encodingID === 10)
      ? languageID === 0x0409 ? 0 : languageID === 0x0404 || languageID === 0x0804 || languageID === 0x0c04 ? 1 : 2
      : 3;
    if (nameID === 16) typoCandidates.push({ name, priority });
    else familyCandidates.push({ name, priority });
  }
  typoCandidates.sort((a, b) => a.priority - b.priority);
  familyCandidates.sort((a, b) => a.priority - b.priority);
  const family = typoCandidates.length > 0
    ? typoCandidates[0].name
    : familyCandidates.length > 0
      ? familyCandidates[0].name
      : null;
  if (family === null) return null;
  const aliases = [];
  for (const candidate of [...typoCandidates, ...familyCandidates]) {
    if (candidate.name !== family && !aliases.includes(candidate.name)) aliases.push(candidate.name);
  }
  return { family, aliases };
}

/**
 * Read the font identity out of one font file (ttf/otf, or the first face of a
 * ttc collection) by locating its `name` table through the table directory.
 * @param file - absolute path to the font file.
 * @returns { family, aliases } or null on any failure.
 */
async function readFontNames(file) {
  let handle;
  try {
    handle = await fsp.open(file, "r");
  } catch (error) {
    return null;
  }
  try {
    const sig = Buffer.alloc(4);
    await handle.read(sig, 0, 4, 0);
    let sfntOffset = 0;
    const sigText = sig.toString("latin1");
    if (sigText === "ttcf") {
      const firstOffset = Buffer.alloc(4);
      await handle.read(firstOffset, 0, 4, 12);
      sfntOffset = firstOffset.readUInt32BE(0);
    } else {
      const version = sig.readUInt32BE(0);
      if (version !== 0x00010000 && sigText !== "OTTO" && sigText !== "true") return null;
    }
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, sfntOffset);
    const numTables = head.readUInt16BE(4);
    if (numTables === 0 || numTables > 512) return null;
    const dir = Buffer.alloc(numTables * 16);
    await handle.read(dir, 0, dir.length, sfntOffset + 12);
    let nameOffset = -1;
    let nameLength = -1;
    for (let i = 0; i < numTables; i++) {
      if (dir.toString("latin1", i * 16, i * 16 + 4) === "name") {
        nameOffset = dir.readUInt32BE(i * 16 + 8);
        nameLength = dir.readUInt32BE(i * 16 + 12);
        break;
      }
    }
    if (nameOffset < 0 || nameLength <= 0) return null;
    const nameBuf = Buffer.alloc(Math.min(nameLength, 1 << 16));
    await handle.read(nameBuf, 0, nameBuf.length, nameOffset);
    return parseNameTable(nameBuf);
  } catch (error) {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Enumerate installed font families by scanning font dirs (cached 60s). */
let fontCache = null;
let fontCacheAt = 0;
async function listSystemFonts() {
  const now = Date.now();
  if (fontCache !== null && now - fontCacheAt < 60000) return fontCache;
  const dirs = [];
  if (process.env.WINDIR) dirs.push(path.join(process.env.WINDIR, "Fonts"));
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
  const seen = new Set();
  const fonts = [];
  for (const dir of dirs) {
    let files = [];
    try {
      files = await fsp.readdir(dir);
    } catch (error) {
      continue;
    }
    for (const file of files) {
      if (!/\.(ttf|otf|ttc)$/i.test(file)) continue;
      const info = await readFontNames(path.join(dir, file));
      if (info === null || seen.has(info.family)) continue;
      seen.add(info.family);
      fonts.push(info);
    }
  }
  fonts.sort((a, b) => a.family.localeCompare(b.family, "zh-CN"));
  fontCache = fonts;
  fontCacheAt = Date.now();
  return fonts;
}
//#endregion

/** Collect the request body as utf-8 text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(error);
    };
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) fail(new Error("request body too large"));
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(data);
    });
    req.on("error", (error) => fail(error));
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

/** Narrow one (field, mode, value) triple from a POST payload into a patch key, or null. */
function patchFor(field, payload) {
  if (payload === null || typeof payload !== "object") return null;
  const mode = payload[field];
  const value = payload[field + "Value"];
  if (mode === void 0 || typeof mode !== "string") return null;
  if (mode === "default") return { [field]: mode, [field + "Value"]: "" };
  if (mode === "system") {
    if (typeof value !== "string" || !FAMILY_NAME_RE.test(value)) return null;
    return { [field]: mode, [field + "Value"]: value };
  }
  if (mode === "custom") {
    if (typeof value !== "string" || !FONT_STACK_RE.test(value)) return null;
    return { [field]: mode, [field + "Value"]: value };
  }
  return null;
}

/**
 * @param ctx - plugin context carrying webServer; settings arrives later.
 */
export function apply(ctx) {
  /** Owner scope of the ui-font namespace; null until settings mounts. */
  let scope = null;
  ctx.inject(["settings"], (settingsCtx) => {
    // dsh 0.1.2-alpha.2: settingsNamespace() was removed from @deepseek-ai/dsh-settings;
    // register() takes the plain lowercase-hyphenated namespace string.
    scope = settingsCtx.settings.register(FONT_SETTINGS_NAMESPACE, FontSettingsSchema);
    settingsCtx.effect(() => () => {
      scope = null;
    }, "font-settings: scope detach");
  });
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/font-settings",
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (req.method === "GET" && url.pathname === "/font-settings/fonts") {
          const fonts = await listSystemFonts();
          return sendJson(res, 200, {
            ok: true,
            fonts: fonts.map((info) => ({ name: info.family, aliases: info.aliases }))
          });
        }
        if (scope === null) {
          return sendJson(res, 503, { ok: false, error: "settings service unavailable" });
        }
        if (req.method === "GET" && url.pathname === "/font-settings") {
          const value = scope.get();
          return sendJson(res, 200, {
            ok: true,
            value: { uiFont: value.uiFont, uiFontValue: value.uiFontValue, codeFont: value.codeFont, codeFontValue: value.codeFontValue }
          });
        }
        if (req.method === "POST" && url.pathname === "/font-settings") {
          let payload;
          try {
            payload = JSON.parse(await readBody(req));
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
          }
          const patch = { ...patchFor("uiFont", payload), ...patchFor("codeFont", payload) };
          if (Object.keys(patch).length === 0) {
            return sendJson(res, 400, { ok: false, error: "no valid font field in payload" });
          }
          await scope.update(patch);
          const value = scope.get();
          return sendJson(res, 200, {
            ok: true,
            value: { uiFont: value.uiFont, uiFontValue: value.uiFontValue, codeFont: value.codeFont, codeFontValue: value.codeFontValue }
          });
        }
        return sendJson(res, 404, { ok: false, error: "not found" });
      } catch (error) {
        if (typeof ctx.logger?.warn === "function") ctx.logger.warn(error);
        return sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }), "font-settings: route");
}
