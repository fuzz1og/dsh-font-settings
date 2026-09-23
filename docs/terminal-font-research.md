# Applying a user font to the DSH sidebar terminal (xterm.js DOM renderer)

**Is the CSS-override approach valid?** Partially — but not as claimed. Injecting
`.xterm-rows, .xterm-char-measure-element { font-family: <stack> !important }` *does* win the
cascade against xterm's own injected rule and inline measure styles, so both the rendered rows and
the measurement spans compute the new font (this is exactly the local observation). What it does
**not** do is invalidate xterm's cached cell size or per-character width cache. The DOM renderer
takes its font from an injected stylesheet built from `rawOptions.fontFamily`, while the
`CharSizeService` re-measures **only** in response to option changes (`fontFamily`/`fontSize`),
a real resize, a device-pixel-ratio change, or a hidden→visible transition. A pure CSS change fires
none of those, so glyphs advance at the new font's width while `dimensions.css.cell.*`, cursor
geometry, selection rectangles, row heights and default letter spacing stay at the old metrics —
i.e. rendering and measurement diverge. The officially supported and universally used mechanism is
the options API (`term.options.fontFamily = …`), which re-measures; the CSS override is only safe
if it is paired with a forced re-measure. Chrome is also prototyping a privacy restriction that
would limit CSS `font-family` to OS-default fonts, which is a long-term risk to any local-font
approach.

---

## Primary-source findings

The terminal plugin bundles **`@xterm/xterm` ^6.0.0** (devDependencies in
`@deepseek-ai/dsh-client-ui-sidebar-terminal/package.json`; the package itself is version
`0.1.7-alpha.2`). Source citations below use the `6.0.0` tag where the bundled code matches it,
and `master` to note where current xterm differs.

### 1. Where the DOM renderer takes its font-family

- The DOM renderer defines `ROW_CONTAINER_CLASS = 'xterm-rows'` and adds it to the row container
  ([DomRenderer.ts @6.0.0 L21, L68](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/renderer/dom/DomRenderer.ts#L21-L68)).
- **Yes, it is a stylesheet rule injected by `_injectCss()`.** That method creates a `<style>`
  element, appends it to `_screenElement`, and writes a rule whose body includes
  `font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: …px; font-kerning: none; white-space: pre`
  ([DomRenderer.ts @6.0.0 L156-L174](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/renderer/dom/DomRenderer.ts#L156-L174)).
- The selector is prefixed by `_terminalSelector`, which is
  `.xterm-dom-renderer-owner-<n>` ([DomRenderer.ts @6.0.0 L474](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/renderer/dom/DomRenderer.ts#L474);
  the bundled copy confirms `get _terminalSelector() { return "." + prefix + this._terminalClass }`).
  So the emitted rule is effectively
  `.xterm-dom-renderer-owner-N .xterm-rows { … font-family: … }` — specificity (0,2,0), **no
  `!important`**. An author rule `.xterm-rows { font-family: X !important }` wins regardless of
  specificity because author `!important` outranks author normal.
- In current `master` xterm additionally applies `font-family`/`font-size` to
  `.xterm-rows, .xterm-rows span`
  ([DomRenderer.ts @master L193-L199](https://github.com/xtermjs/xterm.js/blob/master/src/browser/renderer/dom/DomRenderer.ts#L193-L199)).
  The bundled 6.0.0 only sets it on `.xterm-rows`; spans inherit it.
- **`.xterm-char-measure-element` is the DOM measurement element, and it is used in two places:**
  1. `CharSizeService`'s `DomMeasureStrategy` creates a `<span class="xterm-char-measure-element">`
     containing `"W".repeat(32)` and, in `measure()`, sets
     `this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily` (an
     **inline** style) before reading `offsetWidth / 32` and `offsetHeight`
     ([CharSizeService.ts @6.0.0 L84-L98](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/CharSizeService.ts#L84-L98)).
  2. `WidthCache` creates a `.xterm-width-cache-measure-container` holding four
     `.xterm-char-measure-element` spans (normal/bold/italic/bold-italic) and sets the font on the
     *container* via `setFont()`; per-character widths are cached from these spans
     (bundled `client.terminal.js` L1686-L1730; mirrored in
     [DomRenderer.ts @master](https://github.com/xtermjs/xterm.js/blob/master/src/browser/renderer/dom/DomRenderer.ts)).
  A rule targeting `.xterm-char-measure-element` with `!important` overrides the inline
  `style.fontFamily` (author `!important` beats inline non-important), which is why the live
  `offsetWidth/32` changed from 7.15625 to 9.75.
- **Presence over time.** `xterm-rows` + the options-driven `font-family` rule are present in
  [3.14.5](https://github.com/xtermjs/xterm.js/blob/3.14.5/src/renderer/dom/DomRenderer.ts),
  [5.0.0](https://github.com/xtermjs/xterm.js/blob/5.0.0/src/browser/renderer/dom/DomRenderer.ts),
  [6.0.0](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/renderer/dom/DomRenderer.ts)
  and master. `xterm-char-measure-element` is verified in 6.0.0 and master; it is long-standing but
  I did not fetch every intermediate tag.

### 2. Does a pure CSS font change keep measurement and rendering consistent?

**No.** The measurement cache is not invalidated by CSS.

- `hasValidSize` is simply `width > 0 && height > 0`
  ([CharSizeService.ts @6.0.0 L18](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/CharSizeService.ts#L18)).
- The **only** option-driven re-measure is:
  `this._register(this._optionsService.onMultipleOptionChange(['fontFamily', 'fontSize'], () => this.measure()))`
  ([CharSizeService.ts @6.0.0 L34](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/CharSizeService.ts#L34)).
  `measure()` fires `onCharSizeChange` only when the measured width/height actually changed
  ([CharSizeService.ts @6.0.0 L37-L44](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/CharSizeService.ts#L37-L44)).
- Other invalidation paths: a real resize (`_afterResize` → `measure()`,
  [CoreBrowserTerminal.ts @6.0.0 L1233-L1234](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L1233-L1234));
  a hidden terminal becoming visible while `!hasValidSize` (RenderService, bundled copy L2173); and
  a device-pixel-ratio change (`handleDevicePixelRatioChange`, bundled copy L1454).
- **A pure CSS change fires none of these.** Consequently `dimensions.css.cell.width/height`, row
  heights/line-height, cursor and selection geometry (all derived in `_updateDimensions()`), and the
  `WidthCache` contents stay at the old font's metrics (bundled copy L1433-L1452). This is precisely
  the reported observation: the measure span's width changed, but xterm's cached dimensions did not.
- **Changing an option via the public API does trigger a re-measure.** The options setter fires
  `_onOptionChange.fire(propName)` only when the value actually changes
  ([OptionsService.ts @6.0.0 L119-L136](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/OptionsService.ts#L119-L136)),
  and `onMultipleOptionChange` filters those events by key
  ([OptionsService.ts @6.0.0 L111-L117](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/OptionsService.ts#L111-L117)).
  The chain is:
  `term.options.fontFamily = x` → `CharSizeService.measure()` → (if size changed)
  `onCharSizeChange` → render service dimensions change → `DomRenderer.handleCharSizeChanged()`
  → `_updateDimensions()`, `_widthCache.clear()`, `_setDefaultSpacing()` (bundled copy L1467-L1469),
  and `_handleOptionsChanged()` also rewrites the injected CSS and re-seeds the width cache
  (bundled copy L1500-L1502).
- Caveat: **`term.resize(cols, rows)` with unchanged dimensions does *not* force a re-measure** once
  the size is valid — it only measures if `!hasValidSize`
  ([CoreBrowserTerminal.ts @6.0.0 L1221-L1228](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L1221-L1228)).

### 3. The officially supported way to change a mounted terminal's font

Use the options API on the live instance:

- `terminal.options.fontFamily = '…'`, or assign multiple options with
  `terminal.options = { fontFamily: '…', fontSize: 12 }`.
  The typings document: *"Gets or sets the terminal options. This supports setting multiple
  options"*, with exactly those examples
  ([xterm.d.ts @6.0.0](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts);
  implemented by `public get options()` / `public set options()`
  [public/Terminal.ts @master L130-L136](https://github.com/xtermjs/xterm.js/blob/master/src/browser/public/Terminal.ts#L130-L136)).
- `fontFamily` is a normal runtime option: *"The font family used to render text."*
  ([ITerminalOptions.fontFamily](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#optional-fontfamily)).
  Only `cols`/`rows` are constructor-only (`CONSTRUCTOR_ONLY_OPTIONS = ['cols', 'rows']`,
  [public/Terminal.ts @master L19-L63](https://github.com/xtermjs/xterm.js/blob/master/src/browser/public/Terminal.ts#L19-L63)).
- This is supported after `open()` and it is the path that re-measures (see §2).

### 4. How other browser-terminal projects apply a user font

All the ones I could verify use the **options API**, not a `.xterm-rows` CSS override.

| Project | Mechanism | Source |
| --- | --- | --- |
| VS Code | passes `fontFamily: font.fontFamily` into `new xtermCtor({…})`; `terminal.integrated.fontFamily` defaults to `editor.fontFamily` | [xtermTerminal.ts L241-L255](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts#L241-L255), [terminalConfiguration.ts L179-L181](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L179-L181) |
| Hyper | `getTermOptions()` sets `fontFamily`/`fontSize`; on prop change `this.term.options = pickBy(nextTermOptions, …)` then `fitResize()` | [term.tsx L51-L62](https://github.com/vercel/hyper/blob/canary/lib/components/term.tsx#L51-L62), [L172](https://github.com/vercel/hyper/blob/canary/lib/components/term.tsx#L172), [L451-L473](https://github.com/vercel/hyper/blob/canary/lib/components/term.tsx#L451-L473) |
| Tabby | `this.xterm.options.fontFamily = getCSSFontFamily(config)` (also `fontWeight`, `fontSize`, `lineHeight`) | [xtermFrontend.ts L700-L714](https://github.com/Eugeny/tabby/blob/master/tabby-terminal/src/frontends/xtermFrontend.ts#L700-L714) |
| JupyterLab | on a settings change: `this._term.options.fontFamily = value` / `fontSize = value` | [widget.ts L208-L212](https://github.com/jupyterlab/jupyterlab/blob/main/packages/terminal/src/widget.ts#L208-L212) |
| Theia | `new Terminal({ fontFamily: preferences['terminal.integrated.fontFamily'], … })` and at runtime `this.term.options.fontFamily = …` | [terminal-widget-impl.ts L257-L262](https://github.com/eclipse-theia/theia/blob/master/packages/terminal/src/browser/terminal-widget-impl.ts#L257-L262), [L432-L433](https://github.com/eclipse-theia/theia/blob/master/packages/terminal/src/browser/terminal-widget-impl.ts#L432-L433) |
| code-server | reuses VS Code's terminal, so the same options path (no independent font code) | [coder/code-server](https://github.com/coder/code-server) |
| ttyd | no font setting exposed; terminal options are passed through `XtermOptions`; no CSS override | [terminal/index.tsx](https://github.com/tsl0922/ttyd/blob/main/html/src/components/terminal/index.tsx), [README](https://github.com/tsl0922/ttyd/blob/main/README.md) |
| gotty | config `.gotty` exposes `font_family` / `font_size` / `font_smoothing` (hterm-style preferences; supports `--term xterm` or `hterm`) | [.gotty L207-L214](https://github.com/yudai/gotty/blob/master/.gotty#L207-L214), [README](https://github.com/yudai/gotty/blob/master/README.md) |

I found **no** project in this set that overrides `.xterm-rows` via CSS. That is absence of evidence,
not proof of absence, but it is consistent with the fact that the options API is the documented and
re-measuring path.

### 5. Relevant xterm.js issues / PRs

- **#3645 "On change of browser preference font name, the terminal is not refreshing automatically"**
  — the reporter uses a CSS override (`:not(.xterm) { font-family: ""; }`) to follow the browser
  preference; it works initially but does not refresh when the font changes while the terminal is
  open. This is direct first-party evidence that an external CSS font change does not refresh
  xterm. [xtermjs/xterm.js#3645](https://github.com/xtermjs/xterm.js/issues/3645)
- **#1164 "Better support for web fonts"** — xterm does not reliably pick up a custom `fontFamily`
  on some hard refreshes; asks for a recommended webfont-loading flow. The lesson is to ensure the
  font is loaded before measuring (e.g. `document.fonts.ready` / `FontFaceSet.load`).
  [xtermjs/xterm.js#1164](https://github.com/xtermjs/xterm.js/issues/1164)
- **#1499 "setOption fontSize and fontWeight changes fontFamily"** — a 3.x-era bug in the option
  path. [xtermjs/xterm.js#1499](https://github.com/xtermjs/xterm.js/issues/1499)
- **#5164 "font issues in DOM renderer"** — DOM-renderer font rendering problems.
  [xtermjs/xterm.js#5164](https://github.com/xtermjs/xterm.js/issues/5164)
- **PR #3089 "Render initially hidden terminal when visible"** — touches the
  `hasValidSize`/measure-when-visible path that matters for terminals mounted hidden.
  [xtermjs/xterm.js#3089](https://github.com/xtermjs/xterm.js/pull/3089)
- A GitHub issue search for `hasValidSize` returns only that PR; there is no dedicated public API
  to force a re-measure.
- *Limitation:* GitHub's unauthenticated API rate-limited mid-research and issue pages are
  JS-rendered, so I could not read the full comment threads; conclusions above are drawn from issue
  titles and descriptions.

### 6. Getting the live Terminal instance from the DOM

- **xterm has no element→instance API.** The public API goes the other way only: `Terminal.element`,
  `Terminal.screenElement`, `Terminal.textarea`
  ([public/Terminal.ts @master L85-L94](https://github.com/xtermjs/xterm.js/blob/master/src/browser/public/Terminal.ts#L85-L94)).
- `open(parent)` creates `this.element = document.createElement('div')`, adds the `terminal`/`xterm`
  classes, appends it to `parent`, and later appends the viewport/helpers fragment. **It attaches no
  property, `WeakMap` entry, dataset or global to the element**
  ([CoreBrowserTerminal.ts @6.0.0 L438-L468](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L438-L468),
  [L560-L572](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L560-L572)).
  `onWillOpen` exists only on the core terminal, not on the public `Terminal` class.
- In DSH the instance is held in a React ref: `TerminalScreen` does
  `const terminal = useRef(); … terminal.current = xterm;` inside `useLayoutEffect`
  (bundled `client.terminal.js` L13386-L13437). The `.xterm` node is created imperatively by xterm,
  so it is **not** a React-managed node and carries no fiber key; its React-managed parent (the ref
  target `element.current`) does.
- Therefore the only DOM route is **React-fiber traversal**: read the internal
  `__reactFiber$<random>` key React attaches to managed elements
  ([Stack Overflow #78137532](https://stackoverflow.com/questions/78137532/struggling-with-reactfiber-property-react-attaches-to-elements-inside-its-v)),
  then walk the fiber/hook chain to find the ref whose `.current` exposes `.options`. This is
  undocumented React-internal behaviour, not a supported xterm or React API, and can break on React
  upgrades. No WeakMap registry for terminals was found in xterm or in the DSH bundles.

### 7. CSS Fonts `local()` and Chrome's local-fonts restriction

- **`local()` does not match the family name.** CSS Fonts 3 §src descriptor: *"For OpenType and
  TrueType fonts, this string is used to match only the Postscript name or the full font name in the
  name table of locally available fonts… Platform substitutions for a given font name must not be
  used."* [w3.org/TR/css-fonts-3/#src-desc](https://www.w3.org/TR/css-fonts-3/#src-desc)
- MDN repeats this: `<font-face-name>` *"is used to match either the Postscript name or the full
  font name… uniquely identifies a single font face within a larger family."*
  [MDN @font-face/src](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src#localfont-face-name)
- **Discrepancy to flag:** the current CSS Fonts 4 editor's draft grammar writes
  `local( <<font-family-name>> )`
  ([drafts.csswg.org/css-fonts-4/#font-face-src-parsing](https://drafts.csswg.org/css-fonts-4/#font-face-src-parsing),
  [Overview.bs L2821](https://github.com/w3c/csswg-drafts/blob/main/css-fonts-4/Overview.bs#L2821)),
  which reads as a family name and conflicts with the implementation/MDN behaviour. Treat the
  PostScript/full-name rule as the operative one for browsers today.
- **Chrome "Intent to Prototype: Limiting Access to Local Fonts" is *not* shipped.** The blink-dev
  thread is [groups.google.com/a/chromium.org/g/blink-dev/c/UBFXwrOu6ow](https://groups.google.com/a/chromium.org/g/blink-dev/c/UBFXwrOu6ow)
  (mirror: [mail-archive msg13294](https://www.mail-archive.com/blink-dev@chromium.org/msg13294.html)).
  The explainer is
  [github.com/explainers-by-googlers/limiting-local-fonts-access](https://github.com/explainers-by-googlers/limiting-local-fonts-access)
  and states: *"This proposal is an early design sketch by Chrome… It has not been approved to ship
  in Chrome."* It aims to *"reduce the number of local fonts that a webpage can load by limiting the
  returned list of fonts to default system fonts shipped by the operating system"*, and its goals
  explicitly include addressing *"CSS font-family, CSS @font-face and Canvas text rendering"*, with
  the Local Font Access API able to grant a specific origin access to all installed fonts. Linux is
  an explicit non-goal.
- Status evidence: [chromestatus feature 5185489285677056](https://chromestatus.com/feature/5185489285677056)
  was last updated 2025-06-30, records the feature as in development (its in-development stage
  carries `desktop_first: 145`), with no rollout milestone; the
  [Chrome 145 release notes](https://developer.chrome.com/release-notes/145) contain no such change;
  the CSSWG is discussing it in
  [w3c/csswg-drafts#11753](https://github.com/w3c/csswg-drafts/issues/11753). Safari already limits
  local fonts to OS-bundled ones ([WebKit Tracking Prevention](https://webkit.org/tracking-prevention/)).
- **Implication:** if this ever ships as described, a user-installed Nerd Font referenced only by
  `font-family` (or by `local()`) could stop resolving for web content, unless the origin holds the
  `local-fonts` permission. A webfont served over `@font-face url()` is unaffected.

### 8. `queryLocalFonts()` support and requirements

- **Secure context only**, and permission `local-fonts` must be granted (status queryable via the
  Permissions API). It must be called with **transient user activation** — MDN lists `SecurityError`
  when *"it was not called via a user interaction such as a button press"*, and `NotAllowedError`
  when the user denies the prompt.
  [MDN Window.queryLocalFonts()](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)
- Returns a `Promise<FontData[]>`; each `FontData` exposes `family`, `fullName`, `postscriptName`,
  `style` and `blob()`.
  [MDN FontData](https://developer.mozilla.org/en-US/docs/Web/API/FontData)
- **Support:** Chrome/Edge desktop **103+**; **not** supported in Firefox, Safari, or Chrome for
  Android. Chrome's own docs: *"available from Chrome 103 on desktop."*
  [Chrome: Use advanced typography with local fonts](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts),
  [caniuse: queryLocalFonts](https://caniuse.com/mdn-api_window_querylocalfonts)
- The WICG explainer explicitly notes user activation is required and that access is restricted to
  secure contexts / the top frame, with results sorted to reduce fingerprinting entropy.
  [WICG/local-font-access](https://github.com/WICG/local-font-access)
- Chrome also ships an enterprise policy, `DefaultLocalFontsSetting`, to deny the local-fonts
  permission by default ([Chrome Enterprise policy](https://chromeenterprise.google/policies/default-local-fonts-setting/)).

---

## Comparison of options

### A. CSS override of `.xterm-rows` / `.xterm-char-measure-element`

- **Mechanism:** inject an author stylesheet before mount, e.g.
  `.xterm-rows, .xterm-char-measure-element { font-family: <stack> !important }`. The `!important`
  beats both xterm's non-important injected rule and the inline measure styles (§1).
- **Evidence:** xterm's rule and inline measure styles are source-verified (§1); the local live test
  showed computed style and the measure span changing. It does not re-measure (§2, issue #3645).
- **Robustness:** low. Rendering follows the new font, but cell size, width cache, cursor/selection
  geometry and line height remain stale → columns drift, misaligned cursor/selection, wrong
  letter-spacing. Needs a separate forced re-measure to be correct.
- **Failure modes:** inconsistent metrics; more visible with a font whose advance width differs a
  lot (a Nerd Font vs. the default stack). Also brittle if upstream renames selectors or adds
  `!important`; and future Chrome local-font restrictions could break the referenced local font.
- **Effort:** very low (a few lines), but incomplete.

### B. Obtain the Terminal instance and use the supported options API

- **Mechanism:** reach the live `Terminal` (React-fiber traversal from the ref-target node, §6) and
  set `term.options.fontFamily = stack` (or `term.options = {…}`), optionally calling `fit()` on the
  FitAddon if reachable, or nudging the container so the host's `ResizeObserver` re-fits.
- **Evidence:** the options API is documented (§3) and is what VS Code/Hyper/Tabby/JupyterLab/Theia
  use (§4); it triggers `CharSizeService.measure()` and `WidthCache.clear()` (§2).
- **Robustness:** functionally correct (measurement and rendering stay consistent) but depends on
  React internals and on the exact closure shape, so it is fragile across React/DSH upgrades.
- **Failure modes:** fiber layout changes, multiple terminals on the page, minified/obfuscated
  component structure, refs not in the walked hook chain.
- **Effort:** medium; needs defensive fallbacks and testing per DSH/React version.

### C. Current `@font-face` + `local()` alias approach

- **Mechanism:** define `@font-face { font-family: <alias>; src: local("<fullName>"), local("<postscriptName>"); }`
  and reference the alias. Because `local()` matches only full/PostScript names (§7), the alias must
  be generated from `queryLocalFonts()`'s `fullName`/`postscriptName` (or the OS font metadata).
- **Evidence:** the matching rule is spec'd (§7); `queryLocalFonts` is desktop-Chromium-only and
  requires a gesture + permission (§8).
- **Robustness:** medium. It works with xterm's own stack resolution but only as well as the CSS
  cascade lets it (it is still a font change xterm does not re-measure), and it depends on
  `queryLocalFonts` availability. `size-adjust` can approximate the original metrics but is not
  guaranteed to match them.
- **Failure modes:** silent failure when only a family name is known; no enumeration on Firefox/
  Safari/Chrome-Android; permission denial; future local-font restrictions.
- **Effort:** medium; the plugin already owns this path.

### D. Ask upstream for a supported font hook

- **Mechanism:** request that `@deepseek-ai/dsh-client-ui-sidebar-terminal` read the user font from a
  `Config`/prop/cordis service and pass it into the `new Terminal({ fontFamily, fontSize })` call
  (and re-apply via `term.options` on change).
- **Evidence:** the constructor hardcodes `fontSize: 13` and the font stack (bundled
  `client.terminal.js` L13402-L13408); the ecosystem norm is exactly this options plumbing (§3, §4).
- **Robustness:** highest — supported, re-measuring, no DOM hacks, no permission prompts, survives
  refactors.
- **Failure modes:** depends on upstream acceptance and release timing.
- **Effort:** low for the client change, but external dependency.

---

## Recommended implementation

1. **Preferred:** ask upstream for the hook (option D). Until then, treat the CSS override as a
   *rendering-only* enhancement and always pair it with a re-measure.
2. **If touching the DOM is acceptable:** use the fiber route (option B) as the primary mechanism,
   because only the options API re-measures. Keep the CSS override as a fallback for when the fiber
   walk fails.

### Code sketch

~~~js
var STACK = "'NotoSansM Nerd Font Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// --- Fallback: make rendering follow the user font even without the instance ---------
function injectTerminalFontCss(stack) {
  var id = "font-settings-terminal-font";
  var style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
  }
  // xterm 6.0.0 emits ".xterm-dom-renderer-owner-N .xterm-rows { font-family: <opt> }"
  // (no !important) and sets style.fontFamily inline on ".xterm-char-measure-element".
  // Author !important outranks both. ".xterm-rows span" is added for current master.
  style.textContent =
    ".xterm-rows, .xterm-rows span," +
    ".xterm-char-measure-element, .xterm-width-cache-measure-container" +
    "{ font-family: " + stack + " !important; }";
}

// --- Primary: reach the live Terminal through React internals, use the options API ---
function findXtermInstance(reactManagedNode) {
  var key = Object.keys(reactManagedNode)
    .find(function (k) { return k.indexOf("__reactFiber$") === 0; });
  if (!key) return undefined;
  var seen = new Set();
  var queue = [reactManagedNode[key]];
  while (queue.length) {
    var fiber = queue.shift();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    for (var hook = fiber.memoizedState; hook; hook = hook.next) {
      var value = hook.memoizedState;
      if (value && typeof value === "object" && value.current &&
          value.current.options && "fontFamily" in value.current.options) {
        return value.current; // the Terminal instance
      }
    }
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }
  return undefined;
}

function applyTerminalFont(stack) {
  injectTerminalFontCss(stack);                       // always: covers rendering
  var xtermEl = document.querySelector(".xterm");
  var host = xtermEl && xtermEl.parentElement;        // React-managed ref target
  var term = host && findXtermInstance(host);
  if (!term) return;                                  // CSS-only; metrics may be stale
  // Force onOptionChange to fire so CharSizeService.measure() + WidthCache.clear() run.
  if (term.options.fontFamily === stack) term.options.fontFamily = stack + " ";
  term.options.fontFamily = stack;
  // xterm does not re-fit cols/rows on a font change; the host's ResizeObserver on the
  // container normally does. If you can reach the FitAddon, call fit() after this.
}
~~~

### Re-measure caveat (the important part)

- **The options assignment is what makes it correct, not the stylesheet.** `term.options.fontFamily = stack`
  fires `onOptionChange('fontFamily')` → `CharSizeService.measure()` → `DomRenderer.handleCharSizeChanged()`
  → `_widthCache.clear()` + `_setDefaultSpacing()` (§2).
- The setter only fires when the value actually changes, hence the sentinel write when the stack
  already equals the current option value.
- `term.resize(term.cols, term.rows)` is **not** a re-measure workaround once the size is valid
  (§2). A genuine resize, a DPR change, or the host's container `ResizeObserver` are the only other
  triggers.
- Make sure the font is actually loaded before the first measure (e.g. `await document.fonts.ready`
  or `FontFaceSet.load()`), otherwise the first measurement can use a fallback face
  (cf. issue #1164).
- If you cannot reach the instance, be explicit that the CSS-only path is best-effort: rendering
  follows the font but cell metrics may be stale.

---

## Local empirical validation (executed)

Environment: DSH `0.1.7-alpha.2`, bundled `@xterm/xterm ^6.0.0`, DOM renderer (only `FitAddon` loaded),
headless Chromium driven against a real sidebar terminal on `http://127.0.0.1:3081` (Playwright).

**Test 1 — CSS override alone (option A).** Injected
`.xterm-rows,.xterm-char-measure-element{font-family:'Arial',monospace!important}`:

| probe | before | after |
| --- | --- | --- |
| `getComputedStyle(.xterm-rows).fontFamily` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `Arial, monospace` |
| `getComputedStyle(.xterm-char-measure-element).fontFamily` | `ui-monospace, …` | `Arial, monospace` |
| measure span `offsetWidth/32` | 7.15625 | 9.75 |
| `.xterm-screen` inline width (xterm cached metrics) | 543px | **543px (unchanged)** |

The cascade win is real, the re-measure is not: xterm kept its cached cell geometry, so rendering and
measurement diverge exactly as §2 predicts. **Option A alone is rendering-only, not correct.**

**Test 2 — React-fiber route + supported options API (option B).** The `.xterm` node has **zero own enumerable
keys** (nothing attached by `open()`); the `__reactFiber$…` key sits on its React-managed ancestor.
Walking the ancestor fiber and scanning hook state found the live Terminal ref at ancestor depth 1,
hook index 1, fiber type `TerminalScreen`.

| assignment | rows font | measure cell w | measure cell h | `.xterm-screen` width |
| --- | --- | --- | --- | --- |
| baseline | `ui-monospace, …` | 7.15625 | 15 | 543px |
| `term.options.fontFamily = "'Arial', monospace"` | `Arial, monospace` | 9.75 | – | **933px (re-measured)** |
| restored to baseline | `ui-monospace, …` | 7.15625 | – | 543px |
| `term.options.fontSize = 20` | `ui-monospace, …` | **11** | **23** | **836px (re-measured)** |

0 console errors. So option B is effective end-to-end in the shipping app: it changes the font **and** forces
xterm’s own re-measure, and it also replaces the whole `size-adjust` machinery for the terminal-size feature
(`fontSize` is a first-class option).

---

## Uncertainties / what could not be verified

- **xterm issue comment threads were not readable.** GitHub's unauthenticated API rate-limited and
  the issue pages are JS-rendered, so §5 conclusions come from titles and the issue
  descriptions/meta descriptions, not from maintainer replies. No specific maintainer statement
  telling users to use the options API was retrieved; the options API recommendation follows from
  the source and docs.
- **"Since which version" is only partially established.** `xterm-rows` + the options-driven
  `font-family` rule are verified in 3.14.5, 5.0.0, 6.0.0 and master; `xterm-char-measure-element`
  is verified in 6.0.0 and master. I did not fetch every intermediate tag, and `4.0.0` at the path I
  tried returned 404.
- **CSS Fonts 4 grammar conflict.** The editor's draft writes `local( <<font-family-name>> )` while
  CSS Fonts 3, MDN and browser behaviour use PostScript/full name. I did not resolve which wording
  the final spec will adopt.
- **Chrome restriction status.** The explainer says it is not approved to ship; chromestatus
  (updated 2025-06-30) shows it in development with `desktop_first: 145` and no rollout milestone,
  and Chrome 145 release notes contain no such change. I could not fully rule out a staged/flagged
  rollout, so treat the "not shipped" conclusion as of the last verifiable data.
- **Tabby / ttyd / gotty / code-server** were verified at the level shown in §4; I did not trace
  their full runtime update paths. gotty's config is documented as hterm-style preferences and it
  supports both frontends, so its exact xterm mapping was not confirmed.
- ~~The fiber approach was not executed end-to-end~~ — **resolved**: it was executed against a live
  terminal (see "Local empirical validation"); the ref was found at ancestor depth 1 / hook index 1 in
  the `TerminalScreen` fiber, and `term.options.fontFamily` / `term.options.fontSize` both re-measured.
- **Bundled xterm version.** The plugin's `package.json` declares `@xterm/xterm ^6.0.0`; the
  bundled code matches 6.0.0's renderer, while `master` has since started applying `font-family` to
  `.xterm-rows span` too. A future DSH upgrade could change the selectors and invalidate option A.

---

## Addendum — which name `local()` and `queryLocalFonts()` actually use (verified)

Measured on the same live Chromium (FontFace API for `local()`, the plugin's own LFA index for `queryLocalFonts()`):

| font | nameID 1 (family) | nameID 16 (typographic family) | `local()` accepts | LFA `FontData.family` reports |
| --- | --- | --- | --- | --- |
| Consolas | `Consolas` | – | `Consolas` (family == fullName == postScript) | `Consolas` |
| Cascadia Code | `Cascadia Code` | – | `Cascadia Code Regular` / `CascadiaCode-Roman` only | `Cascadia Code` |
| Mononoki Nerd Font | `Mononoki Nerd Font` | – | `Mononoki Nerd Font Regular` / `MononokiNF-Regular` only | `Mononoki Nerd Font` |
| DejaVu Sans Condensed | `DejaVu Sans Condensed` | `DejaVu Sans` | – | **`DejaVu Sans`** (nameID 1 absent from LFA) |
| Candara Light | `Candara Light` | `Candara` | – | **`Candara`** |
| DengXian Light | `DengXian Light` | `DengXian` | – | **`DengXian`** |
| JetBrainsMono Nerd Font | `JetBrainsMono NF` | `JetBrainsMono Nerd Font` | `JetBrainsMono NF Regular` / `JetBrainsMonoNF-Regular` | nameID 16 (by the same rule) |
| NotoSansM Nerd Font Mono | `NotoSansM NFM` | `NotoSansM Nerd Font Mono` | `NotoSansM NFM Reg` / `NotoSansMNFM-Reg` | nameID 16 (by the same rule) |

Two consequences the plugin design must respect:

1. `local()` never matches a family name — neither nameID 1 nor nameID 16. So a stored value that is only a family name
   cannot produce an alias unless the LFA index supplied the face's fullName/postScript.
2. `queryLocalFonts()` reports the **typographic family (nameID 16)** when present, falling back to nameID 1. That is
   exactly the value the plugin (and the old host parser) stores, so for installed fonts the exact-name lookup in
   `buildTerminalAliasCss` normally hits once the user has read local fonts.
