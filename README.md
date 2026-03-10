# RFQ Tracker Pro

Track your Requests for Quote — never miss a follow-up again.

## Features
- Add RFQs with name, company, phone, email, and optional due date
- **Auto-fill** — type a company or contact name and get suggestions from previous RFQs
- Status tracking: Pending → In Progress → Quoted → Won / Lost / Done
- **Due date tracking** with color-coded urgency (overdue = red, due soon = orange)
- Activity Log tab — add timestamped notes, quote numbers, follow-up details
- Reminders tab — set Windows notification reminders per RFQ
- Search, filter by status, and **click column headers to sort**
- Right-click quick-status update
- **System tray** — minimize or close to tray to keep app running
- **Options** — start with Windows, minimize/close to tray settings
- **Auto-update checker** — notifies you when a new version is available on GitHub
- All data saved locally in a `.db` file next to the app

## How to Build the .exe

**Requirements:** Python 3.9+ installed on a Windows PC.

1. Open Command Prompt in this folder
2. Double-click **BUILD.bat** (or run it in Command Prompt)
3. Wait ~1-2 minutes
4. Your app appears in the `dist/` folder as **`RFQ Tracker Pro.exe`**

You can copy that `.exe` anywhere and share it with co-workers.
No installation needed — just double-click and run.

> **Note:** Each person gets their own database file saved next to their copy of the .exe.

## Windows Notifications
The app checks for due reminders every 60 seconds while running.
Make sure the app is open (or minimized to tray) for notifications to fire.

## Releases
Download the latest `.exe` from the [Releases](https://github.com/JannieDuiwel/RFQ_Tracker/releases) page.
The app will notify you in the status bar when a new version is available.
