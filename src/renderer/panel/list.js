'use strict';
/**
 * The list view: the table, its column sorting, and the two menus that hang
 * off a row.
 *
 * Rows are rebuilt wholesale on every refresh. With a few hundred RFQs that is
 * one innerHTML assignment and well under a frame, and it means there is
 * exactly one path that turns data into DOM - no patching, no stale row that
 * disagrees with the database because an update forgot a field.
 */

const ListView = (() => {
  /**
   * The columns, with the share of the width each one gets.
   *
   * Widths are declared rather than left to the browser because the table is
   * laid out fixed: every column then fits at the minimum window size and long
   * values ellipsise, instead of the table growing wider than the window and
   * pushing the due date - the one column you scan for - off the right edge.
   */
  const COLUMNS = [
    { key: 'status', label: 'Status', width: '112px', cls: 'status-cell' },
    { key: 'description', label: 'RFQ Description', width: '22%' },
    { key: 'name', label: 'Contact Name', width: '15%' },
    { key: 'company', label: 'Company', width: '16%' },
    { key: 'phone', label: 'Phone', width: '122px' },
    { key: 'email', label: 'Email', width: '17%' },
    { key: 'dateCreated', label: 'Created', width: '96px' },
    { key: 'dueDate', label: 'Due Date', width: '96px' },
  ];

  const esc = App.esc;
  const rows = () => document.getElementById('rows');

  function renderHead() {
    const { sortColumn, sortReverse } = App.state.settings;
    document.getElementById('cols').innerHTML = COLUMNS
      .map((c) => `<col style="width:${c.width}" />`).join('');
    document.getElementById('head-row').innerHTML = COLUMNS.map((c) => {
      const arrow = c.key === sortColumn
        ? `<span class="arrow">${sortReverse ? '▼' : '▲'}</span>`
        : '';
      const cls = c.cls ? ` class="${c.cls}"` : '';
      return `<th${cls} data-col="${c.key}" title="Sort by ${esc(c.label)}">${esc(c.label)}${arrow}</th>`;
    }).join('');
  }

  function cell(row, key) {
    const value = row[key];
    if (key === 'status') {
      const color = App.state.statusColors[value] || 'inherit';
      return `<td class="status-cell"><button class="pill" style="color:${color}" `
        + `title="Click to change status"><span>${esc(value)}</span></button></td>`;
    }
    if (!value) return '<td class="muted">—</td>';

    // The two counts that tell you there is more behind the row than the row.
    let extra = '';
    if (key === 'description') {
      if (row.reminderCount) extra += `<span class="badge" title="Pending reminders">⏰ ${row.reminderCount}</span>`;
      if (row.noteCount > 1) extra += `<span class="badge" title="Activity entries">\u{1F4DD} ${row.noteCount}</span>`;
    }
    return `<td title="${esc(value)}">${esc(value)}${extra}</td>`;
  }

  /**
   * Repaints the table.
   *
   * The scroll position is carried across by hand. Assigning innerHTML throws
   * it away, and since every change - a status, a note, a saved edit - comes
   * back through here, losing it would mean being flung to the top of the list
   * several times a minute.
   *
   * The sort itself cannot be lost: it lives in settings and is applied by
   * every query, so a row that moves after a status change has moved to where
   * the current sort puts it. That was a real bug in the tkinter version, where
   * refreshing rebuilt the table in insertion order and the saved sort was only
   * re-applied at startup.
   */
  function render(result) {
    renderHead();

    const wrap = document.querySelector('.table-wrap');
    const scroll = wrap.scrollTop;

    const body = rows();
    body.innerHTML = result.rows.map((r) => {
      const sel = String(r.id) === String(App.selectedId);
      return `<tr data-id="${r.id}"${r.urgency ? ` class="${r.urgency}"` : ''}`
        + `${sel ? ' aria-selected="true"' : ''}>`
        + COLUMNS.map((c) => cell(r, c.key)).join('')
        + '</tr>';
    }).join('');

    wrap.scrollTop = scroll;

    const empty = document.getElementById('empty');
    empty.hidden = result.rows.length > 0;
    if (!result.rows.length) {
      empty.textContent = result.total === 0
        ? 'No RFQs yet. Press Ctrl+N to add the first one.'
        : 'Nothing matches the search and filters.';
    }
  }

  /**
   * Scrolls the selected row back into view and flashes it.
   *
   * Called after a change that can move a row under the current sort - marking
   * something Done sinks it to the bottom, and sorting by status moves it
   * outright. Without this the row simply vanishes from where you were looking,
   * which reads as the list having scrambled itself.
   */
  function revealSelected() {
    const tr = rows().querySelector('tr[aria-selected="true"]');
    if (!tr) return;
    tr.scrollIntoView({ block: 'nearest' });
    tr.classList.remove('moved');
    // Reading offsetWidth restarts the animation; without it, a second change
    // to the same row does not flash at all.
    void tr.offsetWidth;
    tr.classList.add('moved');
  }

  // --- actions -------------------------------------------------------------

  function select(id) {
    App.selectedId = id;
    for (const tr of rows().children) {
      // setAttribute rather than toggleAttribute: the CSS matches the value
      // "true", and a bare aria-selected attribute is not that.
      if (tr.dataset.id === String(id)) tr.setAttribute('aria-selected', 'true');
      else tr.removeAttribute('aria-selected');
    }
  }

  function rowById(id) {
    return (App.result?.rows || []).find((r) => String(r.id) === String(id)) || null;
  }

  function describe(id) {
    const r = rowById(id);
    if (!r) return 'this RFQ';
    return r.description || r.name || r.company || `RFQ ${id}`;
  }

  async function setStatus(id, status) {
    if (!await App.call(App.api.setStatus(id, status))) return;
    await App.refresh();
    // The row has very likely moved - a new status sorts differently, and Done
    // and Lost sink to the bottom. Show where it went.
    revealSelected();
  }

  function statusMenu(x, y, id) {
    App.showMenu(x, y, App.state.statuses.map((s) => ({
      label: s,
      color: App.state.statusColors[s],
      onClick: () => setStatus(id, s),
    })));
  }

  async function duplicate(id) {
    const res = await App.call(App.api.duplicateRfq(id));
    if (!res) return;
    await App.refresh();
    // Open the copy straight away: a duplicate always needs one field changed,
    // and the old app dropped you into the editor for exactly that reason.
    Detail.open(res.rfq.id);
  }

  async function remove(id) {
    const ok = await App.confirm({
      title: 'Delete RFQ',
      message: `Permanently delete "${describe(id)}", along with its notes and reminders? `
        + 'This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (await App.call(App.api.deleteRfq(id))) {
      if (String(App.selectedId) === String(id)) App.selectedId = null;
      App.refresh();
    }
  }

  function contextMenu(x, y, id) {
    App.showMenu(x, y, [
      { label: 'Open / Edit', onClick: () => Detail.open(id) },
      { label: 'Duplicate RFQ', onClick: () => duplicate(id) },
      'sep',
      { label: 'Add quick note…', onClick: () => Detail.open(id, { tab: 'activity' }) },
      'sep',
      { label: 'Mark In Progress', color: App.state.statusColors['In Progress'], onClick: () => setStatus(id, 'In Progress') },
      { label: 'Mark Quoted', color: App.state.statusColors.Quoted, onClick: () => setStatus(id, 'Quoted') },
      { label: 'Mark Done', color: App.state.statusColors.Done, onClick: () => setStatus(id, 'Done') },
      'sep',
      { label: 'Delete RFQ', color: App.state.statusColors.Lost, onClick: () => remove(id) },
    ]);
  }

  // --- wiring --------------------------------------------------------------

  function init() {
    document.getElementById('head-row').addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const { sortColumn, sortReverse } = App.state.settings;
      // Clicking the sorted column flips it; clicking a new one starts ascending.
      App.setSettings({
        sortColumn: th.dataset.col,
        sortReverse: th.dataset.col === sortColumn ? !sortReverse : false,
      });
    });

    const body = rows();

    body.addEventListener('click', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      select(tr.dataset.id);

      const pill = e.target.closest('.pill');
      if (pill) {
        const r = pill.getBoundingClientRect();
        statusMenu(r.left, r.bottom + 2, tr.dataset.id);
      }
    });

    body.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr');
      // A double-click on the status pill is two status menus, not an editor.
      if (tr && !e.target.closest('.pill')) Detail.open(tr.dataset.id);
    });

    body.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      e.preventDefault();
      select(tr.dataset.id);
      contextMenu(e.clientX, e.clientY, tr.dataset.id);
    });
  }

  return {
    init,
    render,
    select,
    revealSelected,
    deleteSelected: () => remove(App.selectedId),
    COLUMNS,
  };
})();
