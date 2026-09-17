'use strict';
/**
 * The entire surface the renderer is allowed to touch.
 *
 * This file is the security boundary. contextIsolation keeps the renderer's
 * JavaScript in a separate world, and only what is listed here crosses over.
 * Never expose `ipcRenderer` itself, and never expose a function that takes a
 * channel name from the caller - either one hands web content the ability to
 * invoke any handler in main, which defeats the whole arrangement.
 *
 * Keep it to thin pass-throughs. Logic belongs in main (testable) or in the
 * renderer (visible); a preload that does real work is hard to reach from
 * either side.
 */

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

contextBridge.exposeInMainWorld('app', {
  // --- settings ------------------------------------------------------------
  getState: () => ipcRenderer.invoke(C.GET_STATE),
  setSettings: (patch) => ipcRenderer.invoke(C.SET_SETTINGS, patch),

  // --- RFQs ----------------------------------------------------------------
  query: (opts) => ipcRenderer.invoke(C.QUERY_RFQS, opts),
  getRfq: (id) => ipcRenderer.invoke(C.GET_RFQ, id),
  saveRfq: (id, fields) => ipcRenderer.invoke(C.SAVE_RFQ, { id, fields }),
  deleteRfq: (id) => ipcRenderer.invoke(C.DELETE_RFQ, id),
  setStatus: (id, status) => ipcRenderer.invoke(C.SET_STATUS, { id, status }),
  duplicateRfq: (id) => ipcRenderer.invoke(C.DUPLICATE_RFQ, id),

  // --- activity and reminders ----------------------------------------------
  addActivity: (id, entry) => ipcRenderer.invoke(C.ADD_ACTIVITY, { id, entry }),
  addReminder: (id, date, time) => ipcRenderer.invoke(C.ADD_REMINDER, { id, date, time }),
  deleteReminder: (id, reminderId) => ipcRenderer.invoke(C.DELETE_REMINDER, { id, reminderId }),

  // --- autofill and calendar -----------------------------------------------
  suggest: (field, text) => ipcRenderer.invoke(C.SUGGEST, { field, text }),
  lookupContact: (field, value) => ipcRenderer.invoke(C.LOOKUP_CONTACT, { field, value }),
  monthDue: (year, month) => ipcRenderer.invoke(C.MONTH_DUE, { year, month }),

  // --- housekeeping --------------------------------------------------------
  importLegacy: (path) => ipcRenderer.invoke(C.IMPORT_LEGACY, { path }),
  openExternal: (url) => ipcRenderer.invoke(C.OPEN_EXTERNAL, url),

  // Subscriptions take a callback and unwrap the IpcRendererEvent, so the
  // renderer never sees an Electron object.
  onUpdateAvailable: (fn) => ipcRenderer.on(C.UPDATE_AVAILABLE, (_e, d) => fn(d)),
  onNewRfq: (fn) => ipcRenderer.on(C.NEW_RFQ, (_e, d) => fn(d || {})),
  onDataChanged: (fn) => ipcRenderer.on(C.DATA_CHANGED, (_e, d) => fn(d)),
});
