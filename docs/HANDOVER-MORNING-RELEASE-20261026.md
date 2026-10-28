# 26 October 2026 corrected morning release — LIVE

Owner target: claude/release-20261026 @e7e3cf393afecc6a3ac313f750a82cdf9f34208a.
Integrated candidate:e40e95cc97e84ba5f5f798a6ee3b6b0825e38a1e on the live Billing/security baseline ac916f6.
PR71 merged:dbaeac8ab52d603169a10e37e45f848661084d28.
Candidate, GitHub tested merge and integrated source share tree1f14d3cbae70aeefda83840a2491e21578949fd8.

Production was released only after the full corrected acceptance list passed. Codex remains the sole integrator/deployer.

## Live environments and rollback

| Environment | Worker | Migration count |
| --- | --- | --- |
| Acceptance | 2ddb0287-4e11-4f3f-8e51-af9d991dfc23 |83|
| Production |1f4ed2d0-68a1-49f7-b380-942a4e10dc42|145|

Production serves100% of traffic. All10 bindings/types/public flags match previous Workerdf6ff632-1fdd-40a4-b31c-ceaf5fa233e4, retained as rollback. All10 hosted privacy, alias and exact-asset checks pass per environment. No rollback needed.
No Edge Function, connector, Tally or staff-role changes; no production order, approval, billing or dispatch actions.

## Migrations and immutable evidence

Acceptance retained its four previously applied migrations and applied ONLY source20261026130000_billing_snapshot_shapes as remote20261026051144 (82→83).

Production applied all five in order after the existing Billing migration20261025181125:
1. billing_rate_check:20261026052049, SHA49e0581a7a08e8036e2ea14f44a41e2a328fad84cc19e5199ca47458cd81dcbd.
2. approver_price_change:20261026052053, SHAfc13bfb537158a26fe33d8143ba3ba89f88f803fe24e47aa8f54af8c80b91b56.
3. remembered_customer_price:20261026052057, SHAdd3c4944524e5d70568343e4e34e72e8d47ef23e0af6ef840aea7a17af74ddeb.
4. ist_dispatch_date:20261026052100, SHA1874b5ed4a743834d541f077f4b18d271935719c6badea9f67a317fb40124dec.
5. billing_snapshot_shapes:20261026052104, SHAea4b3fefac03d29621fdd22b48fcc4aeeadec5ea546210a03e213c0dcde71926.

Hashes normalize CR and surrounding whitespace only. All140 earlier production migration hashes are preserved. All82 earlier acceptance hashes are preserved. No anchor-changed error occurred; no applied SQL was edited.
The first four migrations passed the exact guarded substitutions, existing function/attribute and new-body/privilege checks. The fifth changes only the two approved-rate lookups, adds the private shared helper, and preserves all other inspected function bodies and attributes. Anonymous/authenticated/service-role direct helper execute is denied.
All11 existing production snapshot payload hashes and both pre-correction acceptance payload hashes are unchanged. Newly created acceptance fixtures have their own snapshots; historical payloads were not rewritten.

## Acceptance: full list passed after the corrected Worker

Signed-in Administrator,375×812:
- SO/26-27/0032: formerly failed sheet now shows1 packed unit ×₹800 and total₹800, without changing its sealed snapshot.
- Same disposable fixture: recorded fictitious invoice reference RELEASE-26OCT-0032, moved ready for dispatch and used one-tap Local delivery successfully. Stored India date2026-10-26, courier Local delivery, tracking Hand delivery. No external Tally bill, real shipment or delivery confirmation.
- Isolated customer RELEASE 26OCT Acceptance Test, ID3e17caca-1652-4790-b45d-33015298ee0e, created through Accounts with no ledger or visit.
- SO/26-27/0033, labelled RELEASE-20261026-B: submitted₹590, Administrator changed to₹600 with a reason, Save checkbox observed checked by default. Rate-change audit590→600 and remembered-price audit verified. Saved cost₹500, kindpurchase_price.
- Repeat SO/26-27/0034, labelled RELEASE-20261026-C: confirmation automatically approved₹600 at16.67% margin, below the configured20% minimum, with ZERO exceptions and no second approval. Packed and advanced to awaiting billing; phone sheet shows₹600/total₹600. The approved decision-row snapshot on0033 also returns ready₹600 through the helper.
- Administrator rate-check list loads, checks1 billed fixture and shows no differences. Its fake invoice is waiting for Tally. This does NOT certify actual imported item-key or unit matching; no source data was forced to match.
- Compact Stock layout and first reorder row fit. Measured rowtop460/bottom660 inside694px frame at375×812, with navigation unobscured after dismissing the temporary toast.

Fixture identifiers:
- 0032:8cbe80d4-1517-47d5-827f-009e338f80b6, dispatched.
- 0033:b24bbabe-84f1-4e60-aff9-5b014794bcbc, packed/price approved.
- 0034:3aaf92d8-b3ce-42d5-9ce4-5afa287509ce, awaiting billing.
They remain clearly labelled in acceptance for review. No production fixtures were created.

## Production read-only follow-up

A fresh existing Administrator session loads Orders on Active; search0050 renders UNICARE DIAGNOSTIC CENTER. No order action was submitted.
Read-only database confirms the one current governed snapshot, SO/26-27/0050, now returns a ready billing sheet (1 of1). Its ready-for-dispatch UI does not render the Billing card at that stage; no live card inspection is claimed there.
Advisor findings are the existing84 INFO RLS-without-policy findings,3 existing mutable-search-path warnings and1 existing disabled password-protection warning; none names a new helper.

## Verification and initial failure

Final CI40271592856 is fully green, including the unchanged dependency audit:1560 units/149 files,38 general browser,607 pricing browser (29 intended skips),20 offline,51 SQL checks; lint0 warnings/errors, types/connector/build/audit pass, zero advisories.
Independent local1560 units/51 deployment-order replay, types, both target builds/dry-runs and existing pnpm audit pass. Exact765 tracked source files and418 frozen artifacts verified. Dependency lock/overrides retain the e37c663 security fixes unchanged.
History-map bookkeeping has10 focused tests passing and changes no application behavior.

The superseded145538c candidate passed CI but failed real acceptance: auto/governed snapshots use lineId/decisionId/enteredRate while the sheet/rate readers expected flat decision-row fields. Production was held. The e7e3cf3 correction supports both immutable shapes and verifies governed rates against an approved decision for the same order/line/id/rate with requiresApproval=false. Real gateway producer regressions now cover confirmation, governed apply, exception approval, changed price and remembered repeat orders. The old blocker evidence is retained in work/morning-release-20261026 and work/corrected-release-20261026/blocked-checkpoint-before.md.

## Preservation and local integration

All90 unrelated dirty/untracked saved file hashes are unchanged. Shared handover and rollout logs are append-only; Claude checkout and shared main dependencies were not changed. Final index is empty.
Windows Git could not unlink two local test files during fast-forward. Their filtered hashes were verified against the clean old commit before copying only the tested target blobs. After checking the complete released tree with Git line-ending filters, the index and branch were advanced to the already-merged commit; no reset/delete of user work. Preservation90/90 passed. This affected only the local checkout, not deployed artifacts.
Only migration-map evidence, its focused preflight test and this new checkpoint were committed after deployment; runtime source remains the tested release.
Private evidence:work/corrected-release-20261026 (source/artifact manifests, CI/test/build logs, acceptance/prod proofs, workflow proof, Worker metadata and hosted reports).
