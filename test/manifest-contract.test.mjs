import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Fixed-source contract guards for the DSH STORE automatic policy.
 *
 * The store's automation reads this manifest at a fixed Commit and blocks
 * installation when the repository identity, the explicit file list, the
 * Node/DSH compatibility declarations, the lifecycle scripts, the runtime
 * dependency set, or the Bundle Patch entry set do not match the policy.
 * These tests keep the author-side half of that contract from regressing.
 */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
const CANONICAL_REPOSITORY = 'https://github.com/fuzz1og/dsh-font-settings';

/** Same normalization the store applies before comparing manifest and catalog. */
function canonicalRepository(value) {
	const source = typeof value === 'string' ? value : value?.url;
	return String(source ?? '')
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/\.git\/?$/i, '')
		.replace(/\/$/, '');
}

test('manifest repository matches the canonical GitHub repository', () => {
	assert.equal(canonicalRepository(manifest.repository), CANONICAL_REPOSITORY);
});

test('manifest declares an explicit distributable files list', () => {
	assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
	assert.ok(manifest.files.includes('lib'));
	assert.ok(manifest.files.includes('cordis.patch.yml'));
});

test('manifest declares Node.js and DSH compatibility ranges', () => {
	assert.equal(typeof manifest.engines?.node, 'string');
	assert.match(manifest.engines.node, /^>=?\d/);
	assert.equal(typeof manifest.engines?.dsh, 'string');
	assert.equal(manifest.dsh?.compatibility?.dsh, manifest.engines.dsh);
	assert.equal(typeof manifest.dsh?.compatibility?.dshReleases, 'object');
});

test('the declared DSH release matrix carries exact compatible evidence', () => {
	const releases = manifest.dsh?.compatibility?.dshReleases ?? {};
	const compatible = Object.entries(releases).filter(([, status]) => status === 'compatible');
	assert.ok(compatible.length > 0, 'at least one exact compatible dshReleases record is required');
	for (const [release, status] of Object.entries(releases)) {
		assert.match(release, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `release key ${release} is not a full SemVer`);
		assert.ok(['compatible', 'incompatible', 'unknown'].includes(status), `invalid status for ${release}`);
	}
});

test('manifest has no lifecycle scripts and no runtime dependencies', () => {
	for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
		assert.equal(manifest.scripts?.[lifecycle], undefined, `unexpected ${lifecycle} lifecycle script`);
	}
	assert.deepEqual(manifest.dependencies ?? {}, {});
	assert.deepEqual(manifest.optionalDependencies ?? {}, {});
	assert.deepEqual(manifest.bundledDependencies ?? [], []);
});

test('Bundle Patch mounts exactly one plugin-owned entry, once', () => {
	const ids = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1]);
	assert.deepEqual(ids, ['font-settings']);
	const names = [...patch.matchAll(/^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1]);
	assert.deepEqual(names, ['dsh-font-settings']);
});

test('client entry is declared for the web platform', () => {
	assert.equal(manifest.dsh?.client?.platform, 'web');
	assert.ok(manifest.dsh?.compatibility?.profiles?.includes('web'));
});