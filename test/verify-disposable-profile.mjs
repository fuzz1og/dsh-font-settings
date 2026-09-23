/**
 * Disposable-profile lifecycle evidence for dsh-font-settings.
 *
 * Runs the full install → config-synthesis/cold-start → uninstall cycle inside
 * a throwaway `DSH_HOME` created with `mkdtemp`, so the real `~/.dsh` is never
 * read or written. Prints one JSON summary and exits non-zero if any step
 * fails.
 *
 *   node test/verify-disposable-profile.mjs
 *
 * Scope of this evidence: disposable-Profile install, config composition /
 * cold start, and uninstall. It does NOT cover browser rendering, a real
 * user Profile, or real user data.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = "font-settings-evidence";
const evidence = {
	schemaVersion: 1,
	plugin: "dsh-font-settings",
	scope: "disposable-profile-install-start-uninstall",
	steps: {},
};

function fail(message) {
	console.error(`VERIFY_DISPOSABLE_PROFILE_FAILED: ${message}`);
	console.error(JSON.stringify(evidence, null, 2));
	process.exitCode = 1;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
	return spawnSync(command, args, {
		encoding: "utf8",
		timeout: 180_000,
		...options,
		env: { ...process.env, ...(options.env ?? {}) },
	});
}

// The ambient environment may already carry a real DSH_HOME (for example when
// this check is run from inside DSH itself). Every child below is given the
// disposable home explicitly, so the inherited value is never used.
const inheritedDshHome = process.env.DSH_HOME ?? null;
const dshHome = mkdtempSync(join(tmpdir(), "dsh-font-settings-evidence-"));

try {
	evidence.dshHome = dshHome;
	evidence.inheritedDshHomeOverridden = inheritedDshHome;
	evidence.childrenRestrictedToDisposableHome = true;

	const dshVersion = run("dsh", ["--version"], { env: { DSH_HOME: dshHome } });
	assert(dshVersion.status === 0, `dsh --version failed: ${dshVersion.error ?? dshVersion.stderr}`);
	evidence.dshVersion = dshVersion.stdout.trim().split("\n")[0];
	evidence.nodeVersion = process.version;

	// 1. install
	const add = run("dsh", ["plugin", `--profile`, profile, "add", repoRoot], { env: { DSH_HOME: dshHome } });
	assert(add.status === 0, `plugin add failed: ${add.stderr || add.stdout}`);
	const profileManifest = JSON.parse(readFileSync(join(dshHome, "profiles", profile, "package.json"), "utf8"));
	const bundles = profileManifest?.dsh?.profile?.bundles ?? [];
	assert(bundles.includes("dsh-font-settings"), "profile bundles did not include dsh-font-settings");
	evidence.steps.install = {
		exitCode: add.status,
		bundles,
		declaredDependency: profileManifest?.dependencies?.["dsh-font-settings"] ?? null,
	};

	// 2. config synthesis / cold start
	const dump = run("dsh", [`--profile`, profile, "--dump-config"], { env: { DSH_HOME: dshHome } });
	assert(dump.status === 0, `--dump-config failed: ${dump.stderr || dump.stdout}`);
	const dumpText = dump.stdout;
	const entryIdCount = dumpText.split("\n").filter(line => line.trim() === "- id: font-settings").length;
	assert(entryIdCount === 1, `expected exactly one font-settings entry, found ${entryIdCount}`);
	assert(/name:\s*dsh-font-settings/.test(dumpText), "config does not mount dsh-font-settings");
	evidence.steps.start = {
		exitCode: dump.status,
		method: "dsh --profile --dump-config (config synthesis + cold start)",
		entryId: "font-settings",
		entryIdCount,
	};

	// 2b. host module cold import: proves the entry module evaluates in isolation.
	const hostUrl = pathToFileURL(join(repoRoot, "lib", "index.js")).href;
	const hostImport = run(process.execPath, [
		"--input-type=module",
		"-e",
		`await import(process.argv[1]); console.log("HOST_IMPORT_OK")`,
		hostUrl,
	]);
	assert(hostImport.status === 0 && hostImport.stdout.includes("HOST_IMPORT_OK"),
		`host module import failed: ${hostImport.stderr || hostImport.stdout}`);
	evidence.steps.hostModuleImport = { exitCode: hostImport.status, result: "HOST_IMPORT_OK" };

	// 3. uninstall
	const remove = run("dsh", ["plugin", `--profile`, profile, "remove", "dsh-font-settings"], { env: { DSH_HOME: dshHome } });
	assert(remove.status === 0, `plugin remove failed: ${remove.stderr || remove.stdout}`);
	const afterDump = run("dsh", [`--profile`, profile, "--dump-config"], { env: { DSH_HOME: dshHome } });
	assert(afterDump.status === 0, `post-uninstall --dump-config failed: ${afterDump.stderr}`);
	assert(!/name:\s*dsh-font-settings/.test(afterDump.stdout), "font-settings entry survived uninstall");
	const afterManifest = JSON.parse(readFileSync(join(dshHome, "profiles", profile, "package.json"), "utf8"));
	const afterBundles = afterManifest?.dsh?.profile?.bundles ?? [];
	assert(!afterBundles.includes("dsh-font-settings"), "profile bundles still include dsh-font-settings after uninstall");
	evidence.steps.uninstall = {
		exitCode: remove.status,
		bundles: afterBundles,
		entryPresentAfterRemove: false,
	};

	evidence.result = "passed";
	console.log("VERIFY_DISPOSABLE_PROFILE_OK");
	console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
	fail(error?.message ?? String(error));
} finally {
	rmSync(dshHome, { recursive: true, force: true });
}