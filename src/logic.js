// DemoBudget pure logic module. No DOM, no network. Usable from Node and the browser.
// Policy: durations are whole seconds from 1 to 3600. Zero and decimals are rejected
// Strings are trimmed of surrounding whitespace, then must be plain digits with no sign,
// exponent, decimal point or leading zero.
// (a zero-length cue has no on-screen time; fractional seconds are not meaningful
// for a hand-run demo). Limits are whole seconds from 1 to 3600. Nothing is coerced.

export const MAX_SECONDS = 3600;
export const MAX_TITLE = 500;
export const MAX_SECTIONS = 100;
export const MAX_FILE_BYTES = 1000000;
const TOP_KEYS = 'format,limit,sections,version';
const SECTION_KEYS = 'seconds,title';
const keysOf = o => Object.keys(o).sort().join(',');

export function canAddSection(sections) {
  return sections.length < MAX_SECTIONS ? {} : { error: `A plan can have at most ${MAX_SECTIONS} sections.` };
}

function parseWholeSeconds(raw, label) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { error: `${label} must be a finite number.` };
    if (!Number.isInteger(raw)) return { error: `${label} must be whole seconds; decimals are not allowed.` };
    return checkRange(raw, label);
  }
  if (typeof raw !== 'string') return { error: `${label} is required.` };
  const s = raw.trim(); // surrounding whitespace is trimmed (documented); nothing else is normalized
  if (s === '') return { error: `${label} is required.` };
  if (/^-/.test(s)) return { error: `${label} cannot be negative.` };
  if (/^\d+\.\d*$|^\.\d+$/.test(s)) return { error: `${label} must be whole seconds; decimals are not allowed.` };
  if (!/^\d+$/.test(s)) return { error: `${label} must be a number of seconds.` };
  if (/^0\d/.test(s)) return { error: `${label} cannot have leading zeros.` };
  return checkRange(Number(s), label);
}

function checkRange(n, label) {
  if (n < 0) return { error: `${label} cannot be negative.` };
  if (n === 0) return { error: `${label} must be at least 1 second.` };
  if (n > MAX_SECONDS) return { error: `${label} cannot exceed ${MAX_SECONDS} seconds.` };
  return { value: n };
}

export function validateLimit(raw) {
  return parseWholeSeconds(raw, 'Video limit');
}

export function validateSection(title, seconds) {
  const errors = {};
  let t = typeof title === 'string' ? title.trim() : '';
  if (t === '') errors.title = 'Title is required.';
  else if (/[\r\n\u2028\u2029]/.test(t)) errors.title = 'Title must be a single line.';
  else if (/[\u0000-\u001f\u007f]/.test(t)) errors.title = 'Title cannot contain control characters (U+0000 to U+001F or U+007F).';
  else if (t.length > MAX_TITLE) errors.title = `Title cannot exceed ${MAX_TITLE} UTF-16 code units.`;
  const d = parseWholeSeconds(seconds, 'Duration');
  if (d.error) errors.seconds = d.error;
  if (Object.keys(errors).length) return { errors };
  return { section: { title: t, seconds: d.value } };
}

export function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function computePlan(limit, sections) {
  let cursor = 0;
  const rows = sections.map((sec, i) => {
    const start = cursor;
    cursor += sec.seconds;
    return { index: i + 1, title: sec.title, seconds: sec.seconds, start, end: cursor };
  });
  const total = cursor;
  return {
    limit, rows, total,
    remaining: Math.max(0, limit - total),
    over: Math.max(0, total - limit),
    status: total > limit ? 'over' : total === limit ? 'exact' : 'under',
  };
}

export function moveSection(sections, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 ||
      from >= sections.length || to >= sections.length) return sections.slice();
  const copy = sections.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// Escape Markdown and HTML-significant characters so a renderer shows titles literally.
const MD_SPECIAL = /[\\`*_{}\[\]()<>#+!|~&-]/g;
export function escapeMarkdown(t) {
  return t.replace(MD_SPECIAL, ch => '\\' + ch);
}
export const FORMAT = 'demobudget-cue-sheet';

export function statusLine(plan) {
  if (plan.status === 'over') return `OVER by ${plan.over} s`;
  if (plan.status === 'exact') return 'Exactly at limit (0 s remaining)';
  return `${plan.remaining} s remaining`;
}

export function toMarkdown(limit, sections) {
  const plan = computePlan(limit, sections);
  const data = { format: FORMAT, version: 1, limit, sections: sections.map(x => ({ title: x.title, seconds: x.seconds })) };
  return [
    '# DemoBudget cue sheet',
    '',
    `Limit: ${limit} s`,
    `Total: ${plan.total} s`,
    `Status: ${statusLine(plan)}`,
    '',
    '| # | Start | End | Seconds | Title |',
    '|---|---|---|---|---|',
    ...plan.rows.map(r => `| ${r.index} | ${formatTime(r.start)} | ${formatTime(r.end)} | ${r.seconds} | ${escapeMarkdown(r.title)} |`),
    '',
    'Data for reopening in DemoBudget (do not edit):',
    '',
    '```json',
    JSON.stringify(data),
    '```',
    '',
  ].join('\n');
}

// Import reads the fenced JSON block, validates every value strictly, and then
// requires that re-exporting reproduces the input byte for byte (CRLF tolerated).
// Any hand edit to the table or summary is therefore detected and rejected.
// Shared strict validation of a plan object (used by import and by loading saved data).
export function validatePlanData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Plan data is not an object.' };
  // Stored and imported data must hold JSON numbers; numeric text such as "60" is rejected.
  if (typeof data.limit !== 'number') return { error: 'Invalid limit in cue sheet: Video limit must be a JSON number.' };
  const lim = validateLimit(data.limit);
  if (lim.error) return { error: `Invalid limit in cue sheet: ${lim.error}` };
  if (!Array.isArray(data.sections)) return { error: 'Cue sheet sections are missing.' };
  if (data.sections.length > MAX_SECTIONS) return { error: `A plan can have at most ${MAX_SECTIONS} sections.` };
  const sections = [];
  for (let i = 0; i < data.sections.length; i++) {
    const x = data.sections[i];
    if (!x || typeof x !== 'object' || Array.isArray(x) || keysOf(x) !== SECTION_KEYS) return { error: `Section ${i + 1}: missing or unknown fields.` };
    if (typeof x.title !== 'string' || typeof x.seconds !== 'number') return { error: `Section ${i + 1}: title must be text and seconds a JSON number.` };
    const v = validateSection(x.title, x.seconds);
    if (v.errors) return { error: `Section ${i + 1}: ${Object.values(v.errors).join(' ')}` };
    if (v.section.title !== x.title) return { error: `Section ${i + 1}: title has surrounding spaces.` };
    sections.push(v.section);
  }
  return { limit: lim.value, sections };
}

// Saved browser data must be exactly { limit, sections } and pass the same checks as import.
export function validateStoredPlan(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return { error: 'Saved data is not valid JSON.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || keysOf(data) !== 'limit,sections') return { error: 'Saved data has missing or unknown fields.' };
  return validatePlanData(data);
}

export function parseMarkdown(md) {
  if (typeof md !== 'string') return { error: 'Cue sheet must be text.' };
  let text = md.replace(/\r\n/g, '\n');
  if (!text.endsWith('\n')) text += '\n'; // only a missing final newline is tolerated
  if (!text.startsWith('# DemoBudget cue sheet\n')) return { error: 'Not a DemoBudget cue sheet (missing heading).' };
  const m = /\n```json\n(.*)\n```\n/.exec(text);
  if (!m) return { error: 'Cue sheet is missing its data block.' };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { error: 'Cue sheet data block is not valid JSON.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== FORMAT || data.version !== 1) return { error: 'Unsupported cue sheet format or version.' };
  if (keysOf(data) !== TOP_KEYS) return { error: 'Cue sheet data has missing or unknown fields.' };
  const plan = validatePlanData({ limit: data.limit, sections: data.sections });
  if (plan.error) return plan;
  const lim = { value: plan.limit }; const sections = plan.sections;
  if (toMarkdown(lim.value, sections) !== text) return { error: 'Cue sheet was edited: the table does not match its data block.' };
  return { limit: lim.value, sections };
}

export const EXAMPLE = Object.freeze({
  limit: 150,
  sections: [
    { title: 'Hook: the fictional team Lantern Labs misses demo deadlines', seconds: 20 },
    { title: 'Problem: demos run long and get cut off', seconds: 25 },
    { title: 'Live walkthrough of the main flow', seconds: 60 },
    { title: 'Architecture in one slide', seconds: 25 },
    { title: 'Close and call to action', seconds: 30 },
  ],
});
