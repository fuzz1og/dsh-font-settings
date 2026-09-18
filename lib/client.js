/**
 * dsh-font-settings — client half.
 *
 * Registers one preference row into Settings → General (settings.general.item,
 * the same list slot the Appearance row occupies) with two selector segments:
 * the UI font (--dsw-font-family) and the code/monospace font
 * (--ds-font-family-code). Both variables are defined once on :root in the
 * base token sheet and referenced by every --dsw-font-* typography token, so
 * overriding them via the theme service's overrideTokens() (which ui-layout's
 * theme presenter projects onto <body> as inline variables) changes every
 * text surface in the app, in both color schemes. The code font additionally
 * feeds --dsw-font-mono, a variable the shipped client only ever *references*
 * (plugin-manager / jobs / agent-preset / sidebar-documentpreview), built
 * alias-free by buildMonoToken below.
 *
 * Each segment is ONE combo control:
 *  - a text input that shows the current choice and doubles as the custom
 *    font-stack editor (Enter applies; empty input restores the default),
 *  - a ▾ button that opens a floating picker panel listing every installed
 *    system family (enumerated Host-side — the browser cannot enumerate fonts
 *    itself — and served by GET /font-settings/fonts), each row rendered in
 *    its own font with a sample line, plus a "restore default" row.
 *
 * The panel is fixed-positioned relative to the viewport and flips upward
 * when it would overflow the bottom edge, so a row at the bottom of the
 * settings panel never gets occluded.
 *
 * Persistence goes through the Host route pair /font-settings (GET/POST),
 * which reads/writes the ui-font namespace in $DSH_HOME/settings.yaml; the
 * browser settings wire cannot reach that namespace (api-proxy allowlist),
 * hence the custom route.
 *
 * Bundle format: the DSH client module loader (window.__ModuleLoader__) with a
 * CommonJS-style factory. Only seed externals are required: react and
 * @deepseek-ai/dsh-client-store (dsh 0.1.2-alpha.2: the old
 * @deepseek-ai/dsh-client-runtime package was removed and its defineStore
 * moved into the dsh-client-store seed).
 */
window.__ModuleLoader__.load({
	id: "dsh-font-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let store = require("@deepseek-ai/dsh-client-store");
		//#region dsh-font-settings styles
		const css = [
			".dsfs_group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:16px 0;display:flex}",
			".dsfs_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dsfs_segment{flex-direction:column;gap:8px;display:flex}",
			".dsfs_segmentLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsfs_combo{display:flex;align-items:stretch;min-width:260px;max-width:420px}",
			".dsfs_comboInput{flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-right:0;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 10px;font-size:13px;line-height:20px}",
			".dsfs_comboBtn{flex:none;width:36px;border:1px solid var(--dsw-alias-border-l2);border-left:0;border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:1}",
			".dsfs_comboBtn:hover{color:var(--dsw-alias-label-primary)}",
			".dsfs_panel{position:fixed;z-index:1200;width:320px;max-width:calc(100vw - 24px);max-height:min(360px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#1e1e2e);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:10px;box-shadow:var(--dsw-shadow-lv2,0 8px 28px rgba(0,0,0,.35));overflow:hidden}",
			".dsfs_search{flex:none;margin:8px 8px 4px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
			".dsfs_list{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 4px 8px;display:flex;flex-direction:column;gap:2px}",
			".dsfs_fontItem{display:flex;flex-direction:column;gap:1px;align-items:flex-start;padding:6px 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}",
			".dsfs_fontItem:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsfs_selected{background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 1px var(--dsw-static-neutral-bluish-400)}",
			".dsfs_fontName{font-size:13px;line-height:18px}",
			".dsfs_fontSample{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".dsfs_hint{font-size:12px;line-height:18px}",
			".dsfs_select{box-sizing:border-box;min-width:140px;max-width:220px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 10px;font-size:13px;line-height:20px}",
			".dsfs_note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsfs_hint_ok{color:var(--dsw-alias-state-success-primary)}",
			".dsfs_hint_missing{color:var(--dsw-alias-state-warn-primary)}",
			".dsfs_hint_stale{color:var(--dsw-alias-state-warn-primary)}"
		].join("");
		const tagId = "dsh-font-settings/font.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-font-settings";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region stacks
		/** Fallback tails appended after a system-family pick. */
		const SYS_TAIL_UI = "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif";
		const SYS_TAIL_CODE = "'PingFang SC', 'Microsoft YaHei'";
		/** True for one of the three durable modes. */
		function isValidMode(mode) {
			return mode === "default" || mode === "system" || mode === "custom";
		}
		/** Resolve the CSS stack for one slot from its (mode, value) state. */
		function resolveStack(tail, mode, value) {
			if (mode === "default") return null;
			if (mode === "system") return value.length > 0 ? "'" + value + "', " + tail : null;
			if (mode === "custom") return value.length > 0 ? value : null;
			return null;
		}
		/**
		 * Probe text: long Latin/digit/punctuation mix so real fonts diverge
		 * from the generic sentinels by far more than the 0.5px threshold.
		 * Deliberately NO CJK: CJK glyphs are 1em wide in almost every font,
		 * which adds a constant to both sides of every comparison (diluting
		 * real differences into threshold-coincidences — a real font vs the
		 * serif sentinel can land within 0.4px) and drags in CJK
		 * fallback-font noise.
		 */
		const PROBE_TEXT = "Wm1ilIAEglt.,:|17";
		/** Generic sentinels; a visible family must diverge on at least two. */
		const PROBE_SENTINELS = ["serif", "monospace", "cursive"];
		/** Both list polling and browser-match verdicts expire after ten minutes. */
		const FONT_CACHE_TTL = 10 * 60 * 1000;
		const probeCache = new Map();
		/**
		 * Whether THIS browser process can actually match the family.
		 * document.fonts.check() is useless here (Chromium returns true for
		 * unknown families), so this measures rendered width instead: the
		 * family counts as visible when '<family>', <sentinel> renders
		 * differently from a known-bogus family on the same sentinel for at
		 * least two of the three sentinels (majority vote — see below).
		 * A browser process started before the font was installed (Chrome
		 * enumerates fonts once per process and misses per-user fonts installed
		 * later) reports false here although the system has the font.
		 */
		function familyMatches(family) {
			const key = String(family);
			const cached = probeCache.get(key);
			if (cached !== void 0 && Date.now() - cached.at < FONT_CACHE_TTL) return cached.matched;
			let matched = true;
			try {
				if (typeof document !== "undefined" && document !== null && document.body !== null) {
					const safe = key.replace(/['"\\]/g, "");
					const host = document.createElement("div");
					host.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:pre;font-size:32px";
					// Warm-up read: the very first layout in a fresh browser process
					// can transiently resolve fallback before the font cache is
					// ready, so prime it with a throwaway measurement.
					const warm = document.createElement("span");
					warm.style.fontFamily = "'__dsfs_no_such_family__', serif";
					warm.textContent = PROBE_TEXT;
					host.appendChild(warm);
					document.body.appendChild(host);
					warm.getBoundingClientRect();
					const spans = [];
					for (const sentinel of PROBE_SENTINELS) {
						for (const name of [safe, "__dsfs_no_such_family__"]) {
							const span = document.createElement("span");
							span.style.fontFamily = "'" + name + "', " + sentinel;
							span.textContent = PROBE_TEXT;
							host.appendChild(span);
							spans.push(span);
						}
					}
					let votes = 0;
					for (let i = 0; i < spans.length; i += 2) {
						if (Math.abs(spans[i].getBoundingClientRect().width - spans[i + 1].getBoundingClientRect().width) > 0.5) {
							// Confirm on a second read: rejects measurement transients.
							if (Math.abs(spans[i].getBoundingClientRect().width - spans[i + 1].getBoundingClientRect().width) > 0.5) {
								votes++;
							}
						}
					}
					host.remove();
					// Majority vote: a REAL family renders itself against every
					// sentinel (3/3 diverge). An unmatched family can spuriously
					// diverge on at most one sentinel — Chromium can transiently
					// resolve the shared fallback with pre-settlement metrics —
					// so require at least two sentinels to diverge.
					matched = votes >= 2;
				}
			} catch (error) {
				matched = true; /* probe unavailable — assume usable */
			}
			probeCache.set(key, { matched, at: Date.now() });
			return matched;
		}
		/** Whether the Host enumeration lists the family (i.e. it is installed). */
		function isEnumerated(family, fonts) {
			if (typeof family !== "string" || family.length === 0) return false;
			return fonts.some((font) => font.name === family || font.aliases.includes(family));
		}
		/**
		 * The browser-matching name for a stored system value: DirectWrite
		 * registers the typographic family (nameID 16, "SFMono Nerd Font"),
		 * not nameID 1 ("SF Mono"), so a stored/typed name this browser
		 * process cannot match is re-mapped through the enumerated font list
		 * (name or aliases match) to the name that actually renders.
		 * @param value - the stored family name.
		 * @param fonts - enumerated { name, aliases } entries.
		 * @returns the usable name (unchanged when nothing matches).
		 */
		function resolveSystemName(value, fonts) {
			if (typeof value !== "string" || value.length === 0) return value;
			if (familyMatches(value)) return value;
			for (const font of fonts) {
				if (font.name === value || font.aliases.includes(value)) {
					return familyMatches(font.name) ? font.name : value;
				}
			}
			return value;
		}
		/** First family name of a stack ("'SF Mono', serif" → "SF Mono"). */
		function firstFamilyOf(stack) {
			const match = /^['"]?([^'",]+)/.exec(String(stack).trim());
			return match === null ? "" : match[1].trim();
		}
		/**
		 * Normalize a user-typed stack: a bare family name containing spaces or
		 * CJK gets quoted ("SF Mono" → "'SF Mono'"), otherwise it passes through.
		 */
		function normalizeStack(text) {
			const s = String(text).trim();
			if (s === "" || /['",]/.test(s)) return s;
			return /[\s\u4e00-\u9fff]/.test(s) ? "'" + s + "'" : s;
		}
		//#endregion
		//#region terminal alias
		/**
		 * The sidebar terminal constructs xterm with a hardcoded font stack
		 * ("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace") and reads
		 * no dsh font token, so the theme override above cannot reach it. These
		 * are that stack's concrete families; redefining them with @font-face
		 * redirects the terminal to the selected font.
		 *
		 * `monospace` is deliberately absent: a generic keyword is resolved by
		 * the browser's own fixed-width preference and CANNOT be shadowed by
		 * @font-face (verified — the measured width does not move).
		 */
		const TERMINAL_ALIAS_FAMILIES = ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas"];
		/** data-plugin-css id of the terminal alias sheet. */
		const TERMINAL_ALIAS_TAG = "dsh-font-settings/terminal-alias.css";
		/**
		 * Terminal font sizes offered in the picker (px). 0 means "keep the
		 * terminal's own size", in which case the alias ships no `size-adjust`
		 * at all and behaves exactly as before the setting existed.
		 */
		const TERMINAL_SIZE_CHOICES = [0, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
		/** Upper bound accepted from storage, mirroring the Host-side schema. */
		const TERMINAL_SIZE_MAX = 48;
		/**
		 * Coerce a stored terminal size into a usable px value.
		 * @param px - raw stored value.
		 * @returns a whole px count, or 0 for "the terminal's own size".
		 */
		function normalizeSize(px) {
			const n = Math.round(Number(px));
			if (!Number.isFinite(n) || n <= 0 || n > TERMINAL_SIZE_MAX) return 0;
			return n;
		}
		/**
		 * Anchor used when no terminal is mounted yet. The sidebar terminal
		 * hardcodes `fontSize: 13`, so this is that literal; a live terminal's
		 * own declared size wins when one is on screen (see terminalBasePx),
		 * which keeps the arithmetic right if dsh ever changes the literal.
		 */
		const TERMINAL_BASE_PX_FALLBACK = 13;
		/**
		 * Read only xterm-owned sizing nodes. Rows use the renderer option;
		 * character-measure nodes use the same option for measurement.
		 * Do not read .xterm or .xterm-screen: those ancestors can inherit the
		 * page font size, which is unrelated to the terminal option.
		 */
		const TERMINAL_BASE_SOURCES = [".xterm-rows", ".xterm-char-measure-element"];
		/** Whether the one-shot degraded-read warning was already emitted. */
		let terminalBaseWarned = false;
		/**
		 * The font size the sidebar terminal is currently rendering at, read
		 * back from the renderer's own box — xterm derives the rows' font-size
		 * from the Terminal options, and dsh hardcodes `fontSize: 13`, so this
		 * is exactly the number `size-adjust` multiplies.
		 *
		 * Sources are tried in order, and only a *successful* read is silent.
		 * When every source fails the read is genuinely degraded (a mismatched
		 * base makes the `size-adjust` ratio wrong and shifts the terminal
		 * grid), so it is reported once instead of being silently papered over
		 * with a hardcoded number. The returned value in that case is still
		 * TERMINAL_BASE_PX_FALLBACK — byte-for-byte the old behaviour — so a
		 * build where none of these selectors exist degrades exactly as before,
		 * minus the silence.
		 * @returns a positive px value, or the documented fallback.
		 */
		function terminalBasePx() {
			for (const selector of TERMINAL_BASE_SOURCES) {
				try {
					for (const node of document.querySelectorAll(selector)) {
						const px = Number.parseFloat(getComputedStyle(node).fontSize);
						if (Number.isFinite(px) && px > 0) return px;
					}
				} catch (error) {
					/* no terminal mounted, or no layout yet — try the next source */
				}
			}
			if (!terminalBaseWarned) {
				terminalBaseWarned = true;
				console.warn("[dsh-font-settings] no live terminal font size found (tried "
					+ TERMINAL_BASE_SOURCES.join(", ") + "); using " + TERMINAL_BASE_PX_FALLBACK
					+ "px as the size-adjust base. If the sidebar terminal renders at another size, open it and re-pick the terminal size.");
			}
			return TERMINAL_BASE_PX_FALLBACK;
		}
		/**
		 * The `size-adjust` descriptor for a chosen terminal size.
		 *
		 * The terminal's `fontSize` is a hardcoded literal it never reads from
		 * configuration, and its Terminal instance lives inside a bundled
		 * closure that exposes no service, so the size cannot be assigned — only
		 * scaled. `size-adjust` scales the face's em, and because xterm derives
		 * BOTH its cell measurement (CharSizeService, canvas) and its row
		 * rendering (DomRenderer, `font-size`) from the same font matching, the
		 * two scale together and the grid stays aligned. Overriding the rendered
		 * font-size in CSS instead desyncs them (measured drift ≈3.8px per
		 * cell), which garbles the terminal. A chosen px count is therefore
		 * expressed as a ratio against the size the terminal already renders at.
		 * @param sizePx - desired px, or 0 for no scaling.
		 * @returns `;size-adjust:<pct>%`, or "".
		 */
		function sizeAdjustDescriptor(sizePx) {
			if (!(sizePx > 0)) return "";
			const base = terminalBasePx();
			if (!(base > 0)) return "";
			const pct = (sizePx / base) * 100;
			if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return "";
			return ";size-adjust:" + Math.round(pct * 100) / 100 + "%";
		}
		/**
		 * Quote one font name as a CSS `local()` argument. Names come from font
		 * files, so control characters and CSS structural characters are
		 * stripped before quoting, then backslash and quote are escaped.
		 * @returns the quoted literal, or null when nothing usable remains.
		 */
		function quoteLocal(name) {
			if (typeof name !== "string") return null;
			const clean = name.replace(/[\u0000-\u001f\u007f<>{}]/g, "").trim();
			if (clean.length === 0) return null;
			return "'" + clean.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
		}
		/** A parsed face's weight, coerced to a valid CSS font-weight. */
		function faceWeight(face) {
			const weight = face !== null && typeof face === "object" ? Number(face.weight) : NaN;
			return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? Math.round(weight) : 400;
		}
		/**
		 * Build the alias sheet for one resolved code stack.
		 *
		 * `local()` matches the FULL name (nameID 4) and the PostScript name
		 * (nameID 6) only — never the family name (nameID 1) nor the typographic
		 * family (nameID 16). Handing it the family name fails SILENTLY: the
		 * face never matches, no error is raised, and the terminal quietly falls
		 * through to the next family in its stack. The Host therefore parses the
		 * name table and ships both usable names per face (lib/index.js).
		 *
		 * With no enumerated faces (a hand-typed custom stack, or the
		 * enumeration route being unavailable) only `ui-monospace` is shadowed,
		 * and with the bare family name as a best effort: on Windows and Linux
		 * `ui-monospace` resolves to nothing anyway, so a failed match costs no
		 * fallback we would otherwise have had. Guessing at `Consolas` could
		 * cost one, which is why the guess stays narrow.
		 *
		 * @param codeStack - the resolved code font stack, or null for default.
		 * @param fonts - enumerated { name, aliases, faces } entries.
		 * @param sizePx - desired terminal font size in px, or 0 for the
		 *   terminal's own size.
		 * @returns CSS text ("" when there is nothing to alias).
		 */
		function buildTerminalAliasCss(codeStack, fonts, sizePx) {
			if (codeStack === null) return "";
			const family = firstFamilyOf(codeStack);
			if (family.length === 0) return "";
			const entry = fonts.find((font) => font.name === family || font.aliases.includes(family));
			const faces = entry !== void 0 && Array.isArray(entry.faces) ? entry.faces : [];
			const rules = [];
			// One size-adjust for every rule: it is a property of the requested
			// size, not of a particular family or face.
			const adjust = sizeAdjustDescriptor(sizePx);
			if (faces.length > 0) {
				for (const alias of TERMINAL_ALIAS_FAMILIES) {
					for (const face of faces) {
						const sources = [];
						for (const candidate of [face.fullName, face.postScript]) {
							const quoted = quoteLocal(candidate);
							if (quoted !== null && sources.indexOf(quoted) === -1) sources.push(quoted);
						}
						if (sources.length === 0) continue;
						rules.push("@font-face{font-family:" + alias
							+ ";src:" + sources.map((quoted) => "local(" + quoted + ")").join(",")
							+ ";font-weight:" + faceWeight(face)
							+ ";font-style:" + (face.italic === true ? "italic" : "normal") + adjust + "}");
					}
				}
			} else {
				const quoted = quoteLocal(family);
				if (quoted !== null) {
					rules.push("@font-face{font-family:ui-monospace;src:local(" + quoted + ");font-weight:400;font-style:normal" + adjust + "}");
				}
			}
			return rules.join("");
		}
		/**
		 * The family names the alias sheet above redefines globally via
		 * `@font-face`. Lower-cased for case-insensitive comparison: a token
		 * value naming one of them resolves to the plugin's own injected face
		 * instead of an installed family.
		 */
		const TERMINAL_ALIAS_FAMILY_SET = TERMINAL_ALIAS_FAMILIES.map((family) => family.toLowerCase());
		/**
		 * Split a font stack into its top-level comma-separated segments,
		 * ignoring commas inside quoted family names.
		 * @param stack - a CSS font-family value.
		 * @returns the segments, in source order.
		 */
		function splitFontStack(stack) {
			const segments = [];
			let current = "";
			let quote = "";
			for (let i = 0; i < stack.length; i++) {
				const ch = stack[i];
				if (quote !== "") {
					current += ch;
					if (ch === "\\" && i + 1 < stack.length) {
						current += stack[i + 1];
						i++;
					} else if (ch === quote) {
						quote = "";
					}
					continue;
				}
				if (ch === "'" || ch === '"') {
					quote = ch;
					current += ch;
					continue;
				}
				if (ch === ",") {
					segments.push(current);
					current = "";
					continue;
				}
				current += ch;
			}
			segments.push(current);
			return segments;
		}
		/** One stack segment's bare family name (quotes removed). */
		function familyNameOf(segment) {
			const trimmed = segment.trim();
			const first = trimmed.charAt(0);
			if (trimmed.length >= 2 && (first === "'" || first === '"') && trimmed.charAt(trimmed.length - 1) === first) {
				return trimmed.slice(1, -1).replace(/\\(['"\\])/g, "$1").trim();
			}
			return trimmed;
		}
		/**
		 * Build the value for `--dsw-font-mono` from the resolved code stack.
		 *
		 * Give consumers an explicit stack instead of relying on their disparate
		 * fallbacks. An unresolved CSS variable invalidates the declaration; it
		 * does not itself imply blank glyphs.
		 * Remove globally shadowed terminal aliases so these surfaces do not
		 * inherit terminal size-adjust. If the selected family is itself an
		 * alias, the remaining stack (or generic monospace) is used instead.
		 * Always append the generic monospace fallback when absent.
		 * @param codeStack - the resolved code stack, or null for default mode.
		 * @returns the token value, or null for "emit no token at all".
		 */
		function buildMonoToken(codeStack) {
			if (typeof codeStack !== "string") return null;
			const kept = [];
			for (const segment of splitFontStack(codeStack)) {
				const raw = segment.trim();
				if (raw === "") continue;
				const name = familyNameOf(raw);
				if (name === "") continue;
				// A function value (`var(--x)`, `calc(…)`) is not a family name;
				// keeping it would re-import the indirection this token exists to
				// remove.
				if (/[()]/.test(name)) continue;
				if (TERMINAL_ALIAS_FAMILY_SET.indexOf(name.toLowerCase()) !== -1) continue;
				kept.push(raw);
			}
			if (!kept.some((segment) => familyNameOf(segment).toLowerCase() === "monospace")) {
				kept.push("monospace");
			}
			return kept.join(", ");
		}
		//#endregion
		//#region locales
		/** `settings.font` namespace dictionaries (the row's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "字体",
			"refresh": "重新扫描字体",
			"refresh.busy": "扫描中…",
			"refresh.ok": "字体列表已刷新",
			"refresh.error": "扫描失败，暂保留上次列表，请重试",
			"refresh.note": "列表缓存 10 分钟；安装或删除字体后可立即重新扫描。",
			"uiFont.title": "界面字体",
			"codeFont.title": "等宽字体（代码 / 终端）",
			"terminalSize.title": "终端字号",
			"terminalSize.auto": "默认（跟随终端）",
			"terminalSize.note": "只影响侧边栏终端",
			"combo.placeholder": "默认字体 · 输入自定义字体栈后回车，或点 ▾ 选择系统字体",
			"combo.open": "选择系统字体",
			"panel.search": "搜索字体…",
			"panel.default": "恢复默认",
			"panel.defaultHint": "使用应用内置字体",
			"panel.empty": "没有匹配的字体",
			"panel.hidden": "浏览器不可见",
			"hint.ok": "已应用 · 字体可用",
			"hint.stale": "⚠ 字体已安装，但当前浏览器进程看不到它（刚安装的字体请重启浏览器后重试）",
			"hint.missing": "⚠ 该字体未安装在此系统上，将回退到下一个字体"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"title": "Fonts",
			"refresh": "Rescan fonts",
			"refresh.busy": "Scanning…",
			"refresh.ok": "Font list refreshed",
			"refresh.error": "Scan failed — previous list retained; retry",
			"refresh.note": "List expires after 10 minutes; rescan after installing or deleting fonts.",
			"uiFont.title": "Interface font",
			"codeFont.title": "Monospace font (code / terminal)",
			"terminalSize.title": "Terminal font size",
			"terminalSize.auto": "Default (terminal's own)",
			"terminalSize.note": "Sidebar terminal only",
			"combo.placeholder": "Default · type a font stack and press Enter, or ▾ to pick a system font",
			"combo.open": "Pick a system font",
			"panel.search": "Search fonts…",
			"panel.default": "Restore default",
			"panel.defaultHint": "Use the app's built-in fonts",
			"panel.empty": "No matching fonts",
			"panel.hidden": "Not visible to browser",
			"hint.ok": "Applied · font is usable",
			"hint.stale": "⚠ Installed, but this browser process cannot see it — restart the browser if it was just installed",
			"hint.missing": "⚠ Font not installed on this system — falling back to the next family"
		};
		//#endregion
		//#region settings constants
		/** Locale namespace for the row's copy. */
		const SETTINGS_NS = "settings.font";
		/** Theme override-layer source (names the layer in inspection). */
		const OVERRIDE_SOURCE = "dsh-font-settings";
		/** Slot fields: mode + value pairs. */
		const FIELD_UI = "uiFont";
		const FIELD_CODE = "codeFont";
		/** Wire name of the sidebar terminal's font size (px, 0 = own size). */
		const FIELD_SIZE = "terminalSize";
		//#endregion
		//#region font picker component
		/**
		 * One slot's combined control: a text input (shows the current choice,
		 * doubles as the custom stack editor, Enter applies, empty restores the
		 * default) plus a ▾ button that opens the system-font picker panel.
		 * The panel is fixed-positioned and flips upward when it would overflow
		 * the viewport bottom, so it is never occluded at the bottom of the
		 * settings panel.
		 */
		function FontPicker({ field, mode, value, fonts, setFont, t }) {
			const [open, setOpen] = react.useState(false);
			const [query, setQuery] = react.useState("");
			const [pos, setPos] = react.useState(null);
			const [draft, setDraft] = react.useState(null);
			const [availability, setAvailability] = react.useState({});
			const [hint, setHint] = react.useState(null);
			const comboRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const displayed = draft !== null ? draft : (mode === "system" || mode === "custom") && value.length > 0 ? value : "";
			/** Batch-probe every listed family once per list (sync, cached). */
			react.useEffect(() => {
				if (fonts.length === 0) return;
				const map = {};
				for (const font of fonts) map[font.name] = familyMatches(font.name);
				setAvailability(map);
			}, [fonts]);
			/** Live availability hint for whatever the input currently shows. */
			react.useEffect(() => {
				const text = displayed.trim();
				if (text.length === 0) {
					setHint(null);
					return;
				}
				const family = firstFamilyOf(text);
				if (family.length === 0) {
					setHint(null);
					return;
				}
				const resolved = resolveSystemName(family, fonts);
				setHint(familyMatches(resolved) ? "ok" : isEnumerated(resolved, fonts) ? "stale" : "missing");
			}, [displayed, fonts]);
			/** Measure the panel and place it below the combo, flipping upward when needed. */
			const place = () => {
				const combo = comboRef.current;
				const panel = panelRef.current;
				if (combo === null || panel === null) return;
				const rect = combo.getBoundingClientRect();
				const panelH = panel.offsetHeight;
				const panelW = panel.offsetWidth;
				const spaceBelow = window.innerHeight - rect.bottom - 8;
				const spaceAbove = rect.top - 8;
				const top = spaceBelow >= panelH || spaceBelow >= spaceAbove
					? rect.bottom + 4
					: Math.max(8, rect.top - panelH - 4);
				const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8));
				setPos({ top, left });
			};
			react.useLayoutEffect(() => {
				if (open) place();
			}, [open, query, fonts]);
			react.useEffect(() => {
				if (!open) return;
				const onDown = (event) => {
					if (comboRef.current !== null && comboRef.current.contains(event.target)) return;
					if (panelRef.current !== null && panelRef.current.contains(event.target)) return;
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const togglePanel = () => {
				if (open) {
					setOpen(false);
					return;
				}
				setQuery("");
				setDraft(null);
				const combo = comboRef.current;
				if (combo !== null) {
					const rect = combo.getBoundingClientRect();
					const estH = 340;
					const spaceBelow = window.innerHeight - rect.bottom - 8;
					setPos({
						top: spaceBelow >= estH ? rect.bottom + 4 : Math.max(8, rect.top - estH - 4),
						left: Math.max(8, Math.min(rect.left, window.innerWidth - 328))
					});
				}
				setOpen(true);
			};
			/** Commit the input as a custom stack; empty input restores the default. */
			const commitInput = () => {
				const text = displayed.trim();
				if (text.length === 0) {
					setFont(field, "default", "");
				} else {
					setFont(field, "custom", normalizeStack(text));
				}
				setDraft(null);
			};
			const pickFamily = (family) => {
				setFont(field, "system", family);
				setDraft(null);
				setOpen(false);
			};
			const pickDefault = () => {
				setFont(field, "default", "");
				setDraft(null);
				setOpen(false);
			};
			const needle = query.trim().toLowerCase();
			const filtered = needle.length === 0
				? fonts
				: fonts.filter((font) => (font.name + " " + font.aliases.join(" ")).toLowerCase().includes(needle));
			const combo = react.createElement("div", { key: "combo", className: "dsfs_combo", ref: comboRef },
				react.createElement("input", {
					className: "dsfs_comboInput",
					type: "text",
					value: displayed,
					placeholder: t("combo.placeholder"),
					spellCheck: false,
					onChange: (event) => { setDraft(event.target.value); },
					onKeyDown: (event) => {
						if (event.key === "Enter") commitInput();
					}
				}),
				react.createElement("button", {
					type: "button",
					className: "dsfs_comboBtn",
					"aria-label": t("combo.open"),
					title: t("combo.open"),
					onClick: togglePanel
				}, "▾"),
				open ? react.createElement("div", { ref: panelRef, className: "dsfs_panel", style: pos },
					react.createElement("input", {
						className: "dsfs_search",
						type: "text",
						value: query,
						autoFocus: true,
						placeholder: t("panel.search"),
						spellCheck: false,
						onChange: (event) => { setQuery(event.target.value); }
					}),
					react.createElement("div", { className: "dsfs_list" },
						react.createElement("button", {
							type: "button",
							className: "dsfs_fontItem" + (mode === "default" ? " dsfs_selected" : ""),
							onClick: pickDefault
						},
							react.createElement("span", { className: "dsfs_fontName" }, t("panel.default")),
							react.createElement("span", { className: "dsfs_fontSample" }, t("panel.defaultHint"))
						),
						filtered.length === 0
							? react.createElement("div", { className: "dsfs_fontItem", style: { cursor: "default" } }, t("panel.empty"))
							: filtered.map((font) => react.createElement("button", {
								key: font.name,
								type: "button",
								className: "dsfs_fontItem" + (mode === "system" && value === font.name ? " dsfs_selected" : ""),
								style: { fontFamily: "'" + font.name + "'" },
								onClick: () => { pickFamily(font.name); }
							},
								react.createElement("span", { className: "dsfs_fontName" }, font.name),
								react.createElement("span", { className: "dsfs_fontSample" },
									(availability[font.name] === false ? t("panel.hidden") + " · " : "")
									+ (font.aliases.length > 0 ? font.aliases.join(" · ") + " · " : "")
									+ "中文 Aa 123"
								)
							))
					)
				) : null
			);
			return hint === null || hint === "ok"
				? [combo]
				: [combo, react.createElement("div", { key: "hint", className: "dsfs_hint dsfs_hint_" + hint }, t("hint." + hint))];
		}
		/**
		 * The Settings → General font row: title + UI-font segment + code-font
		 * segment + the sidebar terminal's font size. Selection state arrives through props.useStore; writes go
		 * through props.setFont (the injected face).
		 */
		function FontSettingsRow({ t, useStore, setFont, setSize, refreshFonts }) {
			const state = useStore((s) => s);
			const [refreshStatus, setRefreshStatus] = react.useState(null);
			const rescan = async () => {
				setRefreshStatus("busy");
				setRefreshStatus(await refreshFonts() ? "ok" : "error");
			};
			// A size stored by another build (or by hand) is kept selectable even
			// when it is not one of the offered presets.
			const sizes = state.codeSize > 0 && TERMINAL_SIZE_CHOICES.indexOf(state.codeSize) === -1
				? TERMINAL_SIZE_CHOICES.concat([state.codeSize]).sort((a, b) => a - b)
				: TERMINAL_SIZE_CHOICES;
			return react.createElement("div", { className: "dsfs_group" },
				react.createElement("div", { className: "dsfs_title" }, t("title")),
				react.createElement("button", { type: "button", className: "dsfs_select", disabled: refreshStatus === "busy", onClick: rescan }, t(refreshStatus === "busy" ? "refresh.busy" : "refresh")),
				react.createElement("div", { className: "dsfs_note", role: "status" }, refreshStatus === null ? t("refresh.note") : t("refresh." + refreshStatus)),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("uiFont.title")),
					react.createElement(FontPicker, { field: FIELD_UI, mode: state.uiMode, value: state.uiValue, fonts: state.fonts, setFont: setFont, t: t })
				),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("codeFont.title")),
					react.createElement(FontPicker, { field: FIELD_CODE, mode: state.codeMode, value: state.codeValue, fonts: state.fonts, setFont: setFont, t: t })
				),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("terminalSize.title")),
					react.createElement("select", {
						className: "dsfs_select",
						value: String(state.codeSize),
						"aria-label": t("terminalSize.title"),
						onChange: (event) => { setSize(Number(event.target.value)); }
					}, sizes.map((px) => react.createElement("option", { key: px, value: String(px) }, px === 0 ? t("terminalSize.auto") : px + " px"))),
					react.createElement("div", { className: "dsfs_note" }, t("terminalSize.note"))
				)
			);
		}
		//#endregion
		//#region store
		/** Row store: mirror of the plugin's adopted state + the font list. */
		function createFontRowStore() {
			return store.defineStore({
				init: () => ({
					uiMode: "default",
					uiValue: "",
					codeMode: "default",
					codeValue: "",
					codeSize: 0,
					fonts: [],
					revision: -1
				}),
				actions: {
					sync: (d, uiMode, uiValue, codeMode, codeValue, codeSize, revision) => {
						if (revision <= d.revision) return;
						d.uiMode = uiMode;
						d.uiValue = uiValue;
						d.codeMode = codeMode;
						d.codeValue = codeValue;
						d.codeSize = codeSize;
						d.revision = revision;
					},
					setFonts: (d, fonts) => {
						d.fonts = fonts;
					}
				}
			});
		}
		//#endregion
		//#region apply
		/** Required client services. */
		const inject = ["slots", "locale", "theme"];
		/**
		 * Wire the override layer to the Host route pair, keep it in sync with
		 * the adopted selection, and register the row into the General
		 * section's item slot.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			const theme = ctx.theme;
			let overrideDisposer = null;
			let revision = 0;
			const current = { uiMode: "default", uiValue: "", codeMode: "default", codeValue: "", terminalSize: 0 };
			let bound = null;
			/** Load the system-font list into the store. */
			let systemFonts = [];
			/** Lazily created <style> tag holding the terminal alias rules. */
			let aliasTag = null;
			/** CSS currently installed in that tag (skips needless DOM writes). */
			let aliasCss = "";
			/**
			 * Install or clear the terminal alias sheet for one resolved code
			 * stack. The browser re-resolves @font-face rules as soon as the tag
			 * content changes, so an already-open terminal redraws in the new
			 * face at once; its cell metrics follow on the next re-measure (the
			 * terminal measures when it mounts and when its container resizes).
			 */
			const applyTerminalAlias = (codeStack) => {
				if (typeof document === "undefined") return;
				const text = buildTerminalAliasCss(codeStack, systemFonts, current.terminalSize);
				if (text === aliasCss) return;
				aliasCss = text;
				if (aliasTag === null) {
					const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(TERMINAL_ALIAS_TAG) + "]");
					if (existing !== null) {
						aliasTag = existing;
					} else {
						aliasTag = document.createElement("style");
						aliasTag.dataset.plugin = "dsh-font-settings";
						aliasTag.dataset.pluginCss = TERMINAL_ALIAS_TAG;
						document.head.appendChild(aliasTag);
					}
				}
				aliasTag.textContent = text;
			};
			/** Rebuild the theme override layer from `current` (dispose first). */
			const refreshOverride = () => {
				if (overrideDisposer !== null) {
					overrideDisposer();
					overrideDisposer = null;
				}
				const tokens = {};
				// System values go through resolveSystemName: DirectWrite registers
				// the typographic family (nameID 16), so a stored name the browser
				// rejects ("SF Mono") is re-mapped to the name that renders.
				const uiStack = resolveStack(SYS_TAIL_UI, current.uiMode, current.uiMode === "system" ? resolveSystemName(current.uiValue, systemFonts) : current.uiValue);
				const codeStack = resolveStack(SYS_TAIL_CODE, current.codeMode, current.codeMode === "system" ? resolveSystemName(current.codeValue, systemFonts) : current.codeValue);
				// Before the early return below: default mode yields no tokens but
				// must still clear a previously installed alias sheet.
				applyTerminalAlias(codeStack);
				if (uiStack !== null) tokens["--dsw-font-family"] = uiStack;
				if (codeStack !== null) {
					// Belt-and-braces: also override the derived pure-family code
					// tokens (theme defines them as var(--ds-font-family-code)) so
					// a broken var indirection in any dsh build can never detach a
					// code surface from the selection. The composite `font:`
					// shorthand tokens bake in size/line-height and must NOT be
					// touched with a bare family stack.
					tokens["--ds-font-family-code"] = codeStack;
					// Explicitly cover mono consumers without terminal alias scaling.
					const monoStack = buildMonoToken(codeStack);
					if (monoStack !== null) tokens["--dsw-font-mono"] = monoStack;
					tokens["--dsw-font-markdown-code-font-family"] = codeStack;
					tokens["--dsw-font-markdown-code-block-font-family"] = codeStack;
					tokens["--dsw-font-markdown-code-block-small-font-family"] = codeStack;
				}
				if (Object.keys(tokens).length === 0) return;
				const pairs = {};
				for (const name of Object.keys(tokens)) pairs[name] = { light: tokens[name], dark: tokens[name] };
				overrideDisposer = theme.overrideTokens(OVERRIDE_SOURCE, pairs);
			};
			/** Publish `current` to the slot-bound store with a fresh revision. */
			const push = () => {
				bound?.sync(current.uiMode, current.uiValue, current.codeMode, current.codeValue, current.terminalSize, ++revision);
			};
			/** Adopt a { uiFont, uiFontValue, codeFont, codeFontValue, terminalSize } section. */
			const adopt = (value) => {
				if (value !== void 0 && typeof value === "object" && value !== null) {
					if (typeof value[FIELD_UI] === "string" && isValidMode(value[FIELD_UI])) current.uiMode = value[FIELD_UI];
					if (typeof value[FIELD_UI + "Value"] === "string") current.uiValue = value[FIELD_UI + "Value"];
					if (typeof value[FIELD_CODE] === "string" && isValidMode(value[FIELD_CODE])) current.codeMode = value[FIELD_CODE];
					if (typeof value[FIELD_CODE + "Value"] === "string") current.codeValue = value[FIELD_CODE + "Value"];
					if (typeof value[FIELD_SIZE] === "number") current.terminalSize = normalizeSize(value[FIELD_SIZE]);
				}
				refreshOverride();
				push();
			};
			/** Load the durable selection. */
			const load = async () => {
				try {
					const response = await fetch("/font-settings", { headers: { accept: "application/json" } });
					const data = await response.json();
					if (data !== null && typeof data === "object" && data.ok === true) adopt(data.value);
				} catch (error) {
					/* host route unavailable — keep defaults */
				}
			};
			let disposed = false;
			let fontsLoadedAt = -Infinity;
			let fontsRequest = null;
			let requestIsForced = false;
			const scanFonts = async (force) => {
				try {
					const response = await fetch("/font-settings/fonts" + (force ? "?refresh=1" : ""), { cache: "no-store", headers: { accept: "application/json" } });
					if (!response.ok) return false;
					const data = await response.json();
					if (disposed) return false;
					if (data !== null && typeof data === "object" && data.ok === true && Array.isArray(data.fonts)) {
						systemFonts = data.fonts.map((font) => {
							if (typeof font === "string") return { name: font, aliases: [], faces: [] };
							return {
								name: String(font.name),
								aliases: Array.isArray(font.aliases) ? font.aliases.map(String) : [],
								// Faces carry the FullName/PostScript names that the
								// terminal alias needs for local() — the family name
								// alone would silently fail to match.
								faces: Array.isArray(font.faces) ? font.faces.filter((face) => face !== null && typeof face === "object").map((face) => ({
									fullName: typeof face.fullName === "string" ? face.fullName : "",
									postScript: typeof face.postScript === "string" ? face.postScript : "",
									weight: typeof face.weight === "number" ? face.weight : 400,
									italic: face.italic === true
								})) : []
							};
						});
						// Re-probe even unchanged names: their files may have changed.
						probeCache.clear();
						bound?.setFonts(systemFonts);
						fontsLoadedAt = Date.now();
						// The system-value re-mapping depends on the list: re-resolve
						// now so a stored name the browser rejects ("SF Mono") gets
						// corrected to the name that renders ("SFMono Nerd Font").
						refreshOverride();
						return true;
					}
					return false;
				} catch (error) {
					/* enumeration unavailable — custom input still works */
					return false;
				}
			};
			/** Drop availability verdicts past their TTL (see familyMatches). */
			const pruneProbes = () => {
				for (const [key, entry] of probeCache) {
					if (!entry || Date.now() - entry.at >= FONT_CACHE_TTL) probeCache.delete(key);
				}
			};
			/** One in-flight list request at a time; a failed scan keeps the last list. */
			const loadFonts = (force = false) => {
				if (disposed) return Promise.resolve(false);
				if (fontsRequest !== null) {
					// A button click during a normal fetch must still bypass Host TTL.
					return force && !requestIsForced ? fontsRequest.then(() => loadFonts(true)) : fontsRequest;
				}
				if (!force && Date.now() - fontsLoadedAt < FONT_CACHE_TTL) return Promise.resolve(true);
				requestIsForced = force;
				fontsRequest = scanFonts(force).finally(() => { fontsRequest = null; requestIsForced = false; });
				return fontsRequest;
			};
			/** Forced rescan (toolbar button): bypasses both client and host TTL. */
			const refreshFonts = () => loadFonts(true);
			/** Re-enumerate when the window regains focus (install/delete between visits). */
			const onVisible = () => {
				if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
				loadFonts();
			};
			ctx.effect(() => {
				const id = setInterval(() => {
					fontsLoadedAt = 0;
					pruneProbes();
					loadFonts();
				}, FONT_CACHE_TTL);
				window.addEventListener("focus", onVisible);
				return () => {
					disposed = true;
					clearInterval(id);
					window.removeEventListener("focus", onVisible);
				};
			}, "font-settings: list cache expiry");
			/** Apply one slot's (mode, value): optimistic override, then persist. */
			const save = (field, mode, value) => {
				if (field !== FIELD_UI && field !== FIELD_CODE) return;
				// `current` keeps one (mode, value) pair per slot under the ui/code
				// prefix that refreshOverride and adopt both read. `field` is the
				// wire name (uiFont/codeFont), so it cannot key `current` directly:
				// doing that wrote uiFont/uiFontValue keys nothing reads, and the
				// optimistic override silently became a no-op until the POST
				// round-trip echoed the value back.
				const slot = field === FIELD_UI ? "ui" : "code";
				current[slot + "Mode"] = mode;
				current[slot + "Value"] = typeof value === "string" ? value : "";
				refreshOverride();
				push();
				fetch("/font-settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ [field]: mode, [field + "Value"]: current[slot + "Value"] })
				}).then((response) => response.json()).then((data) => {
					if (data !== null && typeof data === "object" && data.ok === true) adopt(data.value);
				}).catch(() => {
					/* keep optimistic state */
				});
			};
			/** Apply the terminal font size: optimistic alias rebuild, then persist. */
			const saveSize = (px) => {
				const size = normalizeSize(px);
				if (size === current.terminalSize) return;
				current.terminalSize = size;
				refreshOverride();
				push();
				fetch("/font-settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ [FIELD_SIZE]: size })
				}).then((response) => response.json()).then((data) => {
					if (data !== null && typeof data === "object" && data.ok === true) adopt(data.value);
				}).catch(() => {
					/* keep optimistic state */
				});
			};
			ctx.effect(() => () => {
				if (aliasTag !== null) aliasTag.remove();
				aliasTag = null;
				aliasCss = "";
			}, "font-settings: terminal alias sheet");
			ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "font-settings: row dictionaries");
			const store = createFontRowStore();
			/** Slot-entry inject face: bind the store and expose the write path. */
			const injected = (actions) => {
				bound = actions;
				if (systemFonts.length > 0) bound?.setFonts(systemFonts);
				push();
				return { setFont: save, setSize: saveSize, refreshFonts };
			};
			adopt({});
			load();
			loadFonts();
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "font-settings",
				order: 20,
				store,
				locale: SETTINGS_NS,
				inject: injected
			}, FontSettingsRow));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
