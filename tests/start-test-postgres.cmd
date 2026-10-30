@echo off
"%LOCALAPPDATA%\Programs\PostgreSQL\17-portable\pgsql\bin\pg_ctl.exe" -D "%LOCALAPPDATA%\Programs\PostgreSQL\17-portable\data" -l "%LOCALAPPDATA%\Programs\PostgreSQL\17-portable\pg-session.log" -W start
