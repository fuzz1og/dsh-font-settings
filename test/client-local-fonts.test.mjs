import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./client-harness.mjs";

const FONT_DATA = [
	{ family: "JetBrains Mono", fullName: "JetBrains Mono Regular", postscriptName: "JetBrainsMono-Regular", style: "Regular" },
	{ family: "JetBrains Mono", fullName: "JetBrains Mono Bold", postscriptName: "JetBrainsMono-Bold", style: "Bold" },
	{ family: "JetBrains Mono", fullName: "JetBrains Mono Italic", postscriptName: "JetBrainsMono-Italic", style: "Italic" },
	{ family: "Inter", fullName: "Inter Regular", postscriptName: "Inter-Regular", style: "Regular" }
];
const LOCAL_CACHE_KEY = "dsh-font-settings.local-fonts.v1";

test("an unsupported browser disables the read action and names the reason", async () => {
	const h = createHarness({ isSecureContext: true });
	assert.equal(h.lastTools().localStatus, "unsupported");
	assert.equal(await h.actions.readLocalFonts(), false);
	assert.equal(h.lastTools().localStatus, "unsupported");
});

test("a non-secure context is reported separately from an unsupported browser", async () => {
	const h = createHarness({ queryLocalFonts: async () => FONT_DATA, isSecureContext: false });
	assert.equal(h.lastTools().localStatus, "insecure");
	assert.equal(await h.actions.readLocalFonts(), false);
	assert.equal(h.lastTools().localStatus, "insecure");
});

test("a gesture-triggered read merges by family, caches, and publishes the index", async () => {
	let calls = 0;
	const h = createHarness({ queryLocalFonts: async () => { calls++; return FONT_DATA; } });
	assert.equal(await h.actions.readLocalFonts(), true);
	assert.equal(calls, 1);
	assert.equal(h.lastTools().localStatus, "ready");
	const names = h.lastTools().fonts.filter((font) => font.source === "local").map((font) => font.name);
	assert.deepEqual(Array.from(names), ["Inter", "JetBrains Mono"]);
	const mono = h.lastTools().fonts.find((font) => font.name === "JetBrains Mono");
	assert.equal(mono.faces.length, 3, "regular/bold/italic survive; no width duplicates exist");
	assert.ok(mono.faces.some((face) => face.postScript === "JetBrainsMono-Regular" && face.weight === 400 && face.italic === false));
	assert.ok(mono.faces.some((face) => face.postScript === "JetBrainsMono-Bold" && face.weight === 700 && face.italic === false));
	assert.ok(mono.faces.some((face) => face.postScript === "JetBrainsMono-Italic" && face.italic === true));
	const cached = JSON.parse(h.storage.get(LOCAL_CACHE_KEY));
	assert.equal(cached.fonts.length, 2);
});

test("a denied permission is reported and leaves the cached index intact", async () => {
	const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
	const h = createHarness({ queryLocalFonts: async () => { throw denied; } });
	assert.equal(await h.actions.readLocalFonts(), false);
	assert.equal(h.lastTools().localStatus, "denied");
});

test("a cached index is adopted at boot without calling the API", () => {
	const storage = new Map([[LOCAL_CACHE_KEY, JSON.stringify({
		at: Date.now(),
		fonts: [{ name: "Cached Mono", aliases: [], faces: [{ fullName: "Cached Mono Regular", postScript: "CachedMono-Regular", weight: 400, italic: false }], source: "local" }]
	})]]);
	const h = createHarness({ queryLocalFonts: async () => FONT_DATA, storage });
	assert.equal(h.lastTools().localStatus, "ready");
	assert.ok(h.lastTools().fonts.some((font) => font.name === "Cached Mono"));
});

test("the terminal alias is built from postscriptName/fullName, never the family name", async () => {
	const h = createHarness({ queryLocalFonts: async () => FONT_DATA });
	await h.actions.readLocalFonts();
	h.actions.setFont("codeFont", "system", "JetBrains Mono");
	const css = h.aliasCss();
	assert.match(css, /@font-face\{font-family:ui-monospace;src:local\('JetBrains Mono Regular'\),local\('JetBrainsMono-Regular'\)/);
	assert.match(css, /font-weight:700/);
	assert.match(css, /font-style:italic/);
	assert.doesNotMatch(css, /local\('JetBrains Mono'\)/, "the family name alone never resolves in local()");
});

test("a curated family without indexed faces falls back to a ui-monospace family alias", () => {
	const h = createHarness();
	h.actions.setFont("codeFont", "system", "Fira Code");
	assert.match(h.aliasCss(), /@font-face\{font-family:ui-monospace;src:local\('Fira Code'\);font-weight:400;font-style:normal\}/);
});

test("curated candidates are offered per slot even with no local read", () => {
	const h = createHarness();
	const fonts = h.lastTools().fonts;
	const ui = fonts.filter((font) => font.source === "curated" && font.slots.includes("uiFont")).map((font) => font.name);
	const code = fonts.filter((font) => font.source === "curated" && font.slots.includes("codeFont")).map((font) => font.name);
	assert.ok(ui.includes("Inter"));
	assert.ok(!ui.includes("JetBrains Mono"));
	assert.ok(code.includes("JetBrains Mono"));
	assert.ok(!code.includes("Inter"));
});
