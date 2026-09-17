'use strict';
/**
 * One place where the IPC vocabulary lives, so main, preload and the renderer
 * cannot drift apart.
 *
 * A typo'd channel name fails silently - the sender's promise resolves, no
 * handler runs, and nothing is logged. Naming every channel once turns that
 * into a reference error on the first run instead.
 */

module.exports = {
  // --- settings ------------------------------------------------------------
  GET_STATE: 'app:get-state',
  SET_SETTINGS: 'app:set-settings',

  // --- RFQs ----------------------------------------------------------------
  // The list query (search text, status filter, sort) runs in main rather than
  // the renderer: it is the part with rules worth testing - archive statuses
  // sinking to the bottom, blanks sorting last, the win-rate tally.
  QUERY_RFQS: 'rfq:query',
  GET_RFQ: 'rfq:get',
  SAVE_RFQ: 'rfq:save',
  DELETE_RFQ: 'rfq:delete',
  SET_STATUS: 'rfq:set-status',
  DUPLICATE_RFQ: 'rfq:duplicate',

  // --- activity and reminders ----------------------------------------------
  ADD_ACTIVITY: 'rfq:add-activity',
  ADD_REMINDER: 'rfq:add-reminder',
  DELETE_REMINDER: 'rfq:delete-reminder',

  // --- autofill ------------------------------------------------------------
  SUGGEST: 'rfq:suggest',
  LOOKUP_CONTACT: 'rfq:lookup-contact',

  // --- calendar ------------------------------------------------------------
  MONTH_DUE: 'rfq:month-due',

  // --- housekeeping --------------------------------------------------------
  IMPORT_LEGACY: 'app:import-legacy',
  OPEN_EXTERNAL: 'app:open-external',

  // --- main -> renderer (send, fire and forget) ----------------------------
  DATA_CHANGED: 'app:data-changed',
  UPDATE_AVAILABLE: 'app:update-available',
  NEW_RFQ: 'app:new-rfq',
};
