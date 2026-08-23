@echo off
rem Restarts Ulanzi Studio with remote debugging so the plugin can be inspected.
rem Without this, diagnosing anything inside Studio is guesswork.
echo Closing Ulanzi Studio...
taskkill /IM UlanziDeck.exe /F >nul 2>&1
ping -n 3 127.0.0.1 >nul
echo Starting with --log --webRemoteDebug ...
start "" "C:\Program Files (x86)\Ulanzi Studio\UlanziDeck.exe" --log --webRemoteDebug
echo.
echo Ready. DevTools targets: http://127.0.0.1:9292/json/list
