@echo off
rem DevTools client for pages inside Ulanzi Studio - see cdp.js for commands.
rem Node 20 needs the flag to expose a global WebSocket.
"C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe" --experimental-websocket "%~dp0cdp.js" %*
