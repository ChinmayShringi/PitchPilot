import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('UI state is never mutated in place', () => {
  assert.ok(!/state\.(limit|sections)\s*=[^=]/.test(app), 'no direct assignment to state fields');
  assert.ok(!/\.(push|splice|sort|reverse|unshift|pop|shift)\(/.test(app), 'no mutating array methods');
  assert.match(app, /Object\.freeze/);
});

test('every localStorage write is guarded and failures are reported', () => {
  const writes = app.match(/localStorage\.(setItem|removeItem)/g) || [];
  const guarded = app.match(/persist\(\(\) => localStorage\.(setItem|removeItem)/g) || [];
  assert.ok(writes.length > 0 && writes.length === guarded.length);
  assert.match(app, /Could not save to browser storage/);
});

test('draft is cleared after remove, move, example, reset and import', () => {
  for (const fn of ['function move', 'function remove', "'example'", "'reset-yes'", 'function applyImport']) {
    const i = app.indexOf(fn); assert.ok(i >= 0, fn);
    const body = app.slice(i, i + 500);
    assert.ok(/clearDraft: true|resetDraft\(\)/.test(body), fn + ' must clear the draft');
  }
});
