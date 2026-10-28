# Acceptance role walkthrough — 28 October 2026

Status: **PARTIAL; remaining role switches required.** No complete walkthrough pass is claimed.

Environment: acceptance Worker `c6cc0aa9-164d-4d7c-8f24-b5a83243c516`, source `claude/stock-supply-line @ 7b8d714` integrated and released through PR75 `c81b06a`. Full CI40642344950 passed all runtime, browser, SQL and audit-policy gates.

The owner approved `nikitesh.am@gmail.com` as the spare. Original and latest read-back state: active, primary `accounts`, exact roles `[accounts]`, updated_at `2026-10-15 13:50:10.115411+00`. No role mutation occurred, so no restoration was necessary.

| Role | Actual hosted result | Remaining steps |
|---|---|---|
| Sales | Pending | A1–A6; owner was asked to select Sales only in the separate Administrator Users window |
| Management | Pending | B1–B6 |
| Warehouse | Pending | C1–C6; fixes are covered by fresh automated role-control tests, not certified live |
| Accounts | D1 PASS: desktop1366x900 navigation has Stock, Orders, Requests, Pricing, Economics; no Accounts, Service or Users. Active renders. Create and edit controls absent. Existing fixture0034 billing sheet shows packed1Nos × approved600 =600. | D2 partial: checked on retained0034, not a new ROLE-WALK order. D3/D4 pending. |
| Billing | Pending live; bell/notes/controls covered by CI | E1–E7 |
| Operations | Pending | F1–F5 |
| Viewer | Pending | G1–G2 |
| Administrator | Pending on acceptance in this walkthrough | H1–H4; production Administrator smoke check is not substituted |

Shared fixture created through Administrator Accounts UI: `ROLE WALK Test Lab`, ID `774cb4a3-a03c-4b5a-9cea-3e327b95fa8b`, no ledger; town `Acceptance-only disposable walkthrough`. No visit, contact or ROLE-WALK order was created.

No financial exposure to a prohibited role was observed. Only Accounts was exercised after this release; that is not proof of all-role isolation. Existing production and acceptance orders were read only in this phase; no pricing, billing, dispatch or delivery action was submitted.

Evidence under `stockflow-push-release/work/release-20261028/`: `accounts-before.png` (old UI incorrectly offered +Order), `accounts-after-desktop.png` (new UI), `stock-acceptance-phone.png` (375x812 first row visible). Screenshots remain private locally.

Chrome is not connected to browser control; native control previously stopped because its URL could not be verified. No bypass was attempted. The owner confirmed a separate Administrator window is ready; role changes must be made there manually while Nikitesh stays signed in in the in-app browser. The Sales-only switch request remains pending. Continue the checklist, record each role's first screen and every failure, and restore Accounts on completion or interruption. Stop immediately on prohibited financial-data exposure.
