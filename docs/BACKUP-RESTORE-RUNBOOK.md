# StockFlow backup and restore rehearsal: runbook

Author: Claude, 28 Oct 2026. It closes the release gate "Backup restored into an isolated environment and verified" (`docs/planning/RELEASE-GATES.md:21`, `docs/planning/IMPLEMENTATION-STATUS.md:47`, "not evidenced").

**Goal:** prove that we can take a complete copy of production business data, restore it into a separate throwaway database, and show that nothing is missing or changed. Also measure how long a restore takes.

**Facts** (read-only check, 28 Oct 2026):
- Production project `aormuidjbdqruglmyseh` runs PostgreSQL 17.6.
- 91 tables in `public` and `private`, about 73 MB of data.
- Extensions: btree_gist, pg_cron, pg_net, pgcrypto, supabase_vault, uuid-ossp.
- This PC has PostgreSQL 17.11 tools (`C:\Users\Admin\AppData\Local\Programs\PostgreSQL\17-portable\pgsql\bin`). pg_dump 17.11 can read a 17.6 server.

## Roles and safety rules
- **The owner** runs the export command (step 2) in their own terminal and types the database password when prompted. **No agent ever sees, stores or types the password.** It must not be put into chat, files, environment variables in shared shells, or command history.
- **Codex** (the integration chat) runs every other step: fingerprints, restore, verification and cleanup, and records the evidence.
- **Production is read-only throughout.** The only production commands are read-only queries and `pg_dump`.
- **The backup file contains confidential customer and pricing data.**
  - Keep it only in `C:\Users\Admin\StockFlowBackups\`, outside every git checkout.
  - Never commit, upload or attach it.
  - Delete the restored drill database when finished (step 6).
  - Keep or delete the file itself per the owner's choice, recorded in step 6.
- **User logins are not in this backup.** The `auth` schema is not exported, so sign-in accounts and passwords are not in the file; the restore uses a stand-in holding only member IDs. A release rollback doesn't need them, because migrations don't touch `auth`. A full disaster restore into a new project would have to re-create the accounts (4 on 6 Nov 2026) with the same user IDs. The rehearsal records this as an expected gap.
- **Secrets are deliberately excluded.** The `vault` schema (which holds the push sweep secret) and the `cron`/`net` schedules are **not** exported. A real disaster restore must re-create them from the deployment runbooks. The rehearsal records this as an expected gap, not a failure.
- **Best time:** after office hours, with the Tally connector idle and no staff active. Then production doesn't change between the fingerprint and the export, and the comparison should be exact.

## Step 1: production fingerprint (Codex, read-only, just before the export)
Run in a `begin transaction read only;` block on production and save the result as `C:\Users\Admin\StockFlowBackups\fingerprint-production-<date>.json`. It gives one row per table: row count plus a hash of every row's content.

```sql
begin transaction read only;
select t.table_schema, t.table_name,
  (xpath('/row/c/text()', x))[1]::text::bigint as row_count,
  (xpath('/row/h/text()', x))[1]::text as content_md5
from information_schema.tables t
cross join lateral query_to_xml(format(
  'select count(*) as c, md5(coalesce(string_agg(r::text, %L order by r::text), %L)) as h from %I.%I r',
  '|', '', t.table_schema, t.table_name), false, true, '') x
where t.table_schema in ('public','private','supabase_migrations') and t.table_type = 'BASE TABLE'
order by 1, 2;
```

Also record:
- `select now();` as **T0**;
- `select count(*) from supabase_migrations.schema_migrations;` (147 expected as of 28 Oct);
- the function count: `select n.nspname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') group by 1;`.

## Step 2: export (OWNER, about 1 minute)
1. In the Supabase dashboard, go to Project `aormuidjbdqruglmyseh` → **Connect** → **Session pooler**. Copy the **host** and **user** (shaped like `postgres.aormuidjbdqruglmyseh`). Do **not** copy the password anywhere.
2. Open a **new PowerShell window** and paste the command below, replacing `<HOST>` and `<USER>`. It asks for the password; type it there only.

```powershell
New-Item -ItemType Directory -Force C:\Users\Admin\StockFlowBackups | Out-Null
& 'C:\Users\Admin\AppData\Local\Programs\PostgreSQL\17-portable\pgsql\bin\pg_dump.exe' -h <HOST> -p 5432 -U <USER> -d postgres -Fc --no-owner --no-privileges -n public -n private -n supabase_migrations -f "C:\Users\Admin\StockFlowBackups\stockflow-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```

3. When it finishes with no error, tell Codex: "export done". Then close that PowerShell window.

## Step 3: restore into a throwaway local database (Codex)
Use the local portable PostgreSQL 17, the same one the SQL replay uses. Never a hosted project.
1. `createdb -U <local user> stockflow_restore_drill`.
2. Prepare what Supabase normally provides:
   ```sql
   create role anon nologin; create role authenticated nologin; create role service_role nologin;  -- skip any that exist
   create schema if not exists extensions;
   create extension if not exists pgcrypto with schema extensions;
   create extension if not exists "uuid-ossp" with schema extensions;
   create extension if not exists btree_gist;
   -- The dump leaves out Supabase's auth schema by design. One foreign key and one policy need this stand-in.
   create schema if not exists auth;
   create table if not exists auth.users (id uuid primary key);
   create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
   ```
3. Restore in three timed stages, because the foreign key to `auth.users` needs the member IDs loaded first:
   ```powershell
   pg_restore --no-owner --no-privileges --section=pre-data -d stockflow_restore_drill -j 4 "<dump file>"
   pg_restore --no-owner --no-privileges --section=data -d stockflow_restore_drill -j 4 "<dump file>"
   psql -v ON_ERROR_STOP=1 -d stockflow_restore_drill -c "insert into auth.users(id) select distinct user_id from public.stockflow_members where user_id is not null on conflict do nothing"
   pg_restore --no-owner --no-privileges --section=post-data -d stockflow_restore_drill -j 4 "<dump file>"
   ```
   - Save the full output of all stages to `restore-log-<date>.txt`, next to the dump.
   - **Expected, acceptable errors:** `schema "public" already exists` (pre-data stage exit 1 from this alone is fine), references to `cron`, `net` or `vault` objects, and Supabase-only roles or grants. **Any other error is a failure.** List each one.
   - Confirm `stockflow_members_user_id_fkey` and the policy `members_read_own_access` both exist afterwards.
   - **Trial, Claude, 6 Nov 2026** on `stockflow-20261106.dump`, in a separate throwaway database since dropped: the only error was `schema "public" already exists`. Foreign key and policy present, 90 tables, 147 migrations, 350 functions, 131 triggers, 0 unvalidated constraints, about 4 seconds. The fingerprint comparison in step 4 was not part of this trial.
4. Record the wall-clock restore time: this is the **restore time objective** we can actually meet.

## Step 4: verify (Codex)
1. Run the **same fingerprint query** from step 1 on `stockflow_restore_drill`, and save it as `fingerprint-restore-<date>.json`.
2. Compare table by table:
   - **PASS**: every table has an identical `row_count` and `content_md5`.
   - If run at a quiet time, any difference is a **FAIL**. If something changed in production between T0 and the export (for example a connector sync), explain each differing table using production `created_at`/`updated_at`/`imported_at` > T0. Only explained differences on sync-fed tables are acceptable: `stockflow_snapshots`, `stockflow_tally_sales_prices`, `stockflow_request_log` and similar. Any difference in orders, order lines, pricing decisions, price exceptions, billing snapshots, customer prices or members is a **FAIL**.
3. Compare the migration count and the function counts with step 1.
4. **Smoke checks** on the restored DB:
   - read 3 recent orders' billing sheets with `select private.stockflow_order_billing_sheet('<order id>');` (pick ids from the restored `private.stockflow_orders`) → each is `ready=true` with the same total as production shows;
   - one rate check, `select private.stockflow_order_rate_check('<billed order id>');`, returns without error;
   - `select count(*) from private.stockflow_customer_product_prices where status='approved';` equals production.

## Step 5: record the evidence
Append one entry to `docs/INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md` and one to `docs/CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md`. Never include the file contents or any customer data. Record:
- the date and T0;
- the dump file name and size;
- the export duration (owner-reported) and the restore duration;
- the table count;
- PASS or FAIL per table (summarised: "91/91 identical", or a list of explained differences);
- the migration and function counts;
- the smoke-check results;
- the expected gaps (vault, cron, net and auth not exported).

Then tick the gate in `docs/planning/RELEASE-GATES.md:21` and set `docs/planning/IMPLEMENTATION-STATUS.md:47` to "Evidenced <date>", citing the record.

## Step 6: clean up
- `dropdb stockflow_restore_drill` (local only).
- Ask the owner: **keep** the `.dump` file (it's a usable offline backup; keep it on an encrypted drive) or **delete** it. Record the answer.
- Confirm no copy of the dump exists inside any repository folder or `work/` directory.

## Repeat schedule
- Monthly, and before any migration that rewrites existing data.
- Each run is compared against the previous run's time and size, to spot growth or slow restores early.

## Failure handling
Any FAIL stops the rehearsal. Record exactly what differed. Do not "fix" production or the backup; report to the owner and Claude for a reviewed plan.
