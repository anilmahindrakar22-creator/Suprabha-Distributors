# UI polish release — 19 October 2026

Current state: **released to production and PR64 merged**. Production Worker is `bc108530-f877-4466-9168-dff27529f9a2` at 100%; rollback `c6d70338-8a9e-4bd1-83d2-591c7d15360c` is retained. No rollback was needed. Codex is the sole integrator/deployer. Product source remains unchanged from Claude's candidate.

## Reviewed candidate and scope

- `claude/ui-polish` at `855e7898f74ef67874fbe0414c3cf70100225f5c`, parent `de0f8c7bf136a7c1dade1c57bca5df5a2521c5df`.
- PR64: https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/64.
- Eleven client/type/test files: order approval evidence card and two-line queue rows; phone date wrapping and product previews; navigation and Users layouts; Administrator/Management Accounts default All; Requests open-count/disclosure; Stock overdue text and SVG glyphs.
- No API, approval command, permissions, migration, Edge function or connector change. Financial-year order numbering and its 136-entry production history remain intact.
- Tested merge `55235724f6fff356bf91b9867efbcfcd83f51850` and reviewed source share tree `2229066216ca95f9553fce423a75eebbe7f8dead`.
- All 718 tracked source files match committed Git blobs. Both frozen target builds contain 189 files (378 artifact hashes); target/project/reset flags and both deployment dry runs passed.

## Verification completed

- New approval-card browser checks passed on desktop and phone; screenshots inspected. The fixture independently checks unit price ₹4,450, quantity 2 / total ₹8,900, latest displayed bill ₹4,510 / difference ₹60, cost ₹3,465, GP ₹985 per unit / margin 22.1%, policy minimum 25%, and the request reason.
- Card reads existing pricing workspace fields. Existing server pricing-role/order-access checks and pending-exception filtering remain unchanged. No price, stage, invitation or role action submitted.
- Acceptance Worker `1cae7c8d-57ac-4d55-abc2-bb20809bfe4d`, from the exact reviewed candidate.
- Nine hosted shell/private API/canonical Stock alias/served HTML-JS-CSS checks passed.
- Fresh private Administrator tab: **2 successful GET `/api/orders` invocations in 15,117 ms** after opening Orders, Active selected, actual order rendered, no Loading message at end.
- Measurement uses read-only Worker tail, verifies the unique fresh-tab Referer and filters event-start timestamps to the opening window. Counts server-received invocations; it is not browser ResourceTiming or proof about requests that never reached the Worker. Prior reads and subsequent polling are excluded.
- Desktop at 1280px: no page overflow; queue width/scroll width 439/439. All navigation labels visually visible. Navigation retains 6px internal padding overflow (920 scroll / 914 client), with no page overflow.
- Phone at 375×532: page/scroll width 375/375, wrapped date, product preview and reachable next-step control. No hardware-device performance claim. Temporary viewport reset.
- Acceptance Administrator Accounts shows All selected and renders both accounts. Requests shows Product requests / None open with disclosure. Visible add-user Roles form fits both desktop and phone; staff settings untouched.
- Final normal CI workflow **`39197292053` succeeded**. Both complete logs saved and reviewed: lint/types/connector/static/build/audit, **1,487 unit tests / 143 files, 36 general browser checks, 579 staff browser checks plus 15 intended skips, 20 offline checks, 21 installed mitigation tests and all 46 database replay/integrity checks**. General job `117882702816`, database job `117882702642`.
- Immediate pre-deployment production readback was `c6d70338` at 100%; rollback metadata matched target flags and ten binding names/types.
- All 82 unrelated original dirty/untracked file bytes are preserved. No new acceptance fixtures were created; existing ones remain archived. First-real-order follow-up remains unchanged.

## Production verification and integration completed

- Source/artifacts, shared handover/rollout and remote heads were rechecked before production deployment. The verified frozen production target was deployed without rebuilding or changing source.
- Production Worker **`bc108530-f877-4466-9168-dff27529f9a2`**, deployed 19 October 2026 at 04:15:51 UTC / 09:45:51 IST; final independent readback at 100%.
- Nine production hosted privacy/alias/HTML-JS-CSS checks passed.
- Fresh private Administrator tab: **3 successful GET `/api/orders` invocations in 15,177 ms**. Active selected, 18 actual orders rendered, no Loading indicator or stall at end. Same server-received per-tab Referer/timestamp method and limitations as acceptance.
- The real pending order `SF-260920-00034` displayed the new evidence card: proposed ₹4,450 per unit; recent bill/rate entries ₹4,510 and ₹4,450 including references/dates; ₹60 difference; purchase cost ₹3,465 / bill `222/26-27`; GP ₹985 per unit / margin 22.1%; below the 25% policy minimum; actual request reason and requester/time. Approval and Reject controls remained available; neither was submitted. Quantity was 1, so the optional multi-quantity total is covered by the isolated quantity-2 test.
- Actual desktop widths: page 1280/1280, queue 439/439, card 704/704 (client/scroll). Actual phone widths: page 375/375, card 336/336. Phone scroll reached the cost/reason/requester while the fixed approval controls remained reachable. Screenshots visually inspected. Viewport reset and production returned to Active.
- PR64 merged **`fb1fe1e3a33e42bce0bcf4ee168266a1ab6fb4dc`** only after these checks. Reviewed, tested and merged trees all equal `2229066216ca95f9553fce423a75eebbe7f8dead`. Integration checkout fast-forwarded safely; index was clean and all 82 unrelated original dirty/untracked file bytes still matched their saved hashes.
- No migration, Edge function or connector deployment; no source correction or business/role/invitation command. First-real-order verification heartbeat and numbering history were untouched.
- Both shared logs record the outcome. No further work is required for this release.

Private evidence: `work/ui-polish-release-20261019/` contains exact source, CI/build/dry-run/deployment logs, manifests, sanitized tail/window/count, desktop/phone screenshots and layout/AX evidence. No credentials or raw request headers are saved by the tail helper. Known adjacent connector freshness, loading latency, Stalled flags and Pricing-page inbox scope are documented in Claude's handover; this release does not change their rules.
