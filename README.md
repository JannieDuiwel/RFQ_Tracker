# RFQ Tracker

Track Requests for Quote — who asked, what for, where it got to, and what you
promised to do about it by Friday.

A local Windows desktop app. No account, no server, no subscription: the RFQs
live in a file on your machine, and the only time the app touches the network is
to ask GitHub whether there is a newer release — which you can turn off.

Version 2 is a rewrite of the original Python/tkinter app on the
[Electron foundation](https://github.com/JannieDuiwel/Beeld/blob/master/FOUNDATION.md)
shared with Vloei and Beeld. Everything the old version did, it still does; the
old database imports on first run.

---

## Install

Download the latest `RFQ Tracker-<version>-setup.exe` from
[Releases](https://github.com/JannieDuiwel/RFQ_Tracker/releases) and run it. It
installs per-user, so it needs no administrator password, and it puts a shortcut
on the desktop and in the Start menu.

**Coming from version 1?** The first launch offers to import the old
`rfq_tracker.db` if it finds one on the desktop, in Documents, in Downloads or in
your user folder. If it is somewhere else, point at it with **Options → Import
from the old RFQ Tracker**. The import reads that file and never writes to it, so
the old app keeps working until you are satisfied this one does.

---

## What it does

- **RFQs** with a description, contact, company, phone, email, creation date and
  optional due date.
- **Status** through the lifecycle: Pending → In Progress → Quoted → Won / Lost /
  Done. Click the status pill on any row to change it in one move.
- **Autofill** — start typing a contact or company you have quoted before and the
  rest of their details fill themselves in. It never overwrites something you
  have already typed.
- **Due dates**, coloured by urgency: overdue in red, due within a few days in
  orange. How many days counts as "soon" is a setting.
- **Activity log** per RFQ — timestamped notes, quote numbers, what was said on
  the phone. Status changes write themselves into it.
- **Reminders** per RFQ, delivered as Windows notifications. One missed while the
  app was closed fires when it next opens, because the follow-up is still owed.
- **Calendar** view of everything due this month.
- **Search and filter** across every field, with column sorting that keeps
  finished work at the bottom where it belongs.
- **Win rate** in the status bar: Won over Won plus Lost, ignoring everything
  still in flight.
- **System tray** — minimise or close to the tray to keep reminders running.

Keyboard: `Ctrl+N` new RFQ, `Ctrl+F` search, `Enter` open the selected row,
`Delete` delete it, `Ctrl+S` save inside the editor, `Esc` close a dialog.

---

## Where the data lives

```
%APPDATA%\RFQ Tracker\rfqs.json        every RFQ, its notes and its reminders
%APPDATA%\RFQ Tracker\settings.json    preferences only
```

Both are plain JSON, written atomically — a crash mid-save cannot leave a
truncated file. `rfqs.json` is the backup: copy it somewhere, and copying it back
restores everything.

Version 1 kept a SQLite database beside the `.exe`, which meant reinstalling the
app could put it somewhere you did not expect to find your data. Version 2 keeps
it in your user profile instead, where it belongs and where it survives an
upgrade.

---

## Development

```
npm install     # also generates the icons
npm start       # run it
npm run dev     # run it with devtools and renderer errors in the terminal
npm test        # plain node + assert, no runner, under a second
npm run build   # produces dist\RFQ Tracker-<version>-setup.exe
```

No build step and no framework: the renderer is plain DOM, so a clone runs with
nothing to compile.

### Layout

```
src/
  main/       Node. Window, tray, lifecycle, IPC, and the app's own logic.
    store.js         preferences
    db.js            the RFQs - reads, writes, the list query
    reminders.js     the minute poll that fires due reminders
    updates.js       the GitHub release check
    legacy-import.js the one-time read of version 1's SQLite database
  preload/    The entire surface the renderer may touch. The security boundary.
  renderer/   panel/ - index.html plus one file per part of the window.
  shared/     channels.js, statuses.js, dates.js - needed on both sides.
tools/        make-icons.js. Excluded from the packaged app.
test/         Plain node + assert.
```

Everything under `src/main` except `main.js` itself is plain Node that a test can
drive without booting Electron. That one rule is what keeps `npm test` fast and
dependency-free — and the app ships with **zero runtime dependencies**.

The conventions, and the Windows/Electron traps worth not rediscovering, are
written up in [FOUNDATION.md](https://github.com/JannieDuiwel/Beeld/blob/master/FOUNDATION.md).

### Why JSON rather than SQLite

The working set is tens to low hundreds of RFQs. At that size a scan in
JavaScript costs less than the IPC round trip that delivers the result, so SQL
would buy indexes nobody needs at the price of either an experimental Node API or
a native module that has to be rebuilt for every Electron version. The old `.db`
is still read once, by the importer, and then left alone.
