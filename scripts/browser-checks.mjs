// Real Chrome checks over the Chrome DevTools Protocol. No dependencies.
// Run: node --experimental-websocket scripts/browser-checks.mjs
// Env: OUT (evidence dir), DEMO=1 (slow paced run for video, headed on $DISPLAY), PORT.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(process.env.OUT || join(ROOT, 'evidence'));
const DEMO = process.env.DEMO === '1';
const PORT = Number(process.env.PORT || 30000 + Math.floor(Math.random() * 20000));
const CDP = 9300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(join(OUT, 'screenshots'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'demobudget-chrome-'));
const dl = mkdtempSync(join(tmpdir(), 'demobudget-dl-'));
const args = [`--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--metrics-recording-only', '--no-pings', '--password-store=basic', '--disable-gpu'];
if (DEMO) args.push('--window-position=0,0', '--window-size=1280,780', '--app=about:blank');
else args.push('--headless=new', '--window-size=1280,900', 'about:blank');
const chrome = spawn('google-chrome', args, { stdio: 'ignore', env: process.env });

let ws, id = 0; const pending = new Map(); const listeners = [];
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function connect() {
  for (let t = 0; t < 50; t++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(x => x.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = m => { const d = JSON.parse(m.data);
          if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
          else listeners.forEach(f => f(d)); };
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome CDP not reachable');
}

const consoleErrors = [], requests = [], steps = [], results = [];
const t0 = Date.now();
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr);
  return r.result.value;
}
async function pace(ms = 1200) { if (DEMO) await sleep(ms); else await sleep(60); }
function caption(text, ms) { steps.push({ at: (Date.now() - t0) / 1000, text }); return pace(ms ?? 1500); }
async function center(sel) {
  return ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
}
async function click(sel) {
  const { x, y } = await center(sel); await pace(300);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await pace(500);
}
async function clickText(scope, text) {
  const sel = await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent===${JSON.stringify(text)});if(!b)return null;b.setAttribute('data-t','x'+Math.random().toString(36).slice(2));return '[data-t="'+b.getAttribute('data-t')+'"]'})()`);
  if (!sel) throw new Error('button not found: ' + text);
  await click(sel);
}
async function key(k) {
  const map = { Tab: [9, ''], Enter: [13, '\r'], ' ': [32, ' '] };
  const [code, text] = map[k];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, text: text || undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code });
  await sleep(DEMO ? 250 : 30);
}
async function typeText(t) {
  if (DEMO) { for (const ch of t) { await send('Input.insertText', { text: ch }); await sleep(45); } }
  else await send('Input.insertText', { text: t });
}
async function fill(sel, text) {
  await click(sel);
  await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.select&&e.select()})()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await typeText(text);
}
async function shot(name) {
  if (DEMO) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(OUT, 'screenshots', name + '.png'), Buffer.from(r.data, 'base64'));
}
async function check(name, fn) {
  try { const detail = await fn(); results.push({ check: name, result: 'PASS', detail: detail ?? null }); }
  catch (e) { results.push({ check: name, result: 'FAIL', detail: String(e.message || e) }); }
  console.log((results.at(-1).result) + ' ' + name);
}
function assert(c, m) { if (!c) throw new Error(m); }
const listTitles = () => ev(`[...document.querySelectorAll('#list .title')].map(e=>e.textContent)`);
const listTimes = () => ev(`[...document.querySelectorAll('#list .times')].map(e=>e.textContent)`);
const summary = () => ev(`document.getElementById('summary').textContent`);

async function addSection(title, secs) { await fill('#title', title); await fill('#seconds', secs); await click('#save'); }

async function waitForServer() {
  // The harness must not start until the app server answers; fail clearly instead of flaking.
  for (let t = 0; t < 50; t++) {
    try { const r = await fetch(BASE); if (r.status === 200) return; } catch {}
    await sleep(100);
  }
  throw new Error('app server did not answer at ' + BASE + ' (port in use or startup failed)');
}

try {
  await waitForServer();
  await connect();
  listeners.push(d => {
    if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'assert')) consoleErrors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') consoleErrors.push('[log] ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
    if (d.method === 'Network.requestWillBeSent') requests.push(d.params.request.url);
  });
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) await send(m);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true }).catch(() =>
    send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }));
  if (!DEMO) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE }); await sleep(1200);

  await check('load_offline_app', async () => {
    await caption('DemoBudget: an offline, local-only planner for timed hackathon demo videos. No accounts, no network.', 5000);
    const h = await ev(`document.querySelector('h1').textContent`); assert(h === 'DemoBudget', 'heading'); await shot('01-empty');
    return h;
  });
  await check('ui_uses_tested_logic_module', async () => {
    const served = await (await fetch(BASE + 'src/logic.js')).text(); // fetched from Node: page CSP blocks connect
    const disk = readFileSync(join(ROOT, 'src/logic.js'), 'utf8');
    const loaded = await ev(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.endsWith('/src/logic.js')).length`);
    assert(served === disk && loaded >= 1, 'served logic.js differs from tested file or was not loaded');
    return { bytes: disk.length, identical: true };
  });

  await check('validation_errors_visible', async () => {
    await caption('Strict validation: an empty title and a decimal duration are rejected with visible errors, never silently fixed.', 3000);
    await fill('#title', ''); await fill('#seconds', '1.5'); await click('#save'); await pace(2500);
    const r = await ev(`({t:document.getElementById('title-err').textContent,s:document.getElementById('seconds-err').textContent,inv:document.getElementById('title').getAttribute('aria-invalid'),n:document.querySelectorAll('#list li').length,f:document.activeElement.id})`);
    assert(/required/.test(r.t) && /decimals/.test(r.s) && r.inv === 'true' && r.n === 0 && r.f === 'title', JSON.stringify(r));
    await fill('#seconds', '0'); await fill('#title', 'x'); await click('#save'); await pace(2000);
    const z = await ev(`document.getElementById('seconds-err').textContent`); assert(/at least 1/.test(z), z);
    await fill('#limit', '-3'); await click('#limit-form button'); await pace(2000);
    const l = await ev(`document.getElementById('limit-err').textContent`); assert(/negative/.test(l), l);
    await shot('02-validation');
    return { title: r.t, seconds: r.s, zero: z, limit: l };
  });

  await check('create_sections_and_limit', async () => {
    await caption('Set a 60 second limit and add three fictional sections. Each gets start and end timestamps.', 3000);
    await fill('#limit', '60'); await click('#limit-form button');
    await addSection('Hook: fictional user Mira loses track of time', '15');
    await addSection('Live demo of the planner', '30');
    await addSection('Wrap up', '20');
    await pace(2500);
    const t = await listTitles(), s = await summary(), times = await listTimes();
    assert(t.length === 3 && /^Over budget\. Total 65 s of 60 s\. OVER by 5 s/.test(s), s);
    const col = await ev(`[document.getElementById('summary').className, getComputedStyle(document.getElementById('summary')).color]`);
    assert(col[0] === 'summary over' && col[1] === 'rgb(179, 38, 30)', JSON.stringify(col));
    assert(times[2] === '0:45 to 1:05 (20 s)', times[2]);
    await caption('The plan is 5 seconds over budget, shown in red.', 3500);
    await shot('03-created-over');
    return { titles: t, summary: s, times };
  });

  await check('edit_section', async () => {
    await caption('Fix it: edit the wrap up section from 20 to 15 seconds. The plan now lands exactly on the limit.', 3000);
    await clickText('#list button', 'Edit'); // first Edit is section 1; use third
    await click('#cancel-edit');
    const sel = await ev(`(()=>{const b=document.querySelectorAll('#list li')[2].querySelectorAll('button')[2];b.id='edit3';return '#edit3'})()`);
    await click(sel); await pace(1000);
    const pre = await ev(`[document.getElementById('title').value,document.getElementById('seconds').value,document.getElementById('save').textContent]`);
    assert(pre[0] === 'Wrap up' && pre[1] === '20' && pre[2] === 'Save changes', JSON.stringify(pre));
    await fill('#seconds', '15'); await click('#save'); await pace(3000);
    const s = await summary(); assert(/Total 60 s of 60 s\. Exactly at limit/.test(s), s);
    await shot('04-edited-exact');
    return s;
  });

  await check('reorder_section', async () => {
    await caption('Reorder: move the live demo up to first. Start and end times recalculate.', 2500);
    const sel = await ev(`(()=>{const b=document.querySelectorAll('#list li')[1].querySelectorAll('button')[0];b.id='up2';return '#up2'})()`);
    await click(sel); await pace(2500);
    const t = await listTitles(), times = await listTimes();
    assert(t[0] === '1. Live demo of the planner' && times[0] === '0:00 to 0:30 (30 s)' && times[1] === '0:30 to 0:45 (15 s)', JSON.stringify([t, times]));
    const focus = await ev(`document.activeElement.textContent`);
    await shot('05-reordered');
    return { titles: t, times, focusAfterMove: focus };
  });

  await check('literal_text_rendering', async () => {
    await caption('Script-like text stays literal text. Nothing is executed or turned into HTML.', 2500);
    const evil = '<img src=x onerror="document.title=1"><b>bold?</b>';
    await addSection(evil, '5'); await pace(2500);
    const r = await ev(`({img:document.querySelectorAll('#list img, #preview img, #list b').length,txt:[...document.querySelectorAll('#list .title')].at(-1).textContent,title:document.title,pre:document.getElementById('preview').textContent.includes('<img src=x')})`);
    assert(r.img === 0 && r.txt === '4. ' + evil && r.title === 'DemoBudget' && r.pre, JSON.stringify(r));
    await shot('06-literal-text');
    return r;
  });

  await check('delete_section', async () => {
    await caption('Remove that test section. The total returns to 60 seconds.', 2000);
    const sel = await ev(`(()=>{const b=document.querySelectorAll('#list li')[3].querySelectorAll('button')[3];b.id='rm4';return '#rm4'})()`);
    await click(sel); await pace(2000);
    const n = await ev(`document.querySelectorAll('#list li').length`), s = await summary();
    assert(n === 3 && /Total 60 s/.test(s), s);
    return { count: n, summary: s };
  });

  let exported;
  await check('export_preview_and_download', async () => {
    await caption('Export: the Markdown preview matches the visible order and times. Download saves a cue sheet file locally.', 3000);
    await click('#preview'); await pace(2500);
    for (const f of readdirSync(dl)) {} // dir starts empty
    await click('#download');
    let file; for (let i = 0; i < 50 && !file; i++) { await sleep(100); file = readdirSync(dl).find(f => f.endsWith('.md')); }
    assert(file, 'no download');
    exported = readFileSync(join(dl, file), 'utf8');
    const pre = await ev(`document.getElementById('preview').textContent`);
    const times = await listTimes();
    assert(exported === pre, 'download differs from preview');
    assert(exported.includes('| 1 | 0:00 | 0:30 | 30 | Live demo of the planner |') && exported.includes('| 3 | 0:45 | 1:00 | 15 | Wrap up |'), exported);
    writeFileSync(join(OUT, 'exported-cue-sheet.md'), exported);
    await shot('07-export-preview');
    return { file, bytes: exported.length, visibleTimes: times };
  });

  await check('reset_dialog_accessible', async () => {
    await caption('Reset opens an in-page confirmation dialog. Keep my plan, or Escape, changes nothing.', 2500);
    await click('#reset'); await pace(2000);
    const d1 = await ev(`({open:document.getElementById('reset-confirm').open,modal:document.getElementById('reset-confirm').matches(':modal'),focus:document.activeElement.id,label:document.getElementById('reset-confirm').getAttribute('aria-labelledby')})`);
    assert(d1.open && d1.modal && d1.focus === 'reset-no' && d1.label === 'reset-h', JSON.stringify(d1));
    await shot('08-reset-dialog');
    await click('#reset-no'); await pace(800);
    assert(!(await ev(`document.getElementById('reset-confirm').open`)) && (await ev(`document.activeElement.id`)) === 'reset', 'Keep did not close or restore focus');
    await click('#reset'); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pace(800);
    assert(!(await ev(`document.getElementById('reset-confirm').open`)) && (await listTitles()).length === 3, 'Escape lost data');
    await caption('Confirming reset clears the plan and local storage.', 2000);
    await click('#reset'); await click('#reset-yes'); await pace(2000);
    const r = await ev(`({n:document.querySelectorAll('#list li').length,ls:localStorage.getItem('demobudget.v1'),open:document.getElementById('reset-confirm').open})`);
    assert(r.n === 0 && r.ls === null && !r.open, JSON.stringify(r));
    return { dialog: d1, after: r };
  });

  await check('import_exported_file', async () => {
    await caption('Reopen: importing the downloaded cue sheet restores the exact plan.', 2500);
    const p = join(dl, readdirSync(dl).find(f => f.endsWith('.md')));
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
    await send('DOM.setFileInputFiles', { nodeId, files: [p] }); await sleep(800); await pace(2500);
    const pre = await ev(`document.getElementById('preview').textContent`);
    assert(pre === exported, 'import round trip mismatch');
    await ev(`document.getElementById('import-text').value='not a cue sheet'`);
    await click('#import'); await pace(2000);
    const err = await ev(`document.getElementById('import-msg').textContent`);
    assert(/Not a DemoBudget/.test(err), err);
    assert((await listTitles()).length === 3, 'bad import changed state');
    await shot('09-imported');
    return { roundTrip: true, badImportMessage: err };
  });

  await check('persistence_after_reload', async () => {
    await send('Page.reload'); await sleep(1200); await pace(1000);
    const t = await listTitles(); assert(t.length === 3, 'not persisted'); return t;
  });

  await check('invalid_inputs_leave_state_unchanged', async () => {
    const before = await ev(`[localStorage.getItem('demobudget.v1'), document.getElementById('preview').textContent]`);
    const cases = [['', '5'], ['ok', ''], ['ok', '-1'], ['ok', 'NaN'], ['ok', 'Infinity'], ['ok', '1e999'], ['ok', '99999999999999999999'], ['ok', '2.5'], ['ok', '010'], ['x'.repeat(501), '5']];
    const errs = [];
    for (const [t, n] of cases) { await fill('#title', t); await fill('#seconds', n); await click('#save');
      errs.push(await ev(`document.getElementById('title-err').textContent + document.getElementById('seconds-err').textContent`)); }
    for (const l of ['', '-5', 'NaN', 'Infinity', '0', '3601', '1e3', '060']) { await fill('#limit', l); await click('#limit-form button');
      errs.push(await ev(`document.getElementById('limit-err').textContent`)); }
    await ev(`document.getElementById('import-text').value='# DemoBudget cue sheet\\nLimit: 1 s'`); await click('#import');
    errs.push(await ev(`document.getElementById('import-msg').textContent`));
    const after = await ev(`[localStorage.getItem('demobudget.v1'), document.getElementById('preview').textContent]`);
    assert(errs.every(e => e.length > 0), JSON.stringify(errs));
    assert(before[0] === after[0] && before[1] === after[1], 'state changed by invalid input');
    await fill('#title', ''); await fill('#seconds', ''); await ev(`document.getElementById('import-text').value=''`);
    await send('Page.reload'); await sleep(1000);
    return { cases: cases.length + 9, messages: errs };
  });

  await check('adversarial_titles_byte_identical_round_trip', async () => {
    const titles = ['**bold** [link](http://example.invalid) # h | col', '<b onclick="x()">html</b><!-- c --> &amp;',
      'Caf\u00e9 \u65e5\u672c\u8a9e \ud83d\ude80', '\u0645\u0631\u062d\u0628\u0627 \u05e9\u05dc\u05d5\u05dd RTL \u202e reversed', 'z'.repeat(500)];
    const saved = await ev(`localStorage.getItem('demobudget.v1')`);
    for (const t of titles) { await fill('#title', t); await fill('#seconds', '3'); await click('#save'); }
    const shown = await ev(`[...document.querySelectorAll('#list .title')].slice(-5).map(e=>e.textContent.replace(/^\\d+\\. /,''))`);
    assert(JSON.stringify(shown) === JSON.stringify(titles), 'titles not literal');
    const injected = await ev(`document.querySelectorAll('#list b, #list a, #preview b').length`);
    assert(injected === 0, 'markup became elements');
    const md1 = await ev(`document.getElementById('preview').textContent`);
    await ev(`document.getElementById('import-text').value=document.getElementById('preview').textContent`);
    await click('#reset'); await click('#reset-yes');
    await click('#import'); await pace(1000);
    const md2 = await ev(`document.getElementById('preview').textContent`);
    assert(md1 === md2, 'export-import-export not byte identical');
    const w = await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);
    assert(w, 'long title causes horizontal overflow');
    await shot('10-adversarial');
    await ev(`localStorage.setItem('demobudget.v1', ${JSON.stringify(saved)})`); await send('Page.reload'); await sleep(1000);
    return { titles: titles.length, bytes: Buffer.byteLength(md1), identical: true };
  });

  await check('keyboard_only_flow', async () => {
    await caption('Keyboard only: Tab to each control, type, and press Enter. A visible orange focus ring shows where you are.', 3000);
    await ev(`document.activeElement.blur(); window.scrollTo(0,0)`);
    const order = [];
    for (let i = 0; i < 4; i++) { await key('Tab'); order.push(await ev(`document.activeElement.id||document.activeElement.textContent`)); }
    // limit, Set limit, title, seconds
    assert(JSON.stringify(order) === JSON.stringify(['limit', 'Set limit', 'title', 'seconds']), JSON.stringify(order));
    const ring = await ev(`getComputedStyle(document.activeElement).outlineStyle+' '+getComputedStyle(document.activeElement).outlineWidth`);
    assert(/solid 3px/.test(ring), ring);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
    await sleep(DEMO ? 250 : 30); // Shift+Tab back from seconds to title
    assert(await ev(`document.activeElement.id`) === 'title', 'title not reached by Tab');
    await typeText('Keyboard added section'); await key('Tab'); await typeText('9'); await key('Enter'); await pace(2000);
    const t = await listTitles(); assert(t.at(-1) === '4. Keyboard added section', JSON.stringify(t));
    // Activate Remove on that row with keyboard: focus moves back to title after add; Tab through to the row buttons
    let found = false;
    for (let i = 0; i < 40 && !found; i++) { await key('Tab'); found = await ev(`document.activeElement.getAttribute('aria-label')==='Remove Keyboard added section'`); }
    assert(found, 'Remove button not reachable by Tab');
    await shot('12-keyboard-focus');
    await key('Enter'); await pace(1500);
    assert((await listTitles()).length === 3, 'keyboard remove failed');
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await key('Tab'); up = await ev(`document.activeElement.getAttribute('aria-label')==='Move Wrap up up'`); }
    assert(up, 'Up button not reachable by Tab');
    const beforeUp = await listTitles(); await key('Enter'); await pace(1200);
    const afterUp = await listTitles();
    assert(afterUp[1] === '2. Wrap up' && beforeUp[2] === '3. Wrap up', JSON.stringify(afterUp));
    assert((await ev(`document.activeElement.getAttribute('aria-label')`)) === 'Move Wrap up up', 'focus not kept on moved Up');
    return { tabOrder: order, focusRing: ring };
  });

  await check('example_and_mobile_375', async () => {
    await caption('Load the built-in example. The team Lantern Labs is fictional. It starts 10 seconds over budget.', 3000);
    await click('#example'); await pace(2500);
    const s = await summary(); assert(/Total 160 s of 150 s\. OVER by 10 s/.test(s), s);
    if (DEMO) { await caption('The layout also works on narrow phone screens.', 2500); return s; }
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    const w = await ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,minFont:Math.min(...[...document.querySelectorAll('body *')].filter(e=>e.textContent.trim()).map(e=>parseFloat(getComputedStyle(e).fontSize)))})`);
    assert(w.sw <= w.cw && w.cw === 375 && w.minFont >= 12, JSON.stringify(w));
    await shot('13-mobile-375');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    return { summary: s, ...w };
  });

  if (DEMO) { await caption('All data in this video is fictional. DemoBudget runs locally, offline, with no network requests.', 6000); }

  const draft = () => ev(`({t:document.getElementById('title').value,s:document.getElementById('seconds').value,label:document.getElementById('save').textContent,cancelHidden:document.getElementById('cancel-edit').hidden,editingRows:document.querySelectorAll('#list li.editing').length})`);
  const isClear = d => d.t === '' && d.s === '' && d.label === 'Add section' && d.cancelHidden && d.editingRows === 0;
  const rowBtn = async (row, idx) => { const id = 'rb' + Math.random().toString(36).slice(2); await ev(`document.querySelectorAll('#list li')[${row}].querySelectorAll('button')[${idx}].id='${id}'`); await click('#' + id); };
  async function freshTwo() {
    await click('#reset'); await click('#reset-yes');
    await fill('#title', 'Opening'); await fill('#seconds', '60'); await click('#save');
    await fill('#title', 'Closing'); await fill('#seconds', '61'); await click('#save');
  }
  await check('stale_draft_cleared_after_remove', async () => {
    await freshTwo();
    await rowBtn(0, 2); await rowBtn(0, 3); // Edit Opening, then Remove Opening
    const d = await draft(); assert(isClear(d), 'draft not cleared: ' + JSON.stringify(d));
    await click('#save');
    const t = await listTitles(); assert(t.length === 1 && t[0] === '1. Closing', 'resurrected: ' + JSON.stringify(t));
    return { draftAfterRemove: d, titles: t };
  });
  await check('draft_cleared_after_move_example_reset_import', async () => {
    const out = {};
    await freshTwo(); await rowBtn(1, 2); await rowBtn(1, 0); out.move = await draft();
    await rowBtn(0, 2); await click('#example'); out.example = await draft();
    const md = await ev(`document.getElementById('preview').textContent`);
    await rowBtn(0, 2); await click('#reset'); await click('#reset-yes'); out.reset = await draft();
    await fill('#title', 'Opening'); await fill('#seconds', '60'); await click('#save'); await rowBtn(0, 2);
    await ev(`document.getElementById('import-text').value=${JSON.stringify(md)}`); await click('#import'); out.import = await draft();
    for (const [k, v] of Object.entries(out)) assert(isClear(v), k + ': ' + JSON.stringify(v));
    return out;
  });
  await check('draft_kept_on_failure_or_cancel', async () => {
    await freshTwo(); await rowBtn(0, 2); await fill('#seconds', 'abc'); await click('#save');
    const failSave = await draft();
    assert(failSave.label === 'Save changes' && failSave.t === 'Opening' && failSave.s === 'abc', JSON.stringify(failSave));
    await ev(`document.getElementById('import-text').value='garbage'`); await click('#import');
    const failImport = await draft(); assert(failImport.label === 'Save changes' && failImport.t === 'Opening', JSON.stringify(failImport));
    await click('#reset'); await click('#reset-no');
    const cancelReset = await draft(); assert(cancelReset.label === 'Save changes' && cancelReset.t === 'Opening', JSON.stringify(cancelReset));
    await click('#cancel-edit'); const cancelled = await draft(); assert(isClear(cancelled), JSON.stringify(cancelled));
    await ev(`document.getElementById('import-text').value=''; document.getElementById('import-msg').textContent=''`);
    return { failSave, failImport, cancelReset };
  });
  await check('storage_denied_reported_and_consistent', async () => {
    await click('#reset'); await click('#reset-yes');
    const before = await ev(`localStorage.getItem('demobudget.v1')`);
    await ev(`window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){ throw new DOMException('denied by test', 'QuotaExceededError'); }`);
    await fill('#title', 'Kept in memory'); await fill('#seconds', '12'); await click('#save');
    const r = await ev(`({msg:document.getElementById('storage-msg').textContent,titles:[...document.querySelectorAll('#list .title')].map(e=>e.textContent),pre:document.getElementById('preview').textContent.includes('Kept in memory'),sum:document.getElementById('summary').textContent,ls:localStorage.getItem('demobudget.v1')})`);
    await ev(`Storage.prototype.setItem = window.__origSet`);
    assert(/Could not save/.test(r.msg) && r.titles.length === 1 && r.pre && /Total 12 s/.test(r.sum) && r.ls === before, JSON.stringify(r));
    await shot('14-storage-denied');
    await fill('#seconds', '');
    await fill('#title', 'Saved again'); await fill('#seconds', '3'); await click('#save');
    const after = await ev(`({msg:document.getElementById('storage-msg').textContent,ls:JSON.parse(localStorage.getItem('demobudget.v1')).sections.length})`);
    assert(after.msg === '' && after.ls === 2, JSON.stringify(after));
    await click('#reset'); await click('#reset-yes');
    return { denied: r, recovered: after };
  });

  await check('limit_error_cleared_on_unrelated_render', async () => {
    await click('#reset'); await click('#reset-yes');
    await fill('#limit', 'abc'); await click('#limit-form button');
    const bad = await ev(`[document.getElementById('limit-err').textContent, document.getElementById('limit').getAttribute('aria-invalid')]`);
    assert(bad[0] && bad[1] === 'true', JSON.stringify(bad));
    await fill('#title', 'After bad limit'); await fill('#seconds', '5'); await click('#save');
    const after = await ev(`[document.getElementById('limit').value, document.getElementById('limit-err').textContent, document.getElementById('limit').getAttribute('aria-invalid')]`);
    assert(after[0] === '120' && after[1] === '' && after[2] === 'false', JSON.stringify(after));
    return { bad, after };
  });
  await check('paste_without_final_newline_imports', async () => {
    const md = await ev(`document.getElementById('preview').textContent`);
    await click('#reset'); await click('#reset-yes');
    await ev(`document.getElementById('import-text').value=${JSON.stringify(md.slice(0, -1))}`); await click('#import');
    const r = await ev(`[document.getElementById('import-msg').textContent, document.getElementById('preview').textContent]`);
    assert(/Imported 1 sections/.test(r[0]) && r[1] === md, JSON.stringify(r[0]));
    await ev(`document.getElementById('import-text').value=''`);
    return r[0];
  });
  await check('oversized_file_rejected_before_reading', async () => {
    const big = join(dl, 'big.md'); writeFileSync(big, '# DemoBudget cue sheet\n' + 'x'.repeat(1000001));
    const before = await ev(`document.getElementById('preview').textContent`);
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
    await send('DOM.setFileInputFiles', { nodeId, files: [big] }); await sleep(600);
    const r = await ev(`[document.getElementById('import-msg').textContent, document.getElementById('preview').textContent]`);
    assert(/too large/.test(r[0]) && r[1] === before, r[0]);
    return r[0];
  });
  await check('corrupt_saved_data_reported_not_overwritten', async () => {
    const bad = JSON.stringify({ limit: 60, sections: Array.from({ length: 101 }, () => ({ title: 'a', seconds: 1 })) });
    await ev(`localStorage.setItem('demobudget.v1', ${JSON.stringify(bad)})`);
    await send('Page.reload'); await sleep(1000);
    const msg = await ev(`document.getElementById('storage-msg').textContent`);
    assert(/not loaded/.test(msg) && /at most 100/.test(msg), msg);
    await fill('#title', 'New work'); await fill('#seconds', '4'); await click('#save');
    const kept = await ev(`localStorage.getItem('demobudget.v1')`);
    const shown = await listTitles();
    assert(kept === bad && shown.length === 1 && /paused/.test(await ev(`document.getElementById('storage-msg').textContent`)), 'saved data overwritten or not reported');
    await shot('15-corrupt-storage');
    await click('#reset'); await click('#reset-yes');
    const cleared = await ev(`[localStorage.getItem('demobudget.v1'), document.getElementById('storage-msg').textContent]`);
    assert(cleared[0] === null && cleared[1] === '', JSON.stringify(cleared));
    await fill('#title', 'Saves again'); await fill('#seconds', '2'); await click('#save');
    assert(JSON.parse(await ev(`localStorage.getItem('demobudget.v1')`)).sections.length === 1, 'saving did not resume');
    await click('#reset'); await click('#reset-yes');
    return { message: msg };
  });

  await check('padded_numbers_trimmed_documented', async () => {
    await click('#reset'); await click('#reset-yes');
    await fill('#limit', ' 90 '); await click('#limit-form button');
    await fill('#title', 'Padded'); await fill('#seconds', ' 10 '); await click('#save');
    const r = await ev(`[document.getElementById('limit').value, document.getElementById('limit-err').textContent, [...document.querySelectorAll('#list .times')].map(e=>e.textContent)]`);
    assert(r[0] === '90' && r[1] === '' && r[2][0] === '0:00 to 0:10 (10 s)', JSON.stringify(r));
    await click('#reset'); await click('#reset-yes');
    return r;
  });

  await check('saved_numeric_text_rejected_like_import', async () => {
    const bad = '{"limit":"60","sections":[{"title":"a","seconds":5}]}';
    await ev(`localStorage.setItem('demobudget.v1', ${JSON.stringify(bad)})`);
    await send('Page.reload'); await sleep(1000);
    const msg = await ev(`document.getElementById('storage-msg').textContent`);
    const r = await ev(`[localStorage.getItem('demobudget.v1'), document.querySelectorAll('#list li').length]`);
    assert(/not loaded/.test(msg) && /JSON number/.test(msg) && r[0] === bad && r[1] === 0, JSON.stringify([msg, r]));
    await click('#reset'); await click('#reset-yes');
    return msg;
  });

  await check('server_survives_adverse_paths', async () => {
    const { request } = await import('node:http');
    const raw = path => new Promise((ok, fail) => { const r = request({ host: '127.0.0.1', port: PORT, path }, res => { res.resume(); ok(res.statusCode); }); r.on('error', fail); r.end(); });
    const out = {};
    for (const p of ['/%E0%A4%A', '/%', '/%00', '/../../../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/.git/config', '/test/logic.test.js']) out[p] = await raw(p);
    out['/ after'] = await raw('/');
    assert(out['/%E0%A4%A'] === 400 && out['/%'] === 400 && out['/ after'] === 200 && Object.entries(out).filter(([k]) => /etc|git|test/.test(k)).every(([, v]) => v === 404), JSON.stringify(out));
    await send('Page.reload'); await sleep(800);
    assert((await ev(`document.querySelector('h1').textContent`)) === 'DemoBudget', 'page not served after adverse paths');
    return out;
  });

  await check('zero_console_errors', async () => { assert(consoleErrors.length === 0, JSON.stringify(consoleErrors)); return 0; });
  await check('zero_external_network_requests', async () => {
    const ext = requests.filter(u => !u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:'));
    assert(ext.length === 0, JSON.stringify(ext));
    return { totalRequests: requests.length, sameOriginStatic: requests.filter(u => u.startsWith(BASE)).length, blobOrData: requests.filter(u => /^(blob|data):/.test(u)).length, external: 0, urls: [...new Set(requests)] };
  });
} catch (e) {
  results.push({ check: 'harness', result: 'FAIL', detail: String(e.stack || e) });
  console.log('HARNESS FAIL', e);
} finally {
  const chromeVersion = await fetch(`http://127.0.0.1:${CDP}/json/version`).then(r => r.json()).then(j => j.Browser).catch(() => 'unknown');
  const summaryOut = { t0Epoch: t0, ranAt: new Date().toISOString(), mode: DEMO ? 'demo-headed' : 'headless', chrome: chromeVersion, base: BASE,
    pass: results.filter(r => r.result === 'PASS').length, fail: results.filter(r => r.result === 'FAIL').length, results, consoleErrors, steps };
  writeFileSync(join(OUT, DEMO ? 'demo-run.json' : 'browser-checks.json'), JSON.stringify(summaryOut, null, 2));
  try { ws && ws.close(); } catch {}
  chrome.kill(); server.kill();
  process.exit(summaryOut.fail ? 1 : 0);
}
