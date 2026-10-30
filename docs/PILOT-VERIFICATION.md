# Pilot production verification

Run [`supabase/scripts/pilot-verification.sql`](../supabase/scripts/pilot-verification.sql) in the Supabase SQL editor or with `psql -f supabase/scripts/pilot-verification.sql` using a production connection with read access. Before running it, edit the `expected_latest` psql variable at the top to the newest local migration version in the deployed train. The shipped value is `20261031150000`.

The script runs inside a read-only transaction, sets only a 30-second statement timeout, and ends with `rollback`. It contains only read queries and never writes production data.

Missing objects report WARN.

## Checks

1. **Migrations applied** — reports the applied migration count, latest version, newest five versions, and warns when the latest is older than `expected_latest`.
2. **Tally freshness** — reports the newest economics voucher import and stock snapshot time for each company; warns if either source is missing or older than 24 hours.
3. **Sales coverage** — calls the coverage check for each linked economics company over each of the last three complete calendar months; passes complete windows and warns for incomplete ones.
4. **Members** — reports counts by role and status; warns when no active administrator exists or a member's role is not in that member's active roles set.
5. **Leftover test orders** — counts non-cancelled orders whose customer name or notes contain “test”; warns if the count is nonzero and does not show names.
6. **Market objects present** — fails if any required Market table or gateway function is missing.
7. **Market gateway grants** — fails if `anon` or `authenticated` can execute any new public gateway.
8. **Market private table RLS** — fails if row level security is not enabled on any new private Market table.

## Objects checked

Tables: `private.stockflow_commercial_opportunities`, `private.stockflow_commercial_opportunity_closures`, `private.stockflow_commercial_constraints`, `private.stockflow_commercial_actions`, `private.stockflow_commercial_action_results`, `private.stockflow_contact_influences`, and `private.stockflow_contact_influence_ends`.

Functions: `public.stockflow_opportunity_gateway(text,text,text,jsonb)`, `public.stockflow_action_gateway(text,text,text,jsonb)`, `public.stockflow_my_actions_gateway(text,text,text,jsonb)`, and `public.stockflow_power_map_gateway(text,text,text,jsonb)`.

## If a check warns or fails

Record the result and investigate with the release owner before calling the pilot verified. For migration warnings, compare deployed history with the train migration map; do not repair migration history from this script. For stale or incomplete Tally data, confirm the connector/import and coverage blockers. For member warnings, review the active allowlist and role assignment. For leftover test orders, have the owner review and clean them through the normal application workflow. For missing objects, grants, or RLS failures, stop the release verification and have the integration owner inspect the deployed migrations and database permissions.
