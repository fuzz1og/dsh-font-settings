import { readFileSync } from 'node:fs';
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
	assert.match(code, /export const Config = schemastery === null \? undefined : schemastery\.object\(/, 'expected Config to degrade to undefined');
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
