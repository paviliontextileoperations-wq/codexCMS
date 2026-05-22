@echo off
setlocal
set "PGADMIN=C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pgAdmin4.exe"
if exist "%PGADMIN%" (
  start "" "%PGADMIN%"
) else (
  echo pgAdmin was not found at:
  echo %PGADMIN%
  pause
)
