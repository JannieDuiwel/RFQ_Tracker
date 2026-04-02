#!/usr/bin/env python3
"""
RFQ Tracker
A Request for Quote management and tracking desktop application.
"""

import tkinter as tk
from tkinter import ttk, messagebox
import sqlite3
import os
import sys
import json
import urllib.request
import webbrowser
from datetime import datetime
import threading
import time
import calendar as _cal_stdlib

# ─── Version ─────────────────────────────────────────────────────────────────
APP_VERSION = "1.3.0"
GITHUB_REPO = "JannieDuiwel/RFQ_Tracker"

# ─── Notification Support ─────────────────────────────────────────────────────
NOTIF_AVAILABLE = False
try:
    from plyer import notification as _plyer_notif
    NOTIF_AVAILABLE = True
except Exception:
    pass

# ─── System Tray Support ────────────────────────────────────────────────────
TRAY_AVAILABLE = False
try:
    import pystray
    from PIL import Image as PILImage
    TRAY_AVAILABLE = True
except Exception:
    pass


def send_notification(title, message):
    """Send a Windows system tray notification."""
    if NOTIF_AVAILABLE:
        try:
            _plyer_notif.notify(
                title=title,
                message=message,
                app_name="RFQ Tracker",
                timeout=10
            )
        except Exception:
            pass


# ─── Update Checker ──────────────────────────────────────────────────────────
def check_for_update(callback):
    """Check GitHub Releases for a newer version. Runs in a background thread."""
    def _check():
        if not GITHUB_REPO:
            return
        try:
            url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
            req = urllib.request.Request(url, headers={
                "Accept": "application/vnd.github.v3+json"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            latest = data.get("tag_name", "").lstrip("v")
            html_url = data.get("html_url", "")
            if latest and latest != APP_VERSION:
                latest_parts = tuple(int(x) for x in latest.split("."))
                current_parts = tuple(int(x) for x in APP_VERSION.split("."))
                if latest_parts > current_parts:
                    callback(latest, html_url)
        except Exception:
            pass
    threading.Thread(target=_check, daemon=True).start()


# ─── Database ─────────────────────────────────────────────────────────────────
def get_db_path():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "rfq_tracker.db")


DB_PATH = get_db_path()


# ─── Settings ────────────────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "start_with_windows": False,
    "minimize_to_tray": False,
    "close_to_tray": False,
    "dark_mode": False,
    "sort_column": "",
    "sort_reverse": False,
}


def get_settings_path():
    return os.path.join(os.path.dirname(DB_PATH), "settings.json")


def load_settings():
    path = get_settings_path()
    try:
        with open(path, "r") as f:
            saved = json.load(f)
        return {**DEFAULT_SETTINGS, **saved}
    except Exception:
        return dict(DEFAULT_SETTINGS)


def save_settings(settings):
    path = get_settings_path()
    with open(path, "w") as f:
        json.dump(settings, f, indent=2)


def get_icon_path():
    if getattr(sys, 'frozen', False):
        base = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "rfq_icon.ico")


def set_startup(enable):
    """Add or remove RFQ Tracker from Windows startup via registry."""
    try:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        app_name = "RFQTrackerPro"
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0,
                             winreg.KEY_SET_VALUE)
        if enable:
            if getattr(sys, 'frozen', False):
                exe_path = f'"{sys.executable}"'
            else:
                exe_path = f'"{sys.executable}" "{os.path.abspath(__file__)}"'
            winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, exe_path)
        else:
            try:
                winreg.DeleteValue(key, app_name)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception:
        pass


def db_connect():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")
    return con


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    with db_connect() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS rfqs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                company      TEXT DEFAULT '',
                phone        TEXT DEFAULT '',
                email        TEXT DEFAULT '',
                status       TEXT DEFAULT 'Pending',
                date_created TEXT,
                created_at   TEXT
            );

            CREATE TABLE IF NOT EXISTS activity (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                rfq_id  INTEGER NOT NULL,
                entry   TEXT NOT NULL,
                ts      TEXT,
                FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reminders (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                rfq_id     INTEGER NOT NULL,
                remind_at  TEXT NOT NULL,
                notified   INTEGER DEFAULT 0,
                FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
            );
        """)
        # Migration: add due_date column for existing databases
        try:
            con.execute("ALTER TABLE rfqs ADD COLUMN due_date TEXT")
        except sqlite3.OperationalError:
            pass
        # Migration: add description column for existing databases
        try:
            con.execute("ALTER TABLE rfqs ADD COLUMN description TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass


# ─── Theme System ────────────────────────────────────────────────────────────
STATUS_OPTIONS = ["Pending", "In Progress", "Quoted", "Won", "Lost", "Done"]

STATUS_COLORS = {
    "Pending":     "#e17055",
    "In Progress": "#e6a817",
    "Quoted":      "#0984e3",
    "Won":         "#00b894",
    "Lost":        "#b2bec3",
    "Done":        "#6c5ce7",
}

LIGHT_THEME = {
    "BG": "#f4f6fb", "SURFACE": "#ffffff", "TEXT": "#2d3561",
    "ACCENT": "#6c5ce7", "GREEN": "#00b894", "DANGER": "#e17055",
    "SUBTEXT": "#636e72", "BORDER": "#dfe6e9",
    "TOOLBAR_BG": "#2d3561", "TOOLBAR_FG": "#ffffff",
    "SEARCH_BG": "#3d4a8a",
    "ROW_ALT": "#f7f8fc", "SELECTED": "#e8eaf6",
    "CAL_EMPTY": "#f0f2f7",
    "OVERDUE_BG": "#ffeaea", "DUE_SOON_BG": "#fff3e0",
}

DARK_THEME = {
    "BG": "#1e1e2e", "SURFACE": "#2a2a3d", "TEXT": "#e0e0ef",
    "ACCENT": "#9d8cff", "GREEN": "#00d9a3", "DANGER": "#ff6b6b",
    "SUBTEXT": "#a0a0b8", "BORDER": "#3a3a50",
    "TOOLBAR_BG": "#151525", "TOOLBAR_FG": "#e0e0ef",
    "SEARCH_BG": "#3a3a50",
    "ROW_ALT": "#252538", "SELECTED": "#3d3d5c",
    "CAL_EMPTY": "#252538",
    "OVERDUE_BG": "#3d2020", "DUE_SOON_BG": "#3d3520",
}

# Module-level color globals (set by apply_theme)
BG = SURFACE = DARK = ACCENT = GREEN = DANGER = SUBTEXT = BORDER = ""
_TOOLBAR_BG = _TOOLBAR_FG = _SEARCH_BG = ""
_ROW_ALT = _SELECTED = _CAL_EMPTY = _OVERDUE_BG = _DUE_SOON_BG = ""


def apply_theme(theme):
    global BG, SURFACE, DARK, ACCENT, GREEN, DANGER, SUBTEXT, BORDER
    global _TOOLBAR_BG, _TOOLBAR_FG, _SEARCH_BG
    global _ROW_ALT, _SELECTED, _CAL_EMPTY, _OVERDUE_BG, _DUE_SOON_BG
    BG       = theme["BG"]
    SURFACE  = theme["SURFACE"]
    DARK     = theme["TEXT"]
    ACCENT   = theme["ACCENT"]
    GREEN    = theme["GREEN"]
    DANGER   = theme["DANGER"]
    SUBTEXT  = theme["SUBTEXT"]
    BORDER   = theme["BORDER"]
    _TOOLBAR_BG  = theme["TOOLBAR_BG"]
    _TOOLBAR_FG  = theme["TOOLBAR_FG"]
    _SEARCH_BG   = theme["SEARCH_BG"]
    _ROW_ALT     = theme["ROW_ALT"]
    _SELECTED    = theme["SELECTED"]
    _CAL_EMPTY   = theme["CAL_EMPTY"]
    _OVERDUE_BG  = theme["OVERDUE_BG"]
    _DUE_SOON_BG = theme["DUE_SOON_BG"]


# Apply default theme (overridden at startup based on settings)
apply_theme(LIGHT_THEME)


# ─── Main Application Window ──────────────────────────────────────────────────
class RFQApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self._restart = False
        self.title(f"RFQ Tracker  v{APP_VERSION}")
        self.geometry("1100x750")
        self.minsize(860, 600)
        self.configure(bg=BG)
        self.settings = load_settings()
        self.tray_icon = None
        self._update_url = None
        self._setup_style()
        self._build_toolbar()
        self._build_main()
        self.refresh_table()
        self._apply_saved_sort()
        self._start_reminder_thread()
        self._setup_tray()
        self._check_for_updates()
        self._bind_shortcuts()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.bind("<Unmap>", self._on_minimize)

    # ── Keyboard Shortcuts ─────────────────────────────────────────────────
    def _bind_shortcuts(self):
        self.bind("<Control-n>", lambda e: self.open_new_rfq())
        self.bind("<Control-N>", lambda e: self.open_new_rfq())
        self.bind("<Control-f>", lambda e: self._focus_search())
        self.bind("<Control-F>", lambda e: self._focus_search())
        self.bind("<Delete>", lambda e: self.delete_selected())

    def _focus_search(self):
        self.search_entry.focus_set()
        self.search_entry.select_range(0, tk.END)

    # ── Styling ───────────────────────────────────────────────────────────────
    def _setup_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        style.configure("TFrame",      background=BG)
        style.configure("Card.TFrame", background=SURFACE, relief="flat")
        style.configure("TLabel",      background=BG, foreground=DARK)
        style.configure("Sub.TLabel",  background=BG, foreground=SUBTEXT,
                        font=("Segoe UI", 9))
        style.configure("TNotebook",   background=BG, tabmargins=[0, 0, 0, 0])
        style.configure("TNotebook.Tab", padding=(14, 7), font=("Segoe UI", 10))
        style.map("TNotebook.Tab",
                  background=[("selected", SURFACE), ("!selected", BORDER)],
                  foreground=[("selected", DARK),    ("!selected", SUBTEXT)])

        style.configure("Treeview",
                        background=SURFACE, foreground=DARK,
                        rowheight=34, fieldbackground=SURFACE,
                        font=("Segoe UI", 10), borderwidth=0)
        style.configure("Treeview.Heading",
                        background=_TOOLBAR_BG, foreground=_TOOLBAR_FG,
                        font=("Segoe UI", 10, "bold"),
                        padding=8, relief="flat")
        style.map("Treeview",
                  background=[("selected", _SELECTED)],
                  foreground=[("selected", DARK)])

    # ── Toolbar ───────────────────────────────────────────────────────────────
    def _build_toolbar(self):
        bar = tk.Frame(self, bg=_TOOLBAR_BG, padx=18, pady=12)
        bar.pack(fill=tk.X)

        tk.Label(bar, text="\U0001f4cb  RFQ Tracker", bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                 font=("Segoe UI", 15, "bold")).pack(side=tk.LEFT)

        tk.Button(bar, text="  + New RFQ  ",
                  bg=GREEN, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10, "bold"),
                  relief="flat", cursor="hand2",
                  command=self.open_new_rfq,
                  padx=10, pady=5).pack(side=tk.RIGHT, padx=4)

        tk.Button(bar, text=" \u2699 ",
                  bg=ACCENT, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 11),
                  relief="flat", cursor="hand2",
                  command=self.open_options,
                  padx=6, pady=5).pack(side=tk.RIGHT, padx=4)

        search_frame = tk.Frame(bar, bg=_TOOLBAR_BG)
        search_frame.pack(side=tk.RIGHT, padx=20)
        tk.Label(search_frame, text="\U0001f50d", bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                 font=("Segoe UI", 12)).pack(side=tk.LEFT)

        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", lambda *_: self.refresh_table())
        self.search_entry = tk.Entry(
            search_frame, textvariable=self.search_var,
            font=("Segoe UI", 10), width=26,
            relief="flat", bg=_SEARCH_BG, fg=_TOOLBAR_FG,
            insertbackground=_TOOLBAR_FG)
        self.search_entry.pack(side=tk.LEFT, padx=6, ipady=5)

    # ── Main content ──────────────────────────────────────────────────────────
    def _build_main(self):
        # Status bar packed first (side=BOTTOM) so it is always visible
        self.status_var = tk.StringVar()
        self.status_label = tk.Label(self, textvariable=self.status_var,
                                     bg=BORDER, fg=SUBTEXT, font=("Segoe UI", 9),
                                     anchor="w", padx=12)
        self.status_label.pack(fill=tk.X, side=tk.BOTTOM)

        main = tk.Frame(self, bg=BG, padx=18, pady=14)
        main.pack(fill=tk.BOTH, expand=True)

        # Main notebook: List | Calendar
        self._main_nb = ttk.Notebook(main)
        self._main_nb.pack(fill=tk.BOTH, expand=True)
        self._main_nb.bind("<<NotebookTabChanged>>", self._on_tab_change)

        # ── Tab 1: List ────────────────────────────────────────────────────────
        list_tab = tk.Frame(self._main_nb, bg=BG)
        self._main_nb.add(list_tab, text="  \U0001f4cb List  ")

        # Filter bar (multi-select checkboxes)
        filter_frame = tk.Frame(list_tab, bg=BG)
        filter_frame.pack(fill=tk.X, pady=(8, 10))

        tk.Label(filter_frame, text="Show:", bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=(0, 8))

        self._filter_vars = {}
        self._all_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            filter_frame, text="All", variable=self._all_var,
            command=self._toggle_all_filters,
            bg=BG, fg=DARK, selectcolor=SURFACE, activebackground=BG,
            font=("Segoe UI", 9, "bold"), relief="flat", cursor="hand2"
        ).pack(side=tk.LEFT, padx=5)

        for s in STATUS_OPTIONS:
            var = tk.BooleanVar(value=True)
            color = STATUS_COLORS.get(s, DARK)
            tk.Checkbutton(
                filter_frame, text=s, variable=var,
                command=self._on_filter_change,
                bg=BG, fg=color, selectcolor=SURFACE, activebackground=BG,
                font=("Segoe UI", 9, "bold"), relief="flat", cursor="hand2"
            ).pack(side=tk.LEFT, padx=5)
            self._filter_vars[s] = var

        # Table card
        card = tk.Frame(list_tab, bg=SURFACE, relief="flat",
                        highlightthickness=1, highlightbackground=BORDER)
        card.pack(fill=tk.BOTH, expand=True)

        cols = ("status", "desc", "name", "company", "phone", "email", "date", "due")
        self.tree = ttk.Treeview(card, columns=cols, show="headings",
                                  selectmode="browse")

        self.tree.heading("status",  text="Status")
        self.tree.heading("desc",    text="RFQ Description")
        self.tree.heading("name",    text="Contact Name")
        self.tree.heading("company", text="Company")
        self.tree.heading("phone",   text="Phone")
        self.tree.heading("email",   text="Email")
        self.tree.heading("date",    text="Date Created")
        self.tree.heading("due",     text="Due Date")

        self.tree.column("status",  width=100, anchor="center", stretch=False)
        self.tree.column("desc",    width=180, stretch=True)
        self.tree.column("name",    width=140, stretch=True)
        self.tree.column("company", width=140, stretch=True)
        self.tree.column("phone",   width=110, stretch=False)
        self.tree.column("email",   width=170, stretch=True)
        self.tree.column("date",    width=100, anchor="center", stretch=False)
        self.tree.column("due",     width=100, anchor="center", stretch=False)

        # Click column headers to sort
        for c in cols:
            self.tree.heading(c, command=lambda _c=c: self._sort_by_column(_c, False))

        vsb = ttk.Scrollbar(card, orient=tk.VERTICAL,   command=self.tree.yview)
        hsb = ttk.Scrollbar(card, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self.tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        card.grid_rowconfigure(0, weight=1)
        card.grid_columnconfigure(0, weight=1)

        self.tree.bind("<Button-1>",  self._on_tree_click)
        self.tree.bind("<Double-1>", lambda e: self.open_selected())
        self.tree.bind("<Return>",   lambda e: self.open_selected())

        # Right-click menu
        self.ctx = tk.Menu(self, tearoff=0, font=("Segoe UI", 10))
        self.ctx.add_command(label="  Open / Edit",       command=self.open_selected)
        self.ctx.add_command(label="  Duplicate RFQ",     command=self.duplicate_selected)
        self.ctx.add_separator()
        self.ctx.add_command(label="  Add Quick Note",    command=self.quick_note)
        self.ctx.add_separator()
        self.ctx.add_command(label="  Mark Done",          command=lambda: self._quick_status("Done"))
        self.ctx.add_command(label="  Mark In Progress",   command=lambda: self._quick_status("In Progress"))
        self.ctx.add_command(label="  Mark Quoted",        command=lambda: self._quick_status("Quoted"))
        self.ctx.add_separator()
        self.ctx.add_command(label="  Delete RFQ",         command=self.delete_selected)
        self.tree.bind("<Button-3>", self._show_ctx)

        # ── Tab 2: Calendar ────────────────────────────────────────────────────
        cal_tab = tk.Frame(self._main_nb, bg=BG)
        self._main_nb.add(cal_tab, text="  \U0001f4c5 Calendar  ")
        self._build_calendar_tab(cal_tab)

    # ── Filter helpers ─────────────────────────────────────────────────────
    def _toggle_all_filters(self):
        state = self._all_var.get()
        for var in self._filter_vars.values():
            var.set(state)
        self.refresh_table()

    def _on_filter_change(self):
        all_on = all(v.get() for v in self._filter_vars.values())
        self._all_var.set(all_on)
        self.refresh_table()

    def _get_active_statuses(self):
        return {s for s, v in self._filter_vars.items() if v.get()}

    # ── Table management ──────────────────────────────────────────────────────
    def refresh_table(self):
        for row in self.tree.get_children():
            self.tree.delete(row)

        search = self.search_var.get().strip().lower()
        active = self._get_active_statuses()
        today  = datetime.now().date()

        with db_connect() as con:
            rows = con.execute(
                "SELECT id, name, company, phone, email, status, date_created, due_date, description "
                "FROM rfqs ORDER BY created_at DESC"
            ).fetchall()

        shown = 0
        won_count = 0
        lost_count = 0
        row_idx = 0
        for rid, name, company, phone, email, status, date_c, due_date, desc in rows:
            if status not in active:
                continue
            if search and search not in f"{name} {company} {phone} {email} {desc}".lower():
                continue

            if status == "Won":
                won_count += 1
            elif status == "Lost":
                lost_count += 1

            tags = [status.lower().replace(" ", "_")]
            if due_date:
                try:
                    due_dt = datetime.strptime(due_date, "%Y-%m-%d").date()
                    delta = (due_dt - today).days
                    if delta < 0:
                        tags.append("overdue")
                    elif delta <= 3:
                        tags.append("due_soon")
                except ValueError:
                    pass

            self.tree.insert("", "end", iid=str(rid),
                             values=(status, desc or "", name, company,
                                     phone or "\u2014", email or "\u2014",
                                     date_c or "", due_date or ""),
                             tags=tuple(tags))
            shown += 1
            row_idx += 1

        for s, color in STATUS_COLORS.items():
            self.tree.tag_configure(s.lower().replace(" ", "_"), foreground=color)
        self.tree.tag_configure("overdue",  background=_OVERDUE_BG)
        self.tree.tag_configure("due_soon", background=_DUE_SOON_BG)
        self._restripe()

        # Status bar with win/loss ratio
        parts = [f"   Showing {shown} of {len(rows)} RFQs"]
        total_decided = won_count + lost_count
        if total_decided > 0:
            pct = won_count / total_decided * 100
            parts.append(f"Win rate: {pct:.0f}% ({won_count}/{total_decided})")
        parts.append("Ctrl+N: New  |  Ctrl+F: Search  |  Del: Delete")
        self.status_var.set("   |   ".join(parts))

        self.refresh_calendar()

    def _restripe(self):
        """Re-apply alternating row colors based on current visual order."""
        self.tree.tag_configure("evenrow", background=SURFACE)
        self.tree.tag_configure("oddrow",  background=_ROW_ALT)
        for idx, iid in enumerate(self.tree.get_children()):
            cur_tags = [t for t in self.tree.item(iid, "tags") if t not in ("evenrow", "oddrow")]
            cur_tags.append("evenrow" if idx % 2 == 0 else "oddrow")
            self.tree.item(iid, tags=cur_tags)

    _ARCHIVE_STATUSES = {"Done", "Lost"}

    def _sort_by_column(self, col, reverse):
        data = [(self.tree.set(k, col), k) for k in self.tree.get_children()]

        def sort_key(t):
            val, k = t
            is_archive = self.tree.set(k, "status") in self._ARCHIVE_STATUSES
            return (is_archive, val == "", val)

        data.sort(key=sort_key, reverse=reverse)
        for i, (_, k) in enumerate(data):
            self.tree.move(k, '', i)
        self._restripe()
        self.tree.heading(col, command=lambda: self._sort_by_column(col, not reverse))

        # Persist sort preference
        self.settings["sort_column"] = col
        self.settings["sort_reverse"] = reverse
        save_settings(self.settings)

    def _apply_saved_sort(self):
        col = self.settings.get("sort_column", "")
        reverse = self.settings.get("sort_reverse", False)
        valid = ("status", "desc", "name", "company", "phone", "email", "date", "due")
        if col and col in valid:
            self._sort_by_column(col, reverse)

    def _on_tree_click(self, event):
        """Single-click on the Status column opens a quick-change popup."""
        region = self.tree.identify_region(event.x, event.y)
        if region != "cell":
            return
        col = self.tree.identify_column(event.x)
        if col != "#1":  # Status is the first column
            return
        item = self.tree.identify_row(event.y)
        if not item:
            return
        self.tree.selection_set(item)
        menu = tk.Menu(self, tearoff=0, font=("Segoe UI", 10))
        for s in STATUS_OPTIONS:
            color = STATUS_COLORS.get(s, DARK)
            menu.add_command(
                label=f"  {s}",
                foreground=color,
                command=lambda st=s: self._quick_status(st)
            )
        menu.post(event.x_root, event.y_root)

    def _show_ctx(self, event):
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
            self.ctx.post(event.x_root, event.y_root)

    def open_selected(self):
        sel = self.tree.selection()
        if not sel:
            return
        RFQDetailWindow(self, int(sel[0]))

    def open_new_rfq(self):
        RFQDetailWindow(self, None)

    def duplicate_selected(self):
        """Create a copy of the selected RFQ, opened for editing."""
        sel = self.tree.selection()
        if not sel:
            return
        rid = int(sel[0])
        with db_connect() as con:
            row = con.execute(
                "SELECT name, company, phone, email, description, due_date "
                "FROM rfqs WHERE id=?", (rid,)
            ).fetchone()
        if not row:
            return
        name, company, phone, email, desc, due_date = row
        win = RFQDetailWindow(self, None)
        win.title("Duplicate RFQ")
        win.desc_var.set(desc or "")
        win.name_var.set(name or "")
        win.company_var.set(company or "")
        win.phone_var.set(phone or "")
        win.email_var.set(email or "")
        win.due_date_var.set(due_date or "")

    def quick_note(self):
        """Open a small dialog to add a note to the selected RFQ."""
        sel = self.tree.selection()
        if not sel:
            return
        rid = int(sel[0])
        name = self.tree.item(sel[0])["values"][2]
        QuickNoteDialog(self, rid, name)

    def _quick_status(self, status):
        sel = self.tree.selection()
        if not sel:
            return
        rid = int(sel[0])
        with db_connect() as con:
            con.execute("UPDATE rfqs SET status=? WHERE id=?", (status, rid))
            con.execute(
                "INSERT INTO activity (rfq_id, entry, ts) VALUES (?, ?, ?)",
                (rid, f"Status changed to '{status}'", now_str())
            )
        self.refresh_table()

    def delete_selected(self):
        sel = self.tree.selection()
        if not sel:
            return
        rid  = int(sel[0])
        name = self.tree.item(sel[0])["values"][2]
        if messagebox.askyesno("Delete RFQ",
                               f"Permanently delete the RFQ for '{name}'?\n"
                               f"This cannot be undone.", icon="warning"):
            with db_connect() as con:
                con.execute("DELETE FROM rfqs WHERE id=?", (rid,))
            self.refresh_table()

    # ── Calendar tab ──────────────────────────────────────────────────────────
    def _build_calendar_tab(self, parent):
        now = datetime.now()
        self._cal_year  = now.year
        self._cal_month = now.month

        # Navigation bar
        nav = tk.Frame(parent, bg=BG)
        nav.pack(fill=tk.X, pady=(10, 6), padx=4)

        tk.Button(nav, text=" \u25c0 ", bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10), relief="flat", cursor="hand2",
                  command=self._cal_prev, padx=8, pady=4).pack(side=tk.LEFT)

        self._cal_title_var = tk.StringVar()
        tk.Label(nav, textvariable=self._cal_title_var,
                 bg=BG, fg=DARK, font=("Segoe UI", 12, "bold"),
                 width=22, anchor="center").pack(side=tk.LEFT, padx=12)

        tk.Button(nav, text=" \u25b6 ", bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10), relief="flat", cursor="hand2",
                  command=self._cal_next, padx=8, pady=4).pack(side=tk.LEFT)

        tk.Button(nav, text=" Today ", bg=ACCENT, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 9), relief="flat", cursor="hand2",
                  command=self._cal_today, padx=8, pady=4).pack(side=tk.LEFT, padx=14)

        # Day-of-week header row
        hdr = tk.Frame(parent, bg=BG)
        hdr.pack(fill=tk.X, padx=4)
        for i, d in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]):
            tk.Label(hdr, text=d, bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                     font=("Segoe UI", 9, "bold"), anchor="center",
                     padx=4, pady=5).grid(row=0, column=i, sticky="ew", padx=1)
            hdr.grid_columnconfigure(i, weight=1)

        # Calendar grid (rebuilt on each refresh)
        self._cal_grid_frame = tk.Frame(parent, bg=BG)
        self._cal_grid_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=(2, 4))

    def refresh_calendar(self):
        if not hasattr(self, '_cal_grid_frame'):
            return

        self._cal_title_var.set(
            f"{_cal_stdlib.month_name[self._cal_month]}  {self._cal_year}"
        )

        for w in self._cal_grid_frame.winfo_children():
            w.destroy()

        prefix = f"{self._cal_year}-{self._cal_month:02d}-"
        with db_connect() as con:
            rfqs = con.execute(
                "SELECT id, name, company, status, due_date, description "
                "FROM rfqs WHERE due_date LIKE ?",
                (prefix + "%",)
            ).fetchall()

        day_map = {}
        for rfq_id, name, company, status, due_date, desc in rfqs:
            try:
                day = int(due_date[8:10])
                day_map.setdefault(day, []).append(
                    (rfq_id, desc or name or company or "RFQ", status)
                )
            except (ValueError, TypeError, IndexError):
                pass

        today = datetime.now().date()
        weeks = _cal_stdlib.monthcalendar(self._cal_year, self._cal_month)

        for row_idx, week in enumerate(weeks):
            self._cal_grid_frame.grid_rowconfigure(row_idx, weight=1, minsize=80)
            for col_idx, day in enumerate(week):
                cell_bg = SURFACE if day else _CAL_EMPTY
                cell = tk.Frame(self._cal_grid_frame, bg=cell_bg,
                               highlightthickness=1, highlightbackground=BORDER)
                cell.grid(row=row_idx, column=col_idx, sticky="nsew", padx=2, pady=2)

                if day:
                    is_today = (
                        self._cal_year == today.year
                        and self._cal_month == today.month
                        and day == today.day
                    )
                    tk.Label(cell, text=str(day),
                             bg=ACCENT if is_today else cell_bg,
                             fg=_TOOLBAR_FG if is_today else SUBTEXT,
                             font=("Segoe UI", 9, "bold"),
                             anchor="ne", padx=4, pady=2).pack(anchor="ne")

                    for rfq_id, label_text, status in day_map.get(day, []):
                        color = STATUS_COLORS.get(status, DARK)
                        if len(label_text) > 18:
                            label_text = label_text[:16] + "\u2026"
                        badge = tk.Label(cell, text=f" {label_text}",
                                        bg=color, fg=_TOOLBAR_FG,
                                        font=("Segoe UI", 8), cursor="hand2",
                                        anchor="w", pady=2)
                        badge.pack(fill=tk.X, padx=3, pady=1)
                        badge.bind("<Button-1>",
                                   lambda e, _id=rfq_id: RFQDetailWindow(self, _id))

        for col_idx in range(7):
            self._cal_grid_frame.grid_columnconfigure(col_idx, weight=1)

    def _cal_prev(self):
        if self._cal_month == 1:
            self._cal_month = 12
            self._cal_year -= 1
        else:
            self._cal_month -= 1
        self.refresh_calendar()

    def _cal_next(self):
        if self._cal_month == 12:
            self._cal_month = 1
            self._cal_year += 1
        else:
            self._cal_month += 1
        self.refresh_calendar()

    def _cal_today(self):
        now = datetime.now()
        self._cal_year  = now.year
        self._cal_month = now.month
        self.refresh_calendar()

    def _on_tab_change(self, event):
        if hasattr(self, '_main_nb') and self._main_nb.index(self._main_nb.select()) == 1:
            self.refresh_calendar()

    # ── System tray ─────────────────────────────────────────────────────────
    def _setup_tray(self):
        if not TRAY_AVAILABLE:
            return
        try:
            icon_path = get_icon_path()
            image = PILImage.open(icon_path)
        except Exception:
            return

        menu = pystray.Menu(
            pystray.MenuItem("Open RFQ Tracker", self._restore_from_tray,
                             default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", self._quit_from_tray),
        )
        self.tray_icon = pystray.Icon("RFQTracker", image,
                                       "RFQ Tracker", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def _hide_to_tray(self):
        if self.tray_icon:
            self.withdraw()

    def _restore_from_tray(self, icon=None, item=None):
        self.after(0, lambda: (self.deiconify(), self.lift(), self.focus_force()))

    def _quit_from_tray(self, icon=None, item=None):
        if self.tray_icon:
            self.tray_icon.stop()
        self.after(0, self.destroy)

    def _on_minimize(self, event):
        if event.widget is self and self.state() == 'iconic':
            if self.settings.get("minimize_to_tray") and TRAY_AVAILABLE and self.tray_icon:
                self.after(10, self._hide_to_tray)

    def _on_close(self):
        if self.settings.get("close_to_tray") and TRAY_AVAILABLE and self.tray_icon:
            self._hide_to_tray()
        else:
            self._quit_app()

    def _quit_app(self):
        if self.tray_icon:
            self.tray_icon.stop()
        self.destroy()

    def open_options(self):
        OptionsWindow(self)

    # ── Update checker ────────────────────────────────────────────────────────
    def _check_for_updates(self):
        def _on_update(version, url):
            self._update_url = url
            self.after(0, lambda: self._show_update_notice(version, url))
        check_for_update(_on_update)

    def _show_update_notice(self, version, url):
        self.status_var.set(
            f"   \U0001f514 Update available: v{version}  \u2014  Click here to download   |   "
            + self.status_var.get()
        )
        self.status_label.configure(cursor="hand2")
        self.status_label.bind("<Button-1>", lambda e: webbrowser.open(url))

    # ── Reminder thread ───────────────────────────────────────────────────────
    def _start_reminder_thread(self):
        def _loop():
            while True:
                now = datetime.now().strftime("%Y-%m-%d %H:%M")
                try:
                    with db_connect() as con:
                        due = con.execute("""
                            SELECT r.id, q.name, q.company
                            FROM reminders r
                            JOIN rfqs q ON q.id = r.rfq_id
                            WHERE r.remind_at <= ? AND r.notified = 0
                        """, (now,)).fetchall()
                        for rem_id, name, company in due:
                            send_notification(
                                "RFQ Reminder",
                                f"Follow up: {name} \u2013 {company or 'No company'}"
                            )
                            con.execute(
                                "UPDATE reminders SET notified=1 WHERE id=?",
                                (rem_id,)
                            )
                except Exception:
                    pass
                time.sleep(60)

        threading.Thread(target=_loop, daemon=True).start()


# ─── Autocomplete Helper ─────────────────────────────────────────────────────
class AutocompleteEntry:
    """Attach autocomplete dropdown behavior to a tk.Entry widget."""

    def __init__(self, entry_widget, fetch_func, on_select_func=None):
        self.entry = entry_widget
        self.fetch = fetch_func
        self.on_select = on_select_func
        self.lb = None
        self._hide_id = None
        self.entry.bind("<KeyRelease>", self._on_key)
        self.entry.bind("<FocusOut>", self._schedule_hide)
        self.entry.bind("<Escape>", lambda e: self._hide())
        self.entry.bind("<Down>", self._on_arrow_down)
        self.entry.bind("<Up>", self._on_arrow_up)
        self.entry.bind("<Return>", self._on_enter)
        self.entry.bind("<space>", self._on_space)

    def _on_key(self, event):
        if event.keysym in ("Return", "Tab", "Escape", "Up", "Down",
                            "Shift_L", "Shift_R", "Control_L", "Control_R",
                            "space"):
            return

        text = self.entry.get().strip()
        if len(text) < 2:
            self._hide()
            return

        matches = self.fetch(text)
        if not matches:
            self._hide()
            return
        self._show(matches)

    def _on_arrow_down(self, event):
        if not self.lb:
            return
        cur = self.lb.curselection()
        if cur:
            idx = cur[0]
            if idx < self.lb.size() - 1:
                self.lb.selection_clear(0, tk.END)
                self.lb.selection_set(idx + 1)
                self.lb.see(idx + 1)
        else:
            self.lb.selection_set(0)
            self.lb.see(0)
        return "break"

    def _on_arrow_up(self, event):
        if not self.lb:
            return
        cur = self.lb.curselection()
        if cur:
            idx = cur[0]
            if idx > 0:
                self.lb.selection_clear(0, tk.END)
                self.lb.selection_set(idx - 1)
                self.lb.see(idx - 1)
        return "break"

    def _on_enter(self, event):
        if self.lb and self.lb.curselection():
            self._accept_selection()
            return "break"

    def _on_space(self, event):
        if self.lb and self.lb.curselection():
            self._accept_selection()
            return "break"

    def _accept_selection(self):
        if self._hide_id:
            self.entry.after_cancel(self._hide_id)
            self._hide_id = None
        sel = self.lb.curselection()
        if sel:
            value = self.lb.get(sel[0]).strip()
            self.entry.delete(0, tk.END)
            self.entry.insert(0, value)
            if self.on_select:
                self.on_select(value)
        self._hide()
        self.entry.focus_set()

    def _show(self, items):
        self._hide()
        toplevel = self.entry.winfo_toplevel()
        self.lb = tk.Listbox(
            toplevel, font=("Segoe UI", 10), bg=SURFACE, fg=DARK,
            selectbackground=_SELECTED, relief="solid", bd=1,
            height=min(len(items), 5)
        )
        for item in items:
            self.lb.insert(tk.END, f"  {item}")

        x = self.entry.winfo_rootx() - toplevel.winfo_rootx()
        y = (self.entry.winfo_rooty() - toplevel.winfo_rooty()
             + self.entry.winfo_height())
        w = self.entry.winfo_width()
        self.lb.place(x=x, y=y, width=w)
        self.lb.lift()
        self.lb.bind("<<ListboxSelect>>", self._on_lb_select)

    def _on_lb_select(self, event):
        if self._hide_id:
            self.entry.after_cancel(self._hide_id)
            self._hide_id = None
        sel = self.lb.curselection()
        if sel:
            value = self.lb.get(sel[0]).strip()
            self.entry.delete(0, tk.END)
            self.entry.insert(0, value)
            if self.on_select:
                self.on_select(value)
        self._hide()
        self.entry.focus_set()

    def _schedule_hide(self, event=None):
        self._hide_id = self.entry.after(200, self._hide)

    def _hide(self, event=None):
        if self.lb:
            self.lb.destroy()
            self.lb = None


# ─── Quick Note Dialog ───────────────────────────────────────────────────────
class QuickNoteDialog(tk.Toplevel):
    def __init__(self, parent, rfq_id, rfq_name):
        super().__init__(parent)
        self.parent = parent
        self.rfq_id = rfq_id
        self.title(f"Quick Note \u2014 {rfq_name}")

        w, h = 420, 150
        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - w) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - h) // 2
        self.geometry(f"{w}x{h}+{px}+{py}")
        self.resizable(False, False)
        self.configure(bg=BG)
        self.grab_set()
        self.lift()
        self.focus_force()
        self.bind("<Escape>", lambda e: self.destroy())

        tk.Label(self, text="Add a note:", bg=BG, fg=DARK,
                 font=("Segoe UI", 10)).pack(anchor="w", padx=16, pady=(12, 4))

        self.note_var = tk.StringVar()
        entry = tk.Entry(self, textvariable=self.note_var,
                         font=("Segoe UI", 11), relief="solid", bd=1,
                         bg=SURFACE, fg=DARK)
        entry.pack(fill=tk.X, padx=16, ipady=5)
        entry.focus_set()
        entry.bind("<Return>", lambda e: self._save())

        btn_row = tk.Frame(self, bg=BG)
        btn_row.pack(fill=tk.X, padx=16, pady=12)

        tk.Button(btn_row, text="  Save  ",
                  bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10, "bold"),
                  relief="flat", cursor="hand2",
                  command=self._save,
                  padx=14, pady=5).pack(side=tk.RIGHT)

        tk.Button(btn_row, text="  Cancel  ",
                  bg=BORDER, fg=DARK,
                  font=("Segoe UI", 10),
                  relief="flat", cursor="hand2",
                  command=self.destroy,
                  padx=14, pady=5).pack(side=tk.RIGHT, padx=8)

    def _save(self):
        note = self.note_var.get().strip()
        if not note:
            return
        ts = now_str()
        with db_connect() as con:
            con.execute(
                "INSERT INTO activity (rfq_id, entry, ts) VALUES (?, ?, ?)",
                (self.rfq_id, note, ts)
            )
        self.parent.refresh_table()
        self.destroy()


# ─── RFQ Detail / Edit Window ─────────────────────────────────────────────────
class RFQDetailWindow(tk.Toplevel):
    def __init__(self, parent, rfq_id):
        super().__init__(parent)
        self.parent = parent
        self.rfq_id = rfq_id
        self.is_new = (rfq_id is None)

        self.title("New RFQ" if self.is_new else "RFQ Details")
        w, h = 660, 720
        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - w) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - h) // 2
        # Clamp so the dialog doesn't go off the bottom of the screen
        screen_h = self.winfo_screenheight()
        if py + h > screen_h - 40:
            py = screen_h - h - 40
        if py < 0:
            py = 0
        self.geometry(f"{w}x{h}+{px}+{py}")
        self.minsize(640, 620)
        self.resizable(True, True)
        self.configure(bg=BG)
        self.grab_set()
        self.lift()
        self.focus_force()
        self.bind("<Escape>", lambda e: self.destroy())

        self._load_data()
        self._build_ui()
        if not self.is_new:
            self._populate_fields()

    # ── Load from DB ──────────────────────────────────────────────────────────
    def _load_data(self):
        self.row_data   = None
        self.activities = []
        self.rem_data   = []
        if self.rfq_id:
            with db_connect() as con:
                self.row_data = con.execute(
                    "SELECT name, company, phone, email, status, date_created, due_date, description "
                    "FROM rfqs WHERE id=?", (self.rfq_id,)
                ).fetchone()
                self.activities = con.execute(
                    "SELECT entry, ts FROM activity "
                    "WHERE rfq_id=? ORDER BY ts ASC", (self.rfq_id,)
                ).fetchall()
                self.rem_data = con.execute(
                    "SELECT id, remind_at, notified FROM reminders "
                    "WHERE rfq_id=? ORDER BY remind_at ASC", (self.rfq_id,)
                ).fetchall()

    # ── Build UI ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=_TOOLBAR_BG, padx=18, pady=12)
        hdr.pack(fill=tk.X)
        tk.Label(hdr,
                 text="\U0001f4cb  New RFQ" if self.is_new else "\U0001f4cb  RFQ Details",
                 bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                 font=("Segoe UI", 13, "bold")).pack(side=tk.LEFT)

        # Buttons (packed first at bottom so they always stay visible)
        btn_row = tk.Frame(self, bg=BG, padx=18, pady=10)
        btn_row.pack(side=tk.BOTTOM, fill=tk.X)

        tk.Button(btn_row, text="  Save RFQ  ",
                  bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10, "bold"),
                  relief="flat", cursor="hand2",
                  command=self.save,
                  padx=14, pady=7).pack(side=tk.RIGHT)

        tk.Button(btn_row, text="  Cancel  ",
                  bg=BORDER, fg=DARK,
                  font=("Segoe UI", 10),
                  relief="flat", cursor="hand2",
                  command=self.destroy,
                  padx=14, pady=7).pack(side=tk.RIGHT, padx=8)

        # Notebook (fills remaining space above buttons)
        nb = ttk.Notebook(self)
        nb.pack(fill=tk.BOTH, expand=True, padx=18, pady=12)

        self._build_details_tab(nb)
        self._build_activity_tab(nb)
        self._build_reminders_tab(nb)

    # ── Tab 1: Details ────────────────────────────────────────────────────────
    def _build_details_tab(self, nb):
        tab = ttk.Frame(nb, padding=20)
        nb.add(tab, text="  Details  ")

        self.desc_var     = tk.StringVar()
        self.name_var     = tk.StringVar()
        self.company_var  = tk.StringVar()
        self.phone_var    = tk.StringVar()
        self.email_var    = tk.StringVar()
        self.status_var   = tk.StringVar(value="Pending")
        self.date_var     = tk.StringVar(value=datetime.now().strftime("%Y-%m-%d"))
        self.due_date_var = tk.StringVar(value="")

        fields = [
            ("RFQ Description", self.desc_var),
            ("Contact Name *",  self.name_var),
            ("Company",         self.company_var),
            ("Phone / Cell",    self.phone_var),
            ("Email Address",   self.email_var),
        ]

        self._entries = {}
        for i, (label, var) in enumerate(fields):
            tk.Label(tab, text=label, bg=BG, fg=SUBTEXT,
                     font=("Segoe UI", 9)).grid(
                row=i * 2, column=0, columnspan=2, sticky="w", pady=(6, 0))
            e = tk.Entry(tab, textvariable=var,
                         font=("Segoe UI", 11), relief="solid", bd=1,
                         bg=SURFACE, fg=DARK)
            e.grid(row=i * 2 + 1, column=0, columnspan=2,
                   sticky="ew", ipady=5, pady=(2, 2))
            self._entries[label] = e

        r = len(fields) * 2
        tk.Label(tab, text="Status", bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 9)).grid(
            row=r, column=0, sticky="w", pady=(8, 0))
        tk.Label(tab, text="Date Created", bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 9)).grid(
            row=r, column=1, sticky="w", padx=(12, 0), pady=(8, 0))

        ttk.Combobox(tab, textvariable=self.status_var,
                     values=STATUS_OPTIONS, state="readonly",
                     font=("Segoe UI", 11), width=22).grid(
            row=r + 1, column=0, sticky="ew", ipady=3, pady=(2, 0))

        tk.Entry(tab, textvariable=self.date_var,
                 font=("Segoe UI", 11), relief="solid", bd=1,
                 bg=SURFACE, fg=DARK, width=16).grid(
            row=r + 1, column=1, sticky="ew", padx=(12, 0), ipady=5, pady=(2, 0))

        # Due Date
        tk.Label(tab, text="Due Date (optional)", bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 9)).grid(
            row=r + 2, column=0, sticky="w", pady=(8, 0))

        tk.Entry(tab, textvariable=self.due_date_var,
                 font=("Segoe UI", 11), relief="solid", bd=1,
                 bg=SURFACE, fg=DARK, width=16).grid(
            row=r + 3, column=0, sticky="ew", ipady=5, pady=(2, 0))

        tab.columnconfigure(0, weight=1)
        tab.columnconfigure(1, weight=1)

        # Auto-fill from previous RFQs
        AutocompleteEntry(self._entries["Contact Name *"],
                          self._fetch_contacts, self._on_contact_selected)
        AutocompleteEntry(self._entries["Company"],
                          self._fetch_companies, self._on_company_selected)

    # ── Tab 2: Activity / Notes ───────────────────────────────────────────────
    def _build_activity_tab(self, nb):
        tab = ttk.Frame(nb, padding=16)
        nb.add(tab, text="  Activity Log  ")

        tk.Label(tab, text="Notes, Quote Numbers & Activity",
                 bg=BG, fg=DARK, font=("Segoe UI", 10, "bold")).pack(anchor="w")
        tk.Label(tab, text="All entries are timestamped automatically.",
                 bg=BG, fg=SUBTEXT, font=("Segoe UI", 8)).pack(
            anchor="w", pady=(0, 6))

        log_frame = tk.Frame(tab, bg=SURFACE, relief="solid",
                              highlightthickness=1, highlightbackground=BORDER)
        log_frame.pack(fill=tk.BOTH, expand=True)

        self.log_text = tk.Text(
            log_frame, font=("Segoe UI", 9), bg=SURFACE, fg=DARK,
            state="disabled", wrap="word", relief="flat",
            padx=10, pady=8, spacing1=2, spacing3=4
        )
        log_sb = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=log_sb.set)
        log_sb.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.pack(fill=tk.BOTH, expand=True)

        add_row = tk.Frame(tab, bg=BG)
        add_row.pack(fill=tk.X, pady=(8, 0))

        self.note_var = tk.StringVar()
        self._ph = "e.g. Quote #1234 sent, following up Monday..."
        self.note_entry = tk.Entry(
            add_row, textvariable=self.note_var,
            font=("Segoe UI", 10), relief="solid", bd=1,
            bg=SURFACE, fg=SUBTEXT, insertbackground=DARK)
        self.note_entry.insert(0, self._ph)
        self.note_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=5)
        self.note_entry.bind("<FocusIn>",  self._ph_clear)
        self.note_entry.bind("<FocusOut>", self._ph_restore)
        self.note_entry.bind("<Return>",   lambda _: self.add_activity())

        tk.Button(add_row, text=" Add Note ",
                  bg=ACCENT, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 9, "bold"),
                  relief="flat", cursor="hand2",
                  command=self.add_activity,
                  padx=10, pady=5).pack(side=tk.RIGHT, padx=(8, 0))

        self._refresh_log()

    def _ph_clear(self, _=None):
        if self.note_entry.get() == self._ph:
            self.note_entry.delete(0, tk.END)
            self.note_entry.config(fg=DARK)

    def _ph_restore(self, _=None):
        if not self.note_entry.get():
            self.note_entry.insert(0, self._ph)
            self.note_entry.config(fg=SUBTEXT)

    def _refresh_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", tk.END)
        self.log_text.tag_configure("ts",   foreground=ACCENT, font=("Segoe UI", 8))
        self.log_text.tag_configure("body", foreground=DARK,   font=("Segoe UI", 10))
        self.log_text.tag_configure("grey", foreground=SUBTEXT)

        if not self.activities:
            self.log_text.insert(tk.END, "  No activity yet. Add your first note below.\n", "grey")
        else:
            for entry, ts in self.activities:
                self.log_text.insert(tk.END, f"  {ts}\n", "ts")
                self.log_text.insert(tk.END, f"  {entry}\n\n", "body")

        self.log_text.configure(state="disabled")
        self.log_text.see(tk.END)

    # ── Tab 3: Reminders ──────────────────────────────────────────────────────
    def _build_reminders_tab(self, nb):
        tab = ttk.Frame(nb, padding=16)
        nb.add(tab, text="  Reminders  ")

        tk.Label(tab, text="Schedule a Windows Reminder",
                 bg=BG, fg=DARK, font=("Segoe UI", 10, "bold")).pack(anchor="w")
        tk.Label(tab,
                 text="You'll get a notification in the Windows notification panel "
                      "(app must be running).",
                 bg=BG, fg=SUBTEXT, font=("Segoe UI", 8)).pack(
            anchor="w", pady=(0, 12))

        row = tk.Frame(tab, bg=BG)
        row.pack(fill=tk.X)

        tk.Label(row, text="Date (YYYY-MM-DD):",
                 bg=BG, fg=DARK, font=("Segoe UI", 9)).pack(side=tk.LEFT)
        self.rem_date_var = tk.StringVar(
            value=datetime.now().strftime("%Y-%m-%d"))
        tk.Entry(row, textvariable=self.rem_date_var,
                 font=("Segoe UI", 10), width=14, relief="solid", bd=1,
                 bg=SURFACE, fg=DARK).pack(side=tk.LEFT, padx=8, ipady=4)

        tk.Label(row, text="Time (HH:MM):",
                 bg=BG, fg=DARK, font=("Segoe UI", 9)).pack(side=tk.LEFT)
        self.rem_time_var = tk.StringVar(value="09:00")
        tk.Entry(row, textvariable=self.rem_time_var,
                 font=("Segoe UI", 10), width=8, relief="solid", bd=1,
                 bg=SURFACE, fg=DARK).pack(side=tk.LEFT, padx=8, ipady=4)

        tk.Button(row, text=" Set Reminder ",
                  bg=GREEN, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 9, "bold"),
                  relief="flat", cursor="hand2",
                  command=self.add_reminder,
                  padx=8, pady=4).pack(side=tk.LEFT, padx=8)

        tk.Label(tab, text="Scheduled Reminders:",
                 bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(16, 4))

        list_frame = tk.Frame(tab, bg=SURFACE, relief="solid",
                               highlightthickness=1, highlightbackground=BORDER)
        list_frame.pack(fill=tk.BOTH, expand=True)

        self.rem_lb = tk.Listbox(
            list_frame, font=("Segoe UI", 10),
            bg=SURFACE, fg=DARK, relief="flat",
            selectbackground=_SELECTED, bd=0, activestyle="none", height=6)
        self.rem_lb.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        tk.Button(tab, text=" Delete Selected Reminder ",
                  bg=DANGER, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 9),
                  relief="flat", cursor="hand2",
                  command=self.delete_reminder,
                  padx=8, pady=4).pack(anchor="w", pady=8)

        if not self.is_new:
            self._refresh_reminders()

    def _refresh_reminders(self):
        self.rem_lb.delete(0, tk.END)
        for _, remind_at, notified in self.rem_data:
            icon = "\u2713 Sent" if notified else "\u23f0 Pending"
            self.rem_lb.insert(tk.END, f"  {remind_at}    {icon}")

    # ── Data actions ──────────────────────────────────────────────────────────
    def _populate_fields(self):
        if not self.row_data:
            return
        name, company, phone, email, status, date_c, due_date, desc = self.row_data
        self.desc_var.set(desc or "")
        self.name_var.set(name or "")
        self.company_var.set(company or "")
        self.phone_var.set(phone or "")
        self.email_var.set(email or "")
        self.status_var.set(status or "Pending")
        self.date_var.set(date_c or "")
        self.due_date_var.set(due_date or "")

    # ── Auto-fill helpers ──────────────────────────────────────────────────────
    def _fetch_companies(self, text):
        with db_connect() as con:
            rows = con.execute(
                "SELECT DISTINCT company FROM rfqs "
                "WHERE company LIKE ? AND company != '' "
                "ORDER BY created_at DESC LIMIT 10",
                (f"%{text}%",)
            ).fetchall()
        return [r[0] for r in rows]

    def _fetch_contacts(self, text):
        with db_connect() as con:
            rows = con.execute(
                "SELECT DISTINCT name FROM rfqs "
                "WHERE name LIKE ? AND name != '' "
                "ORDER BY created_at DESC LIMIT 10",
                (f"%{text}%",)
            ).fetchall()
        return [r[0] for r in rows]

    def _on_company_selected(self, company):
        with db_connect() as con:
            row = con.execute(
                "SELECT name, phone, email FROM rfqs "
                "WHERE company = ? ORDER BY created_at DESC LIMIT 1",
                (company,)
            ).fetchone()
        if row:
            name, phone, email = row
            if not self.name_var.get().strip() and name:
                self.name_var.set(name)
            if not self.phone_var.get().strip() and phone:
                self.phone_var.set(phone)
            if not self.email_var.get().strip() and email:
                self.email_var.set(email)

    def _on_contact_selected(self, name):
        with db_connect() as con:
            row = con.execute(
                "SELECT company, phone, email FROM rfqs "
                "WHERE name = ? ORDER BY created_at DESC LIMIT 1",
                (name,)
            ).fetchone()
        if row:
            company, phone, email = row
            if not self.company_var.get().strip() and company:
                self.company_var.set(company)
            if not self.phone_var.get().strip() and phone:
                self.phone_var.set(phone)
            if not self.email_var.get().strip() and email:
                self.email_var.set(email)

    def add_activity(self):
        entry = self.note_var.get().strip()
        if not entry or entry == self._ph:
            return
        if self.is_new:
            messagebox.showinfo("Save First",
                                "Please save the RFQ first, then add notes.")
            return
        ts = now_str()
        with db_connect() as con:
            con.execute(
                "INSERT INTO activity (rfq_id, entry, ts) VALUES (?, ?, ?)",
                (self.rfq_id, entry, ts)
            )
        self.note_var.set("")
        self.note_entry.config(fg=SUBTEXT)
        self.note_entry.insert(0, self._ph)
        with db_connect() as con:
            self.activities = con.execute(
                "SELECT entry, ts FROM activity "
                "WHERE rfq_id=? ORDER BY ts ASC", (self.rfq_id,)
            ).fetchall()
        self._refresh_log()

    def add_reminder(self):
        if self.is_new:
            messagebox.showinfo("Save First",
                                "Please save the RFQ first, then set reminders.")
            return
        d = self.rem_date_var.get().strip()
        t = self.rem_time_var.get().strip()
        try:
            remind_at = datetime.strptime(
                f"{d} {t}", "%Y-%m-%d %H:%M"
            ).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            messagebox.showerror("Invalid Date/Time",
                                 "Use YYYY-MM-DD for date and HH:MM for time.\n"
                                 "Example: 2026-03-15  14:30")
            return
        with db_connect() as con:
            con.execute(
                "INSERT INTO reminders (rfq_id, remind_at) VALUES (?, ?)",
                (self.rfq_id, remind_at)
            )
        with db_connect() as con:
            self.rem_data = con.execute(
                "SELECT id, remind_at, notified FROM reminders "
                "WHERE rfq_id=? ORDER BY remind_at ASC", (self.rfq_id,)
            ).fetchall()
        self._refresh_reminders()
        messagebox.showinfo("Reminder Set", f"Reminder set for {remind_at}.")

    def delete_reminder(self):
        sel = self.rem_lb.curselection()
        if not sel:
            return
        idx = sel[0]
        if idx < len(self.rem_data):
            rem_id = self.rem_data[idx][0]
            with db_connect() as con:
                con.execute("DELETE FROM reminders WHERE id=?", (rem_id,))
            with db_connect() as con:
                self.rem_data = con.execute(
                    "SELECT id, remind_at, notified FROM reminders "
                    "WHERE rfq_id=? ORDER BY remind_at ASC", (self.rfq_id,)
                ).fetchall()
            self._refresh_reminders()

    def save(self):
        name = self.name_var.get().strip()
        if not name:
            messagebox.showerror("Required", "Contact Name is required.")
            return

        desc     = self.desc_var.get().strip()
        company  = self.company_var.get().strip()
        phone    = self.phone_var.get().strip()
        email    = self.email_var.get().strip()
        status   = self.status_var.get()
        date_c   = self.date_var.get().strip() or datetime.now().strftime("%Y-%m-%d")
        due_date = self.due_date_var.get().strip() or None
        ts       = now_str()

        with db_connect() as con:
            if self.is_new:
                con.execute(
                    "INSERT INTO rfqs "
                    "(name, company, phone, email, status, date_created, created_at, due_date, description) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (name, company, phone, email, status, date_c, ts, due_date, desc)
                )
                new_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
                con.execute(
                    "INSERT INTO activity (rfq_id, entry, ts) VALUES (?, ?, ?)",
                    (new_id, "RFQ created.", ts)
                )
                self.rfq_id = new_id
                self.is_new = False
            else:
                old_status = self.row_data[4] if self.row_data else None
                con.execute(
                    "UPDATE rfqs SET name=?, company=?, phone=?, email=?, "
                    "status=?, date_created=?, due_date=?, description=? WHERE id=?",
                    (name, company, phone, email, status, date_c, due_date, desc, self.rfq_id)
                )
                if old_status and old_status != status:
                    con.execute(
                        "INSERT INTO activity (rfq_id, entry, ts) VALUES (?, ?, ?)",
                        (self.rfq_id,
                         f"Status changed: {old_status} \u2192 {status}", ts)
                    )

        self.parent.refresh_table()
        self.destroy()


# ─── Options Window ──────────────────────────────────────────────────────────
class OptionsWindow(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent = parent
        self.title("Options")
        self.geometry("460x400")
        self.minsize(400, 360)
        self.resizable(False, False)
        self.configure(bg=BG)
        self.grab_set()
        self.lift()
        self.focus_force()
        self.bind("<Escape>", lambda e: self.destroy())

        self.settings = dict(parent.settings)
        self._build_ui()

    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=_TOOLBAR_BG, padx=18, pady=12)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text="\u2699  Options", bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                 font=("Segoe UI", 13, "bold")).pack(side=tk.LEFT)

        # Buttons (packed at bottom first so they always show)
        btn_row = tk.Frame(self, bg=BG, padx=18, pady=10)
        btn_row.pack(side=tk.BOTTOM, fill=tk.X)

        tk.Button(btn_row, text="  Save  ",
                  bg=_TOOLBAR_BG, fg=_TOOLBAR_FG,
                  font=("Segoe UI", 10, "bold"),
                  relief="flat", cursor="hand2",
                  command=self._save,
                  padx=14, pady=7).pack(side=tk.RIGHT)

        tk.Button(btn_row, text="  Cancel  ",
                  bg=BORDER, fg=DARK,
                  font=("Segoe UI", 10),
                  relief="flat", cursor="hand2",
                  command=self.destroy,
                  padx=14, pady=7).pack(side=tk.RIGHT, padx=8)

        # Content
        content = tk.Frame(self, bg=BG, padx=24, pady=18)
        content.pack(fill=tk.BOTH, expand=True)

        # Startup
        self.startup_var = tk.BooleanVar(value=self.settings.get("start_with_windows", False))
        self._add_option(content,
                         self.startup_var,
                         "Start with Windows",
                         "Automatically launch RFQ Tracker when you log in")

        # Separator
        tk.Frame(content, bg=BORDER, height=1).pack(fill=tk.X, pady=10)

        # Minimize to tray
        self.min_tray_var = tk.BooleanVar(value=self.settings.get("minimize_to_tray", False))
        min_cb = self._add_option(content,
                                  self.min_tray_var,
                                  "Minimize to system tray",
                                  "Hide to tray when minimizing instead of taskbar")

        # Close to tray
        self.close_tray_var = tk.BooleanVar(value=self.settings.get("close_to_tray", False))
        close_cb = self._add_option(content,
                                    self.close_tray_var,
                                    "Close to system tray",
                                    "Hide to tray when closing instead of exiting")

        # Disable tray options if pystray not available
        if not TRAY_AVAILABLE:
            for cb in (min_cb, close_cb):
                cb.configure(state="disabled")
            tk.Label(content, text="(Install pystray + pillow for tray support)",
                     bg=BG, fg=DANGER, font=("Segoe UI", 8)).pack(anchor="w", padx=24)

        # Separator
        tk.Frame(content, bg=BORDER, height=1).pack(fill=tk.X, pady=10)

        # Dark Mode
        self.dark_mode_var = tk.BooleanVar(value=self.settings.get("dark_mode", False))
        self._add_option(content,
                         self.dark_mode_var,
                         "Dark mode",
                         "Use dark color scheme (app will restart to apply)")

    def _add_option(self, parent, var, title, subtitle):
        frame = tk.Frame(parent, bg=BG)
        frame.pack(fill=tk.X, pady=(4, 0))

        cb = tk.Checkbutton(frame, variable=var,
                            text=title, bg=BG, fg=DARK,
                            selectcolor=SURFACE, activebackground=BG,
                            font=("Segoe UI", 10), anchor="w",
                            cursor="hand2")
        cb.pack(anchor="w")

        tk.Label(frame, text=subtitle, bg=BG, fg=SUBTEXT,
                 font=("Segoe UI", 8)).pack(anchor="w", padx=24)

        return cb

    def _save(self):
        old_dark = self.settings.get("dark_mode", False)

        self.settings["start_with_windows"] = self.startup_var.get()
        self.settings["minimize_to_tray"] = self.min_tray_var.get()
        self.settings["close_to_tray"] = self.close_tray_var.get()
        self.settings["dark_mode"] = self.dark_mode_var.get()

        save_settings(self.settings)
        set_startup(self.settings["start_with_windows"])
        self.parent.settings = self.settings

        if self.settings["dark_mode"] != old_dark:
            self.parent._restart = True
            self.parent._quit_app()
        else:
            self.destroy()


# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    while True:
        settings = load_settings()
        apply_theme(DARK_THEME if settings.get("dark_mode") else LIGHT_THEME)
        app = RFQApp()
        app.mainloop()
        if not getattr(app, '_restart', False):
            break
