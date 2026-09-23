/**
 * dsh-font-settings — host half.
 *
 * The host owns exactly one thing: this entry's `Config`, which is also the
 * settings namespace the browser half writes through the official
 * `configForms` channel. There is no route, no file access, no environment
 * probing and no process spawning here — the module is deliberately inert so a
 * fixed-source reviewer can see the whole host surface at a glance.
 *
 * ## Why the host declares a Config and does nothing else
 *
 * Under dsh 0.1.7 a settings namespace IS a profile entry's Config: the
 * settings service projects every active entry's volatile fields through
 * `describe()`, and the browser reaches them through
 * `ctx.configForms.get(entryId)` on loopback. The five fields below are the
 * durable preference; the browser half reads and writes them, and falls back
 * to per-device browser storage when the page is not loopback.
 *
 * Each font slot is (mode, value):
 *  - mode "default"  → the app's built-in stacks (no override)
 *  - mode "system"   → value = one concrete family name
 *  - mode "custom"   → value = a user-supplied CSS font-family stack
 * `terminalSize` is the sidebar terminal's font size in whole px, or 0 to keep
 * the terminal's own size.
 *
 * Every field is `.volatile()`, which is what makes the row editable without a
 * restart: the Loader commits a volatile-only profile edit straight into the
 * running Config references (`_commitVolatile` in cordis-plugin-loader). It is
 * also required by the write path — the settings service refuses any path that
 * is not under a volatile node.
 *
 * ## Font enumeration is a browser concern
 *
 * Installed fonts are enumerable only from the browser, through the Local Font
 * Access API (`window.queryLocalFonts()`, Chromium desktop only, permission +
 * user gesture). The host does not scan font directories, does not read font
 * files, and does not ship a list: a remote page must see the fonts of the
 * machine the user is actually looking at. See lib/client.js.
 */

import { createRequire } from "node:module";

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
 * The resolve still has to happen at module-evaluation time: the loader reads
 * this module's exported `Config` exactly once, while evaluating it
 * (`configOf` in dsh-app-boot). A `Config` that appeared later would leave the
 * entry permanently unconfigurable, and the preference lives in `Config` now —
 * 0.1.7 removed `settings.register`, so a missing schema means nowhere to store
 * the selection.
 *
 * A guarded `require` keeps both properties: evaluation stays infallible, and
 * `Config` exists by the time the loader looks. When neither base resolves the
 * package, `Config` is exported as `undefined` — a shape the loader tolerates
 * (it reads the entry as having no configurable fields) — and the browser half
 * degrades to its per-device storage path.
 */
const schemasteryRequire = createRequire(import.meta.url);

/**
 * Whether one candidate module is a schemastery that can build THIS schema.
 *
 * Checking `.object` alone is not enough: schemastery 3.18.2 has no
 * `.volatile()` (it arrived in 3.18.3), so an accepted 3.18.2 throws while this
 * module is being evaluated — and the loader answers a failed evaluation by
 * killing the whole profile. The capability itself is probed, not a version.
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

/**
 * No required services: the host half only declares Config, and the settings
 * page policy below is applied through an optional child fiber. A missing
 * settings service must not stop the entry (and therefore the Config) from
 * mounting.
 */
export const inject = [];

/**
 * Build the font preference schema — this plugin's `Config`, and therefore the
 * settings namespace it owns under dsh 0.1.7's Config-derived model.
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

/**
 * @param ctx - plugin context. Nothing is required; settings is optional.
 */
export function apply(ctx) {
  if (Config === undefined) {
    // Mount inert with the cause named, instead of having the loader abort the
    // whole profile over one unresolvable dependency. Named once, at boot.
    ctx.logger?.warn?.(
      "[dsh-font-settings] @deepseek-ai/schemastery could not be resolved, so this entry has no font Config and the preference falls back to per-device browser storage. "
      + "This is what a path-based install (`link:`) looks like when the linked checkout's own dependencies were never installed; reinstall from the published specifier."
    );
  }
  ctx.inject(["settings"], (settingsCtx) => {
    // This plugin ships its own Settings row, so suppress the auto-generated
    // page for this entry. It affects page generation only — the browser's
    // configForms reads/writes of the Config fields are untouched.
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), "font-settings: page policy");
  });
}
