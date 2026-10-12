# Release gates (per phase)

**Status:** canonical gate definitions. Phases 1–8 are PROPOSED along with the roadmap.
**Sources:** [REQUIREMENTS §§6, 8](../REQUIREMENTS-AND-DELIVERY-PLAN.md); [PRODUCTION-PILOT-2026-09](../PRODUCTION-PILOT-2026-09.md); [INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN](../INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md); spec §§20–21.
**Last verified:** 13 Oct 2026.

## Every phase
- **Tests:** unit, typecheck, lint, affected browser tests on phone and desktop, and the SQL replay suite (`tests/pricing-migration-local.ps1`). New domains add access denial, replay, `PT409` and immutability tests.
- **Design review:** by Claude, with screenshots on phone and desktop.
- **Integration:** the integration owner integrates and deploys. Acceptance comes before production; the rollback artifact is recorded.
- **Migrations:** mapped in the release evidence (`pricing-release-preflight`). No unreviewed migrations.
- **Records:** implementation status updated with evidence.

## Phase 0: pilot (currently open)
- [ ] Deployed commit and migration set verified in production.
- [ ] Tally company identity confirmed on office Tally; freshness messages correct.
- [ ] Connector restart and retry demonstrated.
- [ ] Hosted critical workflow: create → edit → bill → dispatch → deliver.
- [ ] Role restrictions and two-user conflict verified live.
- [ ] Offline draft survives restart and submits once; installed Android sign-in works.
- [ ] **Backup restored into an isolated environment and verified.**
- [ ] Office performance and billing impact measured (≤10% p95 regression).
- [ ] Economics: LDL-C corrected, 11 import exceptions classified, separate Accounts and Sales/Operations sessions, financial sign-off.
- [ ] Five working days of representative use; no open P0/P1.

## Phase 1
- [ ] Customer + 3 products saved in ≤ 60 s in a staff trial.
- [ ] No duplicate requirement for the same demand.
- [ ] Tally arrival matched to open requirements.

## Phase 2
- [ ] One register ID per physical instrument; installations and placements linked.
- [ ] Approval routing per decided tier (D-04).
- [ ] Attribution buckets reconcile with the source.

## Phase 3
- [ ] Supply proxy labelled.
- [ ] Causes require evidence.
- [ ] No double-counted windows.
- [ ] Full-sales coverage verified.

## Phase 4
- [ ] Sales row scope enforced.
- [ ] No duplicate customer.
- [ ] Prospect linking is person-confirmed.
- [ ] Contact erasure by redaction.

## Phase 5
- [ ] Wallet share reconciles with Tally revenue on a sample.
- [ ] Scores are reproducible from snapshots.
- [ ] EV cards complete or show what's missing.
- [ ] A price action only links to Pricing.

## Phase 6
- [ ] Graph and list parity.
- [ ] "Not enough information" default.
- [ ] RELATIONSHIP evidence can be cited.

## Phase 7
- [ ] List and map parity.
- [ ] No invented pins.
- [ ] Freshness shown.
- [ ] Visit and delivery planners kept separate.

## Phase 8
- [ ] Every KPI is in the registry with a version and a drill-down.
- [ ] No KPI is shown before its data gate passes.
