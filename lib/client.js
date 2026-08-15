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
 * text surface in the app, in both color schemes.
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
 * @deepseek-ai/dsh-client-runtime/client.
 */
window.__ModuleLoader__.load({
	id: "dsh-font-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let runtime = require("@deepseek-ai/dsh-client-runtime/client");
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
		/** Whether a family name is actually usable by this browser/system. */
		function checkFamily(family) {
			try {
				return typeof document !== "undefined"
					&& document.fonts !== void 0
					&& document.fonts.check('16px "' + family + '"');
			} catch (error) {
				return false;
			}
		}
		/**
		 * The browser-matching name for a stored system value: DirectWrite
		 * registers the typographic family (nameID 16, "SFMono Nerd Font"),
		 * not nameID 1 ("SF Mono"), so a stored/typed name that the browser
		 * rejects is re-mapped through the enumerated font list (name or
		 * aliases match) to the name that actually renders.
		 * @param value - the stored family name.
		 * @param fonts - enumerated { name, aliases } entries.
		 * @returns the usable name (unchanged when nothing matches).
		 */
		function resolveSystemName(value, fonts) {
			if (typeof value !== "string" || value.length === 0) return value;
			if (checkFamily(value)) return value;
			for (const font of fonts) {
				if (font.name === value || font.aliases.includes(value)) {
					return checkFamily(font.name) ? font.name : value;
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
		//#region locales
		/** `settings.font` namespace dictionaries (the row's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"title": "字体",
			"uiFont.title": "界面字体",
			"codeFont.title": "等宽字体（代码 / 终端）",
			"combo.placeholder": "默认字体 · 输入自定义字体栈后回车，或点 ▾ 选择系统字体",
			"combo.open": "选择系统字体",
			"panel.search": "搜索字体…",
			"panel.default": "恢复默认",
			"panel.defaultHint": "使用应用内置字体",
			"panel.empty": "没有匹配的字体",
			"panel.unavailable": "未安装",
			"hint.ok": "已应用 · 字体已安装",
			"hint.missing": "⚠ 该字体未安装在此系统上，将回退到下一个字体"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"title": "Fonts",
			"uiFont.title": "Interface font",
			"codeFont.title": "Monospace font (code / terminal)",
			"combo.placeholder": "Default · type a font stack and press Enter, or ▾ to pick a system font",
			"combo.open": "Pick a system font",
			"panel.search": "Search fonts…",
			"panel.default": "Restore default",
			"panel.defaultHint": "Use the app's built-in fonts",
			"panel.empty": "No matching fonts",
			"panel.unavailable": "Not installed",
			"hint.ok": "Applied · font is installed",
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
			/** Batch-check every listed family once per list (all local, so sync). */
			react.useEffect(() => {
				if (fonts.length === 0) return;
				const map = {};
				for (const font of fonts) map[font.name] = checkFamily(font.name);
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
				setHint(checkFamily(resolveSystemName(family, fonts)) ? "ok" : "missing");
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
									(availability[font.name] === false ? t("panel.unavailable") + " · " : "")
									+ (font.aliases.length > 0 ? font.aliases.join(" · ") + " · " : "")
									+ "中文 Aa 123"
								)
							))
					)
				) : null
			);
			return hint === null
				? [combo]
				: [combo, react.createElement("div", { key: "hint", className: "dsfs_hint dsfs_hint_" + hint }, t(hint === "ok" ? "hint.ok" : "hint.missing"))];
		}
		/**
		 * The Settings → General font row: title + UI-font segment + code-font
		 * segment. Selection state arrives through props.useStore; writes go
		 * through props.setFont (the injected face).
		 */
		function FontSettingsRow({ t, useStore, setFont }) {
			const state = useStore((s) => s);
			return react.createElement("div", { className: "dsfs_group" },
				react.createElement("div", { className: "dsfs_title" }, t("title")),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("uiFont.title")),
					react.createElement(FontPicker, { field: FIELD_UI, mode: state.uiMode, value: state.uiValue, fonts: state.fonts, setFont: setFont, t: t })
				),
				react.createElement("div", { className: "dsfs_segment" },
					react.createElement("div", { className: "dsfs_segmentLabel" }, t("codeFont.title")),
					react.createElement(FontPicker, { field: FIELD_CODE, mode: state.codeMode, value: state.codeValue, fonts: state.fonts, setFont: setFont, t: t })
				)
			);
		}
		//#endregion
		//#region store
		/** Row store: mirror of the plugin's adopted state + the font list. */
		function createFontRowStore() {
			return runtime.defineStore({
				init: () => ({
					uiMode: "default",
					uiValue: "",
					codeMode: "default",
					codeValue: "",
					fonts: [],
					revision: -1
				}),
				actions: {
					sync: (d, uiMode, uiValue, codeMode, codeValue, revision) => {
						if (revision <= d.revision) return;
						d.uiMode = uiMode;
						d.uiValue = uiValue;
						d.codeMode = codeMode;
						d.codeValue = codeValue;
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
			const current = { uiMode: "default", uiValue: "", codeMode: "default", codeValue: "" };
			let bound = null;
			/** Load the system-font list into the store. */
			let systemFonts = [];
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
				if (uiStack !== null) tokens["--dsw-font-family"] = uiStack;
				if (codeStack !== null) tokens["--ds-font-family-code"] = codeStack;
				if (Object.keys(tokens).length === 0) return;
				const pairs = {};
				for (const name of Object.keys(tokens)) pairs[name] = { light: tokens[name], dark: tokens[name] };
				overrideDisposer = theme.overrideTokens(OVERRIDE_SOURCE, pairs);
			};
			/** Adopt a { uiFont, uiFontValue, codeFont, codeFontValue } section. */
			const adopt = (value) => {
				if (value !== void 0 && typeof value === "object" && value !== null) {
					if (typeof value[FIELD_UI] === "string" && isValidMode(value[FIELD_UI])) current.uiMode = value[FIELD_UI];
					if (typeof value[FIELD_UI + "Value"] === "string") current.uiValue = value[FIELD_UI + "Value"];
					if (typeof value[FIELD_CODE] === "string" && isValidMode(value[FIELD_CODE])) current.codeMode = value[FIELD_CODE];
					if (typeof value[FIELD_CODE + "Value"] === "string") current.codeValue = value[FIELD_CODE + "Value"];
				}
				refreshOverride();
				bound?.sync(current.uiMode, current.uiValue, current.codeMode, current.codeValue, ++revision);
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
			const loadFonts = async () => {
				try {
					const response = await fetch("/font-settings/fonts", { headers: { accept: "application/json" } });
					const data = await response.json();
					if (data !== null && typeof data === "object" && data.ok === true && Array.isArray(data.fonts)) {
						systemFonts = data.fonts.map((font) => typeof font === "string"
							? { name: font, aliases: [] }
							: { name: String(font.name), aliases: Array.isArray(font.aliases) ? font.aliases.map(String) : [] });
						bound?.setFonts(systemFonts);
						// The system-value re-mapping depends on the list: re-resolve
						// now so a stored name the browser rejects ("SF Mono") gets
						// corrected to the name that renders ("SFMono Nerd Font").
						refreshOverride();
					}
				} catch (error) {
					/* enumeration unavailable — custom input still works */
				}
			};
			/** Apply one slot's (mode, value): optimistic override, then persist. */
			const save = (field, mode, value) => {
				if (field !== FIELD_UI && field !== FIELD_CODE) return;
				current[field] = mode;
				current[field + "Value"] = typeof value === "string" ? value : "";
				refreshOverride();
				bound?.sync(current.uiMode, current.uiValue, current.codeMode, current.codeValue, ++revision);
				fetch("/font-settings", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ [field]: mode, [field + "Value"]: current[field + "Value"] })
				}).then((response) => response.json()).then((data) => {
					if (data !== null && typeof data === "object" && data.ok === true) adopt(data.value);
				}).catch(() => {
					/* keep optimistic state */
				});
			};
			ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "font-settings: row dictionaries");
			const store = createFontRowStore();
			/** Slot-entry inject face: bind the store and expose the write path. */
			const injected = (actions) => {
				bound = actions;
				if (systemFonts.length > 0) bound?.setFonts(systemFonts);
				bound?.sync(current.uiMode, current.uiValue, current.codeMode, current.codeValue, ++revision);
				return { setFont: save };
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
