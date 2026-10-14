import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateStoredPlan, parseMarkdown, toMarkdown, validateSection } from '../src/logic.js';

test('N1: saved data with numbers stored as text is rejected, same as import', () => {
  assert.match(validateStoredPlan('{"limit":"60","sections":[{"title":"a","seconds":5}]}').error, /JSON number/);
  assert.match(validateStoredPlan('{"limit":60,"sections":[{"title":"a","seconds":"5"}]}').error, /JSON number/);
  assert.match(validateStoredPlan('{"limit":60,"sections":[{"title":5,"seconds":5}]}').error, /text/);
  const good = toMarkdown(60, [{ title: 'a', seconds: 5 }]);
  const textLimit = good.replace('"limit":60', '"limit":"60"');
  assert.match(parseMarkdown(textLimit).error, /JSON number/);
  assert.deepEqual(validateStoredPlan('{"limit":60,"sections":[{"title":"a","seconds":5}]}'), { limit: 60, sections: [{ title: 'a', seconds: 5 }] });
});

test('N3: title cap message says UTF-16 code units', () => {
  assert.match(validateSection('x'.repeat(501), '5').errors.title, /500 UTF-16 code units/);
});

test('N2: README does not point to a provenance file missing from the repo', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(!/see provenance/i.test(readme));
});
