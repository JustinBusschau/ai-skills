// Browser check for a board's app code, run by smoke_test.py against a
// throwaway board built from assets/fixture-plan.json (never the real board).
// Drives headless Chrome over the DevTools protocol, using Node's built-in
// WebSocket (Node 22 or newer).
//
//   node ui_check.mjs <port> <fixture board.json> <edit_board.py> <chrome> <python> [screenshot dir]
//
// Prints PASS/FAIL per check and exits non-zero if any failed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';

const [port, dataFile, EDIT, CHROME, PYTHON, shotDir] = process.argv.slice(2);
const projectDir = dirname(dirname(dataFile));
if (shotDir) mkdirSync(shotDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'kanban-cdp-'));
const dbg = await new Promise((resolve) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--window-size=1500,1000', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const events = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbg}/json`); const t = (await r.json()).find((x) => x.type === 'page'); if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('no chrome');
}
function send(method, params = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { res, rej })); }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function shot(name) { if (!shotDir) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotDir, name + '.png'), Buffer.from(r.data, 'base64')); }
const results = [];
function check(name, ok, detail = '') { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ': ' + detail : ''}`); }
const serverBoard = async () => (await fetch(`http://127.0.0.1:${port}/api/board`, { headers: { Host: `localhost:${port}` } })).json();

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id).res(d.result || {}); if (d.error) console.log('CDP error', d.error); pending.delete(d.id); } else if (d.method) events.push(d); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1500);
  check('title rendered', (await ev(`return document.querySelector('#board-title').textContent`)) !== 'Loading board');

  // Open card and add a comment with markdown + mermaid
  await ev(`document.querySelector('.card[data-id="PARTY-2"]').click()`);
  await sleep(300);
  check('ticket dialog opens', await ev(`return document.querySelector('#ticket-dialog').open`));
  await ev(`const ta = document.querySelector('.comments-section textarea'); ta.value = '**Bold** note with \`code\` and <script>alert(1)</script>\\n\\n\`\`\`mermaid\\nflowchart LR\\n  A-->B\\n\`\`\`\\n\\n- item one\\n- item two'; ta.dispatchEvent(new Event('input'));`);
  await ev(`[...document.querySelectorAll('.comments-section button')].find(b => b.textContent === 'Add comment').click()`);
  await sleep(4000);
  const cm = await ev(`const c = document.querySelector('.comment'); return c ? {html: c.innerHTML, svg: !!c.querySelector('svg'), meta: c.querySelector('.comment-meta time').textContent} : null`);
  check('comment rendered', !!cm);
  check('comment markdown bold', cm && cm.html.includes('<strong>Bold</strong>'));
  check('script tag escaped', cm && !cm.html.includes('<script>') && cm.html.includes('&lt;script&gt;'));
  if (cm && !cm.svg && /could not be loaded/.test(cm.html)) {
    // Designed offline behaviour (source shown instead), not a defect.
    console.log('SKIP  mermaid rendered to svg: Mermaid could not be loaded (no internet, or jsDelivr blocked); use create_board.py --vendor-mermaid for offline diagrams');
  } else {
    check('mermaid rendered to svg', cm && cm.svg, cm && cm.html.slice(0, 400));
  }
  check('comment timestamp shown', cm && /^Added \d+ \w+ \d{4}/.test(cm.meta), cm && cm.meta);
  await shot('ui-ticket-dialog');
  await sleep(800);
  let sb = await serverBoard();
  check('comment saved to server', sb.tickets.find((t) => t.id === 'PARTY-2').comments.length === 1);

  // Upload image via the editor's file path (simulate paste with DataTransfer)
  await ev(`const ta = document.querySelector('.comments-section textarea');
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bin], 'shot.png', {type: 'image/png'});
    const dt = new DataTransfer(); dt.items.add(file);
    const e = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
    ta.dispatchEvent(e);`);
  await sleep(800);
  const val = await ev(`return document.querySelector('.comments-section textarea').value`);
  check('pasted image uploaded and inserted', /!\[shot\.png\]\(uploads\/[a-f0-9]{32}\.png\)/.test(val), val);
  await ev(`[...document.querySelectorAll('.comments-section button')].find(b => b.textContent === 'Add comment').click()`);
  await sleep(500);
  check('image displays in comment', await ev(`return !!document.querySelector('.comment img[src^="uploads/"]')`));

  // Edit first comment -> edited timestamp
  await sleep(1100);
  await ev(`[...document.querySelector('.comment').querySelectorAll('button')].find(b => b.textContent === 'Edit').click()`);
  await ev(`const ta = document.querySelector('.comment textarea'); ta.value = 'Edited body'; [...document.querySelector('.comment').querySelectorAll('button')].find(b => b.textContent === 'Save comment').click();`);
  await sleep(300);
  const meta = await ev(`return document.querySelector('.comment .comment-meta').textContent`);
  check('edited comment shows edited timestamp', meta.startsWith('Edited'), meta);

  // Change title & assignee via form and save
  await ev(`const d = document.querySelector('#ticket-dialog'); d.querySelector('.title-input').value = 'Shortlist venues (renamed)'; d.querySelector('.title-input').dispatchEvent(new Event('input')); const sel = d.querySelector('select[aria-label="Assignee"]'); sel.value = 'p-alex-jones'; sel.dispatchEvent(new Event('input')); d.querySelector('button[type=submit]').click();`);
  await sleep(1000);
  sb = await serverBoard();
  const t2 = sb.tickets.find((t) => t.id === 'PARTY-2');
  check('ticket edits saved', t2.title === 'Shortlist venues (renamed)' && t2.assignee === 'p-alex-jones', JSON.stringify(t2).slice(0, 200));

  // Create new ticket
  await ev(`document.querySelector('#new-ticket').click()`);
  await ev(`const d = document.querySelector('#ticket-dialog'); d.querySelector('.title-input').value = 'Book DJ'; const p = d.querySelector('select[aria-label="Parent"]'); p.value = 'PARTY-6'; d.querySelector('button[type=submit]').click();`);
  await sleep(1000);
  sb = await serverBoard();
  const nt = sb.tickets.find((t) => t.title === 'Book DJ');
  check('new ticket created with next key and parent', nt && nt.id === 'PARTY-9' && nt.parent === 'PARTY-6', JSON.stringify(nt));

  // Create subtask from parent dialog
  await ev(`document.querySelector('.card[data-id="PARTY-9"]').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#ticket-dialog button')].find(b => b.textContent === 'Add sub-task').click()`);
  await sleep(200);
  await ev(`const d = document.querySelector('#ticket-dialog'); d.querySelector('.title-input').value = 'Get DJ quotes'; d.querySelector('button[type=submit]').click();`);
  await sleep(1000);
  sb = await serverBoard();
  const st = sb.tickets.find((t) => t.title === 'Get DJ quotes');
  check('sub-task created under parent', st && st.type === 'subtask' && st.parent === 'PARTY-9', JSON.stringify(st));

  // Simulated drag & drop to Blocked column
  await ev(`const card = document.querySelector('.card[data-id="PARTY-8"]'); const cell = document.querySelector('.cell[data-col="blocked"]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true}));
    cell.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
    cell.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true, clientY: 9999}));`);
  await sleep(200);
  check('blocked reason prompt opens', await ev(`return document.querySelector('#prompt-dialog').open`));
  await ev(`const d = document.querySelector('#prompt-dialog'); d.querySelector('textarea').value = 'Waiting for venue date'; d.querySelector('button[type=submit]').click();`);
  await sleep(1000);
  sb = await serverBoard();
  const t8 = sb.tickets.find((t) => t.id === 'PARTY-8');
  check('drop moved ticket and stored reason', t8.status === 'blocked' && t8.blockedReason === 'Waiting for venue date', JSON.stringify(t8).slice(0, 300));

  // Keyboard move Alt+ArrowRight
  await ev(`const c = document.querySelector('.card[data-id="PARTY-8"]'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));`);
  await sleep(200);
  check('keyboard move opens waiting prompt', await ev(`return document.querySelector('#prompt-dialog').open`));
  await ev(`const d = document.querySelector('#prompt-dialog'); [...d.querySelectorAll('button')].find(b => b.textContent === 'Skip').click();`);
  await sleep(900);
  sb = await serverBoard();
  check('keyboard move saved', sb.tickets.find((t) => t.id === 'PARTY-8').status === 'waiting');
  const t8b = sb.tickets.find((t) => t.id === 'PARTY-8');
  check('leaving Blocked clears the reason and records history', t8b.blockedReason === '' && t8b.history.length >= 2
    && t8b.history.some((e) => (e.note || '').includes('Waiting for venue date')), JSON.stringify([t8b.blockedReason, t8b.history]));

  // Swimlanes by assignee; drag into another lane reassigns
  await ev(`const s = document.querySelector('#lane-mode'); s.value = 'assignee'; s.dispatchEvent(new Event('change'));`);
  await sleep(300);
  const lanes = await ev(`return [...document.querySelectorAll('.lane-header .lane-title')].map(e => e.textContent)`);
  check('assignee lanes incl. Unassigned', lanes.includes('Sam Patel') && lanes.includes('Unassigned'), lanes.join(','));
  await ev(`const card = document.querySelector('.card[data-id="PARTY-1"]') || document.querySelector('.card[data-id="PARTY-3"]'); const cell = document.querySelector('.cell[data-lane="p-sam-patel"][data-col="todo"]');
    const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true}));
    cell.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
    cell.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true, clientY: 0}));`);
  await sleep(1000);
  sb = await serverBoard();
  check('drag across assignee lane reassigns', sb.tickets.find((t) => t.id === 'PARTY-3').assignee === 'p-sam-patel');
  await shot('ui-assignee-lanes');

  await ev(`const s = document.querySelector('#lane-mode'); s.value = 'epic'; s.dispatchEvent(new Event('change'));`);
  await sleep(300);
  const elanes = await ev(`return [...document.querySelectorAll('.lane-header .lane-title')].map(e => e.textContent)`);
  check('epic lanes', elanes.some((l) => l.includes('Venue')) && elanes.includes('No epic'), elanes.join(','));
  await shot('ui-epic-lanes');

  // External edit -> poll picks it up (wait for the pending lane-mode save first)
  await sleep(1200);
  const disk = JSON.parse(readFileSync(dataFile, 'utf8'));
  disk.board.title = 'Edited on disk';
  writeFileSync(dataFile, JSON.stringify(disk, null, 2));
  await sleep(5500);
  check('external file edit picked up by poll', (await ev(`return document.querySelector('#board-title').textContent`)) === 'Edited on disk');

  // Conflict: make local change while file changes underneath
  await ev(`window.__origFetch = window.fetch;`);
  disk.board.title = 'Second disk edit';
  writeFileSync(dataFile, JSON.stringify(disk, null, 2));
  await ev(`const s = document.querySelector('#colour-mode'); s.value = 'label'; s.dispatchEvent(new Event('change'));`);
  await sleep(1500);
  const banner = await ev(`const b = document.querySelector('#banner'); return b.hidden ? '' : b.textContent`);
  check('conflict banner shown', banner.includes('changed after this tab loaded'), banner);
  await ev(`[...document.querySelectorAll('#banner button')].find(b => b.textContent.startsWith('Keep my')).click()`);
  await sleep(1200);
  sb = await serverBoard();
  check('keep-mine overwrites', sb.settings.colourBy === 'label');

  // Settings dialog: add a person
  await ev(`document.querySelector('#open-settings').click()`);
  await ev(`const i = document.querySelector('input[aria-label="New person name"]'); i.value = 'Jo Bloggs'; [...document.querySelectorAll('#settings-dialog button')].find(b => b.textContent === 'Add person').click();`);
  await sleep(1000);
  sb = await serverBoard();
  check('settings adds person', sb.people.some((p) => p.name === 'Jo Bloggs'));
  await shot('ui-settings');
  await ev(`document.querySelector('#settings-dialog').close()`);

  // Review finding 2: a ticket dialog open while Claude edits must not revert Claude's change
  await sleep(1500);
  await ev(`document.querySelector('.card[data-id="PARTY-7"]').click()`);
  await sleep(200);
  execFileSync(PYTHON, [EDIT, projectDir, '--op', '{"op":"move","id":"PARTY-7","status":"Done"}']);
  await sleep(5000);
  await ev(`const d = document.querySelector('#ticket-dialog'); d.querySelector('.title-input').value = 'Choose caterer (edited in browser)'; d.querySelector('.title-input').dispatchEvent(new Event('input')); d.querySelector('button[type=submit]').click();`);
  await sleep(1200);
  sb = await serverBoard();
  const t7 = sb.tickets.find((t) => t.id === 'PARTY-7');
  check('dialog save keeps concurrent script change', t7.status === 'done' && t7.title.includes('edited in browser'), JSON.stringify([t7.status, t7.title]));

  // Review finding 1: settings dialog open across a reload must edit the live board
  await ev(`document.querySelector('#open-settings').click()`);
  await sleep(200);
  execFileSync(PYTHON, [EDIT, projectDir, '--op', '{"op":"add-person","name":"Script Person"}']);
  await sleep(5000);
  await ev(`const i = document.querySelector('#settings-dialog input[aria-label="Name"]'); i.value = 'Renamed Lead'; i.dispatchEvent(new Event('change'));`);
  await sleep(1200);
  sb = await serverBoard();
  check('settings edit after reload is saved', sb.people.some((p) => p.name === 'Renamed Lead') && sb.people.some((p) => p.name === 'Script Person'), JSON.stringify(sb.people.map((p) => p.name)));
  await ev(`document.querySelector('#settings-dialog').close()`);

  // Review cycle 2: text being typed in Board settings survives a reload from disk
  await ev(`document.querySelector('#open-settings').click()`);
  await sleep(200);
  await ev(`const i = document.querySelector('#settings-dialog input[aria-label="New person name"]'); i.focus(); i.value = 'Half-typed name';`);
  execFileSync(PYTHON, [EDIT, projectDir, '--op', '{"op":"add-label","name":"from-script"}']);
  await sleep(5000);
  const typed = await ev(`const i = document.querySelector('#settings-dialog input[aria-label="New person name"]'); return i ? i.value : null`);
  check('settings text being typed survives a reload', typed === 'Half-typed name', String(typed));
  await ev(`document.querySelector('#settings-dialog').close()`);

  // Waiting-for party via the prompt
  await ev(`const card = document.querySelector('.card[data-id="PARTY-9"]') ; const cell = document.querySelector('.cell[data-col="waiting"]');
    const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', {dataTransfer: dt, bubbles: true}));
    cell.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true}));
    cell.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true, clientY: 9999}));`);
  await sleep(200);
  await ev(`const d = document.querySelector('#prompt-dialog'); d.querySelector('select').value = 'third_party'; d.querySelector('textarea').value = 'DJ agency quote'; d.querySelector('button[type=submit]').click();`);
  await sleep(1200);
  sb = await serverBoard();
  const t9 = sb.tickets.find((t) => t.id === 'PARTY-9');
  check('waiting prompt records party', t9 && t9.waitingFor === 'third_party' && t9.waitingOn === 'DJ agency quote', JSON.stringify(t9 && [t9.status, t9.waitingFor, t9.waitingOn]));
  check('card shows waiting party', await ev(`return (document.querySelector('.card[data-id="PARTY-9"] .party') || {}).textContent === 'Third party'`));

  // Review cycle 4: a comment typed but not added is posted by "Save changes"
  await ev(`document.querySelector('.card[data-id="PARTY-5"]').click()`);
  await sleep(200);
  await ev(`const ta = document.querySelector('.comments-section textarea'); ta.value = 'Typed but not added'; ta.dispatchEvent(new Event('input')); document.querySelector('#ticket-dialog button[type=submit]').click();`);
  await sleep(1200);
  sb = await serverBoard();
  check('Save changes posts a pending comment', sb.tickets.find((t) => t.id === 'PARTY-5').comments.some((c) => c.body === 'Typed but not added'));

  // Review cycle 4: focus returns to the card after a reason prompt
  await ev(`const c = document.querySelector('.card[data-id="PARTY-3"]'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));`);
  await sleep(200);
  await ev(`c2 = document.querySelector('.card[data-id="PARTY-3"]'); c2 && c2.focus(); c2 && c2.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));`);
  await sleep(200);
  if (await ev(`return document.querySelector('#prompt-dialog').open`)) {
    await ev(`[...document.querySelectorAll('#prompt-dialog button')].find(b => b.textContent === 'Skip').click();`);
    await sleep(300);
    check('focus returns to the card after the reason prompt', await ev(`return document.activeElement && document.activeElement.dataset.id === 'PARTY-3'`));
  } else {
    check('focus returns to the card after the reason prompt', false, 'prompt did not open');
  }

  // Review cycle 4: column headers stay visible when the page scrolls
  await ev(`window.scrollTo(0, 600)`);
  await sleep(200);
  const headTop = await ev(`return document.querySelector('.col-headers').getBoundingClientRect().top`);
  check('column headers stay visible when scrolling', headTop >= 0 && headTop < 200, String(headTop));
  await ev(`window.scrollTo(0, 0)`);

  // Evidence links added by the audit tooling show in the ticket dialog
  execFileSync(PYTHON, [EDIT, projectDir, '--op', '{"op":"add-link","id":"PARTY-5","type":"pr","url":"https://example.com/pr/7","title":"PR 7: book venue"}']);
  await sleep(5000);
  await ev(`document.querySelector('.card[data-id="PARTY-5"]').click()`);
  await sleep(200);
  check('ticket dialog shows evidence links', await ev(`const a = document.querySelector('#ticket-dialog .links a'); return !!a && a.textContent === 'PR 7: book venue' && a.getAttribute('rel') === 'noopener noreferrer'`));
  await ev(`document.querySelector('#ticket-dialog').close()`);

  // Overview dialog
  await ev(`document.querySelector('#open-overview').click()`);
  await sleep(200);
  const ov = await ev(`const d = document.querySelector('#overview-dialog'); return d.open ? d.textContent : ''`);
  check('overview lists blocked and workload', ov.includes('Blocked (') && ov.includes('Open work by person') && ov.includes('Waiting for venue date') === false, ov.slice(0, 300));
  await ev(`document.querySelector('#overview-dialog').close()`);

  // Delete epic cascades
  await ev(`document.querySelector('.epic-chip').click()`);
  await ev(`window.confirm = () => true; [...document.querySelectorAll('#ticket-dialog button')].find(b => b.textContent === 'Delete').click();`);
  await sleep(1000);
  sb = await serverBoard();
  check('delete epic cascades to children', !sb.tickets.some((t) => ['PARTY-1', 'PARTY-2', 'PARTY-3', 'PARTY-4', 'PARTY-5'].includes(t.id)), sb.tickets.map((t) => t.id).join(','));

  const errs = events.filter((e) => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  const real = errs.filter((e) => !(e.params.entry && e.params.entry.text.includes('409')));
  check('no unexpected browser console errors', real.length === 0, JSON.stringify(real.map((e) => e.params.entry ? e.params.entry.text : e.params.exceptionDetails.text)).slice(0, 600));
  await shot('ui-final');
} catch (e) {
  // Report the abort as a failure so a caller can never mistake a cut-short run for a pass.
  console.log(`FAIL  suite aborted before finishing (later checks did not run): ${String(e.message).split('\n')[0]}`);
  results.push(['aborted', false]);
} finally {
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
