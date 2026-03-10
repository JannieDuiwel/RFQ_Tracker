@echo off
echo ============================================
echo   RFQ Tracker Pro - Build Script
echo ============================================
echo.

echo Step 1: Installing required packages...
pip install plyer pyinstaller pillow pystray
echo.

echo Step 2: Creating app icon...
python create_icon.py
echo.

echo Step 3: Building RFQ Tracker Pro.exe ...
pyinstaller --onefile --windowed --icon=rfq_icon.ico --add-data "rfq_icon.ico;." --name="RFQ Tracker Pro" rfq_tracker.py
echo.

echo ============================================
echo   Done! Find your app at:
echo   dist\RFQ Tracker Pro.exe
echo ============================================
pause
