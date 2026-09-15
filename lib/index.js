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
 * OS display names often differ from the CSS family names recorded inside
 * the font files. The Host therefore scans the per-platform font
 * directories and parses each file's sfnt name table (nameID 16/1,
 * UTF-16BE) for the REAL family name — that is what `font-family` must
 * use. TTC collections are read at their first face. Scans run in parallel
 * and cache for 10 minutes; stale entries serve while a background refresh
 * re-scans, and the boot path pre-warms the cache.
 *
 *   Windows  %WINDIR%\Fonts + %LOCALAPPDATA%\Microsoft\Windows\Fonts (flat)
 *   WSL      native Linux dirs (below) + Windows dirs through drvfs:
 *            mount root from /etc/wsl.conf [automount] root (default /mnt),
 *            every drive's Windows\Fonts plus each profile's per-user fonts
 *            (profile names are globbed — they need not match the WSL user)
 *   macOS    /System/Library/Fonts, /System/Library/Fonts/Supplemental,
 *            /Library/Fonts, ~/Library/Fonts (recursive)
 *   Linux    /usr/share/fonts, /usr/local/share/fonts, $XDG_DATA_HOME/fonts,
 *            ~/.fonts (recursive)
 *
 * On WSL both sources are listed: Windows families match a Windows browser
 * attached to the GUI, native Linux families match a WSLg browser; families
 * the connected browser cannot render are flagged client-side. With no font
 * dirs at all the list stays empty and the client falls back to the custom
 * input.
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
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
 * Candidate priority for one `name` record: Windows/Unicode English (0x0409)
 * first, then the Chinese locales, then any other Unicode record, then the
 * Macintosh latin1 platform as a last resort.
 */
function namePriority(platformID, encodingID, languageID) {
  if (platformID === 3 && (encodingID === 1 || encodingID === 10)) {
    return languageID === 0x0409 ? 0 : languageID === 0x0404 || languageID === 0x0804 || languageID === 0x0c04 ? 1 : 2;
  }
  return 3;
}

/** Name-table IDs this plugin reads. */
const NAME_ID_SUBFAMILY = 2;
const NAME_ID_FULL = 4;
const NAME_ID_POSTSCRIPT = 6;
const NAME_ID_TYPO_SUBFAMILY = 17;

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
 *  - fullName / postScript / subfamily — the identity records that
 *    `@font-face { src: local(...) }` actually resolves against. `local()` is
 *    matched on the FullName (nameID 4) and PostScript name (nameID 6), NOT
 *    on the family name: for JetBrainsMono Nerd Font, `local('JetBrainsMono NF')`
 *    (nameID 1) and `local('JetBrainsMono Nerd Font')` (nameID 16) both fail,
 *    while `local('JetBrainsMono NF Regular')` (nameID 4) and
 *    `local('JetBrainsMonoNF-Regular')` (nameID 6) resolve. Without them an
 *    alias silently degrades to the fallback stack.
 * @param buf - the `name` table bytes.
 * @returns identity object, or null when no family is present.
 */
function parseNameTable(buf) {
  if (buf.length < 6) return null;
  const count = buf.readUInt16BE(2);
  const stringOffset = buf.readUInt16BE(4);
  const byId = new Map();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const languageID = buf.readUInt16BE(rec + 4);
    const nameID = buf.readUInt16BE(rec + 6);
    if (nameID !== 1 && nameID !== NAME_ID_SUBFAMILY && nameID !== NAME_ID_FULL
      && nameID !== NAME_ID_POSTSCRIPT && nameID !== 16 && nameID !== NAME_ID_TYPO_SUBFAMILY) continue;
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
    const entry = { name, priority: namePriority(platformID, encodingID, languageID) };
    const list = byId.get(nameID);
    if (list === undefined) byId.set(nameID, [entry]); else list.push(entry);
  }
  const pick = (id) => {
    const list = byId.get(id);
    if (list === undefined) return null;
    list.sort((a, b) => a.priority - b.priority);
    return list[0].name;
  };
  const typoFamily = pick(16);
  const family = typoFamily !== null ? typoFamily : pick(1);
  if (family === null) return null;
  const aliases = [];
  for (const id of [16, 1]) {
    const list = byId.get(id);
    if (list === undefined) continue;
    for (const entry of list) {
      if (entry.name !== family && !aliases.includes(entry.name)) aliases.push(entry.name);
    }
  }
  const typoSubfamily = pick(NAME_ID_TYPO_SUBFAMILY);
  return {
    family,
    aliases,
    fullName: pick(NAME_ID_FULL),
    postScript: pick(NAME_ID_POSTSCRIPT),
    subfamily: typoSubfamily !== null ? typoSubfamily : pick(NAME_ID_SUBFAMILY)
  };
}

/**
 * Weight implied by a subfamily label, used only when the OS/2 table is
 * missing or carries an out-of-range value. Longer qualifiers are tested first
 * so "ExtraLight" is not read as "Light" and "SemiBold" not as "Bold".
 */
function weightFromSubfamily(label) {
  if (label === null) return 400;
  const s = label.toLowerCase();
  if (s.includes("thin")) return 100;
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return 400;
}

/**
 * Read the font identity out of one font file (ttf/otf, or the first face of a
 * ttc collection) by locating its `name`, `OS/2`, and `head` tables through the
 * table directory.
 * @param file - absolute path to the font file.
 * @returns { family, aliases, face } or null on any failure.
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
    let os2Offset = -1;
    let headOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const tag = dir.toString("latin1", i * 16, i * 16 + 4);
      const offset = dir.readUInt32BE(i * 16 + 8);
      if (tag === "name") {
        nameOffset = offset;
        nameLength = dir.readUInt32BE(i * 16 + 12);
      } else if (tag === "OS/2") {
        os2Offset = offset;
      } else if (tag === "head") {
        headOffset = offset;
      }
    }
    if (nameOffset < 0 || nameLength <= 0) return null;
    const nameBuf = Buffer.alloc(Math.min(nameLength, 1 << 16));
    await handle.read(nameBuf, 0, nameBuf.length, nameOffset);
    const identity = parseNameTable(nameBuf);
    if (identity === null) return null;
    // Weight/style for the @font-face descriptors: OS/2 is authoritative,
    // `head.macStyle` carries italic/oblique for faces whose OS/2 lacks
    // fsSelection, and the subfamily label is the final fallback.
    let weight = null;
    let italic = false;
    if (os2Offset >= 0) {
      const os2 = Buffer.alloc(66);
      await handle.read(os2, 0, os2.length, os2Offset);
      const classed = os2.readUInt16BE(4);
      if (classed >= 1 && classed <= 1000) weight = classed;
      italic = (os2.readUInt16BE(62) & 0x0001) !== 0;
    }
    if (headOffset >= 0) {
      const headTable = Buffer.alloc(54);
      await handle.read(headTable, 0, headTable.length, headOffset);
      if ((headTable.readUInt16BE(44) & 0x0002) !== 0) italic = true;
    }
    if (weight === null) weight = weightFromSubfamily(identity.subfamily);
    return {
      family: identity.family,
      aliases: identity.aliases,
      face: { fullName: identity.fullName, postScript: identity.postScript, weight, italic }
    };
  } catch (error) {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Font file extensions worth parsing (browsers cannot use .fon/.dfont). */
const SCAN_EXTENSIONS = /\.(ttf|otf|ttc)$/i;
/** Native-layout recursion depth cap and total-file cap. */
const SCAN_MAX_DEPTH = 6;
const SCAN_MAX_FILES = 5000;
/** Parallel font-file parses (9p crossings get ~limit× wall-time cut). */
const SCAN_CONCURRENCY = 8;
/** Enumeration cache TTL; stale entries serve while a refresh re-scans. */
const CACHE_TTL = 10 * 60 * 1000;

/** True when this Linux host is WSL (kernel release carries "microsoft"). */
function isWsl() {
  return process.platform === "linux" && os.release().toLowerCase().includes("microsoft");
}

/** Read a small text file, null on failure. */
async function readTextOrNull(file) {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (error) {
    return null;
  }
}

/**
 * WSL drvfs mount root. /etc/wsl.conf [automount] root overrides the
 * "/mnt/" default; normalized to an absolute trailing-slash path.
 */
async function wslMountRoot() {
  const text = await readTextOrNull("/etc/wsl.conf");
  if (text !== null) {
    let inSection = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("[")) {
        inSection = line.toLowerCase() === "[automount]";
        continue;
      }
      if (!inSection) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== "root") continue;
      const value = line.slice(eq + 1).trim();
      if (value.length === 0) break;
      const root = value.startsWith("/") ? value : "/" + value;
      return root.endsWith("/") ? root : root + "/";
    }
  }
  return "/mnt/";
}

/**
 * Windows-side font directories reachable through drvfs: every drive's
 * Windows\Fonts plus each profile's per-user
 * AppData\Local\Microsoft\Windows\Fonts. The Windows user name is unrelated
 * to the WSL user name, so profiles are globbed, not inferred; profile
 * entries without such a font dir simply drop out at scan time.
 */
async function windowsFontDirs(mountRoot) {
  let drives = [];
  try {
    drives = await fsp.readdir(mountRoot);
  } catch (error) {
    return [];
  }
  const dirs = [];
  for (const drive of drives) {
    const drivePath = path.join(mountRoot, drive);
    dirs.push(path.join(drivePath, "Windows", "Fonts"));
    let users = [];
    try {
      users = await fsp.readdir(path.join(drivePath, "Users"));
    } catch (error) {
      continue;
    }
    for (const user of users) {
      dirs.push(path.join(drivePath, "Users", user, "AppData", "Local", "Microsoft", "Windows", "Fonts"));
    }
  }
  return dirs;
}

/**
 * Collect font files from a root list. Windows-style roots are flat (their
 * canonical layout has no subdirectories); native roots recurse to
 * SCAN_MAX_DEPTH. Directory symlinks are followed once (realpath visited
 * set guards cycles); .ttf/.otf/.ttc files are kept, all else ignored.
 */
async function collectFontFiles(roots) {
  const files = [];
  const visited = new Set();
  for (const root of roots) {
    let rootReal;
    try {
      rootReal = await fsp.realpath(root.dir);
    } catch (error) {
      continue;
    }
    if (visited.has(rootReal)) continue;
    visited.add(rootReal);
    const queue = [{ dir: root.dir, depth: 0 }];
    while (queue.length > 0 && files.length < SCAN_MAX_FILES) {
      const { dir, depth } = queue.shift();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (error) {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        let isFile = entry.isFile();
        let isDir = entry.isDirectory();
        if (!isFile && !isDir && entry.isSymbolicLink()) {
          try {
            const stat = await fsp.stat(full);
            isFile = stat.isFile();
            isDir = stat.isDirectory();
          } catch (error) {
            continue;
          }
        }
        if (isDir) {
          if (root.flat || depth >= SCAN_MAX_DEPTH) continue;
          let real;
          try {
            real = await fsp.realpath(full);
          } catch (error) {
            continue;
          }
          if (visited.has(real)) continue;
          visited.add(real);
          queue.push({ dir: full, depth: depth + 1 });
        } else if (isFile && SCAN_EXTENSIONS.test(entry.name)) {
          files.push(full);
          if (files.length >= SCAN_MAX_FILES) break;
        }
      }
    }
  }
  return files;
}

/** Run fn over items with at most `limit` in flight; preserves item order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Faces kept per family. A family needs at most regular/bold/italic/bold-italic,
 * and the cap keeps the enumeration payload bounded on hosts with huge
 * collections (Windows font directories run to thousands of files).
 */
const MAX_FACES_PER_FAMILY = 8;

/** Sort weight/style into the order a browser prefers when picking a face. */
function faceOrder(a, b) {
  if (a.italic !== b.italic) return a.italic ? 1 : -1;
  return a.weight - b.weight;
}

/** Dedupe, order, and cap one family's faces; drops unusable entries. */
function normalizeFaces(faces) {
  const seen = new Set();
  const kept = [];
  for (const face of faces) {
    const fullName = typeof face.fullName === "string" && face.fullName.length > 0 ? face.fullName : null;
    const postScript = typeof face.postScript === "string" && face.postScript.length > 0 ? face.postScript : null;
    if (fullName === null && postScript === null) continue;
    const key = `${fullName}|${postScript}|${face.weight}|${face.italic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ fullName, postScript, weight: face.weight, italic: face.italic });
  }
  kept.sort(faceOrder);
  return kept.slice(0, MAX_FACES_PER_FAMILY);
}

/**
 * Scan every platform font directory and parse each file's family name
 * (see the module header for the per-platform dir list). Files parse in
 * parallel; files sharing a family are folded into one entry that carries the
 * per-face FullName/PostScript/weight/style the alias layer needs, families
 * dedupe by exact name, and the list sorts for zh-CN locales.
 */
async function scanAllFonts() {
  const roots = [];
  if (process.platform === "win32") {
    if (process.env.WINDIR) roots.push({ dir: path.join(process.env.WINDIR, "Fonts"), flat: true });
    if (process.env.LOCALAPPDATA) roots.push({ dir: path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"), flat: true });
  } else if (process.platform === "darwin") {
    const home = os.homedir();
    for (const dir of ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", path.join(home, "Library", "Fonts")]) {
      roots.push({ dir, flat: false });
    }
  } else {
    const home = os.homedir();
    const xdgData = typeof process.env.XDG_DATA_HOME === "string" && process.env.XDG_DATA_HOME.startsWith("/")
      ? process.env.XDG_DATA_HOME
      : path.join(home, ".local", "share");
    for (const dir of ["/usr/share/fonts", "/usr/local/share/fonts", path.join(xdgData, "fonts"), path.join(home, ".fonts")]) {
      roots.push({ dir, flat: false });
    }
    if (isWsl()) {
      const mountRoot = await wslMountRoot();
      for (const dir of await windowsFontDirs(mountRoot)) roots.push({ dir, flat: true });
    }
  }
  const seenDirs = new Set();
  const unique = [];
  for (const root of roots) {
    const resolved = path.resolve(root.dir);
    if (seenDirs.has(resolved)) continue;
    seenDirs.add(resolved);
    unique.push(root);
  }
  const files = await collectFontFiles(unique);
  const infos = await mapLimit(files, SCAN_CONCURRENCY, (file) => readFontNames(file));
  const byFamily = new Map();
  for (const info of infos) {
    if (info === null) continue;
    let entry = byFamily.get(info.family);
    if (entry === undefined) {
      entry = { family: info.family, aliases: [], faces: [] };
      byFamily.set(info.family, entry);
    }
    for (const alias of info.aliases) {
      if (!entry.aliases.includes(alias)) entry.aliases.push(alias);
    }
    if (info.face !== undefined && info.face !== null) entry.faces.push(info.face);
  }
  const fonts = [];
  for (const entry of byFamily.values()) {
    fonts.push({ family: entry.family, aliases: entry.aliases, faces: normalizeFaces(entry.faces) });
  }
  fonts.sort((a, b) => a.family.localeCompare(b.family, "zh-CN"));
  return fonts;
}

let fontCache = null;
let fontCacheAt = 0;
let cacheRefreshing = false;
function refreshCacheInBackground() {
  if (cacheRefreshing) return;
  cacheRefreshing = true;
  scanAllFonts()
    .then((fonts) => {
      fontCache = fonts;
      fontCacheAt = Date.now();
    })
    .catch(() => {})
    .finally(() => {
      cacheRefreshing = false;
    });
}

/** Enumerate installed font families (10min cache, stale-while-revalidate). */
async function listSystemFonts() {
  if (fontCache !== null && Date.now() - fontCacheAt < CACHE_TTL) return fontCache;
  if (fontCache !== null) {
    refreshCacheInBackground();
    return fontCache;
  }
  const fonts = await scanAllFonts();
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
  // Pre-warm the enumeration cache so the first picker open is warm even
  // when the scan crosses 9p (WSL); fire-and-forget, no route depends on it.
  ctx.effect(() => {
    listSystemFonts().catch(() => {});
    return () => {};
  }, "font-settings: prewarm");
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
            fonts: fonts.map((info) => ({ name: info.family, aliases: info.aliases, faces: info.faces }))
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

/**
 * Exported for standalone testing / host-side diagnostics only — the Cordis
 * plugin contract stays (name, inject, apply).
 */
export { listSystemFonts, readFontNames };
