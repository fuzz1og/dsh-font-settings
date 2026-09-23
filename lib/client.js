/**
 * dsh-font-settings - client half.
 *
 * Registers one preference row into Settings -> General with two combo
 * controls (UI font, code font) plus the sidebar terminal's font size. The
 * stored value is a CSS font-family stack, never an enum id: the text input is
 * the primary path (type a stack, press Enter; empty restores the default) and
 * every picker is an optional enhancement on top of it.
 *
 * Two enhancement tiers, both degradable:
 *
 *   Tier 1  a curated list of common families, always available, no permission
 *   Tier 2  the machine's own fonts through the Local Font Access API
 *           (window.queryLocalFonts), opt-in behind a button because the API
 *           needs a user gesture, a secure context and the local-fonts
 *           permission, and exists only in Chromium desktop. Results are
 *           merged by family and cached in localStorage; an unsupported
 *           browser or a refused permission disables the button and says why.
 *
 * Persistence follows the same split as the official settings pages: on a
 * loopback page the preference is written to this entry's Config through
 * ctx.configForms.get("font-settings") (the official channel, no custom
 * route); on a non-loopback page the Host document belongs to another machine,
 * so the preference is kept per-device in localStorage instead.
 *
 * The sidebar terminal hardcodes its font stack and reads no dsh token, so the
 * chosen code font is also projected onto that stack with @font-face aliases.
 * Alias sources come from Local Font Access records (postscriptName / fullName)
 * when they are known, because local() matches those and NOT the family name;
 * the family name is only a last-resort alias for ui-monospace.
 *
 * Bundle format: the DSH client module loader (window.__ModuleLoader__) with a
 * CommonJS-style factory. Only seed externals are required: react and
 * @deepseek-ai/dsh-client-store.
 */
window.__ModuleLoader__.load({
	id: "dsh-font-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let store = require("@deepseek-ai/dsh-client-store");
		//#region styles
		const css = [
			".dsfs_group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:16px 0;display:flex}",
			".dsfs_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dsfs_segment{flex-direction:column;gap:8px;display:flex}",
			".dsfs_segmentLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsfs_combo{display:flex;align-items:stretch;min-width:260px;max-width:420px}",
			".dsfs_comboInput{flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-right:0;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 10px;font-size:13px;line-height:20px}",
			".dsfs_comboBtn{flex:none;width:36px;border:1px solid var(--dsw-alias-border-l2);border-left:0;border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:1}",
			".dsfs_comboBtn:hover{color:var(--dsw-alias-label-primary)}",
			".dsfs_panel{position:fixed;z-index:1200;width:320px;max-width:calc(100vw - 24px);max-height:min(400px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#1e1e2e);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:10px;box-shadow:var(--dsw-shadow-lv2,0 8px 28px rgba(0,0,0,.35));overflow:hidden}",
			".dsfs_search{flex:none;margin:8px 8px 4px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
			".dsfs_action{flex:none;margin:6px 8px 2px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;line-height:20px}",
			".dsfs_action:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}",
			".dsfs_actionNote{flex:none;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px;padding:2px 10px 4px}",
			".dsfs_list{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 4px 8px;display:flex;flex-direction:column;gap:2px}",
			".dsfs_section{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:6px 10px 2px}",
			".dsfs_fontItem{display:flex;flex-direction:column;gap:1px;align-items:flex-start;padding:6px 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}",
			".dsfs_fontItem:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsfs_selected{background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 1px var(--dsw-static-neutral-bluish-400)}",
			".dsfs_fontName{font-size:13px;line-height:18px}",
			".dsfs_fontSample{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".dsfs_hint{font-size:12px;line-height:18px}",
			".dsfs_select{box-sizing:border-box;min-width:140px;max-width:220px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 10px;font-size:13px;line-height:20px}",
			".dsfs_note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsfs_hint_ok{color:var(--dsw-alias-state-success-primary)}",
			".dsfs_hint_missing{color:var(--dsw-alias-state-warn-primary)}"
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
		/** Fallback tails appended after a family pick. */
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
		/** First family name of a stack ("'SF Mono', serif" -> "SF Mono"). */
		function firstFamilyOf(stack) {
			const match = /^['"]?([^'",]+)/.exec(String(stack).trim());
			return match === null ? "" : match[1].trim();
		}
		/**
		 * Normalize a user-typed stack: a bare family name containing spaces or
		 * CJK gets quoted ("SF Mono" -> "'SF Mono'"), otherwise it passes through.
		 */
		function normalizeStack(text) {
			const s = String(text).trim();
			if (s === "" || /['",]/.test(s)) return s;
			return /[\s\u4e00-\u9fff]/.test(s) ? "'" + s + "'" : s;
		}
		//#endregion
		//#region curated tier 1
		/**
		 * A small, always-available set of families per slot, in the spirit of
		 * VS Code's defaultSnippets: a non-Chromium browser has no enumeration at
		 * all, and a Chromium user should not have to read fonts just to pick a
		 * common one. These are plain family names - never generic keywords, which
		 * cannot be quoted as a family.
		 */
		const CURATED_FONTS = {
			uiFont: ["Inter", "SF Pro Text", "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC"],
			codeFont: ["JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Ubuntu Mono", "Source Code Pro", "IBM Plex Mono", "Roboto Mono", "Hack", "Inconsolata", "Maple Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Victor Mono", "Iosevka", "Monaspace Neon"]
		};
		/**
		 * Merge the local-font index with the curated list into the flat list the
		 * store carries. Local entries win a name collision (they carry faces and
		 * are known to be installed); curated entries record which slot(s) they
		 * belong to.
		 */
		function buildFontList(localFonts) {
			const out = [];
			const seen = new Set();
			for (const font of localFonts) {
				if (seen.has(font.name)) continue;
				seen.add(font.name);
				out.push({ name: font.name, aliases: font.aliases, faces: font.faces, source: "local", slots: null });
			}
			for (const slot of Object.keys(CURATED_FONTS)) {
				for (const name of CURATED_FONTS[slot]) {
					if (seen.has(name)) continue;
					seen.add(name);
					out.push({ name: name, aliases: [], faces: [], source: "curated", slots: [slot] });
				}
			}
			out.sort((a, b) => a.name.localeCompare(b.name));
			return out;
		}
		//#endregion
		//#region local fonts (Local Font Access)
		/** Where the merged local-font index is cached, per browser origin. */
		const LOCAL_FONTS_CACHE_KEY = "dsh-font-settings.local-fonts.v1";
		/** Where the preference lives when the Host document is not ours to write. */
		const PREFS_KEY = "dsh-font-settings.preferences.v1";
		/** Upper bound on cached families, so a pathological list cannot fill storage. */
		const LOCAL_FONTS_CACHE_MAX = 4000;
		/**
		 * Why the Local Font Access API is (un)available in this browser:
		 *  - "ok"          window.queryLocalFonts exists in a secure context
		 *  - "insecure"    the API exists but the page is not a secure context
		 *  - "unsupported" no API at all (Firefox, Safari, Chrome Android, ...)
		 */
		function localFontsCapability() {
			if (typeof window === "undefined" || window === null) return "unsupported";
			if (typeof window.queryLocalFonts !== "function") return "unsupported";
			if (window.isSecureContext === false) return "insecure";
			return "ok";
		}
		/** Weight implied by a FontData style label ("Bold Italic", "SemiBold", ...). */
		function weightFromStyle(style) {
			const s = typeof style === "string" ? style.toLowerCase() : "";
			if (s.indexOf("thin") !== -1) return 100;
			if (s.indexOf("extralight") !== -1 || s.indexOf("ultralight") !== -1) return 200;
			if (s.indexOf("light") !== -1) return 300;
			if (s.indexOf("medium") !== -1) return 500;
			if (s.indexOf("semibold") !== -1 || s.indexOf("demibold") !== -1) return 600;
			if (s.indexOf("extrabold") !== -1 || s.indexOf("ultrabold") !== -1) return 800;
			if (s.indexOf("black") !== -1 || s.indexOf("heavy") !== -1) return 900;
			if (s.indexOf("bold") !== -1) return 700;
			return 400;
		}
		/** Whether a style label denotes an italic/oblique face. */
		function italicFromStyle(style) {
			return typeof style === "string" && /italic|oblique/i.test(style);
		}
		/** A face is only usable if it can be named in a CSS local() source. */
		function usableSource(face) {
			return (typeof face.fullName === "string" && face.fullName.length > 0)
				|| (typeof face.postScript === "string" && face.postScript.length > 0);
		}
		/**
		 * Reduce one family's faces to the handful the terminal alias needs: the
		 * normal-width face nearest 400 and nearest 700, for upright and italic.
		 * The sidebar terminal only ever asks for normal and bold, so shipping
		 * every style of a 20-face family would be pure bloat.
		 * @param faces - faces indexed from FontData records.
		 * @returns at most four { fullName, postScript, weight, italic } entries.
		 */
		function selectTerminalFaces(faces) {
			const usable = faces.filter(usableSource);
			const seen = new Set();
			const picked = [];
			const add = (face, weight) => {
				const key = face.fullName + "|" + face.postScript + "|" + weight + "|" + face.italic;
				if (seen.has(key)) return;
				seen.add(key);
				picked.push({
					fullName: typeof face.fullName === "string" ? face.fullName : "",
					postScript: typeof face.postScript === "string" ? face.postScript : "",
					weight: weight,
					italic: face.italic === true
				});
			};
			for (const italic of [false, true]) {
				const group = usable.filter((face) => (face.italic === true) === italic);
				if (group.length === 0) continue;
				let regular = null;
				let bold = null;
				for (const target of [400, 700]) {
					let best = null;
					let bestDistance = Infinity;
					for (const face of group) {
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
		 * Merge a queryLocalFonts() result by family. FontData carries the two
		 * names local() actually matches (fullName / postscriptName), so they are
		 * kept per face; the family name is what the picker shows and stores.
		 * @param list - the FontData array returned by queryLocalFonts().
		 * @returns { name, aliases, faces, source } entries, sorted by family.
		 */
		function indexLocalFonts(list) {
			const byFamily = new Map();
			for (const data of list) {
				if (data === null || typeof data !== "object") continue;
				const family = typeof data.family === "string" ? data.family.trim() : "";
				if (family.length === 0 || family.length > 100) continue;
				let entry = byFamily.get(family);
				if (entry === undefined) {
					entry = { family: family, faces: [] };
					byFamily.set(family, entry);
				}
				entry.faces.push({
					fullName: typeof data.fullName === "string" ? data.fullName.trim() : "",
					postScript: typeof data.postscriptName === "string" ? data.postscriptName.trim() : "",
					weight: weightFromStyle(data.style),
					italic: italicFromStyle(data.style)
				});
			}
			const out = [];
			for (const entry of byFamily.values()) {
				out.push({ name: entry.family, aliases: [], faces: selectTerminalFaces(entry.faces), source: "local" });
			}
			out.sort((a, b) => a.name.localeCompare(b.name));
			return out;
		}
		/** Narrow whatever localStorage held back into the local-font index shape. */
		function sanitizeFonts(raw) {
			if (!Array.isArray(raw)) return [];
			const out = [];
			for (const item of raw) {
				if (item === null || typeof item !== "object") continue;
				const name = typeof item.name === "string" ? item.name.trim() : "";
				if (name.length === 0 || name.length > 100) continue;
				const faces = [];
				if (Array.isArray(item.faces)) {
					for (const face of item.faces) {
						if (face === null || typeof face !== "object") continue;
						faces.push({
							fullName: typeof face.fullName === "string" ? face.fullName : "",
							postScript: typeof face.postScript === "string" ? face.postScript : "",
							weight: Number.isFinite(Number(face.weight)) ? Number(face.weight) : 400,
							italic: face.italic === true
						});
					}
				}
				out.push({ name: name, aliases: [], faces: faces, source: "local" });
				if (out.length >= LOCAL_FONTS_CACHE_MAX) break;
			}
			return out;
		}
		/** Read the cached local-font index, or null when absent/unreadable. */
		function readLocalFontCache() {
			try {
				const raw = window.localStorage.getItem(LOCAL_FONTS_CACHE_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return null;
				return { at: Number(parsed.at) || 0, fonts: sanitizeFonts(parsed.fonts) };
			} catch (error) {
				return null;
			}
		}
		/** Cache the local-font index; storage failures are never fatal. */
		function writeLocalFontCache(fonts) {
			try {
				window.localStorage.setItem(LOCAL_FONTS_CACHE_KEY, JSON.stringify({ at: Date.now(), fonts: fonts }));
			} catch (error) {
				/* storage disabled or full - the in-memory index still works */
			}
		}
		/** Read the per-device preference, or null when absent/unreadable. */
		function readLocalPrefs() {
			try {
				const raw = window.localStorage.getItem(PREFS_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return null;
				const out = {};
				for (const field of ["uiFont", "uiFontValue", "codeFont", "codeFontValue"]) {
					if (typeof parsed[field] === "string") out[field] = parsed[field];
				}
				if (typeof parsed.terminalSize === "number" && Number.isFinite(parsed.terminalSize)) out.terminalSize = parsed.terminalSize;
				return out;
			} catch (error) {
				return null;
			}
		}
		/** Persist the per-device preference; storage failures are never fatal. */
		function writeLocalPrefs(prefs) {
			try {
				window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
			} catch (error) {
				/* storage disabled or full - the in-memory state still applies */
			}
		}
		//#endregion
		//#region availability probe
		/**
		 * Probe text: long Latin/digit/punctuation mix so real fonts diverge from
		 * the generic sentinels by far more than the 0.5px threshold.
		 */
		const PROBE_TEXT = "Wm1ilIAEglt.,:|17";
		/** Generic sentinels; a visible family must diverge on at least two. */
		const PROBE_SENTINELS = ["serif", "monospace", "cursive"];
		/** Browser-match verdicts expire after ten minutes. */
		const FONT_CACHE_TTL = 10 * 60 * 1000;
		const probeCache = new Map();
		/**
		 * Whether THIS browser process can actually match the family.
		 * document.fonts.check() is useless here (Chromium returns true for
		 * unknown families), so this measures rendered width instead. A browser
		 * process started before the font was installed reports false here.
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
							if (Math.abs(spans[i].getBoundingClientRect().width - spans[i + 1].getBoundingClientRect().width) > 0.5) votes++;
						}
					}
					host.remove();
					matched = votes >= 2;
				}
			} catch (error) {
				matched = true; /* probe unavailable - assume usable */
			}
			probeCache.set(key, { matched: matched, at: Date.now() });
			return matched;
		}
		/**
		 * The browser-matching name for a stored family value: a stored/typed name
		 * this browser process cannot match is re-mapped through the known font
		 * list to the name that actually renders.
		 * @param value - the stored family name.
		 * @param fonts - the merged font list.
		 * @returns the usable name (unchanged when nothing matches).
		 */
		function resolveSystemName(value, fonts) {
			if (typeof value !== "string" || value.length === 0) return value;
			if (familyMatches(value)) return value;
			for (const font of fonts) {
				if (font.name === value || font.aliases.indexOf(value) !== -1) {
					return familyMatches(font.name) ? font.name : value;
				}
			}
			return value;
		}
		//#endregion
		//#region terminal alias
		/**
		 * The sidebar terminal constructs xterm with a hardcoded font stack
		 * ("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace") and reads
		 * no dsh font token, so the theme override cannot reach it. Redefining
		 * these families with @font-face redirects the terminal to the selection.
		 *
		 * "monospace" is deliberately absent: a generic keyword is resolved by the
		 * browser's own fixed-width preference and CANNOT be shadowed.
		 */
		const TERMINAL_ALIAS_FAMILIES = ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas"];
		/** data-plugin-css id of the terminal alias sheet. */
		const TERMINAL_ALIAS_TAG = "dsh-font-settings/terminal-alias.css";
		/** Terminal font sizes offered in the picker (px); 0 = terminal's own size. */
		const TERMINAL_SIZE_CHOICES = [0, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
		/** Upper bound accepted from storage, mirroring the Host-side schema. */
		const TERMINAL_SIZE_MAX = 48;
		/** Coerce a stored terminal size into a usable px value. */
		function normalizeSize(px) {
			const n = Math.round(Number(px));
			if (!Number.isFinite(n) || n <= 0 || n > TERMINAL_SIZE_MAX) return 0;
			return n;
		}
		/**
		 * Anchor used when no terminal is mounted yet. The sidebar terminal
		 * hardcodes fontSize: 13, so this is that literal; a live terminal's own
		 * declared size wins when one is on screen (see terminalBasePx).
		 */
		const TERMINAL_BASE_PX_FALLBACK = 13;
		/**
		 * Read only xterm-owned sizing nodes. Do not read .xterm or .xterm-screen:
		 * those ancestors can inherit the page font size, unrelated to the option.
		 */
		const TERMINAL_BASE_SOURCES = [".xterm-rows", ".xterm-char-measure-element"];
		/** Whether the one-shot degraded-read warning was already emitted. */
		let terminalBaseWarned = false;
		/**
		 * The font size the sidebar terminal is currently rendering at, read back
		 * from the renderer's own box. When every source fails the read is
		 * genuinely degraded, so it is reported once instead of being silently
		 * papered over; the returned value is still the documented fallback.
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
					/* no terminal mounted, or no layout yet - try the next source */
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
		 * The size-adjust descriptor for a chosen terminal size: a ratio against
		 * the size the terminal already renders at, because the terminal's
		 * fontSize is a hardcoded literal that cannot be assigned.
		 * @param sizePx - desired px, or 0 for no scaling.
		 * @returns ";size-adjust:<pct>%", or "".
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
		 * Quote one font name as a CSS local() argument. Names come from font
		 * metadata, so control characters and CSS structural characters are
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
		 * local() matches the FULL name and the PostScript name only - never the
		 * family name. Handing it the family name fails SILENTLY: the face never
		 * matches, no error is raised, and the terminal quietly falls through to
		 * the next family in its stack. So when Local Font Access has indexed the
		 * chosen family, its per-face fullName/postscriptName records are used.
		 *
		 * With no indexed faces (a curated name that was never read, a hand-typed
		 * custom stack) only ui-monospace is shadowed, with the bare family name
		 * as a best effort: on Windows and Linux ui-monospace resolves to nothing
		 * anyway, so a failed match costs no fallback we would otherwise have had.
		 *
		 * @param codeStack - the resolved code font stack, or null for default.
		 * @param fonts - the local-font index (faces included).
		 * @param sizePx - desired terminal font size in px, or 0 for the
		 *   terminal's own size.
		 * @returns CSS text ("" when there is nothing to alias).
		 */
		function buildTerminalAliasCss(codeStack, fonts, sizePx) {
			if (codeStack === null) return "";
			const family = firstFamilyOf(codeStack);
			if (family.length === 0) return "";
			const entry = fonts.find((font) => font.name === family || font.aliases.indexOf(family) !== -1);
			const faces = entry !== void 0 && Array.isArray(entry.faces) ? entry.faces : [];
			const rules = [];
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
		 * @font-face. Lower-cased for case-insensitive comparison.
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
		 * Build the value for --dsw-font-mono from the resolved code stack.
		 * Remove globally shadowed terminal aliases so those surfaces do not
		 * inherit terminal size-adjust; always append the generic monospace
		 * fallback when absent.
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
				if (/[()]/.test(name)) continue;
				if (TERMINAL_ALIAS_FAMILY_SET.indexOf(name.toLowerCase()) !== -1) continue;
				kept.push(raw);
			}
			if (!kept.some((segment) => familyNameOf(segment).toLowerCase() === "monospace")) kept.push("monospace");
			return kept.join(", ");
		}
		//#endregion
		//#region locales
		/** settings.font namespace dictionaries (the row's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "字体",
			"uiFont.title": "界面字体",
			"codeFont.title": "等宽字体（代码 / 终端）",
			"terminalSize.title": "终端字号",
			"terminalSize.auto": "默认（跟随终端）",
			"terminalSize.note": "只影响侧边栏终端",
			"combo.placeholder": "默认字体 · 输入字体栈后回车，或点 ▾ 选择",
			"combo.open": "打开字体选择",
			"panel.search": "搜索字体…",
			"panel.default": "恢复默认",
			"panel.defaultHint": "使用应用内置字体",
			"panel.empty": "没有匹配的字体",
			"panel.notDetected": "本机未检测到",
			"panel.localSection": "本机字体",
			"panel.curatedSection": "常用字体",
			"local.read": "读取本机字体",
			"local.reread": "重新读取本机字体",
			"local.busy": "读取中…",
			"local.why.unsupported": "当前浏览器不支持读取本机字体：需要 Chromium 桌面版（Chrome / Edge 103+）",
			"local.why.insecure": "需要安全上下文（HTTPS 或 localhost）才能读取本机字体",
			"local.why.denied": "字体访问权限被拒绝，可在浏览器站点设置中重新授权后重试",
			"local.why.error": "读取本机字体失败，请重试",
			"hint.ok": "已应用 · 字体可用",
			"hint.missing": "⚠ 本机未检测到该字体，将回退到下一个字体"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"title": "Fonts",
			"uiFont.title": "Interface font",
			"codeFont.title": "Monospace font (code / terminal)",
			"terminalSize.title": "Terminal font size",
			"terminalSize.auto": "Default (terminal's own)",
			"terminalSize.note": "Sidebar terminal only",
			"combo.placeholder": "Default · type a font stack and press Enter, or ▾ to pick",
			"combo.open": "Open the font picker",
			"panel.search": "Search fonts…",
			"panel.default": "Restore default",
			"panel.defaultHint": "Use the app's built-in fonts",
			"panel.empty": "No matching fonts",
			"panel.notDetected": "Not detected here",
			"panel.localSection": "This device",
			"panel.curatedSection": "Common",
			"local.read": "Read local fonts",
			"local.reread": "Read local fonts again",
			"local.busy": "Reading…",
			"local.why.unsupported": "This browser cannot list local fonts: Chromium desktop (Chrome / Edge 103+) is required",
			"local.why.insecure": "A secure context (HTTPS or localhost) is required to read local fonts",
			"local.why.denied": "Font access was denied; re-grant it in the browser's site settings and retry",
			"local.why.error": "Reading local fonts failed; please retry",
			"hint.ok": "Applied · font is usable",
			"hint.missing": "⚠ Font not detected on this device - falling back to the next family"
		};
		//#endregion
		//#region settings constants
		/** Locale namespace for the row's copy. */
		const SETTINGS_NS = "settings.font";
		/** Theme override-layer source (names the layer in inspection). */
		const OVERRIDE_SOURCE = "dsh-font-settings";
		/** This entry's id, which IS the settings namespace under dsh 0.1.7. */
		const ENTRY_ID = "font-settings";
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
		 * default) plus a button that opens the picker panel. The panel holds the
		 * restore-default row, the opt-in local-font button and its explanation,
		 * the device's indexed families (Tier 2) and the curated list (Tier 1).
		 * It is fixed-positioned and flips upward when it would overflow the
		 * viewport bottom, so it is never occluded at the bottom of the panel.
		 */
		function FontPicker({ field, mode, value, fonts, localStatus, setFont, readLocalFonts, t }) {
			const [open, setOpen] = react.useState(false);
			const [query, setQuery] = react.useState("");
			const [pos, setPos] = react.useState(null);
			const [draft, setDraft] = react.useState(null);
			const [availability, setAvailability] = react.useState({});
			const [hint, setHint] = react.useState(null);
			const comboRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const displayed = draft !== null ? draft : (mode === "system" || mode === "custom") && value.length > 0 ? value : "";
			const curated = fonts.filter((font) => font.source === "curated" && Array.isArray(font.slots) && font.slots.indexOf(field) !== -1);
			const local = fonts.filter((font) => font.source === "local");
			/** Batch-probe every curated family once per list (sync, cached). */
			react.useEffect(() => {
				const map = {};
				for (const font of curated) map[font.name] = familyMatches(font.name);
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
				const entry = fonts.find((font) => font.name === resolved || font.aliases.indexOf(resolved) !== -1);
				setHint(entry !== void 0 && entry.source === "local" ? "ok" : familyMatches(resolved) ? "ok" : "missing");
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
				setPos({ top: top, left: left });
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
					const estH = 360;
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
				if (text.length === 0) setFont(field, "default", "");
				else setFont(field, "custom", normalizeStack(text));
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
			const matches = (font) => (font.name + " " + font.aliases.join(" ")).toLowerCase().indexOf(needle) !== -1;
			const curatedShown = needle.length === 0 ? curated : curated.filter(matches);
			const localShown = needle.length === 0 ? local : local.filter(matches);
			const localNote = localStatus === "unsupported" ? "local.why.unsupported"
				: localStatus === "insecure" ? "local.why.insecure"
					: localStatus === "denied" ? "local.why.denied"
						: localStatus === "error" ? "local.why.error"
							: null;
			const localBlocked = localStatus === "unsupported" || localStatus === "insecure";
			const localLabel = localStatus === "loading" ? "local.busy" : localStatus === "ready" ? "local.reread" : "local.read";
			/** One family row, previewed in its own face. */
			const fontRow = (font) => {
				const quoted = quoteLocal(font.name);
				return react.createElement("button", {
					key: font.name,
					type: "button",
					className: "dsfs_fontItem" + (mode === "system" && value === font.name ? " dsfs_selected" : ""),
					style: quoted === null ? void 0 : { fontFamily: quoted },
					onClick: () => { pickFamily(font.name); }
				},
					react.createElement("span", { className: "dsfs_fontName" }, font.name),
					react.createElement("span", { className: "dsfs_fontSample" },
						(font.source === "curated" && availability[font.name] === false ? t("panel.notDetected") + " · " : "")
						+ "中文 Aa 123")
				);
			};
			const children = [
				react.createElement("button", {
					key: "default",
					type: "button",
					className: "dsfs_fontItem" + (mode === "default" ? " dsfs_selected" : ""),
					onClick: pickDefault
				},
					react.createElement("span", { className: "dsfs_fontName" }, t("panel.default")),
					react.createElement("span", { className: "dsfs_fontSample" }, t("panel.defaultHint"))
				)
			];
			if (localShown.length > 0) {
				children.push(react.createElement("div", { key: "local-section", className: "dsfs_section" }, t("panel.localSection")));
				for (const font of localShown) children.push(fontRow(font));
			}
			if (curatedShown.length > 0) {
				children.push(react.createElement("div", { key: "curated-section", className: "dsfs_section" }, t("panel.curatedSection")));
				for (const font of curatedShown) children.push(fontRow(font));
			}
			if (curatedShown.length === 0 && localShown.length === 0) {
				children.push(react.createElement("div", { key: "empty", className: "dsfs_fontItem", style: { cursor: "default" } }, t("panel.empty")));
			}
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
					react.createElement("button", {
						type: "button",
						className: "dsfs_action",
						disabled: localBlocked || localStatus === "loading",
						onClick: () => { readLocalFonts(); }
					}, t(localLabel)),
					localNote === null ? null : react.createElement("div", { className: "dsfs_actionNote" }, t(localNote)),
					react.createElement("div", { className: "dsfs_list" }, children)
				) : null
			);
			return hint === null || hint === "ok"
				? [combo]
				: [combo, react.createElement("div", { key: "hint", className: "dsfs_hint dsfs_hint_" + hint }, t("hint." + hint))];
		}
		/**
		 * The Settings -> General font row: title + UI-font segment + code-font
		 * segment + the sidebar terminal's font size. Selection state arrives
		 * through props.useStore; writes go through props.setFont (the injected
		 * face).
		 */
		function FontSettingsRow({ t, useStore, setFont, setSize, readLocalFonts }) {
			const state = useStore((s) => s);
			const sizes = state.codeSize > 0 && TERMINAL_SIZE_CHOICES.indexOf(state.codeSize) === -1
				? TERMINAL_SIZE_CHOICES.concat([state.codeSize]).sort((a, b) => a - b)
				: TERMINAL_SIZE_CHOICES;
			return react.createElement("div", { className: "dsfs_group" },
				react.createElement("div", { className: "dsfs_title" }, t("title")),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("uiFont.title")),
					react.createElement(FontPicker, { field: FIELD_UI, mode: state.uiMode, value: state.uiValue, fonts: state.fonts, localStatus: state.localStatus, setFont: setFont, readLocalFonts: readLocalFonts, t: t })
				),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("codeFont.title")),
					react.createElement(FontPicker, { field: FIELD_CODE, mode: state.codeMode, value: state.codeValue, fonts: state.fonts, localStatus: state.localStatus, setFont: setFont, readLocalFonts: readLocalFonts, t: t })
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
		/** Row store: mirror of the plugin's adopted state + the merged font list. */
		function createFontRowStore() {
			return store.defineStore({
				init: () => ({
					uiMode: "default",
					uiValue: "",
					codeMode: "default",
					codeValue: "",
					codeSize: 0,
					fonts: [],
					localStatus: "idle",
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
					setTools: (d, fonts, localStatus) => {
						d.fonts = fonts;
						d.localStatus = localStatus;
					}
				}
			});
		}
		//#endregion
		//#region apply
		/** Required client services. */
		const inject = ["slots", "locale", "theme", "configForms"];
		/**
		 * Wire the preference to the official settings channel (loopback) or to
		 * per-device browser storage (non-loopback), keep the theme override and
		 * the terminal alias in sync with the adopted selection, and register the
		 * row into the General section's item slot.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			const theme = ctx.theme;
			const form = ctx.configForms.get(ENTRY_ID);
			let overrideDisposer = null;
			let revision = 0;
			const current = { uiMode: "default", uiValue: "", codeMode: "default", codeValue: "", terminalSize: 0 };
			let bound = null;
			let localFonts = [];
			let localStatus = "idle";
			let aliasTag = null;
			let aliasCss = "";
			const capability = localFontsCapability();
			/**
			 * Install or clear the terminal alias sheet for one resolved code
			 * stack. The browser re-resolves @font-face rules as soon as the tag
			 * content changes, so an already-open terminal redraws in the new face
			 * at once; its cell metrics follow on the next re-measure.
			 */
			const applyTerminalAlias = (codeStack) => {
				if (typeof document === "undefined") return;
				const text = buildTerminalAliasCss(codeStack, localFonts, current.terminalSize);
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
			/** The merged curated + local list the row renders. */
			const allFonts = () => buildFontList(localFonts);
			/** Publish the font list and the local-font status to the bound store. */
			const publishTools = () => {
				if (bound === null) return;
				bound.setTools(allFonts(), localStatus);
			};
			/** Rebuild the theme override layer from current (dispose first). */
			const refreshOverride = () => {
				if (overrideDisposer !== null) {
					overrideDisposer();
					overrideDisposer = null;
				}
				const fonts = allFonts();
				const tokens = {};
				const uiStack = resolveStack(SYS_TAIL_UI, current.uiMode, current.uiMode === "system" ? resolveSystemName(current.uiValue, fonts) : current.uiValue);
				const codeStack = resolveStack(SYS_TAIL_CODE, current.codeMode, current.codeMode === "system" ? resolveSystemName(current.codeValue, fonts) : current.codeValue);
				// Before the early return below: default mode yields no tokens but
				// must still clear a previously installed alias sheet.
				applyTerminalAlias(codeStack);
				if (uiStack !== null) tokens["--dsw-font-family"] = uiStack;
				if (codeStack !== null) {
					tokens["--ds-font-family-code"] = codeStack;
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
			/** Publish current to the slot-bound store with a fresh revision. */
			const push = () => {
				if (bound === null) return;
				bound.sync(current.uiMode, current.uiValue, current.codeMode, current.codeValue, current.terminalSize, ++revision);
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
			/**
			 * Persist one patch of font fields. On a loopback page the official
			 * config form owns the Host document, so the patch is queued there;
			 * anywhere else the Host document belongs to another machine and the
			 * patch is kept per-device in localStorage.
			 * @param patch - field -> value edits to apply.
			 * @returns whether the patch was accepted (or written locally).
			 */
			const persistPatch = (patch) => {
				let mode = "memory";
				try {
					mode = form.getSnapshot().mode;
				} catch (error) {
					mode = "memory";
				}
				if (mode === "host") {
					const ops = Object.keys(patch).map((path) => ({ op: "set", path: [path], value: patch[path] }));
					return Promise.resolve(form.mutate(ops)).then((accepted) => {
						if (!accepted) {
							const snapshot = form.getSnapshot();
							if (snapshot.value !== void 0 && snapshot.value !== null) adopt(snapshot.value);
						}
						return accepted;
					}).catch(() => false);
				}
				const stored = readLocalPrefs();
				const merged = Object.assign({}, stored === null ? {} : stored, patch);
				writeLocalPrefs(merged);
				return Promise.resolve(true);
			};
			/** Apply one slot's (mode, value): optimistic override, then persist. */
			const save = (field, mode, value) => {
				if (field !== FIELD_UI && field !== FIELD_CODE) return;
				const slot = field === FIELD_UI ? "ui" : "code";
				current[slot + "Mode"] = mode;
				current[slot + "Value"] = typeof value === "string" ? value : "";
				refreshOverride();
				push();
				const patch = {};
				patch[field] = mode;
				patch[field + "Value"] = current[slot + "Value"];
				persistPatch(patch);
			};
			/** Apply the terminal font size: optimistic alias rebuild, then persist. */
			const saveSize = (px) => {
				const size = normalizeSize(px);
				if (size === current.terminalSize) return;
				current.terminalSize = size;
				refreshOverride();
				push();
				const patch = {};
				patch[FIELD_SIZE] = size;
				persistPatch(patch);
			};
			/**
			 * Read this machine's fonts through the Local Font Access API. Must be
			 * called straight from the user gesture: the API requires transient
			 * user activation, so no await may run before the call.
			 * @returns whether a fresh list was indexed.
			 */
			const readLocalFonts = () => {
				if (capability === "unsupported" || capability === "insecure") {
					localStatus = capability;
					publishTools();
					return Promise.resolve(false);
				}
				localStatus = "loading";
				publishTools();
				let result;
				try {
					result = window.queryLocalFonts();
				} catch (error) {
					localStatus = error !== null && error !== void 0 && error.name === "NotAllowedError" ? "denied" : "error";
					publishTools();
					return Promise.resolve(false);
				}
				return Promise.resolve(result).then((list) => {
					localFonts = indexLocalFonts(Array.isArray(list) ? list : []);
					writeLocalFontCache(localFonts);
					localStatus = "ready";
					publishTools();
					refreshOverride();
					return true;
				}).catch((error) => {
					localStatus = error !== null && error !== void 0 && error.name === "NotAllowedError" ? "denied" : "error";
					publishTools();
					return false;
				});
			};
			// Boot: seed the local-font index from cache, then adopt the durable
			// selection. The settings form's snapshot is asynchronous on loopback.
			const cached = readLocalFontCache();
			if (cached !== null && cached.fonts.length > 0) {
				localFonts = cached.fonts;
				localStatus = "ready";
			} else if (capability !== "ok") {
				localStatus = capability;
			}
			const snapshot = form.getSnapshot();
			if (snapshot.mode === "host") {
				adopt(snapshot.status === "ready" && snapshot.value !== void 0 ? snapshot.value : {});
			} else {
				const stored = readLocalPrefs();
				adopt(stored === null ? {} : stored);
			}
			const unsubscribe = form.subscribe(() => {
				const next = form.getSnapshot();
				if (next.mode !== "host" || next.status !== "ready") return;
				if (next.value === void 0 || next.value === null) return;
				adopt(next.value);
			});
			if (typeof unsubscribe === "function") {
				ctx.effect(() => () => { unsubscribe(); }, "font-settings: settings subscription");
			}
			ctx.effect(() => () => {
				if (aliasTag !== null) aliasTag.remove();
				aliasTag = null;
				aliasCss = "";
			}, "font-settings: terminal alias sheet");
			ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh: zh, en: en }), "font-settings: row dictionaries");
			const store = createFontRowStore();
			/** Slot-entry inject face: bind the store and expose the write path. */
			const injected = (actions) => {
				bound = actions;
				publishTools();
				push();
				return { setFont: save, setSize: saveSize, readLocalFonts: readLocalFonts };
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "font-settings",
				order: 20,
				store: store,
				locale: SETTINGS_NS,
				inject: injected
			}, FontSettingsRow));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
