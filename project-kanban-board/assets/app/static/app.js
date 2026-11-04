/* Single-user kanban board. No framework, no build step.
 *
 * The whole board lives in one JSON document (data/board.json on the server).
 * Every change mutates state.board, re-renders, and schedules a save. Saves
 * send the full document with If-Match so a stale tab never overwrites a newer
 * file (for example one Claude edited); the server answers 409 instead.
 */
'use strict';
(() => {
  const CLIENT_HEADERS = { 'X-Kanban-Client': '1' };
  // Pinned build with Subresource Integrity, so a tampered CDN file is refused.
  // A copy in static/vendor/ (create_board.py --vendor-mermaid) is tried first.
  const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js';
  const MERMAID_SRI = 'sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2';
  const MAX_UPLOAD = 10 * 1024 * 1024;
  const POLL_MS = 4000;

  const KIND_LABEL = {
    backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked',
    waiting: 'Awaiting action', testing: 'Awaiting testing', signoff: 'Awaiting sign-off', done: 'Done',
  };
  const TYPE_LABEL = { epic: 'Epic', task: 'Task', subtask: 'Sub-task' };
  const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  const WAITING_FOR_LABEL = { stakeholder: 'Stakeholder', third_party: 'Third party', team: 'Team member', other: 'Other' };
  const DIAGRAM_TEMPLATE = '```mermaid\nflowchart LR\n  A[Start] --> B[Next step]\n  B --> C{Decision}\n  C -->|Yes| D[Done]\n  C -->|No| B\n```\n';

  const state = {
    board: null,
    etag: null,
    rev: 0,          // bumped on every local change
    savedRev: 0,     // rev that the server last confirmed
    saving: false,
    saveTimer: null,
    conflict: false,
    filters: { q: '', assignee: 'all', epic: 'all', label: 'all' },
    collapsed: readPref('collapsedLanes', {}),
    dragId: null,
    idx: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style') {
          for (const [prop, val] of Object.entries(v)) {
            if (prop.startsWith('--')) el.style.setProperty(prop, val);
            else el.style[prop] = val;
          }
        }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = Boolean(v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function readPref(key, fallback) {
    try {
      const raw = localStorage.getItem('kanban:' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writePref(key, value) {
    try { localStorage.setItem('kanban:' + key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const shortDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

  function fmtDateTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : dateTimeFmt.format(d);
  }

  function fmtDue(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    return isNaN(d) ? ymd : shortDateFmt.format(d);
  }

  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function slug(text, fallback) {
    const s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return s || fallback;
  }

  function uniqueId(base, taken) {
    let id = base;
    let n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    return id;
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  let toastTimer = null;
  function toast(message, kind = 'info') {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast ' + kind;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 8000 : 3500);
  }

  function showBanner(kind, message, actions = []) {
    const el = $('#banner');
    el.className = 'banner ' + kind;
    el.replaceChildren(h('span', null, message), ...actions.map(([label, fn]) => h('button', { type: 'button', onclick: fn }, label)));
    el.hidden = false;
  }

  function hideBanner() {
    $('#banner').hidden = true;
  }

  function setSaveState(text, kind = '') {
    const el = $('#save-state');
    el.textContent = text;
    el.className = 'save-state ' + kind;
  }

  // ------------------------------------------------------------------
  // Loading and saving
  // ------------------------------------------------------------------

  async function load() {
    const res = await fetch('/api/board', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load the board (HTTP ${res.status}).`);
    state.etag = res.headers.get('ETag');
    state.board = normalise(await res.json());
    state.rev = 0;
    state.savedRev = 0;
    state.conflict = false;
    state.backupLabel = '';
    render();
    // Dialogs built from the previous board object would edit a stale copy.
    const settings = $('#settings-dialog');
    if (settings.open) {
      const busy = settings.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
        || [...settings.querySelectorAll('.settings-row.add input')].some((i) => i.value.trim());
      if (busy) {
        let note = settings.querySelector('.reload-note');
        if (!note) {
          note = h('p', { class: 'reload-note' }, 'The board was updated from file while you were editing. Your edits here still apply; close and reopen Board settings to see the other changes.');
          settings.querySelector('.settings-body').prepend(note);
        }
      } else {
        openSettings();
      }
    }
    if ($('#overview-dialog').open) openOverview();
  }

  function normalise(board) {
    board.people = board.people || [];
    board.labels = board.labels || [];
    board.tickets = board.tickets || [];
    board.settings = Object.assign(
      { swimlanes: 'none', colourBy: 'epic', showEpicCards: false, showSubtasks: true },
      board.settings || {},
    );
    for (const t of board.tickets) {
      t.labels = t.labels || [];
      t.comments = t.comments || [];
      t.blockedBy = t.blockedBy || [];
      if (t.description == null) t.description = '';
      if (t.blockedReason == null) t.blockedReason = '';
      if (t.waitingOn == null) t.waitingOn = '';
      if (t.waitingFor == null) t.waitingFor = '';
      if (t.priority == null) t.priority = 'medium';
      if (t.order == null) t.order = 0;
      if (!Array.isArray(t.history)) t.history = [];
      if (!Array.isArray(t.links)) t.links = [];
    }
    return board;
  }

  // Call after any change to state.board.
  function changed({ rerender = true } = {}) {
    state.rev += 1;
    state.board.board.updatedAt = nowIso();
    if (rerender) render();
    setSaveState('Unsaved changes', 'pending');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 400);
  }

  async function save() {
    if (state.conflict) return;
    if (state.saving) { state.saveTimer = setTimeout(save, 300); return; }
    if (state.rev === state.savedRev) return;
    state.saving = true;
    const sendingRev = state.rev;
    const label = state.backupLabel;
    setSaveState('Saving', 'pending');
    try {
      const headers = { ...CLIENT_HEADERS, 'Content-Type': 'application/json', 'If-Match': state.etag || '' };
      if (label) headers['X-Kanban-Backup-Label'] = label;
      const res = await fetch('/api/board', { method: 'PUT', headers, body: JSON.stringify(state.board) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (state.backupLabel === label) state.backupLabel = '';
        state.etag = data.etag;
        state.savedRev = sendingRev;
        setSaveState(state.rev === state.savedRev ? 'All changes saved' : 'Unsaved changes', state.rev === state.savedRev ? 'ok' : 'pending');
        if (state.rev !== state.savedRev) state.saveTimer = setTimeout(save, 300);
      } else if (res.status === 409) {
        state.conflict = true;
        setSaveState('Not saved: conflict', 'error');
        showBanner(
          'error',
          'The board file changed after this tab loaded it (perhaps Claude or another tab edited it), so your latest change was not saved.',
          [
            ['Load the newer version (discard my unsaved change)', () => { hideBanner(); load().catch(fatal); }],
            ['Keep my version (overwrite the file)', overwriteAfterConflict],
          ],
        );
      } else if (res.status === 401) {
        state.conflict = true; // nothing will save until the access link is opened again
        setSaveState('Not saved: access link needed', 'error');
        showBanner('error', 'The board server needs its access link again (it may have restarted with a new token). Open the link from the server output (with Docker: docker compose logs board); your unsaved change is still in this tab until you reload.', []);
      } else if (res.status === 422) {
        state.conflict = true; // stop retrying a board the server will keep refusing
        setSaveState('Not saved: invalid', 'error');
        showBanner('error', 'The server refused to save because the board is invalid: ' + (data.problems || []).slice(0, 5).join(' ') ,
          [['Reload from file', () => { hideBanner(); load().catch(fatal); }]]);
      } else {
        // The server answered but could not save (for example data/ is not writable).
        setSaveState('Not saved', 'error');
        showBanner('error', 'The server could not save your changes: ' + (data.error || `HTTP ${res.status}`) + ' Retrying every 15 seconds.',
          [['Retry now', () => { hideBanner(); save(); }]]);
        state.saveTimer = setTimeout(save, 15000);
      }
    } catch (err) {
      setSaveState('Not saved: retrying', 'error');
      toast('Could not reach the board server (' + err.message + '). Is it still running? Retrying in 5 seconds.', 'error');
      state.saveTimer = setTimeout(save, 5000);
    } finally {
      state.saving = false;
    }
  }

  async function overwriteAfterConflict() {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      const data = await res.json();
      state.etag = data.etag;
      state.conflict = false;
      hideBanner();
      save();
    } catch (err) {
      toast('Could not reach the server: ' + err.message, 'error');
    }
  }

  async function poll() {
    if (!state.board || state.saving || state.conflict || state.rev !== state.savedRev) return;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (res.status === 401) {
        setSaveState('Access link needed', 'error');
        showBanner('error', 'The board server needs its access link again. Open the link from the server output (with Docker: docker compose logs board).', []);
        return;
      }
      if (!res.ok) return;
      const { etag } = await res.json();
      if (etag && etag !== state.etag && state.rev === state.savedRev && !state.saving) {
        await load();
        toast('Board updated from file.');
      }
    } catch (_) {
      setSaveState('Server unreachable', 'error');
    }
  }

  function fatal(err) {
    showBanner('error', String(err.message || err), [['Retry', () => { hideBanner(); load().catch(fatal); }]]);
  }

  // ------------------------------------------------------------------
  // Indexes and derived data
  // ------------------------------------------------------------------

  function buildIndex() {
    const b = state.board;
    const byId = new Map(b.tickets.map((t) => [t.id, t]));
    const children = new Map();
    for (const t of b.tickets) {
      if (!t.parent) continue;
      if (!children.has(t.parent)) children.set(t.parent, []);
      children.get(t.parent).push(t);
    }
    for (const list of children.values()) list.sort((a, c) => a.order - c.order);
    state.idx = {
      byId,
      children,
      column: new Map(b.columns.map((c) => [c.id, c])),
      person: new Map(b.people.map((p) => [p.id, p])),
      label: new Map(b.labels.map((l) => [l.id, l])),
      epics: b.tickets.filter((t) => t.type === 'epic').sort((a, c) => a.order - c.order),
    };
  }

  const ticket = (id) => state.idx.byId.get(id);
  const kindOf = (t) => (state.idx.column.get(t.status) || {}).kind;

  function rootEpic(t) {
    let cur = t;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'epic') return cur;
      seen.add(cur.id);
      cur = cur.parent ? ticket(cur.parent) : null;
    }
    return null;
  }

  function descendants(t) {
    const out = [];
    const stack = [...(state.idx.children.get(t.id) || [])];
    while (stack.length) {
      const c = stack.pop();
      out.push(c);
      stack.push(...(state.idx.children.get(c.id) || []));
    }
    return out;
  }

  function progressOf(t) {
    const d = descendants(t);
    return { done: d.filter((c) => kindOf(c) === 'done').length, total: d.length };
  }

  function colourFor(t) {
    const mode = state.board.settings.colourBy;
    if (mode === 'epic') return (rootEpic(t) || {}).colour || null;
    if (mode === 'label') {
      // The ticket's label that comes first in the board's label list, so the
      // colour does not depend on the order labels were ticked.
      const l = state.board.labels.find((x) => t.labels.includes(x.id));
      return l ? l.colour : null;
    }
    return null;
  }

  function matchesFilters(t) {
    const s = state.board.settings;
    const f = state.filters;
    if (t.type === 'epic' && !s.showEpicCards) return false;
    if (t.type === 'subtask' && !s.showSubtasks) return false;
    if (f.assignee === 'none' && t.assignee) return false;
    if (f.assignee !== 'all' && f.assignee !== 'none' && t.assignee !== f.assignee) return false;
    if (f.label !== 'all' && !t.labels.includes(f.label)) return false;
    if (f.epic !== 'all') {
      const e = rootEpic(t);
      if (f.epic === 'none' ? e : !e || e.id !== f.epic) return false;
    }
    if (f.q) {
      const q = f.q.toLowerCase();
      const labelNames = t.labels.map((id) => (state.idx.label.get(id) || {}).name || '').join(' ');
      const hay = [t.id, t.title, t.description, t.blockedReason, t.waitingOn, WAITING_FOR_LABEL[t.waitingFor] || '', labelNames,
        ...t.comments.map((c) => c.body)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function nextKey() {
    const meta = state.board.board;
    const taken = state.idx.byId;
    let n = meta.nextNumber;
    while (taken.has(`${meta.keyPrefix}-${n}`)) n += 1;
    meta.nextNumber = n + 1;
    return `${meta.keyPrefix}-${n}`;
  }

  // Moves a ticket to a column: records the change in its history and clears a
  // blocked or waiting reason that no longer applies (the history keeps it).
  // Mirrors boardlib.set_status.
  function setStatus(t, colId) {
    const old = t.status;
    const oldKind = kindOf(t);
    const newKind = (state.idx.column.get(colId) || {}).kind;
    if (old !== colId) {
      const entry = { at: nowIso(), from: old, to: colId };
      if (oldKind === 'blocked' && t.blockedReason) entry.note = 'was blocked: ' + t.blockedReason;
      if (oldKind === 'waiting' && t.waitingOn) entry.note = 'was waiting on: ' + t.waitingOn;
      t.history = [...(t.history || []), entry].slice(-100);
    }
    t.status = colId;
    if (newKind !== 'blocked') t.blockedReason = '';
    if (newKind !== 'waiting') { t.waitingOn = ''; t.waitingFor = ''; }
  }

  // Epics are moved by hand; point out when one has nothing left in it.
  function epicDoneHint(t) {
    const epic = t.type === 'epic' ? null : rootEpic(t);
    if (epic && kindOf(epic) !== 'done' && descendants(epic).every((d) => kindOf(d) === 'done')) {
      return `every ticket in epic ${epic.id} ${epic.title} is now done, so you may want to move the epic to Done`;
    }
    return null;
  }

  // True if ticket `from` depends, directly or indirectly, on ticket `to`.
  function dependsOn(from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop();
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = ticket(id);
      if (t) stack.push(...t.blockedBy);
    }
    return false;
  }

  function touch(t) {
    t.updatedAt = nowIso();
  }

  // ------------------------------------------------------------------
  // Rendering: header, epic strip, board
  // ------------------------------------------------------------------

  function render() {
    buildIndex();
    const b = state.board;
    document.title = b.board.title + ' | Board';
    $('#board-title').textContent = b.board.title;
    $('#lane-mode').value = b.settings.swimlanes;
    $('#colour-mode').value = b.settings.colourBy;
    $('#show-epics').checked = b.settings.showEpicCards;
    $('#show-subtasks').checked = b.settings.showSubtasks;
    fillFilterSelects();
    renderEpicStrip();
    renderBoard();
  }

  function fillFilterSelects() {
    const a = $('#filter-assignee');
    a.replaceChildren(
      h('option', { value: 'all' }, 'Everyone'),
      h('option', { value: 'none' }, 'Unassigned'),
      ...state.board.people.map((p) => h('option', { value: p.id }, p.name)),
    );
    if (![...a.options].some((o) => o.value === state.filters.assignee)) state.filters.assignee = 'all';
    a.value = state.filters.assignee;
    const lf = $('#filter-label');
    lf.replaceChildren(
      h('option', { value: 'all' }, 'All labels'),
      ...state.board.labels.map((l) => h('option', { value: l.id }, l.name)),
    );
    if (![...lf.options].some((o) => o.value === state.filters.label)) state.filters.label = 'all';
    lf.value = state.filters.label;
    lf.closest('label').hidden = !state.board.labels.length;
    const e = $('#filter-epic');
    e.replaceChildren(
      h('option', { value: 'all' }, 'All epics'),
      h('option', { value: 'none' }, 'No epic'),
      ...state.idx.epics.map((ep) => h('option', { value: ep.id }, `${ep.id} ${ep.title}`)),
    );
    if (![...e.options].some((o) => o.value === state.filters.epic)) state.filters.epic = 'all';
    e.value = state.filters.epic;
  }

  function renderEpicStrip() {
    const strip = $('#epic-strip');
    const epics = state.idx.epics;
    strip.replaceChildren();
    if (!epics.length) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    strip.append(h('span', { class: 'strip-label' }, 'Epics'));
    for (const e of epics) {
      const p = progressOf(e);
      const col = state.idx.column.get(e.status);
      const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
      strip.append(h('button', {
        type: 'button',
        class: 'epic-chip kind-' + (col ? col.kind : ''),
        title: `${e.id} ${e.title}: ${col ? col.name : e.status}, ${p.done} of ${p.total} child tickets done`,
        onclick: () => openTicket(e.id),
      },
      h('span', { class: 'dot', style: { background: e.colour || 'var(--muted)' } }),
      h('span', { class: 'chip-title' }, e.title),
      h('span', { class: 'chip-status' }, col ? col.name : e.status),
      h('span', { class: 'mini-bar', 'aria-hidden': 'true' }, h('span', { style: { width: pct + '%', background: e.colour || 'var(--accent)' } })),
      h('span', { class: 'chip-count' }, `${p.done}/${p.total}`)));
    }
  }

  function computeLanes() {
    const b = state.board;
    const visible = b.tickets.filter(matchesFilters);
    const mode = b.settings.swimlanes;
    if (mode === 'epic') {
      const lanes = state.idx.epics.map((e) => ({ id: e.id, title: e.title, epic: e, tickets: [] }));
      const none = { id: '__none', title: 'No epic', tickets: [] };
      const byId = new Map(lanes.map((l) => [l.id, l]));
      for (const t of visible) {
        const e = t.type === 'epic' ? t : rootEpic(t);
        (e ? byId.get(e.id) : none).tickets.push(t);
      }
      const all = [...lanes, none];
      if (state.filters.epic !== 'all') return all.filter((l) => l.id === state.filters.epic || (state.filters.epic === 'none' && l.id === '__none'));
      return none.tickets.length || !lanes.length ? all : lanes;
    }
    if (mode === 'assignee') {
      const lanes = b.people.map((p) => ({ id: p.id, title: p.name, person: p, tickets: [] }));
      const none = { id: '__unassigned', title: 'Unassigned', tickets: [] };
      const byId = new Map(lanes.map((l) => [l.id, l]));
      for (const t of visible) (byId.get(t.assignee) || none).tickets.push(t);
      return [...lanes, none];
    }
    return [{ id: '__all', title: '', tickets: visible }];
  }

  function renderBoard() {
    const main = $('#board');
    const cols = state.board.columns;
    main.style.setProperty('--cols', cols.length);
    const lanes = computeLanes();
    const showLaneHeaders = state.board.settings.swimlanes !== 'none';

    const headerRow = h('div', { class: 'col-headers', 'aria-hidden': 'true' }, cols.map((c) => {
      const count = state.board.tickets.filter((t) => t.status === c.id && t.type !== 'epic').length;
      const over = c.wipLimit && count > c.wipLimit;
      return h('div', { class: `col-header kind-${c.kind}${over ? ' over-wip' : ''}` },
        h('span', { class: 'col-name' }, c.name),
        h('span', { class: 'col-count', title: c.wipLimit ? `Work-in-progress limit ${c.wipLimit}` : 'Tickets in this column' },
          c.wipLimit ? `${count} / ${c.wipLimit}` : String(count)));
    }));
    const frag = [headerRow];

    for (const lane of lanes) {
      const collapsed = showLaneHeaders && state.collapsed[lane.id];
      const laneEl = h('section', { class: 'lane' + (collapsed ? ' collapsed' : ''), 'aria-label': lane.title || 'All tickets' });
      if (showLaneHeaders) laneEl.append(laneHeader(lane, collapsed));
      if (!collapsed) {
        const row = h('div', { class: 'lane-cells' });
        for (const c of cols) {
          const cards = lane.tickets.filter((t) => t.status === c.id).sort((a, d) => a.order - d.order);
          // Each cell is a labelled group, so a screen reader announces the
          // column (and lane) as focus moves into it. The visual column
          // headers are hidden from assistive technology to avoid repetition.
          const cell = h('div', {
            class: `cell kind-${c.kind}`,
            role: 'group',
            dataset: { col: c.id, lane: lane.id },
            'aria-label': `${c.name}${lane.title ? ', ' + lane.title : ''}, ${cards.length} card${cards.length === 1 ? '' : 's'}`,
          }, cards.map(renderCard));
          cell.addEventListener('dragover', onDragOver);
          cell.addEventListener('dragleave', (e) => { if (e.target === cell) cell.classList.remove('drop-target'); });
          cell.addEventListener('drop', onDrop);
          row.append(cell);
        }
        laneEl.append(row);
      }
      frag.push(laneEl);
    }
    main.replaceChildren(...frag);
    if (!state.board.tickets.length) {
      main.append(h('p', { class: 'empty-board' }, 'No tickets yet. Use "New ticket" to add one.'));
    }
  }

  function laneHeader(lane, collapsed) {
    const toggle = h('button', {
      type: 'button',
      class: 'lane-toggle',
      'aria-expanded': String(!collapsed),
      'aria-label': `${collapsed ? 'Expand' : 'Collapse'} lane ${lane.epic ? lane.epic.title : lane.title}`,
      title: collapsed ? 'Expand lane' : 'Collapse lane',
      onclick: () => {
        state.collapsed[lane.id] = !collapsed;
        writePref('collapsedLanes', state.collapsed);
        renderBoard();
      },
    }, collapsed ? '+' : '−');
    const header = h('div', { class: 'lane-header' }, toggle);
    if (lane.epic) {
      const e = lane.epic;
      const p = progressOf(e);
      const col = state.idx.column.get(e.status);
      const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
      header.style.setProperty('--lane-colour', e.colour || 'var(--muted)');
      header.classList.add('epic-lane');
      // Node.append() would print null as the text "null", so filter empties out.
      header.append(...[
        h('button', { type: 'button', class: 'lane-title link', onclick: () => openTicket(e.id) }, e.title, h('span', { class: 'key lane-key' }, ' ' + e.id)),
        h('span', { class: 'status-pill kind-' + (col ? col.kind : '') }, col ? col.name : e.status),
        progressBar(p, 'bar'),
        h('span', { class: 'lane-meta' }, `${p.done}/${p.total} done`),
        e.assignee ? avatar(state.idx.person.get(e.assignee)) : null,
      ].filter(Boolean));
    } else if (lane.person) {
      header.append(...[avatar(lane.person), h('span', { class: 'lane-title' }, lane.person.name),
        lane.person.role ? h('span', { class: 'lane-meta' }, lane.person.role) : null].filter(Boolean));
    } else {
      header.append(h('span', { class: 'lane-title' }, lane.title));
    }
    header.append(h('span', { class: 'lane-meta right' }, `${lane.tickets.length} shown`));
    return header;
  }

  function progressBar(p, cls) {
    const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
    return h('span', {
      class: cls, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done),
      'aria-label': `${p.done} of ${p.total} child tickets done`,
    }, h('span', { style: { width: pct + '%' } }));
  }

  function avatar(person) {
    if (!person) return null;
    return h('span', { class: 'avatar', title: person.name, style: { background: person.colour || 'var(--muted)' } }, initials(person.name));
  }

  function renderCard(t) {
    const colour = colourFor(t);
    const kind = kindOf(t);
    const parent = t.parent ? ticket(t.parent) : null;
    const epic = rootEpic(t);
    const crumbs = [];
    if (epic && epic !== t) crumbs.push(epic.title);
    if (parent && parent.type !== 'epic') crumbs.push(parent.id + ' ' + parent.title);
    const kids = state.idx.children.get(t.id) || [];
    const p = kids.length ? progressOf(t) : null;
    const overdue = t.due && kind !== 'done' && t.due < todayYmd();
    const openBlockers = t.blockedBy.map(ticket).filter((d) => d && kindOf(d) !== 'done');

    const card = h('article', {
      class: `card type-${t.type} kind-${kind}${colour ? ' coloured' : ''}`,
      draggable: 'true',
      tabindex: '0',
      dataset: { id: t.id },
      style: colour ? { '--card-colour': colour } : null,
      'aria-label': `${TYPE_LABEL[t.type]} ${t.id}: ${t.title}. ${(state.idx.column.get(t.status) || {}).name || ''}`
        + `${kind === 'blocked' ? ', blocked: ' + (t.blockedReason || 'no reason given') : ''}`
        + `${kind === 'waiting' ? ', waiting on ' + (t.waitingOn || 'not recorded') : ''}`
        + `. ${t.assignee && state.idx.person.get(t.assignee) ? 'Assigned to ' + state.idx.person.get(t.assignee).name : 'Unassigned'}.`,
      'aria-keyshortcuts': 'Enter Alt+ArrowLeft Alt+ArrowRight',
      title: 'Click or press Enter to open. Drag, or press Alt+Left or Alt+Right, to move.',
    },
    h('div', { class: 'card-top' },
      h('span', { class: 'key' }, t.id),
      h('span', { class: 'type-badge type-' + t.type }, TYPE_LABEL[t.type]),
      t.priority !== 'medium' ? h('span', { class: 'prio prio-' + t.priority }, PRIORITY_LABEL[t.priority]) : null),
    crumbs.length ? h('div', { class: 'crumb', title: crumbs.join(' › ') }, crumbs.join(' › ')) : null,
    h('h3', { class: 'card-title' }, t.title),
    kind === 'blocked' ? h('div', { class: 'flag flag-blocked' }, 'Blocked: ', t.blockedReason || 'no reason given') : null,
    kind === 'waiting' ? h('div', { class: 'flag flag-waiting' },
      t.waitingFor ? h('span', { class: 'party' }, WAITING_FOR_LABEL[t.waitingFor] || t.waitingFor) : null,
      'Waiting on: ', t.waitingOn || 'not recorded') : null,
    openBlockers.length && kind !== 'blocked' ? h('div', { class: 'flag flag-dep' }, 'Depends on ', openBlockers.map((d) => d.id).join(', ')) : null,
    t.labels.length ? h('div', { class: 'card-labels' }, t.labels.map((id) => {
      const l = state.idx.label.get(id);
      return l ? h('span', { class: 'label', style: { '--label-colour': l.colour || 'var(--muted)' } }, l.name) : null;
    })) : null,
    p && t.type === 'epic' ? progressBar(p, 'bar') : null,
    h('div', { class: 'card-foot' },
      t.due ? h('span', { class: 'due' + (overdue ? ' overdue' : ''), title: overdue ? 'Overdue' : 'Due date' }, (overdue ? 'Overdue ' : 'Due ') + fmtDue(t.due)) : null,
      p ? h('span', { class: 'progress', title: 'Child tickets done' }, `${p.done}/${p.total} done`) : null,
      t.comments.length ? h('span', { class: 'comments', title: 'Comments' }, `${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}`) : null,
      h('span', { class: 'spacer' }),
      t.assignee ? avatar(state.idx.person.get(t.assignee)) : h('span', { class: 'avatar unassigned', title: 'Unassigned' }, '?')));

    card.addEventListener('click', () => openTicket(t.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTicket(t.id); }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const cols = state.board.columns;
        const i = cols.findIndex((c) => c.id === t.status);
        const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
        if (j >= 0 && j < cols.length) {
          moveTicket(t.id, cols[j].id, null, null);
          // Announce the move (the toast is a live region) unless a reason prompt took over.
          if (!$('#prompt-dialog').open) toast(`${t.id} moved to ${cols[j].name}.`);
          focusCard(t.id);
        }
      }
    });
    card.addEventListener('dragstart', (e) => {
      state.dragId = t.id;
      e.dataTransfer.setData('text/plain', t.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      state.dragId = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });
    return card;
  }

  // ------------------------------------------------------------------
  // Drag and drop, moves
  // ------------------------------------------------------------------

  function onDragOver(e) {
    if (!state.dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drop-target');
  }

  function onDrop(e) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drop-target');
    const id = state.dragId || e.dataTransfer.getData('text/plain');
    if (!id || !ticket(id)) return;
    const siblings = [...cell.querySelectorAll('.card')].filter((c) => c.dataset.id !== id);
    let before = null;
    for (const el of siblings) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = el.dataset.id; break; }
    }
    moveTicket(id, cell.dataset.col, before, cell.dataset.lane);
  }

  // Moves a ticket to a column, optionally before another ticket and into a lane.
  function moveTicket(id, colId, beforeId, laneId) {
    const t = ticket(id);
    const col = state.idx.column.get(colId);
    if (!t || !col) return;
    const statusChanged = t.status !== colId;
    const notes = [];

    // Lane semantics: assignee lanes reassign; epic lanes re-parent tasks only.
    const mode = state.board.settings.swimlanes;
    if (laneId && mode === 'assignee') {
      const newAssignee = laneId === '__unassigned' ? null : laneId;
      if (newAssignee !== t.assignee) {
        t.assignee = newAssignee;
        notes.push(newAssignee ? `assigned to ${state.idx.person.get(newAssignee).name}` : 'unassigned');
      }
    } else if (laneId && mode === 'epic') {
      const current = t.type === 'epic' ? t.id : (rootEpic(t) || {}).id || '__none';
      if (laneId !== current) {
        if (t.type === 'task') {
          t.parent = laneId === '__none' ? null : laneId;
          notes.push(t.parent ? `moved to epic ${ticket(t.parent).title}` : 'removed from its epic');
        } else {
          toast(t.type === 'epic'
            ? 'Epics stay in their own lane; only the status changed.'
            : 'A sub-task follows its parent task; open the parent to move it to another epic. Only the status changed.');
        }
      }
    }

    // Order: place before beforeId, or at the end of the column.
    const inCol = state.board.tickets.filter((x) => x.status === colId && x.id !== id).sort((a, b) => a.order - b.order);
    setStatus(t, colId);
    const pos = beforeId ? inCol.findIndex((x) => x.id === beforeId) : -1;
    inCol.splice(pos < 0 ? inCol.length : pos, 0, t);
    inCol.forEach((x, i) => { x.order = (i + 1) * 10; });
    touch(t);
    changed();

    if (statusChanged) {
      if (col.kind === 'done') {
        const open = descendants(t).filter((d) => kindOf(d) !== 'done');
        if (open.length) notes.push(`${open.length} child ticket${open.length === 1 ? ' is' : 's are'} not done yet`);
        const hint = epicDoneHint(t);
        if (hint) notes.push(hint);
      }
      if (col.kind === 'blocked') return askReason(t, 'blockedReason', 'What is blocking this ticket?', notes);
      if (col.kind === 'waiting') return askReason(t, 'waitingOn', 'Who or what is this waiting on?', notes);
    }
    if (notes.length) toast(`${t.id}: ${notes.join('; ')}.`);
  }

  function partySelect(value) {
    return h('select', { 'aria-label': 'Waiting for' },
      h('option', { value: '' }, 'Waiting for (optional)'),
      ...Object.entries(WAITING_FOR_LABEL).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  }

  function focusCard(id) {
    requestAnimationFrame(() => { const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`); if (el) el.focus(); });
  }

  function askReason(t, field, question, notes) {
    const dlg = $('#prompt-dialog');
    const input = h('textarea', { rows: '3', value: t[field] || '', 'aria-label': question });
    const party = field === 'waitingOn' ? partySelect(t.waitingFor) : null;
    const finish = (saveIt) => {
      if (saveIt) {
        const live = ticket(t.id) || t;
        live[field] = input.value.trim();
        if (party) live.waitingFor = party.value;
        touch(live);
        changed();
      }
      dlg.close();
      toast(`${t.id} moved to ${(state.idx.column.get(t.status) || {}).name || t.status}${notes.length ? '; ' + notes.join('; ') : ''}.`);
      focusCard(t.id); // the card was re-rendered, so focus would otherwise fall back to the page
    };
    dlg.setAttribute('aria-label', `${t.id}: ${question}`);
    dlg.oncancel = (e) => { e.preventDefault(); finish(false); };
    dlg.replaceChildren(h('form', { method: 'dialog', class: 'prompt-form', onsubmit: (e) => { e.preventDefault(); finish(true); } },
      h('h2', null, `${t.id}: ${question}`),
      party,
      input,
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', onclick: () => finish(false) }, 'Skip'),
        h('button', { type: 'submit', class: 'primary' }, 'Save'))));
    dlg.showModal();
    input.focus();
    input.select();
  }

  // ------------------------------------------------------------------
  // Markdown: rendered by static/markdown.js (shared with the smoke test).
  // ------------------------------------------------------------------

  const { renderMarkdown } = window.KanbanMarkdown;

  function renderMarkdownInto(el, src) {
    // renderMarkdown escapes all input and only re-introduces a fixed set of tags;
    // the page's Content Security Policy also forbids inline script as a second line of defence.
    el.innerHTML = renderMarkdown(src);
    const blocks = el.querySelectorAll('.mermaid-block');
    if (blocks.length) renderMermaid(blocks);
  }

  let mermaidPromise = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidPromise) {
      mermaidPromise = new Promise((resolve, reject) => {
        const attempt = (src, next, integrity) => {
          const s = document.createElement('script');
          s.src = src;
          if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
          s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('Mermaid did not initialise')));
          s.onerror = () => { s.remove(); if (next) next(); else reject(new Error('Mermaid could not be loaded (offline?)')); };
          document.head.append(s);
        };
        fetch('/api/health', { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({}))
          .then((health) => (health.mermaidVendored
            ? attempt('/static/vendor/mermaid.min.js', () => attempt(MERMAID_CDN, null, MERMAID_SRI))
            : attempt(MERMAID_CDN, null, MERMAID_SRI)));
      }).then((m) => {
        const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
        return m;
      }).catch((err) => { mermaidPromise = null; throw err; });
    }
    return mermaidPromise;
  }

  async function renderMermaid(blocks) {
    let mermaid;
    try {
      mermaid = await loadMermaid();
    } catch (err) {
      blocks.forEach((b) => b.prepend(h('p', { class: 'diagram-note' }, 'Diagram not rendered: ' + err.message + '. The source is shown instead.')));
      return;
    }
    for (const block of blocks) {
      const src = block.querySelector('.mermaid-src').textContent;
      try {
        const { svg } = await mermaid.render(randomId('mmd-'), src);
        const holder = h('div', { class: 'mermaid-svg' });
        holder.innerHTML = svg; // produced by Mermaid with securityLevel 'strict'
        block.replaceChildren(holder);
      } catch (err) {
        block.prepend(h('p', { class: 'diagram-note' }, 'Diagram has an error: ' + String(err.message || err).split('\n')[0]));
        document.querySelectorAll('body > [id^="dmmd-"]').forEach((n) => n.remove());
      }
    }
  }

  // ------------------------------------------------------------------
  // Markdown editor with image paste/upload and diagram insertion
  // ------------------------------------------------------------------

  async function uploadImage(file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Only PNG, JPEG, GIF, and WebP images can be attached.');
    if (file.size > MAX_UPLOAD) throw new Error('Images must be 10 MB or smaller.');
    const res = await fetch('/api/uploads', { method: 'POST', headers: { ...CLIENT_HEADERS, 'Content-Type': file.type }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
    return data.path;
  }

  // Ticket-writing templates (references/ticket-writing.md in the skill).
  const STORY_TEMPLATES = {
    user: '**As a** <type of user>, **I want** <some goal> **so that** <some reason>.',
    behaviour: '**Given** <pre-condition>, **When** <action>, **Then** <result or outcome>.',
    job: '**When** <situation>, **I want to** <motivation>, **so I can** <expected outcome>.',
  };
  const TEMPLATE_TAIL = '\n\n### Technical notes\n- \n\n### Acceptance criteria\n- [ ] \n';

  function makeEditor({ value = '', placeholder = '', rows = 5, label = 'Text', onInput = null, startInPreview = false, templates = false }) {
    const ta = h('textarea', { rows: String(rows), placeholder, value, 'aria-label': label });
    const preview = h('div', { class: 'md preview', hidden: true });
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true, multiple: true });
    const status = h('span', { class: 'editor-status', 'aria-live': 'polite' });

    const insert = (text) => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = ta.value.slice(0, start);
      const pad = before && !before.endsWith('\n') && text.startsWith('```') ? '\n' : '';
      ta.setRangeText(pad + text, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    };
    const addFiles = async (files) => {
      for (const f of files) {
        status.textContent = `Uploading ${f.name || 'image'}`;
        try {
          const path = await uploadImage(f);
          insert(`![${(f.name || 'image').replace(/[\[\]]/g, '')}](${path})\n`);
          status.textContent = '';
        } catch (err) {
          status.textContent = '';
          toast(err.message, 'error');
        }
      }
    };
    fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    ta.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    ta.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    if (onInput) ta.addEventListener('input', onInput);

    const writeBtn = h('button', { type: 'button', class: 'tab active', 'aria-pressed': 'true' }, 'Write');
    const previewBtn = h('button', { type: 'button', class: 'tab', 'aria-pressed': 'false' }, 'Preview');
    const showPreview = (on) => {
      preview.hidden = !on;
      ta.hidden = on;
      writeBtn.classList.toggle('active', !on);
      previewBtn.classList.toggle('active', on);
      writeBtn.setAttribute('aria-pressed', String(!on));
      previewBtn.setAttribute('aria-pressed', String(on));
      if (on) renderMarkdownInto(preview, ta.value || '*Nothing to preview.*');
    };
    writeBtn.addEventListener('click', () => showPreview(false));
    previewBtn.addEventListener('click', () => showPreview(true));
    // Clicking rendered text (but not a link or image) switches back to editing.
    preview.addEventListener('click', (e) => { if (!e.target.closest('a, img, svg')) { showPreview(false); ta.focus(); } });
    if (startInPreview && value) showPreview(true);

    const el = h('div', { class: 'editor' },
      h('div', { class: 'editor-toolbar' },
        writeBtn, previewBtn,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', onclick: () => { showPreview(false); fileInput.click(); }, title: 'Attach an image (you can also paste or drop one into the text box)' }, 'Add image'),
        h('button', { type: 'button', onclick: () => { showPreview(false); insert(DIAGRAM_TEMPLATE); }, title: 'Insert a Mermaid diagram template' }, 'Add diagram'),
        templates ? h('select', {
          'aria-label': 'Insert a story template',
          title: 'Every ticket starts with a story, then technical notes, then acceptance criteria',
          onchange: (e) => {
            const kind = e.target.value;
            e.target.value = '';
            if (!kind) return;
            showPreview(false);
            // At the start of an empty description, the whole skeleton; otherwise just the story line.
            insert(ta.value.trim() ? STORY_TEMPLATES[kind] + '\n' : STORY_TEMPLATES[kind] + TEMPLATE_TAIL);
          },
        }, h('option', { value: '' }, 'Insert template'),
        h('option', { value: 'user' }, 'User story'),
        h('option', { value: 'behaviour' }, 'Behaviour (Given, When, Then)'),
        h('option', { value: 'job' }, 'Job story')) : null),
      ta, preview, fileInput, status,
      h('div', { class: 'editor-hint' }, 'Markdown supported. Paste or drop images. Diagrams use ```mermaid blocks.'));
    return { el, textarea: ta, get value() { return ta.value; }, set value(v) { ta.value = v; }, focus: () => ta.focus(), showPreview };
  }

  // ------------------------------------------------------------------
  // Ticket dialog
  // ------------------------------------------------------------------

  // openTicket(id) edits an existing ticket; openTicket(null, defaults) creates one.
  function openTicket(id, defaults = {}) {
    const dlg = $('#ticket-dialog');
    const existing = id ? ticket(id) : null;
    if (id && !existing) { toast(`Ticket ${id} no longer exists.`, 'error'); return; }
    const isNew = !existing;
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      type: defaults.type || 'task',
      title: '',
      description: '',
      parent: defaults.parent || null,
      status: defaults.status || state.board.columns[0].id,
      assignee: defaults.assignee || null,
      priority: 'medium',
      labels: [],
      colour: null,
      due: null,
      blockedReason: '',
      waitingOn: '',
      waitingFor: '',
      blockedBy: [],
      comments: [],
    };
    let dirty = false;
    const markDirty = () => { dirty = true; };
    const original = JSON.parse(JSON.stringify(draft));
    const hasChildren = existing && (state.idx.children.get(existing.id) || []).length > 0;

    const titleInput = h('input', { type: 'text', value: draft.title, required: true, maxlength: '300', class: 'title-input', 'aria-label': 'Title', placeholder: 'Ticket title', oninput: markDirty });
    const desc = makeEditor({ value: draft.description, rows: 8, label: 'Description', placeholder: 'Start with the story (As a ... I want ... so that ...), then technical notes, then acceptance criteria. Use Insert template.', onInput: markDirty, startInPreview: !isNew, templates: true });

    const typeSel = h('select', { 'aria-label': 'Type', disabled: hasChildren, title: hasChildren ? 'A ticket with children cannot change type.' : null },
      ...Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v, selected: v === draft.type }, l)));
    const parentSel = h('select', { 'aria-label': 'Parent' });
    const statusSel = h('select', { 'aria-label': 'Status' },
      ...state.board.columns.map((c) => h('option', { value: c.id, selected: c.id === draft.status }, c.name)));
    const assigneeSel = h('select', { 'aria-label': 'Assignee' },
      h('option', { value: '' }, 'Unassigned'),
      ...state.board.people.map((p) => h('option', { value: p.id, selected: p.id === draft.assignee }, p.name)));
    const prioSel = h('select', { 'aria-label': 'Priority' },
      ...Object.entries(PRIORITY_LABEL).map(([v, l]) => h('option', { value: v, selected: v === draft.priority }, l)));
    const dueInput = h('input', { type: 'date', value: draft.due || '', min: '2000-01-01', max: '2999-12-31', 'aria-label': 'Due date' });
    const EPIC_COLOURS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0d9488', '#ea580c', '#4f46e5', '#1e3a8a', '#92400e', '#065f46', '#9d174d', '#4c1d95', '#155e75', '#7f1d1d', '#3f6212', '#701a75', '#134e4a', '#9a3412', '#312e81'];
    const colourInput = h('input', { type: 'color', value: draft.colour || EPIC_COLOURS[state.idx.epics.length % EPIC_COLOURS.length], 'aria-label': 'Epic colour' });
    const blockedInput = h('textarea', { rows: '2', value: draft.blockedReason, 'aria-label': 'Blocked reason', placeholder: 'What is blocking it, and who can unblock it?' });
    const waitingInput = h('textarea', { rows: '2', value: draft.waitingOn, 'aria-label': 'Waiting on', placeholder: 'Who or what it is waiting on (stakeholder feedback, a supplier, another ticket).' });
    const partyInput = partySelect(draft.waitingFor || '');
    const labelBoxes = state.board.labels.map((l) => h('label', { class: 'label-check', style: { '--label-colour': l.colour || 'var(--muted)' } },
      h('input', { type: 'checkbox', value: l.id, checked: draft.labels.includes(l.id) }), l.name));
    const depsList = h('div', { class: 'deps' });
    const depInput = h('input', { type: 'text', list: 'dep-options', placeholder: 'Add a ticket key, e.g. ' + state.board.board.keyPrefix + '-3', 'aria-label': 'Add dependency' });
    const depOptions = h('datalist', { id: 'dep-options' },
      ...state.board.tickets.filter((x) => x.id !== draft.id).map((x) => h('option', { value: x.id }, `${x.id} ${x.title}`)));

    const renderDeps = () => {
      depsList.replaceChildren(...draft.blockedBy.map((dep) => {
        const d = ticket(dep);
        return h('span', { class: 'dep-chip' + (d && kindOf(d) === 'done' ? ' done' : '') },
          h('button', { type: 'button', class: 'link', onclick: () => tryOpen(dep) }, dep),
          d ? ' ' + d.title : ' (deleted)',
          h('button', { type: 'button', class: 'x', 'aria-label': `Remove dependency ${dep}`, onclick: () => { draft.blockedBy = draft.blockedBy.filter((x) => x !== dep); markDirty(); renderDeps(); } }, '×'));
      }));
    };
    const addDep = () => {
      const v = depInput.value.trim().split(/\s+/)[0].toUpperCase();
      if (!v) return;
      if (!ticket(v)) { toast(`No ticket ${v}.`, 'error'); return; }
      if (v === draft.id) { toast('A ticket cannot depend on itself.', 'error'); return; }
      if (draft.id && dependsOn(v, draft.id)) { toast(`${v} already depends on ${draft.id}, so this would create a loop.`, 'error'); return; }
      if (!draft.blockedBy.includes(v)) draft.blockedBy.push(v);
      depInput.value = '';
      markDirty();
      renderDeps();
    };
    depInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDep(); } });
    depInput.addEventListener('change', addDep);
    renderDeps();

    const reasonRows = {
      blocked: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Blocked because'), blockedInput),
      waiting: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Waiting on'), partyInput, waitingInput),
    };
    const colourRow = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Epic colour'), colourInput);

    const fillParents = () => {
      const type = typeSel.value;
      const options = type === 'task' ? state.idx.epics : type === 'subtask' ? state.board.tickets.filter((x) => x.type === 'task') : [];
      parentSel.replaceChildren(...[
        // A sub-task must name its parent deliberately, so the blank choice comes first.
        h('option', { value: '' }, type === 'epic' ? 'Epics have no parent' : type === 'subtask' ? 'Choose a parent task' : 'No epic'),
        ...options.filter((o) => o.id !== draft.id).map((o) => h('option', { value: o.id, selected: o.id === draft.parent }, `${o.id} ${o.title}`)),
      ].filter(Boolean));
      parentSel.disabled = type === 'epic';
      if (type === 'subtask' && !options.length) {
        parentSel.replaceChildren(h('option', { value: '' }, 'Create a task first'));
      }
    };
    const syncVisibility = () => {
      const kind = (state.idx.column.get(statusSel.value) || {}).kind;
      reasonRows.blocked.hidden = kind !== 'blocked';
      reasonRows.waiting.hidden = kind !== 'waiting';
      colourRow.hidden = typeSel.value !== 'epic';
    };
    typeSel.addEventListener('change', () => { fillParents(); syncVisibility(); markDirty(); });
    statusSel.addEventListener('change', () => { syncVisibility(); markDirty(); });
    for (const el of [parentSel, assigneeSel, prioSel, dueInput, colourInput, blockedInput, waitingInput, partyInput]) el.addEventListener('input', markDirty);
    labelBoxes.forEach((l) => l.addEventListener('change', markDirty));
    fillParents();
    syncVisibility();

    // Children list (existing tickets only)
    let childrenSection = null;
    if (existing && existing.type !== 'subtask') {
      const kids = state.idx.children.get(existing.id) || [];
      const childType = existing.type === 'epic' ? 'task' : 'subtask';
      childrenSection = h('section', { class: 'children' },
        h('h3', null, existing.type === 'epic' ? 'Tasks in this epic' : 'Sub-tasks'),
        kids.length ? h('ul', { class: 'child-list' }, kids.map((k) => {
          const col = state.idx.column.get(k.status);
          return h('li', null,
            h('button', { type: 'button', class: 'link', onclick: () => tryOpen(k.id) }, k.id),
            ' ', k.title, ' ',
            h('span', { class: 'status-pill kind-' + (col ? col.kind : '') }, col ? col.name : k.status),
            k.assignee ? avatar(state.idx.person.get(k.assignee)) : null);
        })) : h('p', { class: 'muted' }, 'None yet.'),
        h('button', { type: 'button', onclick: () => tryOpen(null, { type: childType, parent: existing.id, status: state.board.columns[0].id }) },
          childType === 'task' ? 'Add task' : 'Add sub-task'));
    }

    // Comments (existing tickets only; they save immediately)
    let commentsSection = null;
    // Comments open for editing, kept across re-renders so adding another
    // comment does not throw an edit in progress away.
    const editing = new Map();
    let composer = null;
    let postComment = () => false;
    if (existing) {
      const list = h('div', { class: 'comment-list' });
      const renderComments = () => {
        const t = ticket(existing.id);
        if (!t) return;
        list.replaceChildren(...(t.comments.length
          ? t.comments.map((c) => editing.get(c.id) || renderComment(t, c, renderComments, editing))
          : [h('p', { class: 'muted' }, 'No comments yet.')]));
      };
      composer = makeEditor({ rows: 3, label: 'New comment', placeholder: 'Add a comment, a screenshot, or a diagram.' });
      postComment = () => {
        const body = composer.value.trim();
        if (!body) return false;
        const t = ticket(existing.id);
        if (!t) { toast('This ticket was deleted elsewhere.', 'error'); return false; }
        const ts = nowIso();
        t.comments.push({ id: randomId('c-'), body, createdAt: ts, updatedAt: ts });
        touch(t);
        composer.value = '';
        composer.showPreview(false);
        changed();
        renderComments();
        return true;
      };
      const addBtn = h('button', { type: 'button', class: 'primary', onclick: () => postComment() }, 'Add comment');
      commentsSection = h('section', { class: 'comments-section' }, h('h3', null, 'Comments'), list, composer.el, h('div', { class: 'dialog-actions left' }, addBtn));
      renderComments();
    }

    // Text typed into the comment box (or an open comment edit) counts as unsaved work.
    const unposted = () => (composer && composer.value.trim()) || editing.size > 0;

    const save = () => {
      const title = titleInput.value.trim();
      if (!title) { toast('A title is required.', 'error'); titleInput.focus(); return; }
      // The date picker accepts years beyond 9999, which the board file cannot hold.
      if (dueInput.value && !/^\d{4}-\d{2}-\d{2}$/.test(dueInput.value)) {
        toast('Enter a due date between the years 1000 and 9999.', 'error'); dueInput.focus(); return;
      }
      const type = typeSel.value;
      const parent = parentSel.disabled ? null : (parentSel.value || null);
      const newKind = (state.idx.column.get(statusSel.value) || {}).kind;
      if (newKind === 'blocked' && !blockedInput.value.trim()
        && !confirm('Save as blocked without saying why? The card will show "no reason given".')) { blockedInput.focus(); return; }
      if (newKind === 'waiting' && !waitingInput.value.trim()
        && !confirm('Save as waiting without saying who or what it waits on?')) { waitingInput.focus(); return; }
      if (type === 'subtask' && !parent) { toast('A sub-task needs a parent task.', 'error'); parentSel.focus(); return; }
      const target = isNew ? null : ticket(existing.id);
      if (!isNew && !target) { toast('This ticket was deleted elsewhere; your edits were not saved.', 'error'); return; }
      const t = target || { id: nextKey(), createdAt: nowIso(), comments: [], history: [], links: [], order: 0 };
      if (isNew) {
        const inCol = state.board.tickets.filter((x) => x.status === statusSel.value);
        t.order = (inCol.reduce((m, x) => Math.max(m, x.order), 0) || 0) + 10;
      }
      const values = {
        type,
        title,
        description: desc.value,
        parent: type === 'epic' ? null : parent,
        status: statusSel.value,
        assignee: assigneeSel.value || null,
        priority: prioSel.value,
        labels: labelBoxes.map((l) => l.querySelector('input')).filter((cb) => cb.checked).map((cb) => cb.value),
        colour: type === 'epic' ? colourInput.value : null,
        due: dueInput.value || null,
        blockedReason: blockedInput.value.trim(),
        waitingOn: waitingInput.value.trim(),
        waitingFor: partyInput.value,
        blockedBy: draft.blockedBy.filter((x) => x !== t.id && ticket(x)),
      };
      // Write back only the fields changed in this dialog, so a change made
      // elsewhere while it was open (for example by Claude) is not reverted.
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      let changedAny = isNew;
      const statusChanged = !isNew && values.status !== original.status;
      if (statusChanged) { setStatus(t, values.status); changedAny = true; }
      if (isNew) t.history = [];
      for (const [key, value] of Object.entries(values)) {
        if (key === 'status' && statusChanged) continue;
        // A reason for a state the ticket is no longer in has just been cleared.
        if (key === 'blockedReason' && newKind !== 'blocked') continue;
        if ((key === 'waitingOn' || key === 'waitingFor') && newKind !== 'waiting') continue;
        if (isNew || !same(value, original[key])) {
          t[key] = value;
          changedAny = true;
        }
      }
      if (statusChanged && newKind === 'blocked') t.blockedReason = values.blockedReason;
      if (statusChanged && newKind === 'waiting') { t.waitingOn = values.waitingOn; t.waitingFor = values.waitingFor; }
      // "Save changes" also posts a comment typed but not yet added.
      const posted = postComment();
      if (editing.size && !confirm('A comment you are editing has not been saved. Close and discard that edit?')) return;
      if (!changedAny) { dirty = false; dlg.close(); if (posted) toast(`Comment added to ${t.id}.`); return; }
      t.updatedAt = nowIso();
      if (isNew) state.board.tickets.push(t);
      dirty = false;
      changed();
      dlg.close();
      const hint = newKind === 'done' ? epicDoneHint(t) : null;
      toast((isNew ? `Created ${t.id}.` : `Saved ${t.id}.`) + (hint ? ` Note: ${hint}.` : ''));
    };

    const remove = () => {
      const t = ticket(existing.id);
      if (!t) return;
      const doomed = [t, ...descendants(t)];
      const msg = doomed.length > 1
        ? `Delete ${t.id} and its ${doomed.length - 1} child ticket${doomed.length > 2 ? 's' : ''}? A copy of the board from just before this delete is kept in data/backups.`
        : `Delete ${t.id}? A copy of the board from just before this delete is kept in data/backups.`;
      if (!confirm(msg)) return;
      const ids = new Set(doomed.map((d) => d.id));
      state.board.tickets = state.board.tickets.filter((x) => !ids.has(x.id));
      for (const x of state.board.tickets) {
        if (x.blockedBy.some((d) => ids.has(d))) x.blockedBy = x.blockedBy.filter((d) => !ids.has(d));
      }
      dirty = false;
      state.backupLabel = 'before-delete';
      changed();
      dlg.close();
      toast(`Deleted ${[...ids].join(', ')}.`);
    };

    const tryClose = () => {
      if ((dirty || unposted()) && !confirm('Discard your unsaved changes to this ticket, including any comment not yet added?')) return;
      dirty = false;
      dlg.close();
    };
    // Navigating to another ticket from inside this one.
    function tryOpen(nextId, nextDefaults) {
      if ((dirty || unposted()) && !confirm('Discard your unsaved changes to this ticket, including any comment not yet added?')) return;
      dirty = false;
      dlg.close();
      openTicket(nextId, nextDefaults);
    }

    const field = (label, control) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
    const colName = (id) => (state.idx.column.get(id) || {}).name || id;
    // Links to commits, pull requests, and branches are added by the audit tooling.
    const LINK_LABEL = { commit: 'Commit', pr: 'Pull request', branch: 'Branch', url: 'Link' };
    const linksField = existing && (existing.links || []).length ? h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Links'),
      h('ul', { class: 'links' }, existing.links.map((l) => h('li', null,
        h('span', { class: 'muted' }, (LINK_LABEL[l.type] || 'Link') + ': '),
        /^https?:\/\//i.test(l.url || '')
          ? h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title || l.ref || l.url)
          : (l.title || l.ref),
        l.repo ? h('span', { class: 'muted' }, ` (${l.repo})`) : null)))) : null;
    const meta = existing
      ? h('div', null,
        h('p', { class: 'meta' }, `Created ${fmtDateTime(existing.createdAt)}. Last updated ${fmtDateTime(existing.updatedAt)}.`),
        existing.history.length ? h('details', { class: 'history' },
          h('summary', null, `Status history (${existing.history.length})`),
          h('ul', null, [...existing.history].reverse().map((e) => h('li', null,
            h('time', { datetime: e.at }, fmtDateTime(e.at)), ` ${colName(e.from)} \u2192 ${colName(e.to)}`,
            e.by ? h('span', { class: 'muted' }, ` by ${e.by}`) : null,
            e.note ? h('span', { class: 'muted' }, ` (${e.note})`) : null)))) : null)
      : null;

    dlg.replaceChildren(h('form', { class: 'ticket-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('header', { class: 'dialog-head' },
        h('span', { class: 'key' }, existing ? existing.id : 'New ticket'),
        existing && existing.type === 'epic' ? h('span', { class: 'dot', style: { background: existing.colour || 'var(--muted)' } }) : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', onclick: tryClose }, '×')),
      h('div', { class: 'dialog-body' },
        h('div', { class: 'main-col' },
          titleInput,
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), desc.el),
          childrenSection,
          commentsSection),
        h('aside', { class: 'side-col' },
          field('Status', statusSel),
          reasonRows.blocked,
          reasonRows.waiting,
          field('Type', typeSel),
          field('Parent', parentSel),
          field('Assignee', assigneeSel),
          field('Priority', prioSel),
          field('Due date', dueInput),
          colourRow,
          labelBoxes.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Labels'), h('div', { class: 'label-boxes' }, labelBoxes)) : null,
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Depends on'), depsList, depInput, depOptions),
          linksField,
          meta)),
      h('footer', { class: 'dialog-actions' },
        existing ? h('button', { type: 'button', class: 'danger', onclick: remove }, 'Delete') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', onclick: tryClose }, 'Cancel'),
        h('button', { type: 'submit', class: 'primary' }, isNew ? 'Create ticket' : 'Save changes'))));

    dlg.oncancel = (e) => { e.preventDefault(); tryClose(); };
    dlg.setAttribute('aria-label', existing ? `Ticket ${existing.id}: ${existing.title}` : 'New ticket');
    dlg.showModal();
    if (isNew) titleInput.focus();
  }

  function renderComment(t, c, rerender, editing) {
    const body = h('div', { class: 'md comment-body' });
    renderMarkdownInto(body, c.body);
    const edited = c.updatedAt && c.updatedAt !== c.createdAt;
    const metaLine = h('div', { class: 'comment-meta' },
      h('time', { datetime: c.updatedAt || c.createdAt, title: `Added ${fmtDateTime(c.createdAt)}` },
        edited ? `Edited ${fmtDateTime(c.updatedAt)}` : `Added ${fmtDateTime(c.createdAt)}`),
      edited ? h('span', { class: 'muted' }, ` (added ${fmtDateTime(c.createdAt)})`) : null,
      c.author ? h('span', { class: 'muted' }, ` by ${c.author}`) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'link', onclick: () => startEdit() }, 'Edit'),
      h('button', { type: 'button', class: 'link danger-text', onclick: () => {
        if (!confirm('Delete this comment?')) return;
        const live = ticket(t.id);
        if (!live) { toast('This ticket was deleted elsewhere.', 'error'); return; }
        live.comments = live.comments.filter((x) => x.id !== c.id);
        touch(live);
        state.backupLabel = 'before-delete';
        changed();
        rerender();
      } }, 'Delete'));
    const article = h('article', { class: 'comment' }, metaLine, body);
    function startEdit() {
      const editor = makeEditor({ value: c.body, rows: 4, label: 'Edit comment' });
      editing.set(c.id, article);
      const done = () => { editing.delete(c.id); rerender(); };
      article.replaceChildren(editor.el, h('div', { class: 'dialog-actions left' },
        h('button', { type: 'button', class: 'primary', onclick: () => {
          const text = editor.value.trim();
          if (!text) { toast('A comment cannot be empty; use Delete instead.', 'error'); return; }
          // Re-resolve: the board may have been reloaded from disk while editing.
          const live = ticket(t.id);
          const liveComment = live && live.comments.find((x) => x.id === c.id);
          if (!liveComment) { toast('This comment was removed elsewhere; your edit was not saved.', 'error'); done(); return; }
          if (text !== liveComment.body) {
            liveComment.body = text;
            liveComment.updatedAt = nowIso();
            touch(live);
            changed();
          }
          done();
        } }, 'Save comment'),
        h('button', { type: 'button', onclick: done }, 'Cancel')));
      editor.focus();
    }
    return article;
  }

  // ------------------------------------------------------------------
  // Settings dialog: title, people, labels, columns, export
  // ------------------------------------------------------------------

  function openSettings() {
    const dlg = $('#settings-dialog');
    // Handlers look everything up when they run, so a reload from disk while
    // the dialog is open cannot make them edit a stale copy.
    const B = () => state.board;
    const gone = () => toast('That item was changed elsewhere; reopen Board settings.', 'error');
    const body = h('div', { class: 'settings-body' });

    const rerender = () => { dlg.close(); openSettings(); };

    const titleInput = h('input', { type: 'text', value: B().board.title, 'aria-label': 'Board title' });
    titleInput.addEventListener('change', () => {
      const v = titleInput.value.trim();
      if (v) { B().board.title = v; changed(); }
    });
    const descInput = h('textarea', { rows: '2', value: B().board.description || '', 'aria-label': 'Board description' });
    descInput.addEventListener('change', () => { B().board.description = descInput.value; changed(); });

    // People
    const peopleRows = B().people.map((p) => {
      const count = B().tickets.filter((t) => t.assignee === p.id).length;
      const name = h('input', { type: 'text', value: p.name, 'aria-label': 'Name' });
      const role = h('input', { type: 'text', value: p.role || '', placeholder: 'Role', 'aria-label': 'Role' });
      const colour = h('input', { type: 'color', value: p.colour || '#6b7280', 'aria-label': 'Colour' });
      const P = () => B().people.find((x) => x.id === p.id);
      name.addEventListener('change', () => {
        const lp = P();
        if (!lp) return gone();
        const v = name.value.trim();
        if (!v) return;
        if (B().people.some((x) => x !== lp && x.name.toLowerCase() === v.toLowerCase())) { toast(`There is already a person called ${v}.`, 'error'); name.value = lp.name; return; }
        lp.name = v;
        changed();
      });
      role.addEventListener('change', () => { const lp = P(); if (!lp) return gone(); lp.role = role.value.trim(); changed(); });
      colour.addEventListener('change', () => { const lp = P(); if (!lp) return gone(); lp.colour = colour.value; changed(); });
      return h('div', { class: 'settings-row' }, colour, name, role, h('span', { class: 'muted' }, `${count} ticket${count === 1 ? '' : 's'}`),
        h('button', { type: 'button', class: 'danger', onclick: () => {
          if (!confirm(`Remove ${p.name}? Their ${count} ticket${count === 1 ? '' : 's'} will become unassigned.`)) return;
          B().tickets.forEach((t) => { if (t.assignee === p.id) { t.assignee = null; touch(t); } });
          B().people = B().people.filter((x) => x.id !== p.id);
          state.backupLabel = 'before-delete';
          changed();
          rerender();
        } }, 'Remove'));
    });
    const newPerson = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'New person name' });
    const addPerson = () => {
      const name = newPerson.value.trim();
      if (!name) return;
      if (B().people.some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast(`There is already a person called ${name}.`, 'error'); return; }
      const id = uniqueId('p-' + slug(name, 'person'), new Set(B().people.map((p) => p.id)));
      const palette = ['#1d4ed8', '#b45309', '#047857', '#be185d', '#6d28d9', '#0e7490', '#b91c1c', '#4d7c0f', '#a21caf', '#0f766e', '#c2410c', '#4338ca'];
      B().people.push({ id, name, role: '', colour: palette[B().people.length % palette.length] });
      changed();
      rerender();
    };

    // Labels
    const labelRows = B().labels.map((l) => {
      const count = B().tickets.filter((t) => t.labels.includes(l.id)).length;
      const name = h('input', { type: 'text', value: l.name, 'aria-label': 'Label name' });
      const colour = h('input', { type: 'color', value: l.colour || '#6b7280', 'aria-label': 'Label colour' });
      const L = () => B().labels.find((x) => x.id === l.id);
      name.addEventListener('change', () => {
        const ll = L();
        if (!ll) return gone();
        const v = name.value.trim();
        if (!v) return;
        if (B().labels.some((x) => x !== ll && x.name.toLowerCase() === v.toLowerCase())) { toast(`There is already a label called ${v}.`, 'error'); name.value = ll.name; return; }
        ll.name = v;
        changed();
      });
      colour.addEventListener('change', () => { const ll = L(); if (!ll) return gone(); ll.colour = colour.value; changed(); });
      return h('div', { class: 'settings-row' }, colour, name, h('span', { class: 'muted' }, `${count} ticket${count === 1 ? '' : 's'}`),
        h('button', { type: 'button', class: 'danger', onclick: () => {
          if (!confirm(`Delete label "${l.name}"? It will be removed from ${count} ticket${count === 1 ? '' : 's'}.`)) return;
          B().tickets.forEach((t) => { if (t.labels.includes(l.id)) { t.labels = t.labels.filter((x) => x !== l.id); touch(t); } });
          B().labels = B().labels.filter((x) => x.id !== l.id);
          state.backupLabel = 'before-delete';
          changed();
          rerender();
        } }, 'Delete'));
    });
    const newLabel = h('input', { type: 'text', placeholder: 'Label name', 'aria-label': 'New label name' });
    const addLabel = () => {
      const name = newLabel.value.trim();
      if (!name) return;
      if (B().labels.some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast(`There is already a label called ${name}.`, 'error'); return; }
      const id = uniqueId('l-' + slug(name, 'label'), new Set(B().labels.map((l) => l.id)));
      B().labels.push({ id, name, colour: '#0891b2' });
      changed();
      rerender();
    };

    // Columns
    const columnRows = B().columns.map((c, i) => {
      const count = B().tickets.filter((t) => t.status === c.id).length;
      const name = h('input', { type: 'text', value: c.name, 'aria-label': 'Column name' });
      const kind = h('select', { 'aria-label': 'Column kind', title: 'What this column means. Blocked and Awaiting columns ask for a reason when a card is moved in.' },
        ...Object.entries(KIND_LABEL).map(([v, l]) => h('option', { value: v, selected: v === c.kind }, l)));
      const wip = h('input', { type: 'number', min: '1', value: c.wipLimit || '', placeholder: 'No limit', 'aria-label': 'Work-in-progress limit', class: 'narrow' });
      const C = () => B().columns.find((x) => x.id === c.id);
      name.addEventListener('change', () => { const lc = C(); if (!lc) return gone(); if (name.value.trim()) { lc.name = name.value.trim(); changed(); } });
      kind.addEventListener('change', () => {
        const lc = C();
        if (!lc) return gone();
        const before = lc.kind;
        lc.kind = kind.value;
        if (!B().columns.some((x) => x.kind === 'done')) {
          lc.kind = before;
          kind.value = before;
          toast('At least one column must be a Done column.', 'error');
          return;
        }
        changed();
      });
      wip.addEventListener('change', () => { const lc = C(); if (!lc) return gone(); const n = parseInt(wip.value, 10); lc.wipLimit = n > 0 ? n : null; changed(); });
      const moveCol = (delta) => {
        const cols = B().columns;
        const at = cols.findIndex((x) => x.id === c.id);
        const j = at + delta;
        if (at < 0 || j < 0 || j >= cols.length) return;
        [cols[at], cols[j]] = [cols[j], cols[at]];
        changed();
        rerender();
      };
      return h('div', { class: 'settings-row' },
        h('button', { type: 'button', class: 'icon', 'aria-label': `Move ${c.name} one place left`, title: 'Move left', disabled: i === 0, onclick: () => moveCol(-1) }, '\u2190'),
        h('button', { type: 'button', class: 'icon', 'aria-label': `Move ${c.name} one place right`, title: 'Move right', disabled: i === B().columns.length - 1, onclick: () => moveCol(1) }, '\u2192'),
        name, kind, wip, h('span', { class: 'muted' }, `${count} ticket${count === 1 ? '' : 's'}`),
        h('button', { type: 'button', class: 'danger', onclick: () => {
          const inCol = B().tickets.filter((t) => t.status === c.id).length;
          if (inCol) { toast(`Move the ${inCol} ticket${inCol === 1 ? '' : 's'} out of "${c.name}" before deleting it.`, 'error'); return; }
          if (B().columns.length <= 2) { toast('A board needs at least two columns.', 'error'); return; }
          if (c.kind === 'done' && B().columns.filter((x) => x.kind === 'done').length === 1) { toast('At least one column must be a Done column.', 'error'); return; }
          B().columns = B().columns.filter((x) => x.id !== c.id);
          state.backupLabel = 'before-delete';
          changed();
          rerender();
        } }, 'Delete'));
    });
    const newColName = h('input', { type: 'text', placeholder: 'Column name', 'aria-label': 'New column name' });
    const newColKind = h('select', { 'aria-label': 'New column kind' }, ...Object.entries(KIND_LABEL).map(([v, l]) => h('option', { value: v, selected: v === 'in_progress' }, l)));
    const addColumn = () => {
      const name = newColName.value.trim();
      if (!name) return;
      const id = uniqueId(slug(name, 'column'), new Set(B().columns.map((c) => c.id)));
      const doneIdx = B().columns.findIndex((c) => c.kind === 'done');
      B().columns.splice(doneIdx < 0 ? B().columns.length : doneIdx, 0, { id, name, kind: newColKind.value, wipLimit: null });
      changed();
      rerender();
    };

    const assumptions = B().board.assumptions || [];
    const repos = B().repos || [];
    body.append(...[
      h('section', null, h('h3', null, 'Board'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), titleInput),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), descInput),
        h('p', { class: 'muted' }, `Ticket keys use the prefix ${B().board.keyPrefix}. Created ${fmtDateTime(B().board.createdAt)}.`)),
      h('section', null, h('h3', null, 'People'), ...peopleRows,
        h('div', { class: 'settings-row add' }, newPerson, h('button', { type: 'button', onclick: addPerson }, 'Add person'))),
      h('section', null, h('h3', null, 'Labels'), ...labelRows,
        h('div', { class: 'settings-row add' }, newLabel, h('button', { type: 'button', onclick: addLabel }, 'Add label'))),
      h('section', null, h('h3', null, 'Columns'),
        h('p', { class: 'muted' }, 'Each column has a kind, which gives it its meaning. Moving a card into a Blocked or Awaiting action column asks for the reason; Done columns count towards progress. Renaming a column keeps its history.'),
        ...columnRows,
        h('div', { class: 'settings-row add' }, newColName, newColKind, h('button', { type: 'button', onclick: addColumn }, 'Add column'))),
      repos.length ? h('section', null, h('h3', null, 'Repositories'),
        h('p', { class: 'muted' }, 'The code this board tracks. Claude manages this list (edit_board.py), and the audit skill reads it.'),
        h('ul', { class: 'assumptions' }, repos.map((r) => h('li', null, h('strong', null, r.name || r.id), ` ${r.path}`,
          r.remote ? h('span', { class: 'muted' }, ` (${r.remote})`) : null)))) : null,
      assumptions.length ? h('section', null, h('h3', null, 'Planning assumptions'),
        h('ul', { class: 'assumptions' }, assumptions.map((a) => h('li', null, a)))) : null,
      h('section', null, h('h3', null, 'Export'),
        h('p', { class: 'muted' }, 'Every save keeps the previous board in data/backups: all copies from the last two hours, then one per hour for two weeks and one per day for a year. A copy from just before any delete is kept separately.'),
        h('div', { class: 'settings-row' },
          h('a', { class: 'button', href: '/api/export.zip', download: '' }, 'Download board and images (.zip)'),
          h('a', { class: 'button', href: '/api/board', download: slug(B().board.title, 'board') + '.json' }, 'Download board.json'))),
    ].filter(Boolean));

    newPerson.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
    newLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } });
    newColName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } });

    dlg.replaceChildren(
      h('header', { class: 'dialog-head' }, h('h2', { id: 'settings-title' }, 'Board settings'), h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', onclick: () => dlg.close() }, '×')),
      body);
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------------
  // Overview: what needs attention, epic progress, and workload
  // ------------------------------------------------------------------

  function openOverview() {
    const dlg = $('#overview-dialog');
    const b = state.board;
    const work = b.tickets.filter((t) => t.type !== 'epic');
    const done = work.filter((t) => kindOf(t) === 'done').length;
    const today = todayYmd();
    const soon = new Date();
    soon.setDate(soon.getDate() + 14);
    const soonYmd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const who = (t) => (t.assignee && state.idx.person.get(t.assignee) ? state.idx.person.get(t.assignee).name : 'Unassigned');
    const go = (id) => { dlg.close(); openTicket(id); };
    const item = (t, detail) => h('li', null,
      h('button', { type: 'button', class: 'link', onclick: () => go(t.id) }, t.id), ' ', t.title,
      h('span', { class: 'muted' }, ` (${who(t)})${detail ? ': ' + detail : ''}`));
    const list = (title, tickets, detail) => h('section', null,
      h('h3', null, `${title} (${tickets.length})`),
      tickets.length ? h('ul', { class: 'overview-list' }, tickets.map((t) => item(t, detail(t)))) : h('p', { class: 'muted' }, 'None.'));
    const byDue = (a, c) => (a.due < c.due ? -1 : a.due > c.due ? 1 : 0);
    const openWork = work.filter((t) => kindOf(t) !== 'done');
    const pct = work.length ? Math.round((100 * done) / work.length) : 0;

    const epicRows = state.idx.epics.map((e) => {
      const p = progressOf(e);
      const stuck = descendants(e).filter((d) => ['blocked', 'waiting'].includes(kindOf(d))).length;
      const col = state.idx.column.get(e.status);
      return h('tr', null,
        h('td', null, h('span', { class: 'dot', style: { background: e.colour || 'var(--muted)' } }), ' ',
          h('button', { type: 'button', class: 'link', onclick: () => go(e.id) }, `${e.id} ${e.title}`)),
        h('td', null, h('span', { class: 'status-pill kind-' + (col ? col.kind : '') }, col ? col.name : e.status)),
        h('td', null, h('span', { class: 'bar' }, h('span', { style: { width: (p.total ? (100 * p.done) / p.total : 0) + '%' } })), ` ${p.done}/${p.total}`),
        h('td', null, String(stuck)));
    });
    const names = [...b.people.map((p) => p.name), 'Unassigned'];
    const loadRows = names.map((name) => {
      const mine = openWork.filter((t) => who(t) === name);
      return h('tr', null, h('td', null, name), h('td', null, String(mine.length)),
        h('td', null, String(mine.filter((t) => kindOf(t) === 'in_progress').length)),
        h('td', null, String(mine.filter((t) => ['blocked', 'waiting'].includes(kindOf(t))).length)));
    }).filter((row, i) => i < b.people.length || openWork.some((t) => !t.assignee));

    dlg.replaceChildren(
      h('header', { class: 'dialog-head' }, h('h2', { id: 'overview-title' }, 'Overview'), h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', onclick: () => dlg.close() }, '\u00d7')),
      h('div', { class: 'settings-body md-like' },
        h('section', null,
          h('p', null, `${done} of ${work.length} tasks and sub-tasks done (${pct}%).`),
          h('span', { class: 'bar wide' }, h('span', { style: { width: pct + '%' } }))),
        list('Blocked', b.tickets.filter((t) => kindOf(t) === 'blocked'), (t) => t.blockedReason || 'no reason recorded'),
        list('Awaiting action', b.tickets.filter((t) => kindOf(t) === 'waiting')
          .sort((a, c) => (a.waitingFor || 'zz').localeCompare(c.waitingFor || 'zz')),
        (t) => (t.waitingFor ? `[${WAITING_FOR_LABEL[t.waitingFor]}] ` : '') + 'waiting on ' + (t.waitingOn || 'not recorded')),
        list('Awaiting testing or sign-off', b.tickets.filter((t) => ['testing', 'signoff'].includes(kindOf(t))), (t) => (state.idx.column.get(t.status) || {}).name),
        list('Overdue', b.tickets.filter((t) => t.due && t.due < today && kindOf(t) !== 'done').sort(byDue), (t) => 'due ' + fmtDue(t.due)),
        list('Due in the next 14 days', b.tickets.filter((t) => t.due && t.due >= today && t.due <= soonYmd && kindOf(t) !== 'done').sort(byDue), (t) => 'due ' + fmtDue(t.due)),
        epicRows.length ? h('section', null, h('h3', null, 'Epics'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'overview-table' },
            h('thead', null, h('tr', null, h('th', null, 'Epic'), h('th', null, 'Status'), h('th', null, 'Done'), h('th', null, 'Blocked or waiting'))),
            h('tbody', null, epicRows)))) : null,
        h('section', null, h('h3', null, 'Open work by person'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'overview-table' },
            h('thead', null, h('tr', null, h('th', null, 'Person'), h('th', null, 'Open'), h('th', null, 'In progress'), h('th', null, 'Blocked or waiting'))),
            h('tbody', null, loadRows))))));
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  // The column headers stick just below the top bar; on small screens the top
  // bar is not sticky (it would take half the screen), so they stick at the top.
  function trackTopbar() {
    const bar = $('.topbar');
    const update = () => {
      const sticky = getComputedStyle(bar).position === 'sticky';
      document.documentElement.style.setProperty('--sticky-top', sticky ? bar.offsetHeight + 'px' : '0px');
    };
    if (window.ResizeObserver) new ResizeObserver(update).observe(bar);
    window.addEventListener('resize', update);
    update();
  }

  function wire() {
    trackTopbar();
    $('#toggle-controls').addEventListener('click', (e) => {
      const open = $('.controls').classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    const search = $('#search');
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filters.q = search.value.trim(); renderBoard(); }, 150);
    });
    $('#filter-assignee').addEventListener('change', (e) => { state.filters.assignee = e.target.value; renderBoard(); });
    $('#filter-epic').addEventListener('change', (e) => { state.filters.epic = e.target.value; renderBoard(); });
    $('#filter-label').addEventListener('change', (e) => { state.filters.label = e.target.value; renderBoard(); });
    $('#lane-mode').addEventListener('change', (e) => { state.board.settings.swimlanes = e.target.value; changed(); });
    $('#colour-mode').addEventListener('change', (e) => { state.board.settings.colourBy = e.target.value; changed(); });
    $('#show-epics').addEventListener('change', (e) => { state.board.settings.showEpicCards = e.target.checked; changed(); });
    $('#show-subtasks').addEventListener('change', (e) => { state.board.settings.showSubtasks = e.target.checked; changed(); });
    $('#new-ticket').addEventListener('click', () => openTicket(null, {
      assignee: state.filters.assignee !== 'all' && state.filters.assignee !== 'none' ? state.filters.assignee : null,
      parent: state.filters.epic !== 'all' && state.filters.epic !== 'none' ? state.filters.epic : null,
    }));
    $('#open-settings').addEventListener('click', openSettings);
    $('#open-overview').addEventListener('click', openOverview);
    window.addEventListener('beforeunload', (e) => {
      if (state.rev !== state.savedRev) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.closest('input, textarea, select, dialog')) { e.preventDefault(); search.focus(); }
    });
    setInterval(poll, POLL_MS);
    // Overdue flags depend on today's date, so redraw when the date changes.
    let shownDay = todayYmd();
    setInterval(() => { if (todayYmd() !== shownDay) { shownDay = todayYmd(); if (state.board) renderBoard(); } }, 60000);
  }

  wire();
  load().catch(fatal);
})();
