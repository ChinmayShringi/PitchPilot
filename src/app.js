import { canAddSection, validateLimit, validateSection, computePlan, moveSection, toMarkdown, parseMarkdown,
  formatTime, statusLine, validateStoredPlan, MAX_FILE_BYTES, EXAMPLE } from './logic.js';

// UI layer only: all calculation, validation and export logic comes from logic.js.
// State is immutable: every change builds a new frozen object via setState.
const KEY = 'demobudget.v1';
const DEFAULT_LIMIT = 120;
const $ = id => document.getElementById(id);
const makeState = (limit, sections) => Object.freeze({ limit, sections: Object.freeze(sections.map(s => Object.freeze({ title: s.title, seconds: s.seconds }))) });
let storedProblem = null; // set when saved data is invalid; saving pauses so it is never silently overwritten
let state = load();
let editing = -1; // index of the section in the form, or -1 when the form adds a new section

function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { storedProblem = 'Browser storage could not be read.'; return makeState(DEFAULT_LIMIT, []); }
  if (raw === null) return makeState(DEFAULT_LIMIT, []);
  const r = validateStoredPlan(raw);
  if (r.error) { storedProblem = r.error; return makeState(DEFAULT_LIMIT, []); }
  return makeState(r.limit, r.sections);
}

function storageNotice() {
  return storedProblem ? `Saved data in this browser was not loaded (${storedProblem}). It has not been changed, and saving is paused until you confirm Reset all or import a cue sheet.` : '';
}

// Persist; on failure keep the in-memory state (which the UI shows) and say so visibly.
function persist(fn, { force = false } = {}) {
  if (storedProblem && !force) { $('storage-msg').textContent = storageNotice(); return false; }
  try { fn(); storedProblem = null; $('storage-msg').textContent = ''; return true; }
  catch {
    $('storage-msg').textContent = 'Could not save to browser storage. Your changes are shown but will be lost when this page closes. Export a cue sheet to keep them.';
    return false;
  }
}

function setState(next, { clearDraft = false, focus, force = false } = {}) {
  state = next;
  if (clearDraft) resetDraft();
  persist(() => localStorage.setItem(KEY, JSON.stringify(state)), { force });
  render(focus);
}

function resetDraft() {
  editing = -1; $('title').value = ''; $('seconds').value = '';
  setErr('title'); setErr('seconds');
}

function setErr(inputId, msg) {
  $(inputId + '-err').textContent = msg || '';
  $(inputId).setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function btn(label, aria, onClick, disabled) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ghost'; b.textContent = label;
  b.setAttribute('aria-label', aria); b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function render(focusSel) {
  const plan = computePlan(state.limit, state.sections);
  $('limit').value = String(state.limit); setErr('limit'); // any render shows the saved limit and clears a stale limit error
  const sum = $('summary');
  sum.textContent = (plan.status === 'over' ? 'Over budget. ' : plan.status === 'exact' ? 'On budget. ' : 'Within budget. ') + `Total ${plan.total} s of ${plan.limit} s. ${statusLine(plan)}.`;
  sum.className = 'summary' + (plan.status === 'over' ? ' over' : '');
  const list = $('list');
  list.replaceChildren();
  plan.rows.forEach((r, i) => {
    const li = document.createElement('li');
    li.dataset.index = String(i);
    if (i === editing) li.className = 'editing';
    const t = document.createElement('div'); t.className = 'title'; t.textContent = `${r.index}. ${r.title}`;
    const tm = document.createElement('div'); tm.className = 'times';
    tm.textContent = `${formatTime(r.start)} to ${formatTime(r.end)} (${r.seconds} s)`;
    const name = r.title.length > 40 ? r.title.slice(0, 40) + '...' : r.title;
    li.append(t, tm,
      btn('Up', `Move ${name} up`, () => move(i, i - 1), i === 0),
      btn('Down', `Move ${name} down`, () => move(i, i + 1), i === plan.rows.length - 1),
      btn('Edit', `Edit ${name}`, () => startEdit(i)),
      btn('Remove', `Remove ${name}`, () => remove(i)));
    list.append(li);
  });
  $('preview').textContent = toMarkdown(state.limit, state.sections);
  $('save').textContent = editing >= 0 ? 'Save changes' : 'Add section';
  $('cancel-edit').hidden = editing < 0;
  if (focusSel) { const el = document.querySelector(focusSel); if (el) el.focus(); }
}

function move(from, to) {
  setState(makeState(state.limit, moveSection(state.sections, from, to)), { clearDraft: true });
  const label = to < from ? 'Up' : 'Down';
  const row = [...document.querySelectorAll(`#list li[data-index="${to}"] button`)];
  const b = row.find(x => x.textContent === label && !x.disabled) || row.find(x => !x.disabled);
  if (b) b.focus();
}
function remove(i) {
  const next = state.sections.filter((_, k) => k !== i);
  setState(makeState(state.limit, next), { clearDraft: true,
    focus: next.length ? `#list li[data-index="${Math.min(i, next.length - 1)}"] button:not([disabled])` : '#title' });
}
function startEdit(i) {
  editing = i;
  $('title').value = state.sections[i].title;
  $('seconds').value = String(state.sections[i].seconds);
  setErr('title'); setErr('seconds');
  render('#title');
}

$('limit-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = validateLimit($('limit').value);
  if (v.error) { setErr('limit', v.error); $('limit').focus(); return; }
  setErr('limit'); setState(makeState(v.value, state.sections));
});

$('section-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = validateSection($('title').value, $('seconds').value);
  setErr('title', v.errors && v.errors.title); setErr('seconds', v.errors && v.errors.seconds);
  if (v.errors) { $(v.errors.title ? 'title' : 'seconds').focus(); return; }
  let next;
  if (editing >= 0) next = state.sections.map((s, k) => (k === editing ? v.section : s));
  else {
    const c = canAddSection(state.sections);
    if (c.error) { setErr('title', c.error); $('title').focus(); return; }
    next = [...state.sections, v.section];
  }
  setState(makeState(state.limit, next), { clearDraft: true, focus: '#title' });
});
$('cancel-edit').addEventListener('click', () => { resetDraft(); render('#title'); });

$('example').addEventListener('click', () => setState(makeState(EXAMPLE.limit, EXAMPLE.sections), { clearDraft: true }));

const dlg = $('reset-confirm');
$('reset').addEventListener('click', () => { dlg.showModal(); $('reset-no').focus(); });
$('reset-no').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => { if (dlg.returnValue !== 'reset') $('reset').focus(); dlg.returnValue = ''; });
$('reset-yes').addEventListener('click', () => {
  state = makeState(DEFAULT_LIMIT, []); resetDraft();
  persist(() => localStorage.removeItem(KEY), { force: true });
  dlg.close('reset'); render('#title');
});

$('download').addEventListener('click', () => {
  const blob = new Blob([toMarkdown(state.limit, state.sections)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'demobudget-cue-sheet.md';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

function applyImport(text) {
  const r = parseMarkdown(text);
  const msg = $('import-msg');
  if (r.error) { msg.className = 'err'; msg.textContent = r.error; return; }
  setState(makeState(r.limit, r.sections), { clearDraft: true, force: true });
  msg.className = 'summary'; msg.textContent = `Imported ${r.sections.length} sections.`;
}
$('import').addEventListener('click', () => applyImport($('import-text').value));
$('import-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const msg = $('import-msg');
  if (f.size > MAX_FILE_BYTES) { msg.className = 'err'; msg.textContent = `File is too large (${f.size} bytes; limit ${MAX_FILE_BYTES}).`; return; }
  let text;
  try { text = await f.text(); } catch { msg.className = 'err'; msg.textContent = 'The file could not be read.'; return; }
  applyImport(text);
});

render();
if (storedProblem) $('storage-msg').textContent = storageNotice();
