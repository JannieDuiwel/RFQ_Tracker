# RFQ Tracker Pro

Track your Requests for Quote — never miss a follow-up again.

## Features
- Add RFQs with name, company, phone, and email (date is automatic)
- Status tracking: Pending → In Progress → Quoted → Won / Lost / Done
- Activity Log tab — add timestamped notes, quote numbers, follow-up details
- Reminders tab — set Windows notification reminders per RFQ
- Search and filter by status
- Right-click quick-status update
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
Make sure the app is open (or minimized) for notifications to fire.
