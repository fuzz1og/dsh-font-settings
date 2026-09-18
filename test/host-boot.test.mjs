import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');

/**
 * A plugin must not be able to abort the profile by failing to load. The loader
 * answers a failed mount by killing the whole boot, so any *static* import of a
 * runtime dependency turns "this package's dependencies are missing" into "dsh
 * will not start" — which is exactly what a `link:` install produced:
 * `Cannot find package '@deepseek-ai/schemastery'`.
 *
 * Node builtins are not the hazard (they always resolve); the plugin's own
 * dependencies are, and they must go through loadSchemastery() instead.
 */
test('host module has no static import of a plugin dependency', () => {
	const statics = [...source.matchAll(/^import\s[\s\S]*?from\s+["']([^"']+)["'];$/gm)].map((m) => m[1]);
	const runtime = statics.filter((specifier) => !specifier.startsWith('node:'));
	assert.deepEqual(runtime, [], `static runtime imports would abort the boot when unresolved: ${runtime.join(', ')}`);
});

test('schemastery is resolved lazily and degrades to a null schema', () => {
	assert.match(source, /import\("@deepseek-ai\/schemastery"\)/, 'expected a dynamic import');
	assert.match(source, /function fontSettingsSchema\(\)/, 'expected lazy schema construction');
	assert.match(source, /if \(schemastery === null\) return null;/, 'expected an explicit unavailable path');
	// The registration site must tolerate the null schema rather than dereference it.
	assert.match(source, /if \(schema === null\)/);
});
