import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let factory, registration, injected;
  let fonts = ['Deleted Font', 'Remaining Font'];
  let fail = false;
  const calls = [], snapshots = [], cleanups = [], timers = new Map(), listeners = new Map();
  const window = { __ModuleLoader__: { load(x) { factory = x.factory; } },
    addEventListener(k, fn) { listeners.set(k, fn); }, removeEventListener(k) { listeners.delete(k); } };
  const context = { window, console, Date, setInterval(fn, ms) { timers.set(fn, ms); return fn; }, clearInterval(fn) { timers.delete(fn); },
    fetch: async (url, options) => {
      calls.push({url, options});
      if (url.startsWith('/font-settings/fonts')) {
        if (fail) throw new Error('scan unavailable');
        return {ok: true, json: async () => ({ok: true, fonts})};
      }
      return {ok: true, json: async () => ({ok: true, value: {}})};
    }
  };
  vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.test = {probeCache, familyMatches}; exports.apply = apply;'), context);
  const plugin = factory(name => name === '@deepseek-ai/dsh-client-store' ? {defineStore: x => x} : {});
  const ctx = { theme: {overrideTokens: () => () => {}}, locale: {register: () => () => {}},
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    slots: { inject(name, fn) { fn(); }, register(options) { registration = options; } }
  };
  plugin.apply(ctx);
  injected = registration.inject({sync() {}, setFonts(value) { snapshots.push(value.map(f => f.name)); }});
  return {plugin, calls, snapshots, timers, listeners, injected,
    changeFonts() { fonts = ['Remaining Font']; }, failScan(value) { fail = value; },
    dispose() { for (const fn of cleanups.reverse()) fn(); }
  };
}
test('manual refresh replaces deleted fonts and invalidates availability probes', async () => {
  const h = harness(); await flush();
  assert.deepEqual([...h.snapshots.at(-1)], ['Deleted Font', 'Remaining Font']);
  h.plugin.test.probeCache.set('Deleted Font', {matched: true, at: Date.now()});
  h.plugin.test.probeCache.set('Remaining Font', {matched: false, at: Date.now()});
  h.changeFonts();
  assert.equal(typeof h.injected.refreshFonts, 'function');
  assert.equal(await h.injected.refreshFonts(), true);
  assert.deepEqual([...h.snapshots.at(-1)], ['Remaining Font']);
  assert.equal(h.plugin.test.probeCache.has('Deleted Font'), false);
  assert.equal(h.plugin.test.probeCache.has('Remaining Font'), false);
  const last = h.calls.at(-1);
  assert.equal(last.url, '/font-settings/fonts?refresh=1');
  assert.equal(last.options.cache, 'no-store');
  h.dispose();
});
test('automatic refresh observes deletion and removes timer/listener on disposal', async () => {
  const h = harness(); await flush();
  assert.equal(h.timers.size, 1);
  const [tick, interval] = [...h.timers.entries()][0];
  assert.equal(interval, 600000);
  h.changeFonts(); tick(); await flush();
  assert.deepEqual([...h.snapshots.at(-1)], ['Remaining Font']);
  assert.equal(h.listeners.has('focus'), true);
  h.dispose(); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
});
test('failed refresh reports failure without discarding usable last list, then retries', async () => {
  const h = harness(); await flush(); h.failScan(true);
  assert.equal(typeof h.injected.refreshFonts, 'function');
  assert.equal(await h.injected.refreshFonts(), false);
  assert.deepEqual([...h.snapshots.at(-1)], ['Deleted Font', 'Remaining Font']);
  h.failScan(false); h.changeFonts();
  assert.equal(await h.injected.refreshFonts(), true);
  assert.deepEqual([...h.snapshots.at(-1)], ['Remaining Font']); h.dispose();
});
