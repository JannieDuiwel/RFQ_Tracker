'use strict';
/**
 * Options.
 *
 * Every toggle here maps to exactly one key in store.js, and applies the moment
 * it changes - including dark mode, which the tkinter version could only do by
 * restarting the whole app. There is no Save button because there is nothing to
 * save: main has already written the file by the time the checkbox has finished
 * animating.
 */

const Options = (() => {
  const esc = App.esc;

  function toggle({ key, title, sub, disabled }) {
    const on = App.state.settings[key];
    return `<label class="toggle">
        <input type="checkbox" data-key="${key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span>
          <span class="title">${esc(title)}</span>
          <span class="sub" style="display:block">${esc(sub)}</span>
        </span>
      </label>`;
  }

  function open() {
    const s = App.state.settings;

    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <div class="dlg-head">${App.icon('sliders')} Options</div>
      <div class="dlg-body" style="width:480px">

        <label class="toggle">
          <input type="checkbox" data-theme-toggle ${s.theme === 'dark' ? 'checked' : ''} />
          <span>
            <span class="title">Dark mode</span>
            <span class="sub" style="display:block">Applies immediately.</span>
          </span>
        </label>

        <hr class="sep" />

        ${toggle({
    key: 'startWithWindows',
    title: 'Start with Windows',
    sub: 'Launch RFQ Tracker when you log in, so reminders can fire.',
  })}
        ${toggle({
    key: 'minimizeToTray',
    title: 'Minimize to the system tray',
    sub: 'Hide to the tray instead of the taskbar when minimising.',
  })}
        ${toggle({
    key: 'closeToTray',
    title: 'Close to the system tray',
    sub: 'Keep running in the tray when the window is closed. Exit from the tray menu.',
  })}

        <hr class="sep" />

        <div class="field" style="max-width:220px">
          <label for="o-due">Highlight due dates within</label>
          <input id="o-due" type="number" min="0" max="90" value="${Number(s.dueSoonDays)}" />
          <div class="hint">days. Overdue rows are always flagged.</div>
        </div>

        ${toggle({
    key: 'checkForUpdates',
    title: 'Check for updates on launch',
    sub: 'Asks GitHub whether a newer release exists. The only time this app uses the network.',
  })}

        <hr class="sep" />

        <div class="row">
          <div class="grow">
            <div class="title">Import from the old RFQ Tracker</div>
            <div class="sub hint">Reads an rfq_tracker.db and adds its RFQs to this one.</div>
          </div>
          <button class="btn" id="o-import">Choose file&hellip;</button>
        </div>
      </div>

      <div class="dlg-foot">
        <button class="btn accent" id="o-close">Done</button>
      </div>`;

    document.body.appendChild(dlg);

    dlg.querySelector('[data-theme-toggle]').addEventListener('change', (e) => {
      App.setSettings({ theme: e.target.checked ? 'dark' : 'light' });
    });

    dlg.querySelectorAll('[data-key]').forEach((box) => {
      box.addEventListener('change', () => {
        App.setSettings({ [box.dataset.key]: box.checked });
      });
    });

    dlg.querySelector('#o-due').addEventListener('change', (e) => {
      App.setSettings({ dueSoonDays: Number(e.target.value) });
    });

    dlg.querySelector('#o-import').addEventListener('click', async () => {
      const res = await App.call(App.api.importLegacy(''));
      if (!res || res.cancelled) return;
      App.state = res.state || App.state;
      await App.refresh();
      App.toast(`Imported ${res.rfqs} RFQs, ${res.activity} notes and ${res.reminders} reminders.`);
    });

    const finish = () => {
      dlg.close();
      dlg.remove();
    };
    dlg.querySelector('#o-close').addEventListener('click', finish);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish();
    });

    dlg.showModal();
  }

  return { open };
})();
