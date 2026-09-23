import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * DSH STORE automatic-policy guard: the fixed-source scanner is a pure text
 * regex over every runtime source file, comments included, and it blocks
 * automatic approval when ANY permission signal appears. The signals below are
 * copied verbatim from the store's src/automation-source-policy.mjs so a stray
 * import, a doc comment or a process.env read fails here instead of silently
 * keeping the catalog entry blocked.
 *
 * File selection mirrors scripts/automate-catalog.mjs: source extensions only,
 * with node_modules / test / docs / examples directories excluded.
 */
const moduleImport = (names) => new RegExp(
	"(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)[\"'](?:node:)?(?:" + names + ")[\"']",
	"i"
);
const FILE_MODULE = moduleImport("fs|fs/promises");
const NETWORK_MODULE = moduleImport("http|https|net|tls|dgram|axios|got|undici");
const COMMAND_MODULE = moduleImport("child_process");
const COMMAND_CALL = /(?:^|[^\w$.'"\x60])(?:exec|execFile|spawn|fork)\s*\(/im;

function permissionSignals(source) {
	return {
		files: FILE_MODULE.test(source)
			|| /\b(?:readFile|writeFile|appendFile|rename|unlink|mkdir|rmdir|rm)\s*\(/i.test(source)
			|| /\$DSH_HOME|\.dsh\/profiles/i.test(source),
		network: NETWORK_MODULE.test(source)
			|| /\b(?:fetch|WebSocket|EventSource)\s*\(/i.test(source)
			|| /\b(?:axios|got|undici)\s*(?:\.|\()/i.test(source),
		commands: COMMAND_MODULE.test(source)
			|| COMMAND_CALL.test(source)
			|| /shell\s*:\s*true|Bun\.spawn|new\s+Deno\.Command/i.test(source),
		credentials: /process\.env/i.test(source)
			|| /\b(?:keychain|credentials?|oauth)\b\s*(?:\.|\[|\()/i.test(source)
			|| /\b(?:api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|password)\b/i.test(source),
		protectedDsh: /(?:__ModuleLoader__[^\n]{0,120}(?:unload|remove)|\bFiber\b[^\n]{0,120}(?:remove|disable|replace)|@deepseek-ai\/[^\n]{0,160}disabled\s*:\s*true|tool\.call\.toolview)/i.test(source)
	};
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|py|rb|go|rs)$/i;
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:node_modules|vendor|test|tests|docs?|examples?|fixtures?|benchmarks?|coverage|\.github)(?:\/|$)/i;
const ROOT = new URL("..", import.meta.url).pathname;

function runtimeFiles(dir, prefix = "") {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const relative = prefix + entry;
		if (EXCLUDED_DIRECTORY.test(relative)) continue;
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...runtimeFiles(full, relative + "/"));
		else if (SOURCE_FILE.test(relative)) out.push({ relative, full });
	}
	return out;
}

test("every runtime source file carries zero permission signals", () => {
	const files = runtimeFiles(ROOT);
	assert.ok(files.length >= 4, "expected the manifest, bundle patch and both halves to be scanned");
	const offenders = [];
	for (const file of files) {
		const signals = permissionSignals(readFileSync(file.full, "utf8"));
		for (const [signal, present] of Object.entries(signals)) {
			if (present) offenders.push(file.relative + ": " + signal);
		}
	}
	assert.deepEqual(offenders, [], "automatic approval requires zero permission signals");
});

test("the host half no longer imports node:fs, reads process.env, or serves a route", () => {
	const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
	assert.doesNotMatch(host, /node:fs/);
	assert.doesNotMatch(host, /process\.env/);
	assert.doesNotMatch(host, /webServer/);
	assert.doesNotMatch(host, /ctx\.webServer/);
});

test("the client half no longer fetches a host route", () => {
	const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	assert.doesNotMatch(client, /\bfetch\s*\(/);
	assert.doesNotMatch(client, /\/font-settings\//);
});
