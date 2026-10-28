# Customer identity: Tally is authoritative

**Historical intervening decision, superseded by the owner's later instruction on 15 October 2026:** restore [one-time confirmation](CUSTOMER-TALLY-LINK-CONFIRMATION-DECISION-20261015.md), with ledger-free customers for visits. Keep Tally names and stable canonical identities for linked customers. The cancellation below is retained as history and is no longer the active instruction. See [current implementation handover](HANDOVER-CUSTOMER-TALLY-LINKS-20261015.md).

15 October 2026. Owner direction: keep customer names from the Tally ledger; no customer matching workflow. This supersedes [person-confirmed customer links](CUSTOMER-TALLY-LINK-CONFIRMATION-DECISION-20261015.md), including the previously approved screen.

## Product behaviour

- Show the customer name supplied by Tally. Staff must not maintain a second customer name or confirm a routine Tally sync.
- Use canonical company identity plus ledger GUID internally. A ledger rename updates the displayed name without creating a new customer or losing orders, visits, contacts, assignments or instrument history.
- Keep app-owned contacts, visits, territories and assignments on the existing customer record. Tally authority over customer identity does not make those records Tally-owned.
- Retain the existing app customer UUID and its foreign keys. Preserve original names in immutable invoice/audit evidence; updating the current directory must not rewrite historical evidence.
- Do not ship a Link to Tally, matching, batch-confirmation or duplicate-master maintenance screen.

## Current implementation and gap

The regular connector already imports Sundry Debtor names from Tally. However, `Get-TallyCustomers` in `desktop-connector/dashboard.ps1` currently sends `tallyKey = name`; the original sync in `20260831123500_sync_tally_customer_ledgers.sql` upserts by that key. The manual-link proposal attempted to bridge this legacy directory to Economics ledger GUIDs. The owner has rejected that extra user task.

The next implementation should extend the existing customer export/sync with company and ledger GUID, rather than add a second ledger directory and matching UI. Review the latest sync replacements and consumers before changing the producer. Add a new migration; do not rewrite deployed migrations.

Migration must preserve existing customer UUIDs using deterministic trusted source evidence. Ambiguous, duplicate, missing-GUID or conflicting legacy records must produce visible technical exceptions and preserve history, rather than merge by guess. Current name equality alone must not silently rebind historical financial attribution. This is a migration concern, not routine staff matching work. Existing verified Economics identities remain authoritative until the governed migration reconciles them.

## Implementation checks

1. Inspect current customer sync, directory reads, Economics identity references and connector fixtures; claim their exact files in both shared logs before edits.
2. Export stable company/ledger identity alongside Tally name using the existing connector read. Keep compatibility during connector rollout and reject stale or invalid identity evidence visibly.
3. Migrate and sync transactionally with uniqueness scoped to company and ledger GUID, retained app UUIDs, auditable identity changes and repeat-safe imports. Do not silently deactivate or replace customers on an invalid export.
4. Verify rename retains the same UUID and related orders/visits/contacts; distinct same-name ledgers remain distinct; cross-company GUIDs cannot collide; duplicate/conflicting evidence cannot partially change identity; replay creates no duplicate customer; concurrent sync is safe.
5. Reconcile financial bindings and source completeness separately before Economics/classes cutover. No customer-name change proves complete sales coverage.

## Withdrawal and release status

The manual-link package was never deployed. Its review work is preserved locally on `codex/customer-tally-link-review` at `c52761b`, based on reconciliation `94ab7ca` of Claude package `479b806` and RC `157b7c7`. Do not merge or release that package. Useful regression findings may be ported selectively into the replacement after primary review.

The held package's disposable database replay and connector fixtures passed locally (`work/customer-links-review-20261015/replay-final-1.log`, `connector-final.log`). Those results do not verify the replacement, which is not implemented yet. No hosted migration, connector, Edge or Worker change was made for this decision. RC remains `157b7c7`; existing acceptance release and Economics/register cutover gates remain unchanged.
