'use strict';
/**
 * Main process: window, tray, lifecycle and IPC.
 *
 * The only file that knows about both Electron and the app's own modules.
 * Everything it calls - store, db, reminders, updates, legacy-import - is plain
 * Node that a test can drive without booting a browser, which is what keeps the
 * suite fast and dependency-free.
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, Notification, nativeImage,
} = require('electron');
const path = require('path');

const C = require('../shared/channels');
const { STATUSES, STATUS_COLORS } = require('../shared/statuses');
const { reminderString } = require('../shared/dates');
const { Store, DEFAULTS } = require('./store');
const { Db } = require('./db');
const { ReminderService } = require('./reminders');
const { checkForUpdate } = require('./updates');
const { findLegacyDb, importLegacy } = require('./legacy-import');

const DEV = process.argv.includes('--dev');

let win = null;
let tray = null;
let store = null;
let db = null;
let reminders = null;

/**
 * Set before any window exists. Windows matches this against the AppUserModelID
 * baked into the installed shortcut to decide whose name and icon appear on a
 * toast - without it, a reminder arrives from "Electron".
 */
app.setAppUserModelId('com.janherman.rfqtracker');

// True only while quitting for real, so the close handler can tell "hide to
// tray" from "the user picked Exit".
let quitting = false;

const asset = (name) => path.join(__dirname, '..', 'assets', name);

// --- window ----------------------------------------------------------------

function createWindow() {
  const s = store.get();

  win = new BrowserWindow({
    width: s.windowWidth,
    height: s.windowHeight,
    minWidth: 900,
    minHeight: 600,
    // Painted before the renderer loads, so startup is not a white flash - and
    // matched to the theme, so it is not a black one either.
    backgroundColor: s.theme === 'dark' ? '#1e1e2e' : '#f4f6fb',
    show: false,
    autoHideMenuBar: true,
    icon: asset('icon-512.png'),
    title: 'RFQ Tracker',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'panel.js'),
      // The security baseline. The renderer gets no Node access; everything it
      // may do is listed explicitly in preload/panel.js. sandbox stays false so
      // preload can use require() - it is trusted code that we wrote.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html'));
  win.once('ready-to-show', () => {
    if (s.windowMaximized) win.maximize();
    win.show();
  });

  // Remember the size, debounced - 'resize' fires per pixel dragged and every
  // one of those would be a disk write.
  let resizeTimer = null;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMaximized()) return;
      const [w, h] = win.getSize();
      store.update({ windowWidth: w, windowHeight: h });
    }, 400);
  });
  win.on('maximize', () => store.update({ windowMaximized: true }));
  win.on('unmaximize', () => store.update({ windowMaximized: false }));

  win.on('minimize', (e) => {
    if (!store.get().minimizeToTray || !tray) return;
    e.preventDefault();
    win.hide();
  });

  win.on('close', (e) => {
    if (quitting || !store.get().closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
  });

  if (DEV) {
    win.webContents.openDevTools({ mode: 'detach' });

    // A throw while wiring listeners silently kills every listener after it,
    // which presents as "that button does nothing". Forwarding renderer errors
    // to the terminal makes that visible instead of mysterious. The signature
    // changed across Electron versions: older builds pass positional args,
    // newer ones a details object.
    win.webContents.on('console-message', (...args) => {
      const d = typeof args[1] === 'object'
        ? args[1]
        : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      const level = String(d.level);
      if (level === 'error' || level === 'warning' || Number(d.level) >= 2) {
        console.error(`[renderer] ${d.message} (${d.sourceId || '?'}:${d.lineNumber || 0})`);
      }
    });
  }

  // Never let web content open a real Electron window; hand links to the OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// --- tray ------------------------------------------------------------------

/**
 * Always created, even when both tray settings are off: the settings can be
 * turned on without restarting the app, and a tray icon that appears the moment
 * you tick the box is less confusing than one that needs a relaunch.
 */
function createTray() {
  try {
    const image = nativeImage.createFromPath(asset('tray.png'));
    if (image.isEmpty()) return;

    tray = new Tray(image);
    tray.setToolTip('RFQ Tracker');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open RFQ Tracker', click: showWindow },
      {
        label: 'New RFQ',
        click: () => {
          showWindow();
          send(C.NEW_RFQ);
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]));
    tray.on('click', showWindow);
  } catch (e) {
    // A missing tray icon is a cosmetic problem, not a reason to fail to start.
    console.error('tray unavailable:', e.message);
  }
}

// --- notifications ---------------------------------------------------------

function notifyReminder({ title, body, rfqId }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: asset('icon-512.png') });
  // Clicking the toast should land on the RFQ it is about, not just raise the
  // window and leave you to find it.
  n.on('click', () => {
    showWindow();
    send(C.NEW_RFQ, { openRfqId: rfqId });
  });
  n.show();
}

// --- IPC -------------------------------------------------------------------
//
// One handler per channel in shared/channels.js. Handlers return plain data and
// never throw across the boundary: an exception in a handler reaches the
// renderer as an opaque "Error invoking remote method", so catch it here and
// return { ok: false, error } instead.

/** Wraps a handler so a bug in it becomes a message, not a dead button. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, payload) => {
    try {
      return { ok: true, ...(await fn(payload)) };
    } catch (e) {
      console.error(`${channel} failed:`, e);
      return { ok: false, error: String(e?.message || e) };
    }
  });
}

function state() {
  const settings = store.get();
  return {
    settings,
    defaults: DEFAULTS,
    statuses: STATUSES,
    statusColors: STATUS_COLORS,
    version: app.getVersion(),
    // Empty unless there is an old database sitting somewhere obvious and it
    // has never been imported. The renderer turns it into an offer, once.
    legacyCandidate: (!settings.legacyImported && db.all().length === 0)
      ? findLegacyDb([
        app.getPath('desktop'),
        app.getPath('documents'),
        app.getPath('downloads'),
        app.getPath('home'),
      ])
      : '',
  };
}

handle(C.GET_STATE, () => state());

handle(C.SET_SETTINGS, (patch) => {
  const before = store.get().startWithWindows;
  const settings = store.update(patch);

  if (settings.startWithWindows !== before) {
    // Electron writes the same HKCU\...\Run value the tkinter app did, so the
    // two never fight over it - whichever ran last wins, which is what the user
    // just asked for.
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });
  }

  return state();
});

handle(C.QUERY_RFQS, (opts = {}) => ({
  result: db.query({ ...opts, dueSoonDays: store.get().dueSoonDays }),
}));

handle(C.GET_RFQ, (id) => ({ rfq: db.get(id) }));

handle(C.SAVE_RFQ, ({ id, fields }) => {
  const name = String(fields?.name || '').trim();
  if (!name) return { ok: false, error: 'Contact name is required.' };

  const rfq = id ? db.update(id, fields) : db.create(fields);
  if (!rfq) return { ok: false, error: 'That RFQ no longer exists.' };
  return { rfq };
});

handle(C.DELETE_RFQ, (id) => ({ removed: db.remove(id) }));
handle(C.SET_STATUS, ({ id, status }) => ({ rfq: db.setStatus(id, status) }));
handle(C.DUPLICATE_RFQ, (id) => ({ rfq: db.duplicate(id) }));

handle(C.ADD_ACTIVITY, ({ id, entry }) => ({ rfq: db.addActivity(id, entry) }));

handle(C.ADD_REMINDER, ({ id, date, time }) => {
  const remindAt = reminderString(date, time);
  if (!remindAt) {
    return { ok: false, error: 'Use YYYY-MM-DD for the date and HH:MM for the time.' };
  }
  const reminder = db.addReminder(id, remindAt);
  if (!reminder) return { ok: false, error: 'Save the RFQ before setting a reminder.' };
  return { reminder, rfq: db.get(id) };
});

handle(C.DELETE_REMINDER, ({ id, reminderId }) => ({
  removed: db.deleteReminder(id, reminderId),
  rfq: db.get(id),
}));

handle(C.SUGGEST, ({ field, text }) => ({ items: db.suggest(field, text) }));
handle(C.LOOKUP_CONTACT, ({ field, value }) => ({ match: db.lookup(field, value) }));
handle(C.MONTH_DUE, ({ year, month }) => ({ days: db.monthDue(year, month) }));

handle(C.IMPORT_LEGACY, async ({ path: given } = {}) => {
  let file = given;

  if (!file) {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose the old RFQ Tracker database',
      properties: ['openFile'],
      filters: [{ name: 'RFQ Tracker database', extensions: ['db'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { cancelled: true };
    file = picked.filePaths[0];
  }

  const res = importLegacy(file, db, store);
  if (!res.ok) return res;
  return { ...res, state: state() };
});

handle(C.OPEN_EXTERNAL, (url) => {
  // Only ever hand the OS an http(s) link. A renderer that has been made to ask
  // for file: or a shell verb should get a no, not a launched process.
  if (!/^https:\/\//.test(String(url))) return { ok: false, error: 'Blocked non-https link.' };
  shell.openExternal(url);
  return {};
});

// --- lifecycle -------------------------------------------------------------

// A second launch should focus the existing window, not start a rival copy that
// writes the same data file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // userData is the right home for settings and data. It is NOT the right
    // home for files the user should find in Explorer - and on a machine where
    // %APPDATA% is virtualised, Explorer cannot open it at all.
    const dir = app.getPath('userData');
    store = new Store(dir);
    db = new Db(dir);

    // Keep the registry in step with the setting on every launch: an installer,
    // a profile copy or a manual edit can leave the two disagreeing.
    app.setLoginItemSettings({ openAtLogin: store.get().startWithWindows });

    createWindow();
    createTray();

    reminders = new ReminderService({ db, notify: notifyReminder });
    reminders.start();

    if (store.get().checkForUpdates) {
      checkForUpdate(app.getVersion()).then((res) => {
        if (res.available) send(C.UPDATE_AVAILABLE, { version: res.version, url: res.url });
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    if (reminders) reminders.stop();
  });

  app.on('window-all-closed', () => {
    // With close-to-tray on, the window is hidden rather than closed, so this
    // only fires when the user really is done.
    if (process.platform !== 'darwin') app.quit();
  });
}
