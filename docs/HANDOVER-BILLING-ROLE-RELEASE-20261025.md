# Billing role, packing and delivery release — 25 October 2026

## Released

Owner source claude/billing-role a3d37d51dd3282ad57fcb569916af7ea34bd8b4b is live in production, with dependency-only correction e37c6635e05593b94ae5dd680ea1fb265aac65e9. PR70 merged as a68e5572639f63a9c3638f936228ccac118a1360 into codex/staff-signin-session-redirect. Candidate, tested GitHub merge and integrated source share tree 56ad8cf02a1b03ed06d2e248f13594cd2a832416. Standalone one-tap-delivery and superseded e692b47 were not released separately.

| Environment | Migration (actual remote version) | Final Worker |
| --- | --- | --- |
| Acceptance | 20261025085356; history 77 → 78 | e164e7ad-a952-491e-8074-68ce70d8abc4 |
| Production | 20261025181125; history 139 → 140 | df6ff632-1fdd-40a4-b31c-ceaf5fa233e4 |

Production serves the Worker at 100%; all 10 bindings and public flags match rollback Worker 6439a38f-b6c0-4996-b4bd-86d655a331d4. No rollback needed. Acceptance was migrated and deployed before production. Initial acceptance Worker e0bf9764 was replaced after the dependency correction; unchanged SQL was not reapplied. No Edge function or connector deployment.

## What changed

- Billing-only staff see approved prices and packed quantities, can copy the sheet for Tally and mark the order billed. Costs, margins, commercial history, price books and Economics remain denied. The owner can now create staff with the Billing role only; no role or account was assigned as a release test.
- Packing supports all items or per-item shortages. Fulfilment saves preserve delivery fields, then advance using the next version. Failed saves do not report successful packing.
- Billing uses packed quantities. Older orders with all packed quantities zero explicitly show ordered quantities with a warning to check with packing.
- One-tap delivery uses the customer as receiver and the current timestamp; the optional receiver/POD form remains.
- Desktop pop-ups require explicit permission and a preference on each computer. They notify only relevant fresh work when the open StockFlow tab is in the background. There is no closed-tab push service. Permission was not enabled during verification.

## Database proof

Source migration 20261025090000_billing_role.sql normalized SHA-256:
69a3ffd1631cd2c70d32984b7add4440359d619939670b0a25b762dd8e282c42.

All previous 77 acceptance and 139 production migration hashes were preserved. Original pricing implementation is retained as a private-to-clients delegate with its body unchanged except the rename. Existing order gateway is unchanged. User/note gateway bodies contain exactly the two guarded role substitutions; existing attributes and ACLs are retained. New wrapper/helper bodies match source. Exactly four role-list constraints change; other inspected constraints do not. Billing gains only the global order scope, orders.transition permission and awaiting_tally_billing → billed_in_tally transition.

Anonymous/authenticated execute is denied for the billing sheet, pricing wrapper and old delegate; service_role executes the wrapper. Gateway key, active membership, role, order access, current approved snapshot and stage checks remain. Billing membership count remains zero in both projects. No real order, packing, billing, delivery, customer or role mutation was performed. Production definition/history check timestamp: 2026-10-25T18:11:35.811863+00:00.

## Verification

Final CI40180190597: both jobs SUCCESS. Reviewed complete logs: 1511 units in148 files,36 general browser tests,591 staff browser tests (19 intended skips),20 offline browser tests,48 SQL checks; lint, types, connector, builds and security audit pass.

Local deployment-order replay:48 checks pass, including end-to-end Billing mark-billed through the real SQL gateway, denial of dispatch, exact output allowlists, no commercial leakage, snapshot invalidation, packed/legacy quantity rules, role/status/key denials and no client execute. Local final units1511/1511, lint/types/build pass. Feature candidate focused browser33 pass/11 intended skips; final full browser coverage is the CI result above.

The first feature CI failed at the security gate despite passing functional checks. Dependency-only manifest changes upgrade shadcn4.22.1, Vite8.1.6 and focused patched overrides. Complete audit now has zero advisories in all severities;34 security regressions pass. Audit gate, parser patch, expiry and tests were not weakened. Upstream withdrew the old braces advisory on23October; no exemption was renewed. Details: BILLING-DEPENDENCY-SECURITY-REVIEW-20261025.md.

All10 hosted privacy/alias/asset checks pass per environment, with exact asset hashes. Final evidence verifies746 tracked source files and418 frozen artifact files (209 per target). Earlier append-log shorthand saying386 artifacts/11 hosted checks is corrected here and in the append log. Final migration-map bookkeeping has10 focused unit tests passing and changes no application code.

The original unrestricted parallel unit run had one encrypted-storage5s timeout (1510passed/1failed); the unchanged isolated file passed6/6 and a bounded two-worker full rerun passed1511. Original failure evidence retained. No timeout or implementation change was made.

## Signed-in observations still pending

The owner assigned Claude the read-only acceptance Administrator check: Orders renders, Billing is offered in Users, eligible packed-order all-items/shortage controls render, and Desktop pop-ups is visible in the desktop bell. A corresponding read-only production observation is requested in the shared handover. No result has been recorded yet. Submit no order/role/pricing/packing/delivery action; do not enable notification permission. If an eligible stage is absent, record that limitation; no fixture or staff mutation is needed.

The browser runtime in this integration chat is blocked by the Windows sandbox setup error. Public hosted checks and automated browser tests are not claimed as signed-in live UI verification. Report any confirmed production regression to Codex for rollback.

## Preservation and evidence

Evidence is retained in ignored work/billing-role-release-20261025-final: exact source, candidate/tested tree, frozen manifests, target builds, deployment logs, hosted reports, production function/history proof and Worker metadata. Earlier feature and security-proposal folders retain initial failures and comparison evidence. Private proposal dependencies are isolated; the main/Claude shared node_modules was not changed.

All89 unrelated dirty/untracked saved file hashes remain unchanged. Shared handover and rollout logs were append-only; their original uncommitted content is preserved. Claude's active checkout was not edited. Codex remains the sole integrator/deployer. Next step is Claude's assigned read-only observations, then owner setup of Billing-only staff if desired.
