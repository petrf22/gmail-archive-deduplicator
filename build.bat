@echo off
REM Build script for Gmail Archive Deduplicator (Windows)
REM Usage: build.bat

echo === Gmail Archive Deduplicator - Build Script ===
echo.

pushd src

REM Check if icons exist
if not exist "icons\icon-16.png" (
    echo WARNING: PNG ikony nebyly nalezeny!
    echo     Prosim vytvorte ikony pred vytvorenim .xpi balicku
    echo     Viz icons\README.md pro instrukce
    echo.
    choice /M "Pokracovat i bez ikon"
    if errorlevel 2 exit /b 1
)

REM Clean old build
if exist "..\gmail-archive-deduplicator.xpi" (
    echo Odstranuji stary balicek...
    del "..\gmail-archive-deduplicator.xpi"
)

REM Create XPI using PowerShell
echo Vytvarem .xpi balicek...
powershell -Command "Compress-Archive -Path manifest.json,background.js,popup.html,popup.js,icons -DestinationPath ..\gmail-archive-deduplicator.zip -Force"
ren "..\gmail-archive-deduplicator.zip" "gmail-archive-deduplicator.xpi"

popd

echo.
echo Hotovo!
echo Soubor: gmail-archive-deduplicator.xpi
echo.
echo Dalsi kroky:
echo 1. Otevrete Thunderbird
echo 2. Stisknete Ctrl+Shift+A
echo 3. Ikona ozubeneho kola -^> Install Add-on From File
echo 4. Vyberte gmail-archive-deduplicator.xpi
echo.
pause
