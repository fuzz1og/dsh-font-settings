import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');

/**
 * The module documents the APIs it migrated off, so every guard below must read
 * code rather than prose. Stripping comments is enough: a real removed-API call
 * is code, and no comment can hide one.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * A plugin must not be able to abort the profile by failing to load. The loader
 * answers a failed mount by killing the whole boot, so any *static* import of a
 * runtime dependency turns "this package's dependencies are missing" into "dsh
 * will not start" — which is exactly what a `link:` install produced:
 * `Cannot find package '@deepseek-ai/schemastery'`.
 *
 * Node builtins are not the hazard (they always resolve); the plugin's own
 * dependencies are, and they must go through resolveSchemastery() instead.
 */
test('host module has no static import of a plugin dependency', () => {
	const statics = [...source.matchAll(/^import\s[\s\S]*?from\s+["']([^"']+)["'];$/gm)].map((m) => m[1]);
	const runtime = statics.filter((specifier) => !specifier.startsWith('node:'));
	assert.deepEqual(runtime, [], `static runtime imports would abort the boot when unresolved: ${runtime.join(', ')}`);
});

/**
 * dsh 0.1.7-alpha.1 reads a plugin's `Config` once, while evaluating the module
 * (`configOf` in dsh-app-boot), and `settings.register`/`get(ns)` are gone — so
 * the schema can no longer be produced lazily on first use. It must be a
 * module-level export built from a guarded resolution that cannot throw.
 */
test('schemastery resolves synchronously through a guarded require, and Config is exported', () => {
	assert.match(code, /createRequire\(import\.meta\.url\)/, 'expected a createRequire base');
	assert.match(code, /function resolveSchemastery\(\)/, 'expected the guarded resolver');
	assert.match(code, /export const Config = buildFontSettingsSchema\(schemastery\)/, 'expected Config to come from the guarded builder');
	// Every field must be volatile: the write path refuses non-volatile paths,
	// and only a volatile edit applies without restarting the entry.
	assert.equal([...code.matchAll(/\.volatile\(\)/g)].length, 5, 'expected all five Config fields to be volatile');
});

/**
 * The 0.1.7 settings API is Config-derived. `register()` and `get(ns)` no
 * longer exist on SettingsForms, so the plugin must never call them again.
 */
test('host module never calls the removed settings.register/get API', () => {
	assert.doesNotMatch(code, /settings\.register\(/, 'settings.register was removed in dsh 0.1.7-alpha.1');
	assert.doesNotMatch(code, /settings\.get\(/, 'settings.get(ns) was removed in dsh 0.1.7-alpha.1');
	assert.match(code, /settings\.describe\(\)/, 'expected reads through describe()');
	assert.match(code, /settings\.mutate\(/, 'expected writes through mutate()');
});

/**
 * The route must keep working when the schema could not be built: 503, not a
 * crash. `Config === undefined` is the documented degraded mode.
 */
test('an unresolvable schemastery degrades to 503 instead of aborting the boot', () => {
	assert.match(code, /if \(settings === undefined \|\| Config === undefined\)/, 'expected the degraded-mode guard');
	assert.match(code, /settings service unavailable/);
	assert.match(code, /ctx\.logger\?\.warn\?\./, 'expected one named warning instead of silence');
});

/**
 * A candidate is probed for the capability this schema needs, not merely for
 * being schemastery — and it must be probed in a `try`, because a module that
 * has the builder but throws while building would otherwise abort the boot.
 *
 * This is not hypothetical: schemastery 3.18.2 has no `.volatile()` (it landed
 * in 3.18.3), and a plain npm install pulls 3.18.2 into the profile, where it
 * shadows the harness's 3.18.3. Accepting it raised
 * `schemastery.string(...).default(...).volatile is not a function` during
 * module evaluation, and the loader answers a failed evaluation by killing the
 * whole profile — the exact failure 0.4.3 removed, reached by a new route.
 */
test('a schemastery too old to build the volatile schema is skipped, not accepted', () => {
	assert.match(code, /function canBuildVolatileSchema\(candidate\)/, 'expected a capability probe');
	assert.match(code, /typeof candidate\.string\(\)\.default\(""\)\.volatile === "function"/, 'expected .volatile to be the probed capability');
	assert.match(code, /if \(canBuildVolatileSchema\(resolved\)\) return resolved;/, 'expected the resolver to skip unusable candidates');
	assert.match(code, /catch \(error\) \{\n\s+return false;/, 'the probe must not throw out of module evaluation');
});

/**
 * The schema must be built inside a guard as well, so an unexpected builder
 * failure degrades to the inert path instead of aborting the profile.
 */
test('Config construction is guarded so no schema failure can abort the boot', () => {
	assert.match(code, /function buildFontSettingsSchema\(z\)/, 'expected a guarded builder');
	assert.match(code, /export const Config = buildFontSettingsSchema\(schemastery\)/, 'expected Config to come from the guarded builder');
	// The builder must swallow a throwing schema rather than let it escape
	// module evaluation.
	assert.match(code, /catch \(error\) \{\n\s+return undefined;/, 'the builder must degrade to undefined');
});

/**
 * schemastery must be a peer, not a bundled dependency: shipping our own copy
 * both risks the too-old shadowing above and gives the loader a schema built by
 * a different instance than the one it validates with.
 */
test('schemastery is a peer dependency with the version that has .volatile()', () => {
	const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.equal(manifest.dependencies?.['@deepseek-ai/schemastery'], undefined, 'schemastery must not be a hard dependency');
	assert.match(manifest.peerDependencies['@deepseek-ai/schemastery'], /3\.18\.3|3\.18\.\^?3/, 'expected a range that excludes 3.18.2');
});

/**
 * The static assertions above pin the shape; these execute the real module to
 * prove the behaviour those shapes exist for. Module evaluation is the thing
 * under test — it must not throw for ANY schemastery availability, because the
 * loader kills the profile when it does.
 */
function evaluateWith(requireImpl) {
	const context = {
		createRequire: () => requireImpl,
		process: { argv: [], env: {} },
		os, path,
		URL,
		console: { warn() {}, log() {} },
	};
	const executable = source
		.replace(/^import .*;$/gm, '')
		.replace(/import\.meta\.url/g, '"file:///test/index.js"')
		.replace(/export (const|function) /g, '$1 ')
		.replace(/^export \{.*\};$/gm, '')
		+ '\nglobalThis.__Config = Config; globalThis.__schemastery = schemastery;'
		+ '\nglobalThis.__probe = canBuildVolatileSchema; globalThis.__builder = buildFontSettingsSchema;';
	vm.runInNewContext(executable, context);
	return context;
}

test('module evaluation never throws, whatever schemastery resolves to', () => {
	// (a) nothing resolvable at all
	const none = evaluateWith(() => { throw new Error('MODULE_NOT_FOUND'); });
	assert.equal(none.__schemastery, null, 'expected no usable schemastery');
	assert.equal(none.__Config, undefined, 'Config must degrade to undefined');
	// (b) a copy that resolves but cannot build the schema (the 3.18.2 case)
	const tooOld = { object: v => v, string: () => ({ default: () => ({}) }) };
	const old = evaluateWith(name => (name === '@deepseek-ai/schemastery' ? { default: tooOld } : (() => { throw new Error('nope'); })()));
	assert.equal(old.__schemastery, null, 'a copy without .volatile() must be rejected');
	assert.equal(old.__Config, undefined);
	// (c) a copy whose builder throws must still not escape module evaluation
	const thrower = { object: () => { throw new Error('builder exploded'); }, string: () => ({ default: () => ({ volatile: () => ({}) }) }) };
	const threw = evaluateWith(name => (name === '@deepseek-ai/schemastery' ? { default: thrower } : (() => { throw new Error('nope'); })()));
	assert.equal(threw.__Config, undefined, 'a throwing builder must degrade, not propagate');
});

test('the capability probe accepts only a schemastery that can build .volatile()', () => {
	const { __probe } = evaluateWith(() => { throw new Error('nope'); });
	assert.equal(__probe(null), false);
	assert.equal(__probe(undefined), false);
	assert.equal(__probe({}), false);
	assert.equal(__probe({ object: () => {} }), false, 'a builder without .volatile() is unusable');
	const good = { object: v => v, string: () => ({ default: () => ({ volatile: () => ({}) }) }) };
	assert.equal(__probe(good), true);
});
