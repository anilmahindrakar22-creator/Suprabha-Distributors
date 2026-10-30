# Local test PostgreSQL

This is the disposable local test database. It is never production.

## Windows issue

PostgreSQL 17 portable can fail while recycling WAL files on Windows, logging rename permission errors and panicking. These settings disable WAL recycling and zeroing and cap the WAL target: `wal_recycle=off`, `wal_init_zero=off`, and `max_wal_size=512MB`. The local utility applies them idempotently.

## One-time owner setup

From the repository root, create a limited logon task using the absolute path to `tests\start-test-postgres.cmd` in the command:

```powershell
schtasks /create /tn StockFlowTestPostgres /sc onlogon /rl limited /tr "\"C:\Users\Admin\Documents\Codex\2026-08-30\pl\stockflow-classes\tests\start-test-postgres.cmd\""
schtasks /run /tn StockFlowTestPostgres
```

This needs no admin rights and makes the server independent of any tool shell.

## Daily use

- Run `node tests/local-postgres.mjs ensure` before replays.
- Run `node tests/local-postgres.mjs status` to inspect running, ready, and `wal_recycle` state.
- Run `node tests/local-postgres.mjs restart` only when recovery is stuck.

## Rules for agents

- Never stop a background task that may own the server.
- Use `ensure` instead of calling `pg_ctl` directly.
- Release evidence is still the unmodified full replay.
