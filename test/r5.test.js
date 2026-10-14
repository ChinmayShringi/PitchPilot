import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toMarkdown, parseMarkdown, validateStoredPlan, validatePlanData, validateSection, MAX_FILE_BYTES, EXAMPLE } from '../src/logic.js';

test('paste without the final newline imports; nothing else is normalized', () => {
  const md = toMarkdown(EXAMPLE.limit, EXAMPLE.sections);
  const r = parseMarkdown(md.slice(0, -1));
  assert.equal(r.error, undefined);
  assert.equal(toMarkdown(r.limit, r.sections), md, 'canonical bytes unchanged');
  assert.match(parseMarkdown(md + '\n').error, /edited/);
  assert.match(parseMarkdown(md.slice(0, -1) + ' ').error, /data block|edited/);
  assert.match(parseMarkdown(md.slice(0, -5)).error, /data block/);
});

test('saved data is validated with the same schema and caps as import', () => {
  assert.deepEqual(validateStoredPlan(JSON.stringify({ limit: 60, sections: [{ title: 'a', seconds: 5 }] })), { limit: 60, sections: [{ title: 'a', seconds: 5 }] });
  assert.match(validateStoredPlan('{bad').error, /not valid JSON/);
  assert.match(validateStoredPlan('null').error, /unknown fields/);
  assert.match(validateStoredPlan('[]').error, /unknown fields/);
  assert.match(validateStoredPlan(JSON.stringify({ limit: 60, sections: [], extra: 1 })).error, /unknown fields/);
  assert.match(validateStoredPlan(JSON.stringify({ limit: 0, sections: [] })).error, /limit/);
  assert.match(validateStoredPlan(JSON.stringify({ limit: 60, sections: Array.from({ length: 101 }, () => ({ title: 'a', seconds: 1 })) })).error, /at most 100/);
  assert.match(validateStoredPlan(JSON.stringify({ limit: 60, sections: [{ title: 'x'.repeat(501), seconds: 1 }] })).error, /Section 1/);
  assert.match(validateStoredPlan(JSON.stringify({ limit: 60, sections: [{ title: 'a', seconds: 1.5 }] })).error, /Section 1/);
  assert.match(validatePlanData(null).error, /not an object/);
});

test('control character rule names the exact rejected ranges', () => {
  for (const c of ['\u0000', '\u0009', '\u001f', '\u007f']) assert.match(validateSection('a' + c + 'b', '1').errors.title, /U\+0000 to U\+001F or U\+007F/);
  assert.ok(validateSection('a\u0080b', '1').section, 'U+0080 is allowed (documented)');
});

test('title cap counts UTF-16 code units', () => {
  const astral = '\ud83d\ude80'; // one character, two UTF-16 code units
  assert.ok(validateSection(astral.repeat(250), '1').section);
  assert.match(validateSection(astral.repeat(250) + 'x', '1').errors.title, /exceed/);
});

test('file import is size-bounded before reading and read errors are shown', async () => {
  assert.equal(MAX_FILE_BYTES, 1000000);
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const i = app.indexOf("'import-file'");
  const body = app.slice(i, i + 700);
  assert.ok(body.indexOf('MAX_FILE_BYTES') < body.indexOf('f.text()'), 'size check before reading');
  assert.match(body, /try \{ text = await f\.text\(\); \} catch \{[^}]*could not be read/);
});
