import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
function load(nodes = {}) {
  let factory; const warnings = [];
  const context = { window: { __ModuleLoader__: { load(x) { factory = x.factory; } } }, document: { querySelector: () => ({}), querySelectorAll: s => nodes[s] ?? [] }, getComputedStyle: n => ({fontSize:n.px}), console: {warn: m => warnings.push(m)} };
  vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.test = {terminalBasePx, sizeAdjustDescriptor, buildMonoToken}; exports.apply = apply;'), context);
  return { ...factory(() => ({})).test, warnings };
}
test('ancestor page font is never used as terminal font', () => {
  const h = load({'.xterm':[{px:'14px'}], '.xterm-screen':[{px:'14px'}]});
  assert.equal(h.terminalBasePx(),13); assert.equal(h.terminalBasePx(),13); assert.equal(h.warnings.length,1);
});
test('rows precede measurement; measurement precedes fallback', () => {
  assert.equal(load({'.xterm-rows':[{px:'17px'}],'.xterm-char-measure-element':[{px:'15px'}]}).terminalBasePx(),17);
  assert.equal(load({'.xterm-screen':[{px:'14px'}],'.xterm-char-measure-element':[{px:'15px'}]}).terminalBasePx(),15);
});
test('invalid readings skipped and later mount can be read', () => {
  const nodes = {'.xterm-rows':[{px:'NaN'},{px:'0px'},{px:'-2px'}]}; const h=load(nodes);
  assert.equal(h.terminalBasePx(),13); nodes['.xterm-rows'].push({px:'16px'}); assert.equal(h.terminalBasePx(),16);
  assert.equal(h.sizeAdjustDescriptor(16),';size-adjust:100%'); assert.equal(h.sizeAdjustDescriptor(0),'');
});
test('mono token avoids terminal aliases and preserves quoted commas', () => {
  const h=load(); assert.equal(h.buildMonoToken(null),null);
  assert.equal(h.buildMonoToken('"My, Mono", Consolas, ui-monospace'),'"My, Mono", monospace');
  assert.equal(h.buildMonoToken('Menlo, SFMono-Regular'),'monospace');
});
