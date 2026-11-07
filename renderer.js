const STORAGE_KEY = 'dashboardhub.v1';

// ---------- saved settings ----------
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.panels)) {
      const merged = Object.assign({ columns: '1', height: 'full' }, saved);
      if (!Array.isArray(merged.servers)) merged.servers = [];
      if (!Array.isArray(merged.profiles) || !merged.profiles.length) {
        merged.profiles = [{ id: 'default', name: 'Default network', network: merged.network || null }];
        merged.activeProfileId = 'default';
      }
      if (!merged.profiles.some(p => p && p.id === merged.activeProfileId)) merged.activeProfileId = merged.profiles[0].id;
      return merged;
    }
  } catch (e) { /* ignore and start fresh */ }
  return { columns: '1', height: 'full', panels: [], servers: [], profiles: [{ id: 'default', name: 'Default network', network: null }], activeProfileId: 'default' };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

let state = loadState();
let editingId = null;
let noteButtons = {};          // panel id -> its Notes button
let notesIds = new Set();      // ids of panels that have a saved note
let notesPanelId = null;       // panel whose note is open right now
let panelEls = {};             // panel id -> its panel box
let chipEls = {};              // panel id -> its top-bar jump button
let findBars = {};             // panel id -> { open(), close(), isOpen() } for its find box (Ctrl+F)
let findGuests = {};           // web page id -> panel id
let activePanelId = null;      // the panel you last pointed at, clicked or typed in (Ctrl+F searches this one)
let maximizedId = null;        // the panel that fills the whole window right now (not saved)
let dragId = null;             // panel being dragged right now
let dragStartOrder = null;     // order before the drag began (used if the drag is cancelled)
let dropSeen = false;          // true once the dragged panel has actually been dropped

// ---------- elements ----------
const grid = document.getElementById('grid');
const jump = document.getElementById('jump');
const toolbar = document.querySelector('.toolbar');
const emptyMsg = document.getElementById('empty');
const dialog = document.getElementById('dialog');
const form = document.getElementById('form');
const nameInput = document.getElementById('nameInput');
const urlInput = document.getElementById('urlInput');
const dialogTitle = document.getElementById('dialogTitle');
const columnsSelect = document.getElementById('columns');
const heightSelect = document.getElementById('height');

const notesDialog = document.getElementById('notesDialog');
const notesTitle = document.getElementById('notesTitle');
const notesText = document.getElementById('notesText');
const notesMsg = document.getElementById('notesMsg');
const revealBtn = document.getElementById('revealBtn');
const notesSave = document.getElementById('notesSave');
const notesCancel = document.getElementById('notesCancel');

const serversDialog = document.getElementById('serversDialog');
const serverList = document.getElementById('serverList');
const serverForm = document.getElementById('serverForm');
const serverFormTitle = document.getElementById('serverFormTitle');
const srvName = document.getElementById('srvName');
const srvHost = document.getElementById('srvHost');
const srvUser = document.getElementById('srvUser');
const srvPort = document.getElementById('srvPort');
const srvMsg = document.getElementById('srvMsg');
const srvCancelEdit = document.getElementById('srvCancelEdit');
const srvSave = document.getElementById('srvSave');

// ---------- helpers ----------
function normalizeUrl(text) {
  let url = text.trim();
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function applyLayout() {
  grid.style.setProperty('--cols', state.columns);
  // "Full screen" makes each panel about one window tall, so it works like a page you scroll to
  const h = state.height === 'full' ? 'calc(100vh - var(--toolbar-h, 56px) - 84px)' : state.height + 'px';
  grid.style.setProperty('--panel-h', h);
  columnsSelect.value = state.columns;
  heightSelect.value = state.height;
}

function makeButton(label, tip, extraClass) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = tip;
  if (extraClass) b.className = extraClass;
  return b;
}

function updateNotesBadge(id) {
  const btn = noteButtons[id];
  if (!btn) return;
  const has = notesIds.has(id);
  btn.textContent = has ? 'Notes ●' : 'Notes';
  btn.classList.toggle('has-notes', has);
}

// Scroll so the panel sits just below the pinned top bar (whatever height the bar has right now)
function jumpToPanel(el) {
  const top = el.getBoundingClientRect().top + window.scrollY - toolbar.offsetHeight - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

// ---------- drawing the panels ----------
function render() {
  // tell the app which websites you added, so their (often self-signed) certificates are accepted and nobody else's are
  try { if (window.settingsApi && window.settingsApi.panelHosts) window.settingsApi.panelHosts(state.panels.map((p) => p.url)).catch(() => {}); } catch (e) { /* not important */ }
  grid.innerHTML = '';
  jump.innerHTML = '';
  noteButtons = {};
  panelEls = {};
  chipEls = {};
  findBars = {};
  findGuests = {};
  emptyMsg.classList.toggle('hidden', state.panels.length > 0);

  state.panels.forEach((panel, index) => {
    const el = document.createElement('section');
    el.className = 'panel';

    const head = document.createElement('div');
    head.className = 'panel-head';

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = panel.name;
    const urlText = document.createElement('span');
    urlText.className = 'panel-url';
    urlText.textContent = panel.url;
    info.append(title, urlText);

    const status = document.createElement('span');
    status.className = 'panel-status';

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    const maxBtn = makeButton('\u26F6 Maximize', 'Make this panel fill the whole window so you can work in it');
    const exitMaxBtn = makeButton('Exit full screen', 'Go back to the dashboard (Esc)', 'primary hidden');
    const findBtn = makeButton('Find', 'Find words in this panel (Ctrl+F)');
    const notesBtn = makeButton('Notes', 'Notes and logins for this panel (stored encrypted)');
    const reloadBtn = makeButton('↻', 'Reload this panel');
    const editBtn = makeButton('Edit', 'Edit name or address');
    const delBtn = makeButton('✕', 'Remove this panel');

    noteButtons[panel.id] = notesBtn;
    updateNotesBadge(panel.id);

    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '☰';

    head.title = 'Drag this bar to move the panel';
    head.draggable = true;
    head.append(grip, info, status, spacer, exitMaxBtn, maxBtn, findBtn, notesBtn, reloadBtn, editBtn, delBtn);

    const body = document.createElement('div');
    body.className = 'panel-body';

    const wv = document.createElement('webview');
    wv.setAttribute('src', panel.url);
    wv.setAttribute('partition', 'persist:panels'); // keeps your logins between launches
    wv.setAttribute('allowpopups', '');

    // find box (Ctrl+F or the Find button): searches the words inside this panel's web page
    const bar = document.createElement('div');
    bar.className = 'find-bar hidden';
    const fIn = document.createElement('input');
    fIn.type = 'text';
    fIn.placeholder = 'Find in this panel';
    fIn.maxLength = 200;
    const fCount = document.createElement('span');
    fCount.className = 'find-count';
    const fPrev = makeButton('▲', 'Previous match (Shift+Enter)');
    const fNext = makeButton('▼', 'Next match (Enter)');
    const fClose = makeButton('✕', 'Close (Esc)');
    bar.append(fIn, fCount, fPrev, fNext, fClose);
    const doFind = (next, forward) => {
      const t = fIn.value;
      if (!t) { try { wv.stopFindInPage('clearSelection'); } catch (e) { /* page not ready */ } fCount.textContent = ''; fIn.classList.remove('nomatch'); return; }
      try { wv.findInPage(t, next ? { findNext: true, forward: forward } : {}); } catch (e) { fCount.textContent = 'Page not ready'; }
    };
    const closeFind = () => {
      bar.classList.add('hidden');
      try { wv.stopFindInPage('clearSelection'); } catch (e) { /* page not ready */ }
      fCount.textContent = '';
      fIn.classList.remove('nomatch');
    };
    const openFind = () => {
      activePanelId = panel.id;
      bar.classList.remove('hidden');
      fIn.focus();
      fIn.select();
      if (fIn.value) doFind(false);
    };
    findBars[panel.id] = { open: openFind, close: closeFind, isOpen: () => !bar.classList.contains('hidden') };
    findBtn.addEventListener('click', () => { if (bar.classList.contains('hidden')) openFind(); else closeFind(); });
    fIn.addEventListener('input', () => doFind(false));
    fIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doFind(true, !e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    fNext.addEventListener('click', () => doFind(true, true));
    fPrev.addEventListener('click', () => doFind(true, false));
    fClose.addEventListener('click', closeFind);
    wv.addEventListener('found-in-page', (e) => {
      const r = e.result || {};
      if (!r.finalUpdate && !r.matches) return;
      fCount.textContent = r.matches ? (r.activeMatchOrdinal + ' of ' + r.matches) : 'No matches';
      fIn.classList.toggle('nomatch', !r.matches);
    });
    wv.addEventListener('dom-ready', () => { try { findGuests[wv.getWebContentsId()] = panel.id; } catch (e) { /* not ready */ } });
    wv.addEventListener('did-start-loading', () => { fCount.textContent = ''; });
    el.addEventListener('mouseenter', () => { activePanelId = panel.id; });
    el.addEventListener('mousedown', () => { activePanelId = panel.id; });
    wv.addEventListener('focus', () => { activePanelId = panel.id; });

    body.append(wv, bar);
    el.append(head, body);
    grid.append(el);
    el.style.order = index;
    panelEls[panel.id] = el;

    // full screen: the panel fills the whole window (the web page inside is not reloaded or moved)
    const applyMax = (on) => {
      el.classList.toggle('maximized', on);
      maxBtn.classList.toggle('hidden', on);
      exitMaxBtn.classList.toggle('hidden', !on);
      head.draggable = !on;
      head.title = on ? '' : 'Drag this bar to move the panel';
      document.body.classList.toggle('has-maximized', on);
    };
    maxBtn.addEventListener('click', () => { if (maximizedId && panelEls[maximizedId] && maximizedId !== panel.id) exitMaximized(); maximizedId = panel.id; applyMax(true); });
    exitMaxBtn.addEventListener('click', exitMaximized);
    el._applyMax = applyMax;
    if (maximizedId === panel.id) applyMax(true);          // the panel list was redrawn (an edit, say) while it was full screen

    // quick-jump button in the top bar (also draggable)
    const chip = makeButton(panel.name, 'Click to jump to ' + panel.name + ', or drag to rearrange', 'chip');
    chip.draggable = true;
    chip.style.order = index;
    chip.addEventListener('click', () => jumpToPanel(el));
    jump.append(chip);
    chipEls[panel.id] = chip;

    // --- drag and drop ---
    head.addEventListener('dragstart', (e) => startDrag(panel.id, e));
    head.addEventListener('dragend', endDrag);
    chip.addEventListener('dragstart', (e) => startDrag(panel.id, e));
    chip.addEventListener('dragend', endDrag);
    el.addEventListener('dragover', (e) => { if (dragId) { allowDrop(e); dragOver(panel.id); } });
    chip.addEventListener('dragover', (e) => { if (dragId) { allowDrop(e); dragOver(panel.id); } });

    // --- events ---
    notesBtn.addEventListener('click', () => openNotes(panel));
    reloadBtn.addEventListener('click', () => { status.textContent = ''; wv.reload(); });

    editBtn.addEventListener('click', () => openDialog(panel));
    delBtn.addEventListener('click', () => {
      if (confirm('Remove "' + panel.name + '" from the dashboard? Its saved note will be deleted too.')) {
        state.panels = state.panels.filter(p => p.id !== panel.id);
        notesIds.delete(panel.id);
        if (window.notesApi) { window.notesApi.remove(panel.id).catch(() => {}); }
        saveState();
        render();
      }
    });

    wv.addEventListener('did-start-loading', () => { status.textContent = 'Loading...'; });
    wv.addEventListener('did-stop-loading', () => {
      if (status.textContent === 'Loading...') status.textContent = '';
    });
    wv.addEventListener('render-process-gone', (e) => {
      const why = e && e.reason;
      if (why === 'clean-exit') return;
      status.textContent = 'This page stopped working (' + (why || 'crashed') + ') - press reload';
    });
    wv.addEventListener('did-fail-load', (e) => {
      // -3 means "cancelled", which is normal and not a real error
      if (e.isMainFrame && e.errorCode !== -3) {
        status.textContent = 'Could not load (' + e.errorDescription + ') - check the address, then press reload';
      }
    });
  });
}

// Leaves full screen and shows the dashboard again.
function exitMaximized() {
  const id = maximizedId;
  maximizedId = null;
  document.body.classList.remove('has-maximized');
  if (id && panelEls[id] && panelEls[id]._applyMax) panelEls[id]._applyMax(false);
  document.body.classList.remove('has-maximized');
}

// ---------- drag and drop to rearrange ----------
// Panels are reordered with CSS "order", so the web pages inside are never
// moved or reloaded while you drag.
function applyOrder() {
  state.panels.forEach((p, i) => {
    if (panelEls[p.id]) panelEls[p.id].style.order = i;
    if (chipEls[p.id]) chipEls[p.id].style.order = i;
  });
}

function markDragging(id, on) {
  grid.classList.toggle('dragging', on);   // lets the drag pass over the web pages
  if (panelEls[id]) panelEls[id].classList.toggle('drag-source', on);
  if (chipEls[id]) chipEls[id].classList.toggle('drag-source', on);
}

function allowDrop(e) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function startDrag(id, e) {
  dragId = id;
  dropSeen = false;
  dragStartOrder = state.panels.slice();
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', id); } catch (err) { /* ignore */ }
  setTimeout(() => { if (dragId === id) markDragging(id, true); }, 0);
}

function dragOver(targetId) {
  if (!dragId || dragId === targetId) return;
  const from = state.panels.findIndex(p => p.id === dragId);
  const to = state.panels.findIndex(p => p.id === targetId);
  if (from < 0 || to < 0) return;
  const moved = state.panels.splice(from, 1)[0];
  state.panels.splice(to, 0, moved);
  applyOrder();
}

function endDrag(e) {
  if (!dragId) return;
  const id = dragId;
  dragId = null;
  markDragging(id, false);
  // Never dropped (cancelled with Esc, or released outside the window): put everything back
  if (!dropSeen && dragStartOrder) {
    state.panels = dragStartOrder;
    applyOrder();
  }
  dragStartOrder = null;
  saveState();
}

// Allow dropping anywhere in the window, and scroll the page when dragging near the top or bottom edge
document.addEventListener('dragenter', (e) => { if (dragId) e.preventDefault(); });
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  allowDrop(e);
  if (e.clientY < toolbar.offsetHeight + 50) window.scrollBy(0, -28);
  else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 28);
});
document.addEventListener('drop', (e) => { if (dragId) { e.preventDefault(); dropSeen = true; } });

// ---------- add / edit dialog ----------
function openDialog(panel) {
  editingId = panel ? panel.id : null;
  dialogTitle.textContent = panel ? 'Edit panel' : 'Add panel';
  nameInput.value = panel ? panel.name : '';
  urlInput.value = panel ? panel.url : '';
  dialog.showModal();
  nameInput.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const url = normalizeUrl(urlInput.value);
  if (!name || !urlInput.value.trim()) return;

  if (editingId) {
    const p = state.panels.find(x => x.id === editingId);
    if (p) { p.name = name; p.url = url; }
  } else {
    state.panels.push({ id: newId(), name: name, url: url });
  }
  saveState();
  dialog.close();
  render();
});

document.getElementById('cancelBtn').addEventListener('click', () => dialog.close());
document.getElementById('addBtn').addEventListener('click', () => openDialog(null));

// ---------- notes dialog ----------
function setMasked(masked) {
  notesText.classList.toggle('masked', masked);
  revealBtn.textContent = masked ? 'Reveal' : 'Hide';
}

function blockNotes(message) {
  notesMsg.textContent = message;
  notesSave.disabled = true;
}

async function openNotes(panel) {
  notesPanelId = panel.id;
  notesTitle.textContent = 'Notes: ' + panel.name;
  notesText.value = '';
  notesMsg.textContent = '';
  notesSave.disabled = false;
  setMasked(true);
  notesDialog.showModal();

  if (!window.notesApi) {
    blockNotes('Notes are not available in this window.');
    return;
  }

  try {
    const available = await window.notesApi.available();
    if (notesPanelId !== panel.id) return;
    if (!available) {
      blockNotes('Encrypted notes are not available on this computer, so notes cannot be saved. ' +
                 '(On Linux this needs a keyring such as GNOME Keyring or KWallet.)');
      return;
    }
    if (notesIds.has(panel.id)) {
      const res = await window.notesApi.get(panel.id);
      if (notesPanelId !== panel.id) return;
      if (res.ok) {
        notesText.value = res.text;
      } else {
        notesMsg.textContent = 'Could not read the saved note. Saving will replace it.';
      }
    }
  } catch (e) {
    notesMsg.textContent = 'Something went wrong opening the note.';
  }
  notesText.focus();
}

revealBtn.addEventListener('click', () => {
  setMasked(!notesText.classList.contains('masked'));
});

notesCancel.addEventListener('click', () => notesDialog.close());

notesSave.addEventListener('click', async () => {
  const id = notesPanelId;
  if (!id || !window.notesApi) return;
  try {
    const text = notesText.value;
    const res = await window.notesApi.set(id, text);
    if (res && res.ok) {
      if (text.trim()) notesIds.add(id); else notesIds.delete(id);
      updateNotesBadge(id);
      renderServers();
      notesDialog.close();
    } else {
      notesMsg.textContent = (res && res.error) || 'Could not save the note.';
    }
  } catch (e) {
    notesMsg.textContent = 'Could not save the note.';
  }
});

// Clear the note text from the page as soon as the dialog closes
notesDialog.addEventListener('close', () => {
  notesText.value = '';
  notesMsg.textContent = '';
  notesPanelId = null;
});

// ---------- Linux servers (SSH) ----------
let editingServerId = null;

function resetServerForm() {
  editingServerId = null;
  serverFormTitle.textContent = 'Add a server';
  srvSave.textContent = 'Save server';
  srvCancelEdit.classList.add('hidden');
  srvName.value = '';
  srvHost.value = '';
  srvUser.value = '';
  srvPort.value = '';
}

function renderServers() {
  serverList.innerHTML = '';

  if (state.servers.length === 0) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = 'No servers yet. Add one below.';
    serverList.append(none);
    return;
  }

  state.servers.forEach((s) => {
    const noteKey = 'ssh-' + s.id;
    const row = document.createElement('div');
    row.className = 'server-row';

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = s.name;
    const detail = document.createElement('span');
    detail.className = 'panel-url';
    detail.textContent = s.user + '@' + s.host + (String(s.port) !== '22' ? ':' + s.port : '');
    info.append(title, detail);

    const connectBtn = makeButton('Connect', 'Open a terminal window and log in over SSH', 'primary');
    const hasNote = notesIds.has(noteKey);
    const noteBtn = makeButton(hasNote ? 'Notes ●' : 'Notes', 'Notes and password for this server (stored encrypted)');
    noteBtn.classList.toggle('has-notes', hasNote);
    const editBtn = makeButton('Edit', 'Edit this server');
    const delBtn = makeButton('✕', 'Remove this server');

    row.append(info, connectBtn, noteBtn, editBtn, delBtn);
    serverList.append(row);

    connectBtn.addEventListener('click', async () => {
      srvMsg.textContent = '';
      if (!window.sshApi) { srvMsg.textContent = 'SSH is not available in this window.'; return; }
      try {
        const res = await window.sshApi.connect({ name: s.name, user: s.user, host: s.host, port: s.port });
        if (!res || !res.ok) srvMsg.textContent = (res && res.error) || 'Could not open the terminal window.';
      } catch (e) {
        srvMsg.textContent = 'Could not open the terminal window.';
      }
    });

    noteBtn.addEventListener('click', () => openNotes({ id: noteKey, name: s.name }));

    editBtn.addEventListener('click', () => {
      editingServerId = s.id;
      serverFormTitle.textContent = 'Edit server';
      srvSave.textContent = 'Save changes';
      srvCancelEdit.classList.remove('hidden');
      srvName.value = s.name;
      srvHost.value = s.host;
      srvUser.value = s.user;
      srvPort.value = String(s.port);
      srvMsg.textContent = '';
      srvName.focus();
    });

    delBtn.addEventListener('click', () => {
      if (confirm('Remove "' + s.name + '"? Its saved note will be deleted too.')) {
        state.servers = state.servers.filter(x => x.id !== s.id);
        notesIds.delete(noteKey);
        if (window.notesApi) { window.notesApi.remove(noteKey).catch(() => {}); }
        if (editingServerId === s.id) resetServerForm();
        saveState();
        renderServers();
      }
    });
  });
}

serverForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = srvName.value.trim();
  const host = srvHost.value.trim();
  const user = srvUser.value.trim();
  const portText = srvPort.value.trim() || '22';

  if (!name) { srvMsg.textContent = 'Please give the server a name.'; return; }
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(user)) {
    srvMsg.textContent = 'The username can only use letters, numbers, dot, dash and underscore.';
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(host)) {
    srvMsg.textContent = 'The address can only use letters, numbers, dots, dashes and colons (for example 192.168.1.60).';
    return;
  }
  if (!/^[0-9]{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    srvMsg.textContent = 'The port must be a number from 1 to 65535 (usually 22).';
    return;
  }

  const port = Number(portText);
  if (editingServerId) {
    const s = state.servers.find(x => x.id === editingServerId);
    if (s) { s.name = name; s.host = host; s.user = user; s.port = port; }
  } else {
    state.servers.push({ id: newId(), name: name, host: host, user: user, port: port });
  }
  srvMsg.textContent = '';
  saveState();
  resetServerForm();
  renderServers();
});

srvCancelEdit.addEventListener('click', () => { resetServerForm(); srvMsg.textContent = ''; });
document.getElementById('srvClose').addEventListener('click', () => serversDialog.close());
document.getElementById('serversBtn').addEventListener('click', () => {
  srvMsg.textContent = '';
  resetServerForm();
  renderServers();
  serversDialog.showModal();
});

// ---------- backup: export and import ----------
const backupDialog = document.getElementById('backupDialog');
const backupMsg = document.getElementById('backupMsg');
const exportNotes = document.getElementById('exportNotes');
const importReplace = document.getElementById('importReplace');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');

function showBackupMsg(text, good) {
  backupMsg.textContent = text;
  backupMsg.classList.toggle('ok', !!good);
}

function setBackupBusy(busy) {
  exportBtn.disabled = busy;
  importBtn.disabled = busy;
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

async function doExport() {
  showBackupMsg('');
  if (!window.backupApi) { showBackupMsg('Backup is not available in this window.'); return; }

  const withNotes = exportNotes.checked;
  if (withNotes && !confirm('The file will contain your notes and passwords as plain text.\n\n' +
      'Keep it private and do not send it to anyone. Continue?')) {
    return;
  }

  setBackupBusy(true);
  try {
    const data = {
      app: 'dashboard-hub',
      format: 1,
      exportedAt: new Date().toISOString(),
      includesNotes: withNotes,
      layout: { columns: state.columns, height: state.height },
      panels: [],
      servers: []
    };
    if (window.hubNetmap) {
      try { data.network = window.hubNetmap.exportData(); } catch (e) { /* the map is left out */ }
      data.profiles = (state.profiles || []).map(p => ({ id: p.id, name: p.name, locked: !!p.locked, fp: p.fp || null, network: p.id === state.activeProfileId ? data.network : p.network || null }));
      const activeProfile = (state.profiles || []).find(p => p.id === state.activeProfileId);
      data.activeProfileName = activeProfile ? activeProfile.name : 'Default network';
    }
    let notesMissed = 0;

    async function noteFor(key) {
      if (!withNotes || !notesIds.has(key) || !window.notesApi) return '';
      try {
        const r = await window.notesApi.get(key);
        if (r && r.ok && r.text) return r.text;
      } catch (e) { /* counted below */ }
      notesMissed++;
      return '';
    }

    for (const p of state.panels) {
      const item = { name: p.name, url: p.url };
      const note = await noteFor(p.id);
      if (note) item.note = note;
      data.panels.push(item);
    }
    if (window.bmcApi) {
      try { const bl = await window.bmcApi.list(); if (bl && bl.ok) data.bmc = bl.list.map(b => ({ name: b.name, host: b.host, port: b.port, https: b.https, username: b.username, mac: b.mac || '' })); } catch (e) { /* the server list is left out */ }
    }
    if (data.profiles) {                        // every network profile brings its own panels
      for (const pr of data.profiles) {
        const src = pr.id === state.activeProfileId ? state.panels : ((state.profiles.find(x => x.id === pr.id) || {}).panels || []);
        pr.panels = [];
        for (const p of src) {
          const item = { name: p.name, url: p.url };
          const note = await noteFor(p.id);
          if (note) item.note = note;
          pr.panels.push(item);
        }
        const srcS = pr.id === state.activeProfileId ? state.servers : ((state.profiles.find(x => x.id === pr.id) || {}).servers || []);
        pr.servers = [];
        for (const s of srcS) {
          const item = { name: s.name, host: s.host, user: s.user, port: s.port };
          const note = await noteFor('ssh-' + s.id);
          if (note) item.note = note;
          pr.servers.push(item);
        }
      }
    }
    for (const s of state.servers) {
      const item = { name: s.name, host: s.host, user: s.user, port: s.port };
      const note = await noteFor('ssh-' + s.id);
      if (note) item.note = note;
      data.servers.push(item);
    }

    const res = await window.backupApi.export(data);
    if (res && res.ok) {
      const mapCount = window.hubNetmap && data.network ? window.hubNetmap.count() : 0;
      let msg = 'Saved ' + plural(data.panels.length, 'panel') + ', ' + plural(data.servers.length, 'server') +
                (data.network ? ' and the network map (' + plural(mapCount, 'machine') + ')' : '') +
                ' to ' + res.path + '.';
      if (notesMissed) msg += ' ' + plural(notesMissed, 'note') + ' could not be read and left out.';
      showBackupMsg(msg, !notesMissed);
    } else if (!(res && res.canceled)) {
      showBackupMsg((res && res.error) || 'Could not save the file.');
    }
  } catch (e) {
    showBackupMsg('Could not save the file.');
  } finally {
    setBackupBusy(false);
  }
}

async function doImport() {
  showBackupMsg('');
  if (!window.backupApi) { showBackupMsg('Backup is not available in this window.'); return; }

  setBackupBusy(true);
  try {
    const res = await window.backupApi.import();
    if (!res || res.canceled) return;
    if (!res.ok) { showBackupMsg(res.error || 'Could not read the file.'); return; }

    const d = res.data;
    const netCount = d.network ? Object.keys(d.network.devices).length - 1 : 0;
    const profCount = Array.isArray(d.profiles) ? d.profiles.length : 0;
    if (d.panels.length === 0 && d.servers.length === 0 && !d.network && !profCount) {
      showBackupMsg('Nothing to import: the file has no usable panels, servers or network map.' +
                    (d.skipped ? ' (' + d.skipped + ' invalid ' + (d.skipped === 1 ? 'entry was' : 'entries were') + ' skipped.)' : ''));
      return;
    }

    const replace = importReplace.checked;
    let question = 'This file has ' + plural(d.panels.length, 'panel') + ' and ' + plural(d.servers.length, 'server') +
                   (d.network ? ', and a network map with ' + plural(netCount, 'machine') : '') + (profCount ? ', and ' + plural(profCount, 'network profile') : '') + '.';
    if (d.skipped) question += '\n' + d.skipped + ' invalid ' + (d.skipped === 1 ? 'entry' : 'entries') + ' will be skipped.';
    question += replace
      ? '\n\nThis will REPLACE your current panels, servers' + (d.network ? ' and network map' : '') + ', and delete their saved notes. Continue?'
      : '\n\nAdd them to your dashboard?';
    if (profCount && d.profiles.some(pr => Array.isArray(pr.panels))) question += '\nEach profile keeps its own panels.';
    if (!confirm(question)) return;

    // Notes can only be stored if this computer can encrypt them
    const hasNotes = d.panels.some(p => p.note) || d.servers.some(s => s.note);
    let notesOk = false;
    if (hasNotes && window.notesApi) {
      try { notesOk = !!(await window.notesApi.available()); } catch (e) { notesOk = false; }
    }
    let notesSaved = 0;
    let notesLost = 0;

    if (replace) {
      const removals = [];
      state.panels.forEach(p => { removals.push(p.id); });
      (state.profiles || []).forEach(pr => { (pr.panels || []).forEach(p => { removals.push(p.id); }); (pr.servers || []).forEach(s => { removals.push('ssh-' + s.id); }); });
      state.servers.forEach(s => { removals.push('ssh-' + s.id); });
      for (const key of removals) {
        notesIds.delete(key);
        if (window.notesApi) { try { await window.notesApi.remove(key); } catch (e) { /* ignore */ } }
      }
      state.panels = [];
      state.servers = [];
      if (d.layout) {
        state.columns = d.layout.columns;
        state.height = d.layout.height;
        applyLayout();
      }
    }

    async function keepNote(key, note) {
      if (!note) return;
      if (!notesOk) { notesLost++; return; }
      try {
        const r = await window.notesApi.set(key, note);
        if (r && r.ok) { notesIds.add(key); notesSaved++; } else { notesLost++; }
      } catch (e) { notesLost++; }
    }

    const urlKey = (u) => String(u).trim().toLowerCase().replace(/\/+$/, '');
    const serverKey = (s) => (s.user + '@' + s.host + ':' + s.port).toLowerCase();
    const haveUrls = new Set(state.panels.map(p => urlKey(p.url)));
    const haveServers = new Set(state.servers.map(serverKey));
    let addedPanels = 0, addedServers = 0, duplicates = 0;

    const profPanelsIn = Array.isArray(d.profiles) && d.profiles.some(pr => Array.isArray(pr.panels));
    for (const p of (profPanelsIn ? [] : d.panels)) {          // newer backups carry the panels inside each profile
      if (haveUrls.has(urlKey(p.url))) { duplicates++; continue; }
      const id = newId();
      state.panels.push({ id: id, name: p.name, url: p.url });
      haveUrls.add(urlKey(p.url));
      addedPanels++;
      await keepNote(id, p.note);
    }
    const profServersIn = Array.isArray(d.profiles) && d.profiles.some(pr => Array.isArray(pr.servers));
    for (const s of (profServersIn ? [] : d.servers)) {
      const entry = { name: s.name, host: s.host, user: s.user, port: s.port };
      if (haveServers.has(serverKey(entry))) { duplicates++; continue; }
      entry.id = newId();
      state.servers.push(entry);
      haveServers.add(serverKey(entry));
      addedServers++;
      await keepNote('ssh-' + entry.id, s.note);
    }

    let mapResult = null;
    if (d.network && window.hubNetmap && !(Array.isArray(d.profiles) && d.profiles.length)) {   // with profiles, each network map comes in with its own profile (never mixed into the current map)
      try { mapResult = window.hubNetmap.importData(d.network, replace); } catch (e) { mapResult = null; }
    }

    if (Array.isArray(d.profiles) && d.profiles.length) {
      const incoming = [];
      for (const p of d.profiles) {
        const entry = { id: newId(), name: p.name, network: p.network || null, locked: !!p.locked, fp: p.fp || null };
        if (Array.isArray(p.panels)) {
          entry.panels = [];
          for (const pp of p.panels) {
            const id = newId();
            entry.panels.push({ id: id, name: pp.name, url: pp.url });
            addedPanels++;
            await keepNote(id, pp.note);
          }
        }
        if (Array.isArray(p.servers)) {
          entry.servers = [];
          for (const ss of p.servers) {
            const sv = { id: newId(), name: ss.name, host: ss.host, user: ss.user, port: ss.port };
            entry.servers.push(sv);
            addedServers++;
            await keepNote('ssh-' + sv.id, ss.note);
          }
        }
        incoming.push(entry);
      }
      if (replace) { state.profiles = incoming; const chosen = incoming.find(p => p.name === d.activeProfileName) || incoming[0]; state.activeProfileId = chosen.id; if (profPanelsIn) { state.panels = chosen.panels || []; delete chosen.panels; } if (profServersIn) { state.servers = chosen.servers || []; delete chosen.servers; } }
      else {
        const names = new Set((state.profiles || []).map(p => String(p.name).toLowerCase()));
        incoming.forEach(p => { if (names.has(String(p.name).toLowerCase())) p.name = p.name + ' (Imported)'; state.profiles.push(p); });
      }
      const active = state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
      state.activeProfileId = active.id;
      if (replace && window.hubNetmap && active.network) window.hubNetmap.importData(active.network, true);
    }
    let bmcAdded = 0;
    if (d.bmc && d.bmc.length && window.bmcApi && window.bmcApi.importList) {
      try { const br = await window.bmcApi.importList(d.bmc, replace); bmcAdded = br && br.added ? br.added : 0; } catch (e) { bmcAdded = 0; }
    }
    saveState();
    render();
    renderServers();
    if (window.hubProfilesRefresh) window.hubProfilesRefresh();
    if (window.hubNetmap && window.hubNetmap.guardCheck) window.hubNetmap.guardCheck();

    let msg = 'Imported ' + plural(addedPanels, 'panel') + ', ' + plural(addedServers, 'server') +
              (mapResult ? ' and ' + plural(mapResult.devices, 'machine') + ' on the network map' : '') +
              (profCount ? (mapResult ? ', plus ' : ' and ') + plural(profCount, 'network profile') : '') + '.';
    if (mapResult && mapResult.duplicates) duplicates += mapResult.duplicates;
    if (duplicates) msg += ' ' + plural(duplicates, 'duplicate') + ' skipped (already in your dashboard).';
    if (d.skipped) msg += ' ' + d.skipped + ' invalid ' + (d.skipped === 1 ? 'entry was' : 'entries were') + ' skipped.';
    if (bmcAdded) msg += ' ' + plural(bmcAdded, 'server management login') + ' restored (type their passwords again under Settings > Server management).';
    if (notesSaved) msg += ' ' + plural(notesSaved, 'note') + ' restored.';
    if (notesLost) msg += ' ' + plural(notesLost, 'note') + ' could not be saved (encrypted notes are not available on this computer).';
    showBackupMsg(msg, !notesLost);
  } catch (e) {
    showBackupMsg('Something went wrong importing that file.');
  } finally {
    setBackupBusy(false);
  }
}

// ---------- settings menu: keep running in the system tray ----------
(function initSettings() {
  const chk = document.getElementById('trayCheck');
  const hint = document.getElementById('trayHint');
  const msg = document.getElementById('settingsMsg');
  if (!chk || !window.settingsApi) return;
  const gchk = document.getElementById('gpuCheck'), ghint = document.getElementById('gpuHint'), grestart = document.getElementById('gpuRestart');
  window.settingsApi.get().then((r) => { window.hubBackground = !!(r && r.closeToTray); }).catch(() => {});
  // while the window cannot be seen (hidden in the tray, minimised) nothing is drawn, and animations stand still
  if (window.settingsApi.onVisible) window.settingsApi.onVisible((visible) => {
    window.hubWindowHidden = !visible;
    document.body.classList.toggle('window-hidden', !visible);
    window.dispatchEvent(new Event('hub-visibility'));
  });
  async function load() {
    msg.textContent = '';
    try {
      const r = await window.settingsApi.get();
      chk.checked = !!(r && r.closeToTray);
      window.hubBackground = chk.checked;
      hint.textContent = r && r.platform === 'linux'
        ? 'Needs a system tray (GNOME needs the "AppIndicator" extension).'
        : r && r.platform === 'win32' ? 'The icon may be under the small arrow (^) in the taskbar.' : '';
      if (gchk) {
        gchk.checked = !!(r && r.gpu);
        const st = r && r.gpuState;
        const now = st === 'on' ? 'Right now: the graphics card is being used.' : st === 'off' ? 'Right now: switched off (software drawing).' : st === 'software' ? 'Right now: this computer is not letting the app use the graphics card (software drawing).' : '';
        const pend = r && r.gpu !== r.gpuRunning;
        ghint.textContent = (r && r.gpuAutoOff ? 'The graphics card was switched off automatically because the graphics driver kept crashing. Switch it back on here if the driver has been fixed. ' : '') + (pend ? 'Restart the app to apply the change. ' : '') + now;
        grestart.hidden = !pend;
      }
    } catch (e) { hint.textContent = ''; }
  }
  if (gchk) {
    gchk.addEventListener('change', async () => {
      let r;
      try { r = await window.settingsApi.setGpu(gchk.checked); } catch (e) { r = { ok: false }; }
      if (!r || !r.ok) { gchk.checked = !gchk.checked; msg.textContent = 'The setting could not be saved.'; return; }
      grestart.hidden = !r.needsRestart;
      ghint.textContent = r.needsRestart ? 'Restart the app to apply the change.' : '';
    });
    grestart.addEventListener('click', () => { try { window.settingsApi.restart(); } catch (e) { /* ignore */ } });
  }
  ['settingsBtn', 'profilesBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.addEventListener('click', load); });
  chk.addEventListener('change', async () => {
    msg.textContent = '';
    let r;
    try { r = await window.settingsApi.set({ closeToTray: chk.checked }); } catch (e) { r = { ok: false, error: 'The setting could not be saved.' }; }
    if (!r || !r.ok) { chk.checked = !chk.checked; msg.textContent = (r && r.error) || 'The setting could not be saved.'; }
    else { window.hubBackground = chk.checked; msg.textContent = chk.checked ? 'On: the X button hides the window to the tray.' : 'Off: the X button closes the app.'; }
  });
})();

document.getElementById('backupBtn').addEventListener('click', () => {
  showBackupMsg('');
  exportNotes.checked = false;
  importReplace.checked = false;
  backupDialog.showModal();
});
document.getElementById('backupClose').addEventListener('click', () => backupDialog.close());
exportBtn.addEventListener('click', doExport);
importBtn.addEventListener('click', doImport);

// ---------- network profiles ----------
(function initProfiles() {
  const btn = document.getElementById('profilesBtn');
  const menu = document.getElementById('profilesMenu');
  const choices = document.getElementById('profileChoices');
  const dialog = document.getElementById('profileDialog');
  const form = document.getElementById('profileForm');
  const nameInput = document.getElementById('profileNameInput');
  const title = document.getElementById('profileDialogTitle');
  const message = document.getElementById('profileDialogMessage');
  const nameLabel = document.getElementById('profileNameLabel');
  const confirmBtn = document.getElementById('profileConfirm');
  if (!btn || !menu || !choices || !dialog || !form || !nameInput) return;

  let pendingAction = null;
  const active = () => (state.profiles || []).find(p => p.id === state.activeProfileId) || state.profiles[0];
  function capture() {
    const p = active();
    if (p && window.hubNetmap) { try { p.network = window.hubNetmap.exportData(); } catch (_) {} }
    saveState();
  }
  window.hubProfilesCapture = capture;
  window.hubActiveProfile = () => state.activeProfileId;
  // The router & switch links and server logins belong to a profile: tell the app which profile is showing, then reload those lists
  let announced = null;
  async function announce() {
    const pid = state.activeProfileId;
    if (!pid || pid === announced || !window.connApi || !window.connApi.setProfile) return;
    announced = pid;
    try { await window.connApi.setProfile(pid); } catch (e) { announced = null; return; }
    try { if (window.hubConnections && window.hubConnections.reload) window.hubConnections.reload(); } catch (e) { /* ignore */ }
    try { if (window.hubBmcReload) window.hubBmcReload(); } catch (e) { /* ignore */ }
    try { if (window.hubBandwidth && window.hubBandwidth.reset) window.hubBandwidth.reset(); } catch (e) { /* ignore */ }
  }
  function refresh() {
    announce();
    const p = active();
    btn.textContent = 'Profile: ' + (p ? p.name : 'Network');
    choices.replaceChildren();
    (state.profiles || []).forEach(profile => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'profile-choice' + (profile.id === state.activeProfileId ? ' active' : '');
      b.textContent = (profile.id === state.activeProfileId ? '✓  ' : '    ') + profile.name;
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', profile.id === state.activeProfileId ? 'true' : 'false');
      b.addEventListener('click', () => switchTo(profile.id));
      choices.appendChild(b);
    });
    const multi = state.profiles.length > 1;
    document.getElementById('profileDuplicate').disabled = !p;
    document.getElementById('profileRename').disabled = !p;
    document.getElementById('profileRemove').disabled = !p || !multi;
    const lockBtn = document.getElementById('profileLock');
    if (lockBtn) { lockBtn.disabled = !p; lockBtn.textContent = p && p.locked ? 'Unlock map' : 'Lock map'; }
  }
  function close() {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }
  function switchTo(id) {
    if (id === state.activeProfileId) { close(); return; }
    capture();
    const next = state.profiles.find(p => p.id === id);
    if (!next) return;
    const cur = active();
    if (cur) { cur.panels = state.panels; cur.servers = state.servers; }   // park this network's panels and servers with its profile
    state.panels = next.panels || [];                    // and bring this network's own
    state.servers = next.servers || [];
    delete next.panels; delete next.servers;
    state.activeProfileId = id;
    if (window.hubNetmap) {
      const blank = { router: '192.168.0.1', devices: { router: { ip: '192.168.0.1', isRouter: true } }, links: [], ignored: [] };
      window.hubNetmap.importData(next.network || blank, true);
    }
    activePanelId = null;
    saveState(); render(); renderServers(); refresh(); close();
    if (window.hubNetmap && window.hubNetmap.guardCheck) window.hubNetmap.guardCheck();
  }
  window.hubProfilesSwitch = (id) => switchTo(id);
  window.hubProfilesCreate = (name) => {
    capture();
    const id = newId();
    state.profiles.push({ id, name: String(name || 'New network').slice(0, 50), network: null });
    switchTo(id);
  };
  const lockEl = document.getElementById('profileLock');
  if (lockEl) lockEl.addEventListener('click', () => {
    const p = active();
    if (!p) return;
    p.locked = !p.locked;
    saveState(); refresh(); close();
    if (window.hubNetmap && window.hubNetmap.guardCheck) window.hubNetmap.guardCheck();
  });
  // a duplicated profile gets its own copy of every note (still encrypted by the app)
  async function copyNotes(pairs) {
    if (!window.notesApi) return;
    for (const [from, to] of pairs) {
      if (!notesIds.has(from)) continue;
      try {
        const r = await window.notesApi.get(from);
        if (r && r.ok && r.text) { const w = await window.notesApi.set(to, r.text); if (w && w.ok) notesIds.add(to); }
      } catch (e) { /* that note is simply not copied */ }
    }
    if (typeof render === 'function') { try { render(); } catch (e) { /* ignore */ } }
  }
  function openAction(action) {
    const p = active();
    if (!p) return;
    pendingAction = action;
    close();
    nameLabel.classList.remove('hidden');
    nameInput.value = '';
    nameInput.disabled = false;
    if (action === 'new') {
      title.textContent = 'New network profile';
      message.textContent = 'Give this network a name, such as “Client office” or “Building A”.';
      nameInput.value = 'New profile';
      confirmBtn.textContent = 'Create';
    } else if (action === 'duplicate') {
      title.textContent = 'Duplicate network profile';
      message.textContent = 'Create a separate copy of the current profile and its saved network map.';
      nameInput.value = p.name + ' copy';
      confirmBtn.textContent = 'Duplicate';
    } else if (action === 'rename') {
      title.textContent = 'Rename network profile';
      message.textContent = 'Choose a new name for the current profile.';
      nameInput.value = p.name;
      confirmBtn.textContent = 'Rename';
    } else if (action === 'remove') {
      title.textContent = 'Remove network profile';
      message.textContent = 'Remove “' + p.name + '”, its saved network map, its panels and its servers? This cannot be undone.';
      nameLabel.classList.add('hidden');
      nameInput.value = p.name;
      confirmBtn.textContent = 'Remove';
    }
    dialog.showModal();
    if (action !== 'remove') { nameInput.focus(); nameInput.select(); }
    else confirmBtn.focus();
  }
  document.getElementById('profileNew').addEventListener('click', () => openAction('new'));
  document.getElementById('profileDuplicate').addEventListener('click', () => openAction('duplicate'));
  document.getElementById('profileRename').addEventListener('click', () => openAction('rename'));
  document.getElementById('profileRemove').addEventListener('click', () => openAction('remove'));
  document.getElementById('profileCancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', e => {
    e.preventDefault();
    const action = pendingAction;
    const p = active();
    if (!action || !p) { dialog.close(); return; }
    const name = nameInput.value.trim().slice(0, 50);
    if (action !== 'remove' && !name) { nameInput.focus(); return; }
    if (action === 'new') {
      capture();
      const id = newId();
      state.profiles.push({ id, name, network: null });
      dialog.close();
      switchTo(id);
    } else if (action === 'duplicate') {
      capture();
      const id = newId();
      const copy = p.network ? JSON.parse(JSON.stringify(p.network)) : null;
      const pairs = [];
      const panelCopy = state.panels.map(x => { const n = Object.assign({}, x, { id: newId() }); pairs.push([x.id, n.id]); return n; });   // same pages, own copies
      const serverCopy = state.servers.map(x => { const n = Object.assign({}, x, { id: newId() }); pairs.push(['ssh-' + x.id, 'ssh-' + n.id]); return n; });
      copyNotes(pairs);
      state.profiles.push({ id, name, network: copy, panels: panelCopy, servers: serverCopy });
      dialog.close();
      // the copy starts with its own copy of this network's router / switch links and server logins
      const go = () => switchTo(id);
      let copied = null;
      try { copied = window.connApi && window.connApi.copyProfile ? window.connApi.copyProfile(p.id, id) : null; } catch (e) { copied = null; }
      if (copied && copied.then) copied.then(go, go); else go();
    } else if (action === 'rename') {
      p.name = name;
      saveState(); refresh(); dialog.close();
    } else if (action === 'remove') {
      if (state.profiles.length < 2) { dialog.close(); return; }
      capture();
      const index = state.profiles.findIndex(x => x.id === p.id);
      state.profiles.splice(index, 1);
      const next = state.profiles[Math.max(0, index - 1)];
      for (const gone of state.panels) { notesIds.delete(gone.id); if (window.notesApi) { try { window.notesApi.remove(gone.id); } catch (e) { /* ignore */ } } }
      for (const gone of state.servers) { notesIds.delete('ssh-' + gone.id); if (window.notesApi) { try { window.notesApi.remove('ssh-' + gone.id); } catch (e) { /* ignore */ } } }
      state.panels = next.panels || [];
      state.servers = next.servers || [];
      delete next.panels; delete next.servers;
      state.activeProfileId = next.id;
      if (window.hubNetmap) window.hubNetmap.importData(next.network || { router: '192.168.0.1', devices: { router: { ip: '192.168.0.1' } }, links: [], ignored: [] }, true);
      activePanelId = null;
      saveState(); render(); renderServers(); refresh(); dialog.close(); close();
      try { if (window.connApi && window.connApi.dropProfile) window.connApi.dropProfile(p.id); } catch (e) { /* its links stay hidden */ }
      if (window.hubNetmap && window.hubNetmap.guardCheck) window.hubNetmap.guardCheck();
    }
    pendingAction = null;
  });
  const settingsBtn = document.getElementById('settingsBtn');
  const toggleMenu = e => {
    e.stopPropagation();
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) refresh();
  };
  btn.addEventListener('click', toggleMenu);              // the profile name next to the tabs opens the same menu
  if (settingsBtn) settingsBtn.addEventListener('click', toggleMenu);
  menu.addEventListener('click', e => { e.stopPropagation(); if (e.target && (e.target.id === 'backupBtn' || e.target.id === 'bmcMenuBtn' || e.target.id === 'toolsMenuBtn' || e.target.id === 'securityMenuBtn')) close(); });
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn && e.target !== settingsBtn) close(); });
  window.hubProfilesRefresh = refresh;
  window.addEventListener('beforeunload', capture);
  refresh();
})();

// ---------- top bar controls ----------
document.getElementById('reloadAll').addEventListener('click', () => {
  document.querySelectorAll('webview').forEach(w => { try { w.reload(); } catch (e) { /* not ready yet */ } });
});

columnsSelect.addEventListener('change', () => {
  state.columns = columnsSelect.value;
  saveState();
  applyLayout();
});

heightSelect.addEventListener('change', () => {
  state.height = heightSelect.value;
  saveState();
  applyLayout();
});

// ---------- start ----------
// Keep track of the top bar's height: it grows when the panel buttons wrap onto more rows.
function syncToolbarHeight() {
  document.documentElement.style.setProperty('--toolbar-h', toolbar.offsetHeight + 'px');
}
if (window.ResizeObserver) new ResizeObserver(syncToolbarHeight).observe(toolbar);
window.addEventListener('resize', syncToolbarHeight);
syncToolbarHeight();

applyLayout();
render();

if (window.notesApi) {
  window.notesApi.list()
    .then((ids) => {
      notesIds = new Set(Array.isArray(ids) ? ids : []);
      Object.keys(noteButtons).forEach(updateNotesBadge);
      renderServers();
    })
    .catch(() => { /* notes simply show as empty */ });
}


// ---------- Ctrl+F: find words in a panel (works on every panel, including while you are typing inside its web page) ----------
function openFindFor(panelId) {
  const id = panelId && findBars[panelId] ? panelId : (activePanelId && findBars[activePanelId] ? activePanelId : (state.panels[0] && state.panels[0].id));
  if (id && findBars[id]) { findBars[id].open(); jumpToPanelIfHidden(id); }
}
function jumpToPanelIfHidden(id) {
  const el = panelEls[id];
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom < toolbar.offsetHeight || r.top > window.innerHeight - 80) jumpToPanel(el);
}
document.addEventListener('keydown', (e) => {
  // Esc leaves full screen (unless a box is open, or the find box is using Esc)
  if (e.key === 'Escape' && maximizedId && !document.querySelector('dialog[open]') && !(findBars[maximizedId] && findBars[maximizedId].isOpen())) { e.preventDefault(); exitMaximized(); return; }
  if (document.body.classList.contains('view-map')) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'f') {
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    openFindFor(null);
  }
});
if (window.findApi) {
  window.findApi.onOpen((guestId) => { if (!document.body.classList.contains('view-map')) openFindFor(findGuests[guestId] || null); });
  window.findApi.onEscape((guestId) => { const id = findGuests[guestId]; if (id && findBars[id] && findBars[id].isOpen()) findBars[id].close(); });
}
