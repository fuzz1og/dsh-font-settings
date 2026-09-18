import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
// Settings registration is not involved in these routes; only schema construction runs.
const z = { object: value => value, string: () => ({ default() {} }), number: () => ({ default() {} }) };

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
const TTL = 10 * 60 * 1000;
const fonts = name => [{ family: name, aliases: [], faces: [] }];
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real registered HTTP handler; isolate OS scanning and wall time.
// Like client.test.mjs, each VM gives the module an independent cache.
function harness() {
  let now = 1000;
  const scans = [];
  let handler;
  const context = {
    z, URL,
    Date: { now: () => now },
    __scan: () => new Promise((resolve, reject) => scans.push({ resolve, reject })),
  };
  vm.runInNewContext(source
    .replace(/^import .*;$/gm, '')
    .replace(/export (const|function) /g, '$1 ')
    .replace(/^export \{.*\};$/gm, '')
    // Tests drive the real module's enumeration seam, not the platform scan.
    + '\nvar scanAllFonts = (...args) => __scan(...args);\nglobalThis.mount = apply;', context);
  context.mount({
    effect: fn => fn(),
    inject() {},
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    logger: { warn() {} },
  });
  return {
    scans,
    advance(ms) { now += ms; },
    async get(query = '') {
      let status;
      let body;
      await handler({ method: 'GET', url: '/font-settings/fonts' + query }, {
        writeHead(code) { status = code; },
        end(text) { body = JSON.parse(text); },
      });
      return { status, body };
    },
  };
}

test('prewarm and simultaneous cold requests share one scan', async () => {
  const h = harness();
  const first = h.get();
  const second = h.get('?refresh=1');
  assert.equal(h.scans.length, 1);
  h.scans[0].resolve(fonts('Shared'));
  const results = await Promise.all([first, second]);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal(result.body.fonts[0].name, 'Shared');
  }
});

test('refresh=1 bypasses fresh data and concurrent forced refreshes share a scan', async () => {
  const h = harness();
  h.scans[0].resolve(fonts('Old'));
  await tick();
  h.advance(TTL - 1);
  assert.equal((await h.get()).body.fonts[0].name, 'Old');
  assert.equal(h.scans.length, 1);
  const first = h.get('?refresh=1');
  const second = h.get('?refresh=1');
  await tick();
  assert.equal(h.scans.length, 2);
  h.scans[1].resolve(fonts('Forced'));
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.status, 200);
    assert.equal(result.body.fonts[0].name, 'Forced');
  }
});

test('a failed refresh does not certify stale data fresh', async () => {
  const h = harness();
  h.scans[0].resolve(fonts('Old'));
  await tick();
  h.advance(TTL);
  const request = h.get();
  await tick();
  h.scans[1].reject(new Error('scan failed'));
  // The route turns the scan error into 500 {ok:false}; stale data is NOT served.
  const failed = await request;
  assert.equal(failed.status, 500);
  assert.equal(failed.body.ok, false);
  // fontCacheAt must stay untouched: the next request retries, not another TTL of stale data.
  const retry = h.get();
  await tick();
  assert.equal(h.scans.length, 3);
  h.scans[2].resolve(fonts('Recovered'));
  assert.equal((await retry).body.fonts[0].name, 'Recovered');
});

test('a failed forced refresh leaves the still-valid entry fresh', async () => {
  const h = harness();
  h.scans[0].resolve(fonts('Old'));
  await tick();
  h.advance(TTL - 1);
  const request = h.get('?refresh=1');
  await tick();
  assert.equal(h.scans.length, 2);
  h.scans[1].reject(new Error('forced scan failed'));
  assert.equal((await request).status, 500);
  assert.equal((await h.get()).body.fonts[0].name, 'Old');
  assert.equal(h.scans.length, 2);
  // Failure must not extend the original expiration deadline.
  h.advance(1);
  const retry = h.get();
  await tick();
  assert.equal(h.scans.length, 3);
  h.scans[2].resolve(fonts('Recovered'));
  assert.equal((await retry).body.fonts[0].name, 'Recovered');
});

test('expired font cache awaits the refreshed list instead of returning stale data', async () => {
  const h = harness();
  h.scans[0].resolve(fonts('Old'));
  await tick();
  assert.equal((await h.get()).body.fonts[0].name, 'Old');
  h.advance(TTL);
  let settled = false;
  const request = h.get().then(result => { settled = true; return result; });
  await tick();
  assert.equal(h.scans.length, 2);
  assert.equal(settled, false);
  h.scans[1].resolve(fonts('New'));
  assert.equal((await request).body.fonts[0].name, 'New');
});
