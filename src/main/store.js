'use strict';
/**
 * Settings persistence.
 *
 * Hand-rolled rather than pulling in electron-store: it is a few dozen lines,
 * has no dependency surface, and lets us do atomic writes (write temp, rename)
 * so a crash mid-save cannot leave a truncated settings file that bricks the
 * app on next launch.
 *
 * A class taking its directory as an argument, NOT a module singleton with an
 * init() call. Several independent stores can then exist in one test process,
 * so a case cannot leak into the next and there is no hidden global to reset.
 *
 * This holds preferences only. The RFQs themselves live in db.js, in their own
 * file, so a settings write can never put the actual work at risk.
 */

const fs = require('fs');
const path = require('path');

/**
 * Every setting the app has, with its default. This object is the closest
 * thing to documentation of what the app can be made to do, so non-obvious
 * defaults get a reason.
 */
const DEFAULTS = {
  // --- interface -----------------------------------------------------------
  theme: 'light',
  // Remembered so reopening the app feels like returning to it rather than
  // starting over. The tkinter app opened at 1100x750; keep that.
  windowWidth: 1100,
  windowHeight: 750,
  windowMaximized: false,

  // Which status checkboxes are ticked. The old app reset these on every
  // launch, which meant re-hiding Done and Lost several times a day.
  visibleStatuses: ['Pending', 'In Progress', 'Quoted', 'Won', 'Lost', 'Done'],

  // '' means the natural order: newest RFQ first.
  sortColumn: '',
  sortReverse: false,

  // --- behaviour -----------------------------------------------------------
  startWithWindows: false,
  minimizeToTray: false,
  closeToTray: false,

  // A due date this many days out or nearer is highlighted as "due soon".
  dueSoonDays: 3,

  // Off means the app never reaches the network. Worth being able to say.
  checkForUpdates: true,

  // --- migration -----------------------------------------------------------
  // Set once the tkinter app's rfq_tracker.db has been read in, so the import
  // does not run again and re-add everything the user has since deleted.
  legacyImported: false,
};

/** Bounds for values a bad input could otherwise break. */
const LIMITS = {
  windowWidth: [640, 7680],
  windowHeight: [480, 4320],
  dueSoonDays: [0, 90],
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.settingsPath = path.join(dir, 'settings.json');
    fs.mkdirSync(dir, { recursive: true });
    this.settings = { ...DEFAULTS, ...this._read(this.settingsPath) };
  }

  _read(file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Missing is normal on first run. Corrupt is not, but the only useful
      // recovery is to fall back to defaults rather than refuse to start.
      return {};
    }
  }

  /** Write via temp + rename so an interrupted write cannot truncate the file. */
  _writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  get() {
    return this.settings;
  }

  /**
   * Merges a patch over the current settings, clamps what needs clamping, and
   * persists. Returns the new settings so a caller can hand them straight back
   * to the renderer without a second read.
   */
  update(patch) {
    const next = { ...this.settings, ...(patch || {}) };

    for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
      const n = Number(next[key]);
      next[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[key];
    }

    // An empty filter would show an empty table with no obvious way back, so
    // treat "nothing ticked" as "everything ticked".
    if (!Array.isArray(next.visibleStatuses) || next.visibleStatuses.length === 0) {
      next.visibleStatuses = [...DEFAULTS.visibleStatuses];
    }

    this.settings = next;
    this._writeAtomic(this.settingsPath, this.settings);
    return this.settings;
  }

  reset() {
    // legacyImported is a fact about this profile, not a preference. Resetting
    // it would re-import the old database and duplicate every RFQ.
    const { legacyImported } = this.settings;
    this.settings = { ...DEFAULTS, legacyImported };
    this._writeAtomic(this.settingsPath, this.settings);
    return this.settings;
  }
}

module.exports = { Store, DEFAULTS, LIMITS };
