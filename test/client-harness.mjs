/**
 * Shared VM harness for the client half.
 *
 * lib/client.js is a browser bundle: it registers a factory on
 * window.__ModuleLoader__ and expects react / dsh-client-store as externals.
 * This harness runs the real file in a VM, captures the factory, and applies
 * the plugin against a cordis-shaped context whose configForms form, DOM and
 * localStorage are inspectable.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const CLIENT_SOURCE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** A minimal DOM node: enough for the alias <style> tag and the probe. */
export function makeNode(tag) {
	return {
		tagName: tag,
		style: { cssText: "", fontFamily: "" },
		dataset: {},
		textContent: "",
		children: [],
		appendChild(child) { this.children.push(child); },
		remove() {},
		contains() { return false; },
		getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
	};
}

const DEFAULT_VALUE = { uiFont: "default", uiFontValue: "", codeFont: "default", codeFontValue: "", terminalSize: 0 };

/**
 * @param options.snapshot - the configForms snapshot the form reports.
 * @param options.queryLocalFonts - window.queryLocalFonts stub (omit for unsupported).
 * @param options.isSecureContext - window.isSecureContext.
 * @param options.storage - a Map backing localStorage.
 */
export function createHarness(options = {}) {
	const state = {
		snapshot: options.snapshot ?? { status: "ready", mode: "host", value: { ...DEFAULT_VALUE }, revision: 1, writable: true },
		mutations: [],
		overrides: [],
		tools: [],
		syncs: [],
		aliasNodes: [],
		listeners: [],
		cleanups: [],
		warnings: [],
		registration: null,
		entryId: null
	};
	const storage = options.storage ?? new Map();
	const localStorage = {
		getItem: (key) => (storage.has(key) ? storage.get(key) : null),
		setItem: (key, value) => { storage.set(key, String(value)); },
		removeItem: (key) => { storage.delete(key); }
	};
	const form = {
		getSnapshot: () => state.snapshot,
		subscribe(listener) {
			state.listeners.push(listener);
			return () => {
				const index = state.listeners.indexOf(listener);
				if (index >= 0) state.listeners.splice(index, 1);
			};
		},
		async mutate(ops) {
			state.mutations.push(ops);
			if (state.snapshot.mode !== "host") return false;
			const value = { ...(state.snapshot.value ?? {}) };
			for (const op of ops) value[op.path[0]] = op.value;
			state.snapshot = { ...state.snapshot, value };
			return true;
		}
	};
	const documentStub = {
		querySelector: () => null,
		querySelectorAll: () => [],
		createElement: (tag) => {
			const node = makeNode(tag);
			if (tag === "style") state.aliasNodes.push(node);
			return node;
		},
		head: { appendChild: () => {} },
		body: null,
		addEventListener: () => {},
		removeEventListener: () => {}
	};
	const windowStub = {
		__ModuleLoader__: { load: (definition) => { state.definition = definition; } },
		queryLocalFonts: options.queryLocalFonts,
		isSecureContext: options.isSecureContext ?? true,
		localStorage,
		innerHeight: 800,
		innerWidth: 1200,
		addEventListener: () => {},
		removeEventListener: () => {}
	};
	const react = {
		useState: (initial) => [initial, () => {}],
		useEffect: () => {},
		useLayoutEffect: () => {},
		useRef: () => ({ current: null }),
		createElement: (type, props, ...children) => ({ type, props, children })
	};
	const context = { window: windowStub, document: documentStub, console: { warn: (...args) => state.warnings.push(args.join(" ")) } };
	context.globalThis = context;
	vm.runInNewContext(CLIENT_SOURCE, context);
	const plugin = state.definition.factory((name) => {
		if (name === "react") return react;
		if (name === "@deepseek-ai/dsh-client-store") return { defineStore: (config) => config };
		return {};
	});
	const ctx = {
		theme: { overrideTokens: (source, pairs) => { state.overrides.push({ source, pairs }); return () => {}; } },
		locale: { register: () => () => {} },
		configForms: { get: (entryId) => { state.entryId = entryId; return form; } },
		effect(fn) { const disposer = fn(); if (typeof disposer === "function") state.cleanups.push(disposer); return disposer; },
		slots: {
			inject: (name, fn) => fn(),
			register: (options) => { state.registration = options; return () => {}; }
		}
	};
	plugin.apply(ctx);
	const actions = state.registration.inject({
		sync: (...args) => state.syncs.push(args),
		setTools: (fonts, localStatus) => state.tools.push({ fonts, localStatus })
	});
	return {
		state,
		form,
		actions,
		storage,
		plugin,
		emitSnapshot() { for (const listener of state.listeners) listener(); },
		lastTools() { return state.tools.length === 0 ? null : state.tools[state.tools.length - 1]; },
		aliasCss() { return state.aliasNodes.length === 0 ? "" : state.aliasNodes[state.aliasNodes.length - 1].textContent; }
	};
}
