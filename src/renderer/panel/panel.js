'use strict';
/**
 * Renderer: shared state, the toolbar, the filter chips and the status bar.
 *
 * Plain DOM, no framework, no build step. The window is split into four more
 * files loaded after this one - list, calendar, detail, options - because one
 * window with two views and three dialogs is more than one file should hold,
 * not because anything here needs a bundler.
 *
 * `App` is the seam between them. It owns what is transient (which row is
 * selected, what is typed in the search box) and nothing that matters: the
 * state of record lives in main, and every mutation goes there and comes back.
 */

const App = {
  api: window.app,

  /** Last snapshot from main: settings, defaults, the status vocabulary. */
  state: null,
  /** Last list query result, so the calendar and menus can read the rows. */
  result: null,
  /** Transient: the row the keyboard acts on. */
  selectedId: null,
  /** Transient: not persisted, because an old search is never what you want. */
  search: '',
};

const el = (id) => document.getElementById(id);

/** Anything from the database goes through this before it reaches innerHTML. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

App.esc = esc;

/**
 * One icon from the sprite in index.html, as a markup string.
 *
 * A string rather than a node because almost every caller is building a row or
 * a dialog with a template literal, and a helper that returned an element would
 * mean those become document.createElement ladders. The sprite ids are the only
 * thing this has to agree with.
 */
App.icon = function icon(name, extra = '') {
  return `<svg class="ico ${extra}" aria-hidden="true"><use href="#i-${name}" /></svg>`;
};

// --- talking to main -------------------------------------------------------

/**
 * Every handler in main returns { ok, ... }. This unwraps that in one place:
 * on failure the user sees why, and the caller gets null rather than a promise
 * that resolves to something it then has to check.
 */
async function call(promise, { quiet = false } = {}) {
  const res = await promise;
  if (!res || !res.ok) {
    if (!quiet) App.toast((res && res.error) || 'Something went wrong.', 'bad');
    return null;
  }
  return res;
}

App.call = call;

/** Re-runs the list query and repaints whatever view is showing. */
App.refresh = async function refresh() {
  const { settings } = App.state;
  const res = await call(App.api.query({
    search: App.search,
    statuses: settings.visibleStatuses,
    sort: { column: settings.sortColumn, reverse: settings.sortReverse },
  }));
  if (!res) return;

  App.result = res.result;
  ListView.render(res.result);
  renderStatusBar(res.result);
  if (!el('view-calendar').hidden) CalendarView.refresh();
};

App.setSettings = async function setSettings(patch) {
  const res = await call(App.api.setSettings(patch));
  if (!res) return;
  App.state = res;
  applyTheme();
  renderFilters();
  await App.refresh();
};

// --- chrome ----------------------------------------------------------------

function applyTheme() {
  document.documentElement.dataset.theme = App.state.settings.theme === 'dark' ? 'dark' : 'light';
}

function renderStatusBar(result) {
  el('counts').textContent = result.total === result.shown
    ? `${result.total} RFQ${result.total === 1 ? '' : 's'}`
    : `Showing ${result.shown} of ${result.total} RFQs`;

  el('winrate').textContent = result.winRate === null
    ? ''
    : `Win rate: ${result.winRate}% (${result.won} of ${result.won + result.lost} decided)`;
}

/**
 * The status filter. Ticking every box and ticking none would show the same
 * thing, so "All" is a shortcut rather than a state of its own, and main
 * refuses to store an empty list.
 */
function renderFilters() {
  const box = el('filters');
  const { statuses, statusColors, settings } = App.state;
  const on = new Set(settings.visibleStatuses);

  box.innerHTML = '<span class="label">Show:</span>';

  const all = document.createElement('label');
  const allOn = statuses.every((s) => on.has(s));
  all.className = 'chip';
  all.dataset.on = String(allOn);
  all.innerHTML = `<input type="checkbox" ${allOn ? 'checked' : ''} /> All`;
  all.querySelector('input').addEventListener('change', (e) => {
    App.setSettings({ visibleStatuses: e.target.checked ? [...statuses] : [] });
  });
  box.appendChild(all);

  for (const s of statuses) {
    const chip = document.createElement('label');
    chip.className = 'chip';
    chip.dataset.on = String(on.has(s));
    chip.style.setProperty('--chip', statusColors[s]);
    chip.innerHTML = `<input type="checkbox" ${on.has(s) ? 'checked' : ''} /> ${esc(s)}`;
    chip.querySelector('input').addEventListener('change', (e) => {
      const next = new Set(settings.visibleStatuses);
      if (e.target.checked) next.add(s);
      else next.delete(s);
      App.setSettings({ visibleStatuses: [...next] });
    });
    box.appendChild(chip);
  }
}

// --- small shared UI -------------------------------------------------------

let toastTimer = null;
App.toast = function toast(text, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.textContent = text;
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'bad' ? 5000 : 2600);
};

/**
 * A popup menu at a point on screen. Items are { label, color, onClick } or the
 * string 'sep'. Closes on the next click anywhere, on Escape, and on scroll -
 * a menu still floating over a table that has moved under it is worse than no
 * menu at all.
 */
App.showMenu = function showMenu(x, y, items) {
  const menu = el('menu');
  menu.innerHTML = '';

  for (const item of items) {
    if (item === 'sep') {
      menu.appendChild(document.createElement('hr'));
      continue;
    }
    const b = document.createElement('button');
    b.textContent = item.label;
    if (item.color) b.style.color = item.color;
    b.addEventListener('click', () => {
      App.hideMenu();
      item.onClick();
    });
    menu.appendChild(b);
  }

  menu.hidden = false;
  // Measure, then nudge back on screen if it would hang off an edge.
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;

  // Close on the next click outside. Registered a tick later, because the click
  // that opened this menu is still bubbling and would otherwise close it again
  // before anyone saw it.
  setTimeout(() => {
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) App.hideMenu();
    }, { once: true });
  }, 0);
};

App.hideMenu = function hideMenu() {
  el('menu').hidden = true;
};

/** A modal yes/no. Returns a promise for the answer. */
App.confirm = function confirm({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <div class="dlg-head">${esc(title)}</div>
      <div class="dlg-body" style="max-width:420px">${esc(message)}</div>
      <div class="dlg-foot">
        <button class="btn" value="no">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'accent'}" value="yes">${esc(confirmLabel)}</button>
      </div>`;

    const finish = (answer) => {
      dlg.close();
      dlg.remove();
      resolve(answer);
    };
    dlg.querySelector('[value="no"]').addEventListener('click', () => finish(false));
    dlg.querySelector('[value="yes"]').addEventListener('click', () => finish(true));
    // Esc fires 'cancel' on a native dialog, which is the answer "no".
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });

    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[value="yes"]').focus();
  });
};

// --- first-run import ------------------------------------------------------

function renderImportNotice() {
  const found = App.state.legacyCandidate;
  const notice = el('import-notice');
  notice.hidden = !found;
  if (!found) return;
  el('import-path').textContent = `Found ${found} — import its RFQs, notes and reminders?`;
}

async function runImport(path) {
  const res = await call(App.api.importLegacy(path));
  if (!res || res.cancelled) return;

  App.state = res.state || App.state;
  App.state.legacyCandidate = '';
  el('import-notice').hidden = true;
  applyTheme();
  renderFilters();
  await App.refresh();
  App.toast(`Imported ${res.rfqs} RFQs, ${res.activity} notes and ${res.reminders} reminders.`);
}

// --- wiring ----------------------------------------------------------------

let searchTimer = null;
el('search').addEventListener('input', (e) => {
  App.search = e.target.value;
  // One query per pause in typing, not one per keystroke.
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => App.refresh(), 150);
});

el('new-rfq').addEventListener('click', () => Detail.open(null));
el('options').addEventListener('click', () => Options.open());

el('import-now').addEventListener('click', () => runImport(App.state.legacyCandidate));
el('import-pick').addEventListener('click', () => runImport(''));
el('import-dismiss').addEventListener('click', () => {
  // Dismissing hides the offer for this session only. It is not marked as
  // imported, because "not now" is not "never".
  el('import-notice').hidden = true;
});

function showView(which) {
  const isList = which === 'list';
  el('view-list').hidden = !isList;
  el('view-calendar').hidden = isList;
  el('tab-list').setAttribute('aria-selected', String(isList));
  el('tab-calendar').setAttribute('aria-selected', String(!isList));
  if (!isList) CalendarView.refresh();
}

el('tab-list').addEventListener('click', () => showView('list'));
el('tab-calendar').addEventListener('click', () => showView('calendar'));

window.addEventListener('blur', App.hideMenu);
document.addEventListener('scroll', App.hideMenu, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') App.hideMenu();

  // Shortcuts belong to the window, not to a dialog that is currently open over
  // it - Ctrl+N inside the detail editor should type nothing and do nothing.
  if (document.querySelector('dialog[open]')) return;

  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

  if (e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    Detail.open(null);
  } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    el('search').focus();
    el('search').select();
  } else if (e.key === 'Delete' && !typing && App.selectedId) {
    e.preventDefault();
    ListView.deleteSelected();
  } else if (e.key === 'Enter' && !typing && App.selectedId) {
    e.preventDefault();
    Detail.open(App.selectedId);
  }
});

/**
 * Shown from two places - the event, and the state snapshot at boot - because
 * the check in main can finish on either side of this window being ready.
 * Assigning onclick rather than adding a listener keeps a second call from
 * opening the browser twice.
 */
function showUpdate({ version, url }) {
  const btn = el('update');
  btn.hidden = false;
  btn.innerHTML = `${App.icon('bell')} Version ${esc(version)} is available — download`;
  btn.onclick = () => App.api.openExternal(url);
}

App.api.onUpdateAvailable(showUpdate);

App.api.onNewRfq((payload) => {
  if (payload.openRfqId) Detail.open(payload.openRfqId);
  else Detail.open(null);
});

// --- boot ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const res = await call(App.api.getState());
  if (!res) return;

  App.state = res;
  el('version').textContent = `v${res.version}`;
  applyTheme();
  renderFilters();
  renderImportNotice();
  // The check may already have finished while this window was loading.
  if (res.update) showUpdate(res.update);
  ListView.init();
  CalendarView.init();
  await App.refresh();
});
