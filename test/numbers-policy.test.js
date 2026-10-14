import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLimit, validateSection } from '../src/logic.js';

// Whitespace and leading-zero policy (README: trimmed whitespace accepted; leading zeros rejected).
test('surrounding whitespace is trimmed for limits and durations', () => {
  assert.equal(validateLimit(' 90 ').value, 90);
  assert.equal(validateLimit('\t60\n').value, 60);
  assert.equal(validateSection('a', ' 10 ').section.seconds, 10);
  assert.equal(validateSection('a', '10 ').section.seconds, 10);
  assert.match(validateSection('a', '   ').errors.seconds, /required/);
});

test('leading zeros are rejected, not normalized', () => {
  assert.match(validateSection('a', '010').errors.seconds, /leading zeros/);
  assert.match(validateSection('a', ' 010 ').errors.seconds, /leading zeros/);
  assert.match(validateLimit('00').error, /leading zeros/);
  assert.match(validateLimit('060').error, /leading zeros/);
  assert.equal(validateLimit('90').value, 90);
  assert.equal(validateSection('a', '10').section.seconds, 10);
});

test('other forms stay rejected after trimming', () => {
  for (const x of [' +5 ', ' 1e2 ', ' 2.5 ', ' -3 ', ' 5 s ']) assert.ok(validateSection('a', x).errors?.seconds, x);
});
