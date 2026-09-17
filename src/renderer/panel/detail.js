'use strict';
/**
 * The RFQ editor: details, activity log and reminders, in one modal.
 *
 * A <dialog> rather than a second BrowserWindow. The tkinter version used a
 * Toplevel because that was the only thing it had; here a real window would
 * mean a second preload, a second renderer directory and a way to tell the
 * first window that something changed - all to show eight fields over the table
 * they came from. showModal() already gives the modal behaviour, the backdrop,
 * the focus trap and Escape.
 *
 * Details are edited and then saved. Notes and reminders are not: they belong
 * to a record that already exists, they are appended rather than edited, and
 * they save the moment you add them. That asymmetry is deliberate - a note you
 * typed should not be lost because you pressed Cancel on the fields above it.
 */

const Detail = (() => {
  const esc = App.esc;

  let dlg = null;
  let rfq = null;
  let isNew = false;
  let saved = null; // field values as last written, to detect real edits

  const FIELDS = ['description', 'name', 'company', 'phone', 'email', 'status', 'dateCreated', 'dueDate'];

  const input = (name) => dlg.querySelector(`[name="${name}"]`);

  function values() {
    const out = {};
    for (const f of FIELDS) out[f] = input(f).value.trim();
    return out;
  }

  function dirty() {
    const now = values();
    return FIELDS.some((f) => now[f] !== saved[f]);
  }

  // --- markup --------------------------------------------------------------

  function template() {
    const statuses = App.state.statuses
      .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

    return `
      <div class="dlg-head">${App.icon('clipboard')} ${isNew ? 'New RFQ' : 'RFQ Details'}</div>

      <div class="dlg-tabs">
        <button class="tab" data-tab="details" aria-selected="true">Details</button>
        <button class="tab" data-tab="activity" aria-selected="false">Activity Log</button>
        <button class="tab" data-tab="reminders" aria-selected="false">Reminders</button>
      </div>

      <div class="dlg-body" style="width:620px">
        <section data-panel="details">
          <div class="field">
            <label for="d-description">RFQ description</label>
            <input id="d-description" name="description" type="text"
                   placeholder="What is being quoted" />
          </div>
          <div class="grid-2">
            <div class="field ac-wrap">
              <label for="d-name">Contact name *</label>
              <input id="d-name" name="name" type="text" autocomplete="off" />
            </div>
            <div class="field ac-wrap">
              <label for="d-company">Company</label>
              <input id="d-company" name="company" type="text" autocomplete="off" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="d-phone">Phone / cell</label>
              <input id="d-phone" name="phone" type="text" />
            </div>
            <div class="field">
              <label for="d-email">Email address</label>
              <input id="d-email" name="email" type="text" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="d-status">Status</label>
              <select id="d-status" name="status">${statuses}</select>
            </div>
            <div class="field">
              <label for="d-dueDate">Due date</label>
              <input id="d-dueDate" name="dueDate" type="date" />
            </div>
          </div>
          <div class="field" style="max-width:50%">
            <label for="d-dateCreated">Date created</label>
            <input id="d-dateCreated" name="dateCreated" type="date" />
          </div>
        </section>

        <section data-panel="activity" hidden>
          <div class="log" id="d-log"></div>
          <div class="row" style="margin-top:8px">
            <input class="grow" id="d-note" type="text"
                   placeholder="e.g. Quote #1234 sent, following up Monday" />
            <button class="btn accent" id="d-add-note">Add note</button>
          </div>
          <div class="hint" id="d-note-hint">Every entry is timestamped automatically.</div>
        </section>

        <section data-panel="reminders" hidden>
          <div class="row">
            <div class="field" style="margin:0"><label for="d-rem-date">Date</label>
              <input id="d-rem-date" type="date" /></div>
            <div class="field" style="margin:0"><label for="d-rem-time">Time</label>
              <input id="d-rem-time" type="time" value="09:00" /></div>
            <button class="btn primary" id="d-add-rem" style="margin-top:16px">Set reminder</button>
          </div>
          <div class="hint">
            A Windows notification, as long as RFQ Tracker is running or sitting in the tray.
          </div>
          <ul class="rem-list" id="d-rem-list"></ul>
        </section>
      </div>

      <div class="dlg-foot">
        <span class="error left" id="d-error"></span>
        <button class="btn" id="d-cancel">Cancel</button>
        <button class="btn accent" id="d-save">Save RFQ</button>
      </div>`;
  }

  // --- panels --------------------------------------------------------------

  function renderLog() {
    const log = dlg.querySelector('#d-log');
    const entries = (rfq?.activity || []);

    log.innerHTML = entries.length
      ? entries.map((a) => `<div class="entry"><div class="ts">${esc(a.ts)}</div>`
        + `<div class="body">${esc(a.entry)}</div></div>`).join('')
      : '<div class="hint">No activity yet. Add the first note below.</div>';

    // Newest entries are at the bottom, which is where the eye should land.
    log.scrollTop = log.scrollHeight;

    const canAdd = !isNew;
    dlg.querySelector('#d-note').disabled = !canAdd;
    dlg.querySelector('#d-add-note').disabled = !canAdd;
    dlg.querySelector('#d-note-hint').textContent = canAdd
      ? 'Every entry is timestamped automatically.'
      : 'Save the RFQ first, then notes can be added to it.';
  }

  function renderReminders() {
    const list = dlg.querySelector('#d-rem-list');
    const items = (rfq?.reminders || []);

    list.innerHTML = items.length
      ? items.map((r) => `<li data-id="${r.id}">
          <span class="when">${esc(r.remindAt)}</span>
          <span class="${r.notified ? 'sent' : 'pending'}">${r.notified
    ? `${App.icon('check', 'ico-sm')} sent`
    : `${App.icon('clock', 'ico-sm')} pending`}</span>
          <span style="flex:1"></span>
          <button class="btn" data-remove="${r.id}">Remove</button>
        </li>`).join('')
      : '<li class="hint" style="border:0;background:none">No reminders set.</li>';

    dlg.querySelector('#d-add-rem').disabled = isNew;
  }

  function showTab(which) {
    for (const b of dlg.querySelectorAll('.dlg-tabs .tab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === which));
    }
    for (const s of dlg.querySelectorAll('[data-panel]')) {
      s.hidden = s.dataset.panel !== which;
    }
    if (which === 'activity' && !isNew) dlg.querySelector('#d-note').focus();
  }

  function error(text) {
    dlg.querySelector('#d-error').textContent = text || '';
  }

  // --- autocomplete --------------------------------------------------------

  /**
   * Suggests previous contacts or companies, and fills in the rest of the row
   * when one is picked - which is the whole point: the second RFQ for a
   * customer should not mean retyping their phone number.
   *
   * Only empty fields are filled. Overwriting something the user has already
   * typed, because they happened to pick a name afterwards, is the kind of
   * helpfulness that loses data.
   */
  function attachAutocomplete(field) {
    const box = input(field);
    const wrap = box.closest('.ac-wrap');
    let list = null;
    let items = [];
    let index = -1;
    let timer = null;

    /**
     * Two steps, not one: hide() takes the list off the page, close() also
     * forgets what was in it. Redrawing needs the first without the second -
     * collapsing them into one function means render() wipes the suggestions it
     * was about to draw, and nothing ever appears.
     */
    const hide = () => {
      if (list) list.remove();
      list = null;
      index = -1;
    };

    const close = () => {
      hide();
      items = [];
    };

    function highlight() {
      if (!list) return;
      [...list.children].forEach((li, i) => {
        li.setAttribute('aria-selected', String(i === index));
      });
    }

    async function pick(value) {
      box.value = value;
      close();
      const res = await App.call(App.api.lookupContact(field, value), { quiet: true });
      const match = res && res.match;
      if (!match) return;
      for (const f of ['name', 'company', 'phone', 'email']) {
        if (f !== field && !input(f).value.trim() && match[f]) input(f).value = match[f];
      }
    }

    function render() {
      hide();
      if (!items.length) return;
      list = document.createElement('ul');
      list.className = 'ac';
      list.innerHTML = items.map((v) => `<li>${esc(v)}</li>`).join('');
      [...list.children].forEach((li, i) => {
        // mousedown, not click: blur fires first on a click and would have
        // closed the list before the selection landed.
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(items[i]);
        });
      });
      wrap.appendChild(list);
    }

    box.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const res = await App.call(App.api.suggest(field, box.value), { quiet: true });
        items = (res && res.items) || [];
        // Nothing to suggest if the only match is what is already typed.
        if (items.length === 1 && items[0].toLowerCase() === box.value.trim().toLowerCase()) {
          items = [];
        }
        index = -1;
        render();
      }, 120);
    });

    box.addEventListener('keydown', (e) => {
      if (!list) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        highlight();
      } else if (e.key === 'Enter' && index >= 0) {
        e.preventDefault();
        pick(items[index]);
      } else if (e.key === 'Escape') {
        // Close the list, but do not let Escape reach the dialog and shut it.
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    });

    box.addEventListener('blur', () => setTimeout(close, 120));
  }

  // --- actions -------------------------------------------------------------

  async function reload() {
    if (isNew) return;
    const res = await App.call(App.api.getRfq(rfq.id));
    if (res && res.rfq) rfq = res.rfq;
  }

  async function addNote() {
    const box = dlg.querySelector('#d-note');
    const text = box.value.trim();
    if (!text) return;

    const res = await App.call(App.api.addActivity(rfq.id, text));
    if (!res) return;
    rfq = res.rfq;
    box.value = '';
    renderLog();
    App.refresh();
  }

  async function addReminder() {
    const date = dlg.querySelector('#d-rem-date').value;
    const time = dlg.querySelector('#d-rem-time').value;

    const res = await App.call(App.api.addReminder(rfq.id, date, time));
    if (!res) return;
    rfq = res.rfq;
    renderReminders();
    App.refresh();
    App.toast(`Reminder set for ${res.reminder.remindAt}.`);
  }

  async function removeReminder(reminderId) {
    const res = await App.call(App.api.deleteReminder(rfq.id, reminderId));
    if (!res) return;
    rfq = res.rfq;
    renderReminders();
    App.refresh();
  }

  async function save() {
    const fields = values();
    if (!fields.name) {
      error('Contact name is required.');
      showTab('details');
      input('name').focus();
      return;
    }

    const res = await App.call(App.api.saveRfq(isNew ? null : rfq.id, fields));
    if (!res) return;

    // Save closes, new or not. An earlier version kept a first save open so
    // notes could be added to the record it had just created, but a button
    // labelled "Save RFQ" that leaves the dialog sitting there reads as a save
    // that did not work. Notes are two clicks away from the row instead.
    const id = res.rfq.id;
    close(true);
    await App.refresh();

    // Land on what was just saved, so a new RFQ does not vanish into a sorted
    // list of eighty.
    ListView.select(id);
    ListView.revealSelected();
  }

  function close(force) {
    if (!force && dirty()) {
      App.confirm({
        title: 'Discard changes?',
        message: 'This RFQ has edits that have not been saved.',
        confirmLabel: 'Discard',
      }).then((yes) => {
        if (yes) close(true);
      });
      return;
    }
    dlg.close();
    dlg.remove();
    dlg = null;
    rfq = null;
  }

  // --- open ----------------------------------------------------------------

  async function open(id, { tab = 'details' } = {}) {
    // One editor at a time. Opening a second over the first is how you end up
    // saving the wrong one.
    if (dlg) close(true);

    isNew = !id;
    if (isNew) {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      rfq = {
        description: '', name: '', company: '', phone: '', email: '',
        status: 'Pending', dateCreated: iso, dueDate: '', activity: [], reminders: [],
      };
    } else {
      const res = await App.call(App.api.getRfq(id));
      if (!res || !res.rfq) {
        App.toast('That RFQ no longer exists.', 'bad');
        return;
      }
      rfq = res.rfq;
    }

    dlg = document.createElement('dialog');
    dlg.innerHTML = template();
    document.body.appendChild(dlg);

    for (const f of FIELDS) input(f).value = rfq[f] || '';
    saved = values();

    dlg.querySelectorAll('.dlg-tabs .tab').forEach((b) => {
      b.addEventListener('click', () => showTab(b.dataset.tab));
    });

    dlg.querySelector('#d-save').addEventListener('click', save);
    dlg.querySelector('#d-cancel').addEventListener('click', () => close());
    dlg.querySelector('#d-add-note').addEventListener('click', addNote);
    dlg.querySelector('#d-note').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addNote();
    });
    dlg.querySelector('#d-add-rem').addEventListener('click', addReminder);
    dlg.querySelector('#d-rem-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) removeReminder(btn.dataset.remove);
    });

    // Ctrl+S from anywhere in the dialog, since the fields are what it is for.
    dlg.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    });

    // Escape reaches the dialog as 'cancel'; route it through the same
    // unsaved-changes check as the Cancel button.
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });

    attachAutocomplete('name');
    attachAutocomplete('company');

    dlg.querySelector('#d-rem-date').value = rfq.dueDate || saved.dateCreated;

    renderLog();
    renderReminders();
    dlg.showModal();
    showTab(tab);
    if (tab === 'details') input('description').focus();
  }

  return { open };
})();
