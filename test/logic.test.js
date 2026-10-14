import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLimit, validateSection, computePlan, moveSection, toMarkdown, parseMarkdown,
  formatTime, statusLine, escapeMarkdown, canAddSection, MAX_SECTIONS, EXAMPLE } from '../src/logic.js';

const S = (title, seconds) => ({ title, seconds });

test('exact limit gives 0 remaining and 0 over', () => {
  const p = computePlan(60, [S('a', 30), S('b', 30)]);
  assert.equal(p.total, 60); assert.equal(p.remaining, 0); assert.equal(p.over, 0);
  assert.equal(p.status, 'exact'); assert.match(statusLine(p), /Exactly at limit/);
});

test('one second over is reported as over by 1', () => {
  const p = computePlan(60, [S('a', 30), S('b', 31)]);
  assert.equal(p.over, 1); assert.equal(p.remaining, 0); assert.equal(p.status, 'over');
  assert.equal(statusLine(p), 'OVER by 1 s');
});

test('under limit reports remaining', () => {
  const p = computePlan(60, [S('a', 10)]);
  assert.equal(statusLine(p), '50 s remaining');
});

test('decimal durations and limits are rejected, not rounded', () => {
  assert.match(validateSection('a', '1.5').errors.seconds, /decimals/);
  assert.match(validateSection('a', '2.').errors.seconds, /decimals/);
  assert.match(validateSection('a', '.5').errors.seconds, /decimals/);
  assert.match(validateSection('a', 1.5).errors.seconds, /decimals/);
  assert.match(validateLimit('120.0').error, /decimals/);
});

test('zero, negative, nonfinite, non-numeric and too large inputs are rejected', () => {
  assert.match(validateSection('a', '0').errors.seconds, /at least 1/);
  assert.match(validateSection('a', '-5').errors.seconds, /negative/);
  assert.match(validateSection('a', -5).errors.seconds, /negative/);
  assert.match(validateSection('a', 0).errors.seconds, /at least 1/);
  assert.match(validateSection('a', Infinity).errors.seconds, /finite/);
  assert.match(validateSection('a', NaN).errors.seconds, /finite/);
  assert.match(validateSection('a', 'abc').errors.seconds, /number/);
  assert.match(validateSection('a', '1e3').errors.seconds, /number/);
  assert.match(validateSection('a', '0x10').errors.seconds, /number/);
  assert.match(validateSection('a', '').errors.seconds, /required/);
  assert.match(validateSection('a', null).errors.seconds, /required/);
  assert.match(validateSection('a', '3601').errors.seconds, /exceed/);
  assert.match(validateLimit('').error, /required/);
  assert.match(validateLimit('0').error, /at least 1/);
  assert.equal(validateLimit(' 90 ').value, 90);
  assert.equal(validateLimit(3600).value, 3600);
});

test('titles: empty, whitespace, multiline and too long are rejected; trimmed otherwise', () => {
  assert.match(validateSection('', '5').errors.title, /required/);
  assert.match(validateSection('   ', '5').errors.title, /required/);
  assert.match(validateSection(undefined, '5').errors.title, /required/);
  assert.match(validateSection('a\nb', '5').errors.title, /single line/);
  assert.match(validateSection('x'.repeat(501), '5').errors.title, /exceed/);
  assert.equal(validateSection('x'.repeat(500), '5').section.title.length, 500);
  assert.match(validateSection('a\u2028b', '5').errors.title, /single line/);
  assert.match(validateSection('a\tb', '5').errors.title, /control/);
  assert.deepEqual(validateSection('  Hi ', '5').section, { title: 'Hi', seconds: 5 });
  const both = validateSection('', 'x').errors;
  assert.ok(both.title && both.seconds);
});

test('reordering recomputes start and end offsets', () => {
  const secs = [S('A', 10), S('B', 20), S('C', 30)];
  const moved = moveSection(secs, 2, 0);
  assert.deepEqual(moved.map(s => s.title), ['C', 'A', 'B']);
  const rows = computePlan(100, moved).rows;
  assert.deepEqual(rows.map(r => [r.start, r.end]), [[0, 30], [30, 40], [40, 60]]);
  assert.deepEqual(secs.map(s => s.title), ['A', 'B', 'C'], 'original not mutated');
  assert.deepEqual(moveSection(secs, 0, 5).map(s => s.title), ['A', 'B', 'C']);
  assert.deepEqual(moveSection(secs, -1, 0).map(s => s.title), ['A', 'B', 'C']);
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00'); assert.equal(formatTime(65), '1:05'); assert.equal(formatTime(3600), '60:00');
});

test('script-like and markdown-special text is escaped in the table and literal after import', () => {
  const evil = '<script>alert(1)</script> | pipe \\ back <img src=x onerror=alert(2)> *b* [l](u) `c` # h';
  const v = validateSection(evil, '7');
  assert.equal(v.section.title, evil);
  const md = toMarkdown(30, [v.section]);
  const row = md.split('\n').find(l => l.startsWith('| 1 |'));
  assert.ok(!/(^|[^\\])[<>]/.test(row), 'unescaped angle brackets must not appear in the table');
  assert.ok(row.includes('\\<script\\>alert\\(1\\)\\</script\\> \\| pipe \\\\ back'));
  assert.equal(escapeMarkdown('a_b*c'), 'a\\_b\\*c');
  assert.equal(parseMarkdown(md).sections[0].title, evil);
});

const ADVERSARIAL = [
  '**bold** _it_ [link](http://example.invalid) # heading | col',
  '<b onclick="x()">html</b><!-- c --> &amp;',
  'Caf\u00e9 \u00fcber na\u00efve \u65e5\u672c\u8a9e \ud83d\ude80 emoji-free? no: astral char',
  '\u0645\u0631\u062d\u0628\u0627 \u05e9\u05dc\u05d5\u05dd RTL \u202e reversed',
  '```json {"format":"x"} ```',
  'y'.repeat(500),
];

test('adversarial titles round trip byte-identically (export, import, export)', () => {
  const secs = ADVERSARIAL.map((t, i) => ({ title: t, seconds: i + 1 }));
  for (const s of secs) assert.ok(validateSection(s.title, s.seconds).section, s.title);
  const md1 = toMarkdown(100, secs);
  const r = parseMarkdown(md1);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.sections, secs);
  const md2 = toMarkdown(r.limit, r.sections);
  assert.equal(Buffer.compare(Buffer.from(md1), Buffer.from(md2)), 0);
});

test('export matches order and times exactly (deterministic)', () => {
  const secs = [S('Intro', 15), S('Demo', 90), S('Close', 20)];
  const md = toMarkdown(120, secs);
  assert.equal(md, [
    '# DemoBudget cue sheet', '', 'Limit: 120 s', 'Total: 125 s', 'Status: OVER by 5 s', '',
    '| # | Start | End | Seconds | Title |', '|---|---|---|---|---|',
    '| 1 | 0:00 | 0:15 | 15 | Intro |', '| 2 | 0:15 | 1:45 | 90 | Demo |', '| 3 | 1:45 | 2:05 | 20 | Close |', '',
    'Data for reopening in DemoBudget (do not edit):', '', '```json',
    '{"format":"demobudget-cue-sheet","version":1,"limit":120,"sections":[{"title":"Intro","seconds":15},{"title":"Demo","seconds":90},{"title":"Close","seconds":20}]}',
    '```', '',
  ].join('\n'));
  assert.equal(toMarkdown(120, secs), md);
});

test('import round trip including example, empty plan and CRLF', () => {
  for (const [lim, secs] of [[EXAMPLE.limit, EXAMPLE.sections], [60, []]]) {
    const md = toMarkdown(lim, secs);
    const r = parseMarkdown(md);
    assert.equal(r.limit, lim); assert.deepEqual(r.sections, secs.map(s => ({ ...s })));
    assert.equal(toMarkdown(r.limit, r.sections), md);
  }
  assert.deepEqual(parseMarkdown(toMarkdown(60, [S('a', 5)]).replace(/\n/g, '\r\n')).sections, [S('a', 5)]);
});

test('import rejects malformed or edited cue sheets', () => {
  const good = toMarkdown(60, [S('a', 5)]);
  const swapJson = (o) => good.replace(/```json\n.*\n```/, '```json\n' + JSON.stringify(o) + '\n```');
  const base = { format: 'demobudget-cue-sheet', version: 1, limit: 60, sections: [{ title: 'a', seconds: 5 }] };
  assert.match(parseMarkdown(42).error, /text/);
  assert.match(parseMarkdown('hello').error, /heading/);
  assert.match(parseMarkdown('# DemoBudget cue sheet\n').error, /data block/);
  assert.match(good.replace(/```json\n.*\n```/, '```json\n{bad\n```').length && parseMarkdown(good.replace(/```json\n.*\n```/, '```json\n{bad\n```')).error, /not valid JSON/);
  assert.match(parseMarkdown(swapJson({ ...base, format: 'x' })).error, /Unsupported/);
  assert.match(parseMarkdown(swapJson({ ...base, version: 2 })).error, /Unsupported/);
  assert.match(parseMarkdown(swapJson(null)).error, /Unsupported/);
  assert.match(parseMarkdown(swapJson({ ...base, limit: 1.5 })).error, /Invalid limit/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: 'x' })).error, /missing/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: [{ title: 'a', seconds: -5 }] })).error, /Section 1/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: [null] })).error, /Section 1/);
  assert.match(parseMarkdown(swapJson({ ...base, extra: 1 })).error, /unknown fields/);
  assert.match(parseMarkdown(swapJson({ format: base.format, version: 1, limit: 60 })).error, /unknown fields/);
  assert.match(parseMarkdown(swapJson([1])).error, /Unsupported/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: [{ title: 'a', seconds: 5, note: 'x' }] })).error, /unknown fields/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: [[]] })).error, /unknown fields/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: Array.from({ length: 101 }, () => ({ title: 'a', seconds: 1 })) })).error, /at most 100/);
  assert.match(parseMarkdown(swapJson({ ...base, sections: [{ title: ' a', seconds: 5 }] })).error, /spaces/);
  assert.match(parseMarkdown(good.replace('| 5 | a |', '| 9 | a |')).error, /edited/);
  assert.match(parseMarkdown(good.replace('Limit: 60 s', 'Limit: 90 s')).error, /edited/);
});

test('extreme numeric inputs are rejected', () => {
  for (const x of ['1e999', '99999999999999999999', 'Infinity', '-Infinity', 'NaN', ' ', '+5', '5 s', '\u0665']) {
    assert.ok(validateSection('a', x).errors?.seconds, x);
  }
  for (const x of [Number.MAX_VALUE, -0.5, Number.MAX_SAFE_INTEGER + 2, true, {}, []]) {
    assert.ok(validateSection('a', x).errors?.seconds, String(x));
  }
});

test('randomized arithmetic invariants (seeded, 500 plans)', () => {
  let seed = 20261013;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 500; k++) {
    const n = rnd(12);
    const secs = Array.from({ length: n }, (_, i) => S('s' + i, 1 + rnd(400)));
    const limit = 1 + rnd(3600);
    const p = computePlan(limit, secs);
    const sum = secs.reduce((a, b) => a + b.seconds, 0);
    assert.equal(p.total, sum);
    assert.equal(p.remaining - p.over, limit - sum);
    assert.ok(p.remaining >= 0 && p.over >= 0 && (p.remaining === 0 || p.over === 0));
    p.rows.forEach((r, i) => {
      assert.equal(r.end - r.start, r.seconds);
      assert.equal(r.start, i === 0 ? 0 : p.rows[i - 1].end);
    });
    if (n > 1) {
      const moved = moveSection(secs, rnd(n), rnd(n));
      assert.equal(computePlan(limit, moved).total, sum);
      assert.deepEqual([...moved].sort((a, b) => a.title.localeCompare(b.title)), [...secs].sort((a, b) => a.title.localeCompare(b.title)));
    }
    const md = toMarkdown(limit, secs);
    assert.equal(toMarkdown(parseMarkdown(md).limit, parseMarkdown(md).sections), md);
  }
});

test('example is fictional and starts over budget', () => {
  const p = computePlan(EXAMPLE.limit, EXAMPLE.sections);
  assert.equal(p.status, 'over'); assert.equal(p.over, 10);
  assert.match(EXAMPLE.sections[0].title, /fictional/);
});

test('section count cap', () => {
  assert.equal(MAX_SECTIONS, 100);
  assert.equal(canAddSection(Array(99).fill(S('a', 1))).error, undefined);
  assert.match(canAddSection(Array(100).fill(S('a', 1))).error, /at most 100/);
  const full = Array.from({ length: 100 }, (_, i) => S('s' + i, 1));
  assert.deepEqual(parseMarkdown(toMarkdown(3600, full)).sections, full);
});

test('the browser UI imports this same logic module (no duplicated logic)', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/logic\.js';/);
  assert.ok(!/function (computePlan|toMarkdown|parseMarkdown|validateSection|validateLimit)\b/.test(app), 'app.js must not redefine logic');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(app), 'no HTML sinks in UI code');
  assert.match(html, /<script type="module" src="src\/app\.js"><\/script>/);
});
