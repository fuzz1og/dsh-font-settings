import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./client-harness.mjs";

const PREFS_KEY = "dsh-font-settings.preferences.v1";
const DEFAULTS = { uiFont: "default", uiFontValue: "", codeFont: "default", codeFontValue: "", terminalSize: 0 };
/** VM-realm values have foreign prototypes; compare plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the client addresses this entry's id as the settings namespace", () => {
	const h = createHarness();
	assert.equal(h.state.entryId, "font-settings");
});

test("on loopback the preference is written through the official config form", () => {
	const h = createHarness({ snapshot: { status: "ready", mode: "host", value: { ...DEFAULTS }, revision: 4, writable: true } });
	h.actions.setFont("uiFont", "custom", "'Fira Code'");
	assert.deepEqual(plain(h.state.mutations), [[
		{ op: "set", path: ["uiFont"], value: "custom" },
		{ op: "set", path: ["uiFontValue"], value: "'Fira Code'" }
	]]);
	assert.equal(h.state.overrides.at(-1).pairs["--dsw-font-family"].light, "'Fira Code'");
	assert.equal(h.storage.has(PREFS_KEY), false, "the host document is authoritative on loopback");
});

test("a host snapshot is adopted and pushed to the row store", () => {
	const h = createHarness({ snapshot: { status: "ready", mode: "host", value: { ...DEFAULTS, codeFont: "system", codeFontValue: "JetBrains Mono", terminalSize: 14 }, revision: 2, writable: true } });
	const sync = h.state.syncs.at(-1);
	assert.equal(sync[2], "system");
	assert.equal(sync[3], "JetBrains Mono");
	assert.equal(sync[4], 14);
});

test("a later host snapshot replaces the adopted value", () => {
	const h = createHarness();
	h.state.snapshot = { status: "ready", mode: "host", value: { ...DEFAULTS, uiFont: "system", uiFontValue: "Inter" }, revision: 9, writable: true };
	h.emitSnapshot();
	const sync = h.state.syncs.at(-1);
	assert.equal(sync[0], "system");
	assert.equal(sync[1], "Inter");
});

test("restoring the default clears the override instead of persisting a stack", () => {
	const h = createHarness();
	h.actions.setFont("uiFont", "custom", "'Fira Code'");
	const before = h.state.overrides.length;
	h.actions.setFont("uiFont", "default", "");
	assert.equal(h.state.syncs.at(-1)[0], "default");
	assert.equal(h.state.overrides.length, before, "default mode installs no token layer");
	assert.deepEqual(plain(h.state.mutations.at(-1)), [
		{ op: "set", path: ["uiFont"], value: "default" },
		{ op: "set", path: ["uiFontValue"], value: "" }
	]);
});

test("off loopback the preference stays per-device in localStorage", () => {
	const h = createHarness({ snapshot: { status: "unavailable", mode: "memory", value: undefined, revision: undefined, writable: false } });
	h.actions.setFont("codeFont", "system", "JetBrains Mono");
	h.actions.setSize(16);
	assert.deepEqual(plain(h.state.mutations), [], "a remote page never writes the host document");
	const stored = JSON.parse(h.storage.get(PREFS_KEY));
	assert.equal(stored.codeFont, "system");
	assert.equal(stored.codeFontValue, "JetBrains Mono");
	assert.equal(stored.terminalSize, 16);
});

test("a per-device preference is adopted at boot off loopback", () => {
	const storage = new Map([[PREFS_KEY, JSON.stringify({ ...DEFAULTS, uiFont: "custom", uiFontValue: "'Inter'", terminalSize: 15 })]]);
	const h = createHarness({ snapshot: { status: "unavailable", mode: "memory", value: undefined, revision: undefined, writable: false }, storage });
	const sync = h.state.syncs.at(-1);
	assert.equal(sync[0], "custom");
	assert.equal(sync[1], "'Inter'");
	assert.equal(sync[4], 15);
	assert.equal(h.state.overrides.at(-1).pairs["--dsw-font-family"].light, "'Inter'");
});

test("terminal size alone persists without touching the font slots", () => {
	const h = createHarness();
	h.actions.setSize(20);
	assert.deepEqual(plain(h.state.mutations), [[{ op: "set", path: ["terminalSize"], value: 20 }]]);
});
