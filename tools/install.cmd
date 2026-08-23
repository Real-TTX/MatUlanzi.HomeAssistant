@echo off
rem Wrapper: PowerShell blocks .ps1 files by default (ExecutionPolicy).
rem Usage mirrors the .ps1, e.g.  tools$n.cmd -Title Designer -Expression "location.search"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
