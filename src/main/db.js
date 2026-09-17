'use strict';
/**
 * The RFQs themselves: one JSON file, held in memory, written atomically on
 * every change.
 *
 * Why not SQLite, given the app it replaces used it? Because the working set is
 * tens to low hundreds of RFQs - this machine's live database holds 80 - and at
 * that size a table scan in JavaScript costs less than the IPC round trip that
 * delivers the result. SQL would buy indexes nobody needs, at the price of
 * either an experimental Node API or a native module that has to be rebuilt for
 * every Electron version. The old .db is still read once, by legacy-import.js,
 * and then left alone.
 *
 * Activity entries and reminders are nested inside their RFQ rather than kept
 * in sibling tables. No query wants them any other way, deleting an RFQ takes
 * its history with it for free, and it removes the foreign key that the SQL
 * version needed a PRAGMA to enforce.
 *
 * Like Store, this takes its directory as a constructor argument, so tests can
 * run several independent copies in one process.
 */

const fs = require('fs');
const path = require('path');

const { STATUSES, ARCHIVE_STATUSES, WON, LOST } = require('../shared/statuses');
const { dayString, stampString, urgency } = require('../shared/dates');

/** Bumped only if the on-disk shape changes in a way that needs migrating. */
const SCHEMA_VERSION = 1;

/** Columns the list can be sorted by, mapped to the field each one reads. */
const SORT_FIELDS = {
  status: 'status',
  description: 'description',
  name: 'name',
  company: 'company',
  phone: 'phone',
  email: 'email',
  dateCreated: 'dateCreated',
  dueDate: 'dueDate',
};

/** Every field an RFQ has, so a record from an older version gains new ones. */
function normalise(raw) {
  return {
    id: Number(raw.id),
    description: String(raw.description || ''),
    name: String(raw.name || ''),
    company: String(raw.company || ''),
    phone: String(raw.phone || ''),
    email: String(raw.email || ''),
    status: STATUSES.includes(raw.status) ? raw.status : 'Pending',
    dateCreated: String(raw.dateCreated || ''),
    createdAt: String(raw.createdAt || ''),
    dueDate: String(raw.dueDate || ''),
    activity: Array.isArray(raw.activity)
      ? raw.activity.map((a) => ({ ts: String(a.ts || ''), entry: String(a.entry || '') }))
      : [],
    reminders: Array.isArray(raw.reminders)
      ? raw.reminders.map((r) => ({
        id: Number(r.id),
        remindAt: String(r.remindAt || ''),
        notified: Boolean(r.notified),
      }))
      : [],
  };
}

class Db {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'rfqs.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._read();
  }

  _read() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // Missing is the normal first run. Corrupt is not, and quietly starting
      // over on top of it is the worst thing this app could do - so keep a copy
      // of whatever was there before the empty file replaces it.
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch { /* nothing useful to do if even that fails */ }
      }
    }

    const rfqs = Array.isArray(parsed && parsed.rfqs)
      ? parsed.rfqs.map(normalise).filter((r) => r.id)
      : [];

    return {
      version: SCHEMA_VERSION,
      // Derived rather than trusted: a hand-edited file with a stale nextId
      // would otherwise hand out an id that is already taken.
      nextId: Math.max(1, ...rfqs.map((r) => r.id + 1)),
      nextReminderId: Math.max(1, ...rfqs.flatMap((r) => r.reminders.map((x) => x.id + 1))),
      rfqs,
    };
  }

  /**
   * Write via temp + rename, so an interrupted write cannot truncate the file.
   * Deliberately a copy of Store's helper rather than a shared import: these
   * are the two files that must not depend on anything, and eight lines is a
   * cheaper price than a module they both have to load.
   */
  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // --- reads ---------------------------------------------------------------

  all() {
    return this.data.rfqs;
  }

  get(id) {
    return this.data.rfqs.find((r) => r.id === Number(id)) || null;
  }

  /**
   * The list view: filtered, sorted and tallied.
   *
   * This is the piece worth having in main and under test - the two sort rules
   * that are not obvious (finished work sinks, blanks sort last in either
   * direction) and the win rate, which is a ratio of decided RFQs only: Won
   * over Won plus Lost, with everything still in flight left out of both.
   */
  query(opts = {}) {
    const {
      search = '',
      statuses = STATUSES,
      sort = {},
      dueSoonDays = 3,
      today = new Date(),
    } = opts;

    const needle = String(search).trim().toLowerCase();
    const allowed = new Set(statuses);

    let won = 0;
    let lost = 0;

    const rows = this.data.rfqs.filter((r) => {
      if (!allowed.has(r.status)) return false;
      if (needle) {
        const hay = `${r.name} ${r.company} ${r.phone} ${r.email} ${r.description}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (r.status === WON) won++;
      else if (r.status === LOST) lost++;
      return true;
    }).map((r) => ({
      id: r.id,
      status: r.status,
      description: r.description,
      name: r.name,
      company: r.company,
      phone: r.phone,
      email: r.email,
      dateCreated: r.dateCreated,
      dueDate: r.dueDate,
      urgency: urgency(r.dueDate, dueSoonDays, today),
      noteCount: r.activity.length,
      reminderCount: r.reminders.filter((x) => !x.notified).length,
    }));

    this._sort(rows, sort);

    const decided = won + lost;
    return {
      rows,
      shown: rows.length,
      total: this.data.rfqs.length,
      won,
      lost,
      winRate: decided ? Math.round((won / decided) * 100) : null,
    };
  }

  /**
   * Sorts in place. With no column, rows stay in natural order: newest first,
   * which is what the SQL version's `ORDER BY created_at DESC` gave, and what
   * someone who has never touched a column header expects to see.
   */
  _sort(rows, sort = {}) {
    const field = SORT_FIELDS[sort.column];
    if (!field) {
      rows.sort((a, b) => b.id - a.id);
      return rows;
    }

    const archived = new Set(ARCHIVE_STATUSES);
    const dir = sort.reverse ? -1 : 1;

    rows.sort((a, b) => {
      // Finished work sinks in both directions: reversing a sort should reorder
      // the live RFQs, not bury them under a year of closed ones.
      const arc = Number(archived.has(a.status)) - Number(archived.has(b.status));
      if (arc) return arc;

      const av = String(a[field] || '');
      const bv = String(b[field] || '');

      // Same reasoning for blanks. An empty due date is missing information,
      // not the earliest possible date, so it belongs at the end either way.
      const blank = Number(av === '') - Number(bv === '');
      if (blank) return blank;

      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
      // Ties fall back to id, so the order is stable rather than whatever the
      // engine's sort happens to do with equal keys.
      return cmp ? cmp * dir : (a.id - b.id) * dir;
    });
    return rows;
  }

  /** RFQs with a due date in the given month, keyed by day, for the calendar. */
  monthDue(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const byDay = {};
    for (const r of this.data.rfqs) {
      if (!r.dueDate.startsWith(prefix)) continue;
      const day = Number(r.dueDate.slice(8, 10));
      if (!day) continue;
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push({
        id: r.id,
        label: r.description || r.name || r.company || 'RFQ',
        status: r.status,
      });
    }
    return byDay;
  }

  /**
   * Distinct previous values for an autofill dropdown, most recent first.
   * Substring rather than prefix matching, because "Lutzville" should find
   * "OK Lutzville" - which is how you remember a customer when you cannot
   * remember which word their name starts with.
   */
  suggest(field, text, limit = 8) {
    if (field !== 'name' && field !== 'company') return [];
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return [];

    const seen = new Set();
    const out = [];
    for (const r of [...this.data.rfqs].sort((a, b) => b.id - a.id)) {
      const val = r[field];
      if (!val || seen.has(val.toLowerCase())) continue;
      if (!val.toLowerCase().includes(needle)) continue;
      seen.add(val.toLowerCase());
      out.push(val);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** The most recent RFQ for a contact or company, to fill the other fields. */
  lookup(field, value) {
    if (field !== 'name' && field !== 'company') return null;
    const want = String(value || '').trim().toLowerCase();
    if (!want) return null;

    const match = [...this.data.rfqs]
      .sort((a, b) => b.id - a.id)
      .find((r) => String(r[field]).toLowerCase() === want);

    if (!match) return null;
    const { name, company, phone, email } = match;
    return { name, company, phone, email };
  }

  // --- writes --------------------------------------------------------------

  create(fields) {
    const now = new Date();
    const rfq = normalise({
      ...fields,
      id: this.data.nextId,
      dateCreated: fields.dateCreated || dayString(now),
      createdAt: stampString(now),
      activity: [{ ts: stampString(now), entry: 'RFQ created.' }],
      reminders: [],
    });
    this.data.nextId++;
    this.data.rfqs.push(rfq);
    this._save();
    return rfq;
  }

  /**
   * Applies an edit. A status change writes itself into the activity log -
   * that history is the point of the log, and leaving it to the caller means
   * one path through the UI eventually forgets.
   */
  update(id, fields) {
    const rfq = this.get(id);
    if (!rfq) return null;

    const before = rfq.status;
    const next = normalise({ ...rfq, ...fields, id: rfq.id });

    // Not the caller's to rewrite: these are the record's own history.
    next.createdAt = rfq.createdAt;
    next.activity = rfq.activity;
    next.reminders = rfq.reminders;

    if (next.status !== before) {
      next.activity = [...next.activity, {
        ts: stampString(),
        entry: `Status changed: ${before} → ${next.status}`,
      }];
    }

    this.data.rfqs[this.data.rfqs.indexOf(rfq)] = next;
    this._save();
    return next;
  }

  setStatus(id, status) {
    if (!STATUSES.includes(status)) return null;
    return this.update(id, { status });
  }

  /** A copy of the contact details only - not the history, and not the status. */
  duplicate(id) {
    const src = this.get(id);
    if (!src) return null;
    return this.create({
      description: src.description,
      name: src.name,
      company: src.company,
      phone: src.phone,
      email: src.email,
      dueDate: src.dueDate,
      status: 'Pending',
    });
  }

  remove(id) {
    const rfq = this.get(id);
    if (!rfq) return false;
    this.data.rfqs.splice(this.data.rfqs.indexOf(rfq), 1);
    this._save();
    return true;
  }

  addActivity(id, entry) {
    const rfq = this.get(id);
    const text = String(entry || '').trim();
    if (!rfq || !text) return null;
    rfq.activity.push({ ts: stampString(), entry: text });
    this._save();
    return rfq;
  }

  addReminder(id, remindAt) {
    const rfq = this.get(id);
    if (!rfq || !remindAt) return null;
    const reminder = { id: this.data.nextReminderId++, remindAt, notified: false };
    rfq.reminders.push(reminder);
    rfq.reminders.sort((a, b) => a.remindAt.localeCompare(b.remindAt));
    this._save();
    return reminder;
  }

  deleteReminder(id, reminderId) {
    const rfq = this.get(id);
    if (!rfq) return false;
    const before = rfq.reminders.length;
    rfq.reminders = rfq.reminders.filter((r) => r.id !== Number(reminderId));
    if (rfq.reminders.length === before) return false;
    this._save();
    return true;
  }

  /**
   * Reminders that have come due and not yet fired. `now` is a
   * 'YYYY-MM-DD HH:MM' string compared as text - that format sorts correctly,
   * so this path needs no date parsing at all.
   */
  dueReminders(now) {
    const out = [];
    for (const rfq of this.data.rfqs) {
      for (const r of rfq.reminders) {
        if (!r.notified && r.remindAt <= now) out.push({ rfq, reminder: r });
      }
    }
    return out;
  }

  markNotified(reminderId) {
    for (const rfq of this.data.rfqs) {
      const r = rfq.reminders.find((x) => x.id === Number(reminderId));
      if (r) {
        r.notified = true;
        this._save();
        return true;
      }
    }
    return false;
  }

  /**
   * Bulk append for the legacy importer, which brings its own history.
   *
   * Appends rather than replaces, and hands out fresh ids as it goes: running
   * an import twice should leave you with duplicates you can delete, never
   * with a record of yours quietly overwritten by one from the old file.
   */
  importRecords(records) {
    let rfqs = 0;
    let activity = 0;
    let reminders = 0;

    for (const raw of records) {
      const rfq = normalise({ ...raw, id: this.data.nextId++ });
      rfq.reminders = rfq.reminders.map((r) => ({ ...r, id: this.data.nextReminderId++ }));
      this.data.rfqs.push(rfq);
      rfqs++;
      activity += rfq.activity.length;
      reminders += rfq.reminders.length;
    }

    this._save();
    return { rfqs, activity, reminders };
  }
}

module.exports = { Db, SORT_FIELDS, SCHEMA_VERSION };
