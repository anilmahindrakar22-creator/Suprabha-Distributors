# Major release plan: StockFlow "Market & Pilot", Sunday 8 Nov 2026

**Author:** Claude (plan, design, review). **Builder:** Codex. **Release owner:** the integration chat (gate, deploy). **Date:** 30 Oct 2026.
**Train:** `claude/train-20261106`. Cut Fri 6 Nov, gate and RELEASE TARGET entry by Sat 7 Nov, release Sun 8 Nov.

## 1. What this release is
The biggest single release so far. It adds the commercial layer (Market) on top of the operational core, plus local test-infrastructure fixes, while keeping the office pilot the priority. The roadmap's own warning: "pilot keeps slipping on speculative work". Nothing here may delay the pilot; anything not ready by Thu 5 Nov moves to the next train.

## 2. Already built and tested on the train
| Area | What users get | Evidence |
| --- | --- | --- |
| Wallet V2 | Lab wallet estimates, gap to the 80% target, Focus band | replay, browser, design review |
| Diagnosis + evidence | Why we're not winning: facts, graded source, "price not proven" | D1–D13 |
| Next actions | One owned action per opportunity, "Actions due", proven-price rule for price review | A1–A9 |
| My actions | Staff see and close their own actions; a visit is recorded on close; "Meet: A → B → Decider" | M1–M11 |
| Power Maps 1 + 2 | New roles and alerts, Focus "no decision maker", influence links, route to the decider | P1–P5, I1–I7 |
| Opportunities (ADR-0008, accepted) | Division scope, origin, outcomes (sales before vs now) | D11–D13 |
| Live role refresh | Role changes reach signed-in users without re-login | browser, unit |
| Declutter | Problems-only chips, details behind toggles | design review |
| Local test DB | 50–76 s replay, no crashes, hidden launcher | replay evidence |

**Gate pre-run (30 Oct):** full replay ✓, deployment-order replay ✓ (at `2e743eb`), full browser suite (949/950 → fixed), stock e2e 42/42, unit 1,974 (known pwsh-only failure), tsc 0.

## 3. Remaining work before the cut (Codex in parallel; each with the usual check-first design, real-DB tests, browser, design review)
| # | Workstream | Why now | Size | Gate |
| --- | --- | --- | --- | --- |
| W1 | **Release notes + staff "What's new"** (owner one-pager, role-by-role) and the train-2 **RELEASE TARGET** entry | needed for the release and pilot | S | Claude writes |
| W2 | **Wallet quick entry:** one screen to enter monthly wallet estimates for many labs in a row, with the same validation and audit | Market shows nothing until estimates exist; one-by-one entry is slow | M | SQL reuse (`record_wallet_snapshot`), browser |
| W3 | **Pilot verification pack:** a read-only production check script for the integration chat, covering deployed migrations vs the map, Tally freshness, active roles, pending gates, and leftover test orders | turns Phase 0 "implemented, not verified" into evidence on deploy day | M | read-only, unit |
| W4 | **Full regression at the cut:** full replay (both orders), full browser, stock e2e, unit, plus a phone walkthrough per role | the gate | — | Claude runs, integration chat repeats |

**Not in this release (next trains):** Phase 3 reagent consumption intelligence (needs certified full sales); the Command Center; the Market Map; Power Map diagram (until data exists); assessment evidence fields.

## 4. Owner actions that decide whether the release is useful
1. **Confirm customer links** (Accounts → Review links → "Select all on this page" for exact matches). About 106; minutes.
2. **Enter wallet estimates** for the key labs (W2 makes this fast).
3. **Certified sales:** the integration chat's connector update produces the first certified nightly window. Watch the possible ₹100 September difference.
4. Pilot items: backup restore drill, push test, Nikitesh's role, the billing user, clean test orders, the batch 1 release note.

## 5. Release risks and controls
- **Schema volume:** many new tables and gateways. All are append-only, role-gated and idempotent, and proven by real-database replay in both orders. The integration chat checks the deployment order again on the day.
- **Role refresh touches sign-in:** the full browser suite caught one regression (renewal), fixed. Watch Android sign-in in the pilot.
- **Data emptiness:** Market screens fail closed (blank, not zero) until coverage is certified. Release notes say so plainly.
- **Rollback:** every new migration is additive (new tables and functions; the only change to an existing object is the Power Map role and alert widening). Rolling the app back to the previous build hides the new screens, while the old app keeps working against the new database. Nothing has to be undone in the database. There's no runtime feature switch.
