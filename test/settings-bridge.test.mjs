import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The 0.1.7 migration moved the font preference out of a registered settings
 * namespace (`settings.register('ui-font', schema)` → scope) into this entry's
 * own volatile Config, read through `settings.describe()` and written through
 * `settings.mutate()`.
 *
 * These tests exercise the real route handler against a settings double that
 * matches the 0.1.7 surface exactly: `describe()` + `mutate()` only, no
 * `register`, no `get(ns)`. A regression that reintroduces either removed call
 * fails here loudly instead of only in a browser.
 */

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
// Schemastery stand-in: only presence of the builder matters at this seam.
const z = { object: value => value, string: () => ({ default: () => ({ volatile: () => ({}) }) }), number: () => ({ default: () => ({ volatile: () => ({}) }) }) };

const DEFAULTS = { uiFont: 'default', uiFontValue: '', codeFont: 'default', codeFontValue: '', terminalSize: 0 };

/**
 * Settings double mirroring dsh 0.1.7-alpha.1's SettingsForms: descriptors carry
 * value and revision together, and `mutate` fences on the revision the caller
 * read. `entryId` is the namespace key — a namespace IS an entry's Config now.
 */
function harness({ entryId = 'font-settings', initial = DEFAULTS, conflictOnce = false, detachAfterRead = false } = {}) {
  let value = { ...DEFAULTS, ...initial };
  let revision = 3;
  let pendingConflict = conflictOnce;
  const mutations = [];
  const settings = {
    describe: () => (detachAfterRead ? [] : [{ ns: entryId, value: structuredClone(value), revision }]),
    async mutate(ns, ops, expected) {
      assert.equal(ns, entryId, 'the write must address this entry id');
      if (expected !== revision) throw Object.assign(new Error('stale'), { code: 'SETTINGS_CONFLICT' });
      if (pendingConflict) {
        pendingConflict = false;
        // A concurrent writer won the race: the revision moved under us.
        revision += 1;
        throw Object.assign(new Error('stale'), { code: 'SETTINGS_CONFLICT' });
      }
      const next = { ...value };
      for (const op of ops) {
        assert.equal(op.op, 'set');
        next[op.path[0]] = op.value;
      }
      mutations.push(structuredClone(ops));
      value = next;
      revision += 1;
    },
  };
  return {
    settings,
    mutations,
    value: () => structuredClone(value),
    /** Move the revision without touching the value, to open a conflict window. */
    touch: () => { revision += 1; },
  };
}

function load() {
  let handler;
  const context = {
    z, URL,
    // The module's node: builtin bindings are stripped with its import lines,
    // so the VM gets the real ones it still dereferences.
    os, path,
    createRequire: () => name => {
      if (name === '@deepseek-ai/schemastery') return { default: z };
      throw new Error('unresolvable: ' + name);
    },
    process: { argv: [], env: {} },
    // The enumeration seam: this file is about the settings model, so the
    // platform font scan is replaced (as in cache.test.mjs) instead of being
    // allowed to touch a real filesystem from inside the VM.
    __fonts: [{ family: 'Stub Mono', aliases: [], faces: [] }],
  };
  const code = source
    .replace(/^import .*;$/gm, '')
    .replace(/import\.meta\.url/g, '"file:///test/index.js"')
    .replace(/export (const|function) /g, '$1 ')
    .replace(/^export \{.*\};$/gm, '')
    + '\nvar scanAllFonts = () => Promise.resolve(globalThis.__fonts);\nglobalThis.mount = apply;';
  vm.runInNewContext(code, context);
  return (settings, extra = {}) => {
    context.mount({
      fiber: extra.entryId === undefined ? { entry: { options: { id: 'font-settings' } } } : { entry: { options: { id: extra.entryId } } },
      effect: fn => fn(),
      inject() {},
      get: () => settings,
      webServer: { register(route) { handler = route.handler; return () => {}; } },
      logger: { warn() {} },
    });
    return async (method, payload, query = '') => {
      let status;
      let body;
      const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
      const req = {
        method,
        url: '/font-settings' + query,
        on(event, fn) { if (event === 'data') for (const c of chunks) fn(c); if (event === 'end') fn(); return req; },
        destroy() {},
      };
      await handler(req, {
        writeHead(code) { status = code; },
        end(text) { body = JSON.parse(text); },
      });
      return { status, body };
    };
  };
}

test('GET reads the entry through describe() and returns the five wire fields', async () => {
  const h = harness({ initial: { codeFont: 'system', codeFontValue: 'JetBrainsMono NF', terminalSize: 14 } });
  const request = load()(h.settings);
  const { status, body } = await request('GET');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.value, { uiFont: 'default', uiFontValue: '', codeFont: 'system', codeFontValue: 'JetBrainsMono NF', terminalSize: 14 });
});

test('POST writes through mutate() with the revision describe() reported', async () => {
  const h = harness();
  const request = load()(h.settings);
  const { status, body } = await request('POST', { uiFont: 'system', uiFontValue: 'Inter' });
  assert.equal(status, 200);
  assert.equal(body.value.uiFont, 'system');
  assert.equal(body.value.uiFontValue, 'Inter');
  // One op per addressed field, all paths absolute from the section root.
  assert.deepEqual(h.mutations[0], [
    { op: 'set', path: ['uiFont'], value: 'system' },
    { op: 'set', path: ['uiFontValue'], value: 'Inter' },
  ]);
  assert.equal(h.value().uiFontValue, 'Inter');
});

test('a single conflict is recovered by re-reading the fence and retrying once', async () => {
  const h = harness({ conflictOnce: true });
  const request = load()(h.settings);
  const { status, body } = await request('POST', { codeFont: 'custom', codeFontValue: "'Fira Code'" });
  assert.equal(status, 200, 'a lost race must not surface as a failure when one retry wins');
  assert.equal(body.value.codeFont, 'custom');
  assert.equal(h.mutations.length, 1, 'the retry is the only committed write');
});

test('a persistent conflict answers 409 and writes nothing', async () => {
  const h = harness();
  const settings = {
    describe: () => h.settings.describe(),
    mutate: async () => { throw Object.assign(new Error('stale'), { code: 'SETTINGS_CONFLICT' }); },
  };
  const request = load()(settings);
  const { status, body } = await request('POST', { uiFont: 'system', uiFontValue: 'Inter' });
  assert.equal(status, 409);
  assert.deepEqual(body, { ok: false, error: 'conflict' });
});

test('an entry absent from describe() answers 503 rather than throwing', async () => {
  const h = harness({ detachAfterRead: true });
  const request = load()(h.settings);
  const { status, body } = await request('GET');
  assert.equal(status, 503);
  assert.equal(body.error, 'settings entry unavailable');
});

test('a missing settings service answers 503', async () => {
  const h = harness();
  const request = load()(undefined);
  const { status, body } = await request('GET');
  assert.equal(status, 503);
  assert.equal(body.error, 'settings service unavailable');
});

test('the entry id from the live fiber is the namespace, not a hardcoded literal', async () => {
  const h = harness({ entryId: 'my-fonts' });
  const request = load()(h.settings, { entryId: 'my-fonts' });
  const { status } = await request('POST', { uiFont: 'system', uiFontValue: 'Inter' });
  assert.equal(status, 200);
  assert.equal(h.value().uiFontValue, 'Inter');
});

test('invalid field values are refused before any write', async () => {
  const h = harness();
  const request = load()(h.settings);
  for (const payload of [{ uiFont: 'system', uiFontValue: 'bad;{injection}' }, { uiFont: 'nonsense' }, { terminalSize: 999 }]) {
    const { status } = await request('POST', payload);
    assert.equal(status, 400, JSON.stringify(payload));
  }
  assert.deepEqual(h.mutations, []);
});

test('the font list route is unaffected by the settings model', async () => {
  const h = harness();
  const request = load()(h.settings);
  const { status, body } = await request('GET', undefined, '/fonts');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.fonts), 'expected a fonts array');
});
