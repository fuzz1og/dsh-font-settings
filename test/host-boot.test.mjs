import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

/**
 * The module documents the APIs it migrated off, so every guard below must read
 * code rather than prose. Stripping comments is enough: a real removed-API call
 * is code, and no comment can hide one.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * A plugin must not be able to abort the profile by failing to load. The loader
 * answers a failed mount by killing the whole boot, so any *static* import of a
 * runtime dependency turns "this package's dependencies are missing" into "dsh
 * will not start". Node builtins are not the hazard (they always resolve).
 */
test("host module has no static import of a plugin dependency", () => {
	const statics = [...source.matchAll(/^import\s[\s\S]*?from\s+["']([^"']+)["'];$/gm)].map((m) => m[1]);
	const runtime = statics.filter((specifier) => !specifier.startsWith("node:"));
	assert.deepEqual(runtime, [], "static runtime imports would abort the boot when unresolved: " + runtime.join(", "));
});

/**
 * The host half is deliberately inert: its whole surface is the Config
 * declaration plus the optional settings-page policy. Enumeration moved to the
 * browser (Local Font Access), so no filesystem, environment, network or route
 * code may come back.
 */
test("the host declares no route, no scanner and no environment access", () => {
	assert.doesNotMatch(code, /webServer/);
	assert.doesNotMatch(code, /process\.env/);
	assert.doesNotMatch(code, /node:fs/);
	assert.doesNotMatch(code, /scanAllFonts|readFontNames|parseNameTable/);
	assert.doesNotMatch(code, /ctx\.webServer\.register/);
});

/**
 * dsh 0.1.7-alpha.1 reads a plugin's Config once, while evaluating the module,
 * and settings.register/get(ns) are gone. The schema must be a module-level
 * export built from a guarded resolution that cannot throw.
 */
test("schemastery resolves synchronously through a guarded require, and Config is exported", () => {
	assert.match(code, /createRequire\(import\.meta\.url\)/);
	assert.match(code, /function resolveSchemastery\(\)/);
	assert.match(code, /export const Config = buildFontSettingsSchema\(schemastery\)/);
	assert.equal([...code.matchAll(/\.volatile\(\)/g)].length, 5, "expected all five Config fields to be volatile");
});

test("host module never calls the removed settings.register/get API", () => {
	assert.doesNotMatch(code, /settings\.register\(/);
	assert.doesNotMatch(code, /settings\.get\(/);
});

test("the settings page policy is applied through the optional settings service", () => {
	assert.match(code, /export const inject = \[\]/);
	assert.match(code, /ctx\.inject\(\["settings"\]/);
	assert.match(code, /settingsCtx\.settings\.configure\(\{ auto: false \}, ctx\.fiber\)/);
});

/**
 * A candidate is probed for the capability this schema needs, not merely for
 * being schemastery — and it must be probed in a try, because a module that has
 * the builder but throws while building would otherwise abort the boot.
 */
test("a schemastery too old to build the volatile schema is skipped, not accepted", () => {
	assert.match(code, /function canBuildVolatileSchema\(candidate\)/);
	assert.match(code, /typeof candidate\.string\(\)\.default\(""\)\.volatile === "function"/);
	assert.match(code, /if \(canBuildVolatileSchema\(resolved\)\) return resolved;/);
	assert.match(code, /catch \(error\) \{\n\s+return false;/);
});

test("Config construction is guarded so no schema failure can abort the boot", () => {
	assert.match(code, /function buildFontSettingsSchema\(z\)/);
	assert.match(code, /catch \(error\) \{\n\s+return undefined;/);
});

test("schemastery is a peer dependency with the version that has .volatile()", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.dependencies?.["@deepseek-ai/schemastery"], undefined, "schemastery must not be a hard dependency");
	assert.match(manifest.peerDependencies["@deepseek-ai/schemastery"], /3\.18\.3|3\.18\.\^?3/);
});

function evaluateWith(requireImpl) {
	const context = {
		createRequire: () => requireImpl,
		process: { argv: [], env: {} },
		URL,
		console: { warn() {}, log() {} }
	};
	const executable = source
		.replace(/^import .*;$/gm, "")
		.replace(/import\.meta\.url/g, '"file:///test/index.js"')
		.replace(/export (const|function) /g, "$1 ")
		.replace(/^export \{.*\};$/gm, "")
		+ "\nglobalThis.__Config = Config; globalThis.__schemastery = schemastery;"
		+ "\nglobalThis.__probe = canBuildVolatileSchema; globalThis.__builder = buildFontSettingsSchema;"
		+ "\nglobalThis.__apply = apply;";
	vm.runInNewContext(executable, context);
	return context;
}

test("module evaluation never throws, whatever schemastery resolves to", () => {
	const none = evaluateWith(() => { throw new Error("MODULE_NOT_FOUND"); });
	assert.equal(none.__schemastery, null);
	assert.equal(none.__Config, undefined);
	const tooOld = { object: (v) => v, string: () => ({ default: () => ({}) }) };
	const old = evaluateWith((name) => (name === "@deepseek-ai/schemastery" ? { default: tooOld } : (() => { throw new Error("nope"); })()));
	assert.equal(old.__schemastery, null);
	assert.equal(old.__Config, undefined);
	const thrower = { object: () => { throw new Error("builder exploded"); }, string: () => ({ default: () => ({ volatile: () => ({}) }) }) };
	const threw = evaluateWith((name) => (name === "@deepseek-ai/schemastery" ? { default: thrower } : (() => { throw new Error("nope"); })()));
	assert.equal(threw.__Config, undefined, "a throwing builder must degrade, not propagate");
});

test("the capability probe accepts only a schemastery that can build .volatile()", () => {
	const { __probe } = evaluateWith(() => { throw new Error("nope"); });
	assert.equal(__probe(null), false);
	assert.equal(__probe(undefined), false);
	assert.equal(__probe({}), false);
	assert.equal(__probe({ object: () => {} }), false);
	const good = { object: (v) => v, string: () => ({ default: () => ({ volatile: () => ({}) }) }) };
	assert.equal(__probe(good), true);
});

test("apply configures the settings page policy and names the degraded mode once", () => {
	const good = { object: (v) => v, string: () => ({ default: () => ({ volatile: () => ({}) }) }), number: () => ({ default: () => ({ volatile: () => ({}) }) }) };
	const ok = evaluateWith((name) => (name === "@deepseek-ai/schemastery" ? { default: good } : (() => { throw new Error("nope"); })()));
	let policy = null;
	let owner = null;
	const fiber = {};
	const ctx = {
		fiber,
		logger: { warn() { throw new Error("unexpected warning"); } },
		inject(services, callback) {
			assert.deepEqual([...services], ["settings"]);
			callback({
				effect: (fn) => fn(),
				settings: { configure: (value, who) => { policy = value; owner = who; return () => {}; } }
			});
		}
	};
	ok.__apply(ctx);
	assert.equal(policy.auto, false);
	assert.equal(owner, fiber);

	const none = evaluateWith(() => { throw new Error("nope"); });
	const warnings = [];
	none.__apply({ fiber: {}, logger: { warn: (message) => warnings.push(message) }, inject: () => {} });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /schemastery/);
});
