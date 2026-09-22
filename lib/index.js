/**
 * dsh-font-settings — host half.
 *
 * Owns the `ui-font` preference and serves it to the browser through a small
 * same-origin HTTP route set:
 *
 *   GET  /font-settings          → { ok, value: { uiFont, uiFontValue, codeFont, codeFontValue, terminalSize } }
 *   POST /font-settings          → { uiFont?, uiFontValue?, codeFont?, codeFontValue?, terminalSize? } → { ok, value }
 *   GET  /font-settings/fonts    → { ok, fonts: ["Family Name", ...] }  (installed system fonts)
 *
 * ## Where the preference lives (dsh 0.1.7-alpha.1)
 *
 * Through 0.1.6-alpha.2 this plugin registered its own settings namespace with
 * `ctx.settings.register('ui-font', schema)` and read/wrote it through the
 * returned scope. That API is GONE in 0.1.7-alpha.1 — `SettingsForms` exposes
 * neither `register()` nor `get(ns)`. Settings are Config-derived now: a
 * namespace IS a profile entry's Config, projected by `settings.describe()`
 * and written through `settings.mutate()`.
 *
 * The preference therefore moved into this plugin's OWN `Config`, declared as
 * volatile fields, and this entry's id (`font-settings`, from
 * cordis.patch.yml) is the namespace key:
 *
 *   - read:  `settings.describe()` → the row whose `ns` is this entry's id,
 *            carrying `{ value, revision }` together;
 *   - write: `settings.mutate(ns, ops, revision)` with that same revision.
 *
 * Volatility is what makes this work without a restart: the Loader commits a
 * volatile-only profile edit straight into the running Config references
 * (`_commitVolatile` in cordis-plugin-loader), and `describe()`/`mutate()`
 * both require every addressed path to be under a volatile node. The read
 * deliberately goes through `settings.describe()` rather than the live
 * `config.*.get()` references so there is exactly one read path and one write
 * path, both owned by the settings service.
 *
 * Durability is unchanged in kind — the value still lands in the profile's
 * Cordis patch. It no longer lands in `$DSH_HOME/settings.yaml`, which 0.1.7
 * retired as a settings document anyway (the settings service renames it to
 * `settings.yaml.imported` on boot and folds its sections into profile
 * entries).
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
 * and cache for 10 minutes; expiry awaits a re-scan (concurrent callers share
 * it). GET /font-settings/fonts?refresh=1 bypasses a still-fresh cache.
 * Failed scans do not extend the last successful result's TTL.
 * The boot path pre-warms through the same deduplicated scan.
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

import { createRequire } from "node:module";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Schemastery is resolved through a guarded synchronous `require` rather than a
 * static `import`, so that a missing copy degrades this plugin instead of
 * killing the whole boot.
 *
 * A static `import` that cannot resolve throws while the loader evaluates this
 * module, and the loader answers a failed mount by aborting the profile — so one
 * plugin's missing dependency takes the entire harness down. That is not
 * hypothetical: installing this package with `link:` (or any path-based
 * specifier) points the profile at a checkout whose own dependencies were never
 * installed, and every launch then died with
 * `Cannot find package '@deepseek-ai/schemastery'`.
 *
 * The resolve still has to happen at module-evaluation time, unlike the 0.4.3
 * lazily-on-first-use version: the loader reads this module's exported `Config`
 * exactly once, while evaluating it (`configOf` in dsh-app-boot). A `Config`
 * that appeared later would leave the entry permanently unconfigurable, and the
 * preference lives in `Config` now — 0.1.7 removed `settings.register`, so a
 * missing schema means nowhere to store the selection.
 *
 * A guarded `require` keeps both properties: evaluation stays infallible, and
 * `Config` exists by the time the loader looks. When neither base resolves the
 * package, `Config` is exported as `undefined` — a shape the loader tolerates
 * (it reads the entry as having no configurable fields) — and the routes answer
 * 503 while the rest of the harness runs normally.
 */
const schemasteryRequire = createRequire(import.meta.url);
/**
 * Whether one candidate module is a schemastery that can build THIS schema.
 *
 * Checking `.object` alone is not enough, and the gap is a real boot-abort:
 * schemastery 3.18.2 has no `.volatile()` (it arrived in 3.18.3), so an
 * accepted 3.18.2 throws while this module is being evaluated — and the loader
 * answers a failed evaluation by killing the whole profile. That is exactly
 * the failure 0.4.3 removed, reached by a different route: installing from the
 * npm specifier instead of a `link:` pulled schemastery 3.18.2 into the
 * profile as a real dependency, and the profile-local copy shadows the
 * harness's own.
 *
 * So the capability itself is probed, not a version string: build a throwaway
 * schema and require `.volatile` to be callable.
 * @param candidate - the resolved module namespace.
 * @returns whether it can build this plugin's Config.
 */
function canBuildVolatileSchema(candidate) {
  if (typeof candidate?.object !== "function" || typeof candidate?.string !== "function") return false;
  try {
    return typeof candidate.string().default("").volatile === "function";
  } catch (error) {
    return false;
  }
}

/**
 * Resolve a usable schemastery, trying this package's own dependency first and
 * the running harness install second.
 *
 * Every candidate is capability-probed rather than trusted, so a too-old copy
 * is skipped instead of aborting the boot; the launcher base is what rescues
 * that case, because the harness always ships the release it needs.
 * `process.argv[1]` is the launcher entry in a real `dsh` run, which is what
 * makes both a `link:`/checkout install and a plain npm install work — the
 * first cannot resolve the harness's dependency graph from its own path.
 *
 * @returns the module namespace, or null when no candidate can build the schema.
 */
function resolveSchemastery() {
  const bases = [schemasteryRequire];
  const launcher = process.argv[1];
  if (typeof launcher === "string" && launcher.length > 0) {
    try {
      bases.push(createRequire(launcher));
    } catch (error) {
      /* an unusable launcher path is not fatal — the first base may still hit */
    }
  }
  for (const base of bases) {
    try {
      const loaded = base("@deepseek-ai/schemastery");
      const resolved = loaded !== null && typeof loaded === "object" ? loaded.default ?? loaded : loaded;
      if (canBuildVolatileSchema(resolved)) return resolved;
    } catch (error) {
      /* not resolvable from this base — try the next */
    }
  }
  return null;
}
const schemastery = resolveSchemastery();

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-font-settings";

/** The routes need the web server; the settings service stays optional. */
export const inject = ["webServer"];

/** Entry id assumed when the loader hands the plugin no entry (tests, diagnostics). */
const DEFAULT_ENTRY_ID = "font-settings";

/**
 * Build the font preference schema — this plugin's `Config`, and therefore the
 * "namespace" it owns under dsh 0.1.7's Config-derived settings model (a
 * namespace IS a profile entry's Config; the entry id is the key).
 *
 * Each font slot is (mode, value):
 *  - mode "default"  → stock font stacks (no override)
 *  - mode "system"   → value = one family name from the system-font list
 *  - mode "custom"   → value = a user-supplied CSS font-family stack
 * `terminalSize` is the sidebar terminal's font size in whole px, or 0 to keep
 * whatever size the terminal ships with.
 *
 * Every field is `.volatile()`, which is what makes the row editable without a
 * restart: the Loader commits a volatile-only profile edit straight into the
 * running Config references (`_commitVolatile` in cordis-plugin-loader). It is
 * also required by the write path — `settings.mutate` refuses any path that is
 * not under a volatile node.
 *
 * Guarded even though the resolver already probed `.volatile`: this runs during
 * module evaluation, and the loader answers an evaluation failure by aborting
 * the whole profile, so ANY builder failure here must degrade to the inert path
 * rather than take the harness down. Returns undefined when there is no usable
 * schemastery, which the entry tolerates as "no configurable fields".
 *
 * @param z - a capability-probed schemastery module, or null.
 * @returns the schema, or undefined when it cannot be built.
 */
function buildFontSettingsSchema(z) {
  if (z === null) return undefined;
  try {
    return z.object({
      uiFont: z.string().default("default").volatile(),
      uiFontValue: z.string().default("").volatile(),
      codeFont: z.string().default("default").volatile(),
      codeFontValue: z.string().default("").volatile(),
      terminalSize: z.number().default(0).volatile()
    });
  } catch (error) {
    return undefined;
  }
}

export const Config = buildFontSettingsSchema(schemastery);

/** Bounds accepted for a user-chosen terminal font size, in px. */
const TERMINAL_SIZE_MIN = 8;
const TERMINAL_SIZE_MAX = 48;

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
      // `subfamily` rides along because the width variants of a family
      // ("Cond" / "ExtCond" / "SemCond") are otherwise indistinguishable, and
      // picking a condensed face for the terminal would be wrong.
      face: { fullName: identity.fullName, postScript: identity.postScript, subfamily: identity.subfamily, weight, italic }
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
/** Enumeration cache TTL; expiry awaits a re-scan. */
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
 * The CSS weights the sidebar terminal actually asks for: xterm renders base
 * text at `fontWeight: normal` and bold cells at `fontWeightBold: bold`, and
 * never requests anything else. Each shipped face is re-tagged with the weight
 * it is meant to satisfy rather than the weight the font file declares.
 */
const TERMINAL_FACE_WEIGHTS = [400, 700];

/** Subfamily markers identifying a condensed / expanded width variant. */
const NARROW_WIDTH_RE = /(cond|narrow|expanded)/i;

/** A face is only usable if it can be named in a CSS `local()` source. */
function usableSource(face) {
  return (typeof face.fullName === "string" && face.fullName.length > 0)
    || (typeof face.postScript === "string" && face.postScript.length > 0);
}

/**
 * Reduce one family's faces to the handful the terminal alias needs.
 *
 * A family can carry dozens of variants — NotoSansM Nerd Font Mono ships 36
 * files (9 weights × 4 widths) — and almost all of them are useless to a
 * terminal that only ever asks for weights 400 and 700 at normal width.
 *
 * Sorting every face by weight and truncating is actively wrong: the lightest
 * variants alone can fill every slot, Regular and Bold get dropped, and the
 * nearest face left for a 400 request is a Thin one, so the terminal renders
 * far too light. NotoSansM NFM is exactly that case — its eight 250-weight
 * faces (ExtraLight/Thin × 4 widths) crowded out both Regular and Bold.
 *
 * So select by ROLE instead: for each of normal and italic, take the
 * normal-width face nearest 400 and the one nearest 700, then re-tag them with
 * the weight they must satisfy. A bold entry is kept only when it is a
 * different face from the regular one, so a single-face family still gets
 * synthesized bold instead of silently reusing its regular for both.
 * @param faces - parsed faces of one family.
 * @returns at most four `{ fullName, postScript, weight, italic }` entries.
 */
function terminalFaces(faces) {
  const usable = faces.filter(usableSource);
  const seen = new Set();
  const picked = [];
  const add = (face, weight) => {
    const key = `${face.fullName}|${face.postScript}|${weight}|${face.italic}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({
      fullName: typeof face.fullName === "string" ? face.fullName : "",
      postScript: typeof face.postScript === "string" ? face.postScript : "",
      weight,
      italic: face.italic === true
    });
  };
  for (const italic of [false, true]) {
    const group = usable.filter((face) => (face.italic === true) === italic);
    if (group.length === 0) continue;
    // Prefer the family's normal width; only fall back to condensed/expanded
    // variants when the family offers nothing else.
    const uprightWidth = group.filter((face) => !NARROW_WIDTH_RE.test(typeof face.subfamily === "string" ? face.subfamily : ""));
    const pool = uprightWidth.length > 0 ? uprightWidth : group;
    let regular = null;
    let bold = null;
    for (const target of TERMINAL_FACE_WEIGHTS) {
      let best = null;
      let bestDistance = Infinity;
      for (const face of pool) {
        const distance = Math.abs((Number.isFinite(face.weight) ? face.weight : 400) - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = face;
        }
      }
      if (best === null) continue;
      if (target === 400) regular = best;
      else if (best !== regular) bold = best;
    }
    if (regular !== null) add(regular, 400);
    if (bold !== null) add(bold, 700);
  }
  return picked;
}

/**
 * Scan every platform font directory and parse each file's family name
 * (see the module header for the per-platform dir list). Files parse in
 * parallel; files sharing a family are folded into one entry holding the faces
 * the terminal alias needs, families dedupe by exact name, and the list sorts
 * for zh-CN locales.
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
    fonts.push({ family: entry.family, aliases: entry.aliases, faces: terminalFaces(entry.faces) });
  }
  fonts.sort((a, b) => a.family.localeCompare(b.family, "zh-CN"));
  return fonts;
}

let fontCache = null;
let fontCacheAt = 0;
let fontCachePromise = null;
/**
 * One awaited rescan; concurrent callers share it. A failed scan does not
 * certify the old data fresh: fontCacheAt stays untouched, so the next
 * request retries instead of serving the failed scan for another TTL.
 */
function scanFontsDeduplicated() {
  if (fontCachePromise !== null) return fontCachePromise;
  fontCachePromise = scanAllFonts()
    .then((fonts) => {
      fontCache = fonts;
      fontCacheAt = Date.now();
      return fonts;
    })
    .finally(() => {
      fontCachePromise = null;
    });
  return fontCachePromise;
}

/** Enumerate installed font families (10min cache; expiry awaits a fresh scan). */
async function listSystemFonts() {
  if (fontCache !== null && Date.now() - fontCacheAt < CACHE_TTL) return fontCache;
  return scanFontsDeduplicated();
}

/** Enumerate installed families, bypassing a still-fresh cache when asked. */
function listSystemFontsRefreshed() {
  return scanFontsDeduplicated();
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
 * Narrow the optional terminal font size out of a POST payload.
 * 0 clears the override (the terminal keeps its own size); any other value must
 * be a whole pixel count within bounds. Returns null when the payload carries no
 * usable size, so the caller can tell "absent" from "invalid".
 * @param payload - the parsed POST body.
 * @returns a patch object, or null.
 */
function sizeFor(payload) {
  if (payload === null || typeof payload !== "object") return null;
  const size = payload.terminalSize;
  if (typeof size !== "number" || !Number.isFinite(size)) return null;
  const px = Math.round(size);
  if (px === 0) return { terminalSize: 0 };
  if (px < TERMINAL_SIZE_MIN || px > TERMINAL_SIZE_MAX) return null;
  return { terminalSize: px };
}

/** The four font fields the GET/POST routes carry, in wire order. */
const WIRE_FIELDS = ["uiFont", "uiFontValue", "codeFont", "codeFontValue", "terminalSize"];

/** Project a settings section down to the fields the browser half reads. */
function wireValue(section) {
  const out = {};
  for (const field of WIRE_FIELDS) out[field] = section?.[field];
  return out;
}

/**
 * Read this entry's settings row through the settings service.
 *
 * dsh 0.1.7-alpha.1 removed `settings.get(ns)`; `describe()` is the surviving
 * in-process read, projecting each active entry's live Config references into
 * `{ ns, value, revision }` descriptors. One call therefore yields the value
 * and the fence it belongs to, which is what lets the write path be
 * revision-fenced without caching a revision anywhere.
 *
 * @param settings - the mounted settings service.
 * @param entryId - this entry's id, which IS the settings namespace key.
 * @returns `{ value, revision }`, or null when the entry is not present in the
 *   projection (Config undefined because schemastery was unresolvable, or the
 *   entry is inactive).
 */
function readSettings(settings, entryId) {
  const descriptor = settings.describe().find((row) => String(row.ns) === entryId);
  if (descriptor === undefined) return null;
  return {
    value: wireValue(descriptor.value),
    revision: Number(descriptor.revision) || 0
  };
}

/**
 * Persist one patch of font fields and return the committed value.
 *
 * Every addressed path must sit under a volatile node — it does, the whole
 * schema is volatile — which is what lets the Loader apply the change to the
 * running entry without a restart.
 *
 * A concurrent edit between the read and the write raises
 * `SETTINGS_CONFLICT`; that is recovered by re-reading the fence and retrying
 * once, so a lost race cannot be reported as durable success nor silently
 * discarded. A second conflict surfaces to the caller as a 409, and the client
 * keeps its optimistic state (the browser half has no conflict UI for fonts —
 * a single settings editor makes an unrecovered conflict a real anomaly rather
 * than an ordinary outcome).
 *
 * @param settings - the mounted settings service.
 * @param entryId - this entry's id.
 * @param patch - field → value edits to apply.
 * @returns the committed wire value.
 * @throws when the entry disappears or the write fails twice.
 */
async function writeSettings(settings, entryId, patch) {
  const ops = Object.entries(patch).map(([field, value]) => ({ op: "set", path: [field], value }));
  for (let attempt = 0; ; attempt++) {
    const current = readSettings(settings, entryId);
    if (current === null) throw new Error(`settings entry "${entryId}" is not configurable`);
    try {
      await settings.mutate(entryId, ops, current.revision);
      const committed = readSettings(settings, entryId);
      return committed === null ? current.value : committed.value;
    } catch (error) {
      if (error?.code !== "SETTINGS_CONFLICT" || attempt > 0) throw error;
    }
  }
}

/**
 * @param ctx - plugin context carrying webServer; settings arrives later.
 */
export function apply(ctx) {
  /**
   * This entry's id, and therefore the settings namespace this plugin owns
   * under 0.1.7's Config-derived model. Read from the live fiber because the
   * profile may rename the row; the literal is the fallback for a context with
   * no entry (unit tests, diagnostics).
   */
  const entryId = ctx.fiber?.entry?.options?.id ?? DEFAULT_ENTRY_ID;
  // Pre-warm the enumeration cache so the first picker open is warm even
  // when the scan crosses 9p (WSL); fire-and-forget, no route depends on it.
  ctx.effect(() => {
    listSystemFonts().catch(() => {});
    return () => {};
  }, "font-settings: prewarm");
  if (Config === undefined) {
    // Mount inert with the cause named, instead of having the loader abort the
    // whole profile over one unresolvable dependency. Named once, at boot.
    ctx.logger?.warn?.(
      "[dsh-font-settings] @deepseek-ai/schemastery could not be resolved, so this entry has no font Config and /font-settings will answer 503. "
      + "This is what a path-based install (`link:`) looks like when the linked checkout's own dependencies were never installed; reinstall from the published specifier."
    );
  }
  ctx.inject(["settings"], (settingsCtx) => {
    // This plugin ships its own Settings row, so suppress the auto-generated
    // page for this entry (the same policy dsh-llm-pi-ai and
    // dsh-agent-default-model use). It affects page generation only — the
    // describe()/mutate() reads and writes below are untouched.
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), "font-settings: page policy");
  });
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/font-settings",
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (req.method === "GET" && url.pathname === "/font-settings/fonts") {
          const force = url.searchParams.get("refresh") === "1";
          const fonts = await (force ? listSystemFontsRefreshed() : listSystemFonts());
          return sendJson(res, 200, {
            ok: true,
            fonts: fonts.map((info) => ({ name: info.family, aliases: info.aliases, faces: info.faces }))
          });
        }
        const settings = ctx.get("settings");
        if (settings === undefined || Config === undefined) {
          return sendJson(res, 503, { ok: false, error: "settings service unavailable" });
        }
        if (req.method === "GET" && url.pathname === "/font-settings") {
          const current = readSettings(settings, entryId);
          if (current === null) return sendJson(res, 503, { ok: false, error: "settings entry unavailable" });
          return sendJson(res, 200, { ok: true, value: current.value });
        }
        if (req.method === "POST" && url.pathname === "/font-settings") {
          let payload;
          try {
            payload = JSON.parse(await readBody(req));
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
          }
          const patch = { ...patchFor("uiFont", payload), ...patchFor("codeFont", payload), ...sizeFor(payload) };
          if (Object.keys(patch).length === 0) {
            return sendJson(res, 400, { ok: false, error: "no valid font field in payload" });
          }
          try {
            return sendJson(res, 200, { ok: true, value: await writeSettings(settings, entryId, patch) });
          } catch (error) {
            if (error?.code === "SETTINGS_CONFLICT") return sendJson(res, 409, { ok: false, error: "conflict" });
            return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
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
 * plugin contract stays (name, inject, Config, apply).
 */
export { listSystemFonts, listSystemFontsRefreshed, readFontNames, sizeFor, readSettings, writeSettings, wireValue, DEFAULT_ENTRY_ID };
