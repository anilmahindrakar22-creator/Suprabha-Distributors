# Local test PostgreSQL

This is the disposable local test database. It is never production.

## Windows issue

PostgreSQL 17 portable can fail while recycling WAL files on Windows, logging rename permission errors and panicking. These settings disable WAL recycling and zeroing and cap the WAL target: `wal_recycle=off`, `wal_init_zero=off`, and `max_wal_size=512MB`. The local utility applies them idempotently.

## One-time owner setup

The visible console can cause PostgreSQL to log `terminated by exception 0xC000013A` when it is closed; a closed console window stops the database. The VBScript launcher starts the batch file with no window, so there is no console window to close.

In an admin Command Prompt, update the existing task:

```cmd
schtasks /change /tn StockFlowTestPostgres /tr "wscript.exe \"C:\Users\Admin\Documents\Codex\2026-08-30\pl\stockflow-classes\tests\start-test-postgres.vbs\""
```

For a fresh install, create and run the logon task with the full command:

```cmd
schtasks /create /tn StockFlowTestPostgres /sc onlogon /rl limited /tr "wscript.exe \"C:\Users\Admin\Documents\Codex\2026-08-30\pl\stockflow-classes\tests\start-test-postgres.vbs\""
schtasks /run /tn StockFlowTestPostgres
```

## Daily use

- Run `node tests/local-postgres.mjs ensure` before replays.
- Run `node tests/local-postgres.mjs status` to inspect running, ready, and `wal_recycle` state.
- Run `node tests/local-postgres.mjs restart` only when recovery is stuck.

## Rules for agents

- Never stop a background task that may own the server.
- Use `ensure` instead of calling `pg_ctl` directly.
- Release evidence is still the unmodified full replay.
