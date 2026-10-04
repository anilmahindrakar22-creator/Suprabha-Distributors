# Price book implementation checkpoint — 14 September 2026

## Combined-role implementation start — 4 October 2026

- Owner approved simultaneous combined permissions, not active-role switching. Added a strict deterministic role-set contract in existing user types, retaining legacy scalar role compatibility and rejecting empty, duplicate, unknown or oversized sets. Unit tests cover union semantics and ensure Sales + Warehouse cannot gain pricing or Administrator access. This helper is not yet wired to live authorization; existing user mutation still accepts only one role.
- Fresh targeted user-type suite: 17 passed; affected lint and typecheck passed. No migration, account permission change or deployment performed. Combined roles are NOT complete or available in the app yet.
- Next required ticket: audited database role assignments and gateway authorization integration, preserving old singleton access and suspension/idempotency/concurrency controls. Inspection found membership reads in numerous order, pricing, recovery and operations gateways, plus independent frontend guards in frame/order workspace/pricing workspace/customer price book. Do not deploy a checkbox-only picker or choose a highest role as a substitute for a real permission union. Finish server enforcement/security tests before connecting the UI.

## Production staff email gate activation — 4 October 2026

- Owner reported successful recovery completion; signed-in production Users view remains accessible as Administrator. SMTP was already persisted enabled and production provisioning secret presence verified. Enabled the production staff build's email-action gate, while acceptance remains false and default Sites unchanged. This exposes the existing explicit Invite / resend and Reset password buttons; email labels remain labels, not disguised actions.
- No email sent, new user provisioned, role changed or Tally mutation performed in this activation. Provisioning credential validity and multi-account invitation acceptance still require a real invitation check; owner recovery is user-confirmed, not an independently observed password-update audit sequence.
- Fresh affected invitation/reset/preflight tests: 40 passed; typecheck, whitespace check and staff-production build passed. Source `f81756e` deployed to production staff Worker version `7126855c-157c-4f81-8fbd-02f5fbe4735a` with gate true. Browser reload returned sign-in (consistent with reset session revocation); live post-activation button readback awaits private sign-in. No credential requested in chat.

## Compact staff controls and recovery clarification — 4 October 2026

- Production owner login and Administrator Users access were observed in the signed-in staff browser. Production SMTP persisted enabled after reload; provisioning secret presence was verified through Worker metadata, not its value. One owner recovery request was accepted. Owner clarified that they opened the link once without changing the password, then reopened it: the consumed single-use link cannot restore the in-memory bearer. No authentication bypass or bearer persistence added.
- Staff login now shows each email once with short, individually labelled actions; while email actions are disabled, redundant disabled buttons are replaced by one panel status. Existing authorization, invitation uncertainty and mutation controls unchanged. Recovery page explains single-use completion and distinguishes provider `otp_expired` from missing link without reflecting provider payloads.
- A hosted synthetic-fragment probe enabled the reset form without submitting a password; production template uses standard `ConfirmationURL`. This does not demonstrate a real completed reset. Email gate remains false pending actual recovery completion; public Sites/Tally unchanged.
- Final validation: 28 affected desktop/emulated mobile browser checks passed; typecheck, affected oxlint, whitespace check and staff-production build passed. Source `42cf754` deployed only to staff Worker version `6fa23fd5-bbda-4b5d-81eb-f66b80d07b3d`; signed-in hosted Users readback confirms compact disabled-state controls. One fresh owner recovery request accepted after rollout; recipient completion remains pending.

## Production Auth configuration — 4 October 2026

- Production dashboard inspection found the default Site URL `http://localhost:3000`, no redirect allowlist and public signup enabled. Saved and read back the production staff Site URL and the single exact `/staff-password-reset` redirect; disabled public signup while retaining email confirmation and disabled anonymous sign-in/manual linking. Existing ChatGPT authentication is separate and unchanged.
- Custom SMTP is disabled in production. No production provisioning secret is present in the protected local vault. Account invitation, recovery delivery and authenticated staff acceptance are therefore still blocked on private credential configuration. No provider account created, email sent, password handled or email gate enabled. No source/runtime application code changed; dashboard readback verified settings, not email delivery.

## Production staff host staged — 4 October 2026

- Built the existing source with `pnpm build:staff:production` and deployed `suprabha-staff` to `https://suprabha-staff.anil-mahindrakar22.workers.dev` (initial version `b1990a0e-e12c-4d78-ba6e-e8b7a8f27534`, then six server bindings applied). Verified production project guard `aormuidjbdqruglmyseh` and email-action gate false. Production gateway/read keys came only from the protected production vault; publishable key came from the production project. Acceptance secrets/accounts were not reused.
- Hosted root/sign-in returned HTTP 200 with email/password form and configured ChatGPT peer choice. Anonymous Users returned 401; cross-origin invitation returned 403. Targeted staff-auth/public-sign-in/preflight suites: 71 tests passed; production build passed. No authenticated production account or actual Android acceptance claimed.
- Public Sites remains unchanged and has no staff peer link yet. Provisioning secret, production Auth URL/signup settings, approved account bootstrap and SMTP/recovery verification remain required before enabling invitations or linking the staff host publicly. No email sent, account created, Tally change or paid service used. This is staged infrastructure, not a completed login rollout.

## Coordinated production key rotation — 4 October 2026

- Owner approved rotation of both production gateway/read keys. Fresh random replacements are stored locally with current-user-only ACLs and DPAPI encryption; no raw credential is committed. Production Orders Edge version 28 differs from deployed version 27 only by reading the configured gateway hash, retaining the existing custom authentication and request gate.
- Rotated the guarded database gateway hash and the two relevant Edge settings, then republished existing Sites version 55 with environment revision 5. Deployment `appgdep_6ac1e912f8e481918000460ee2b157e0` succeeded; no new application features or audience changes deployed.
- New-key read-only gateway session and stock dashboard probes both returned HTTP 200. Business counts remain 30 orders, 459 customers and 3 billing snapshots. Tally upload-key digest is unchanged. Targeted request-gate suite: 9 tests passed. These checks do not prove signed-in browser workflow acceptance.
- Production staff Worker, provider accounts, SMTP/recovery delivery and dual public-login activation remain pending. Acceptance credentials were not copied into production; Tally remains untouched. Supersedes the credential blocker below.

## Production staff setup prerequisite check — 4 October 2026

- Following the owner's instruction to proceed with production setup, read-only checks found no `suprabha-staff` Worker and zero production Supabase Auth accounts. Existing ChatGPT login remains unchanged. Sites runtime metadata confirms production gateway/read secrets exist but values are masked; only acceptance credentials are saved in the known local protected vault. Do not reuse them or derive a raw key from its database hash.
- Production setup is blocked on securely supplied existing gateway/read values or explicit approval of coordinated rotation across production Edge/database verification, existing Sites host and the new staff host. Rotation was not performed; owner decision requested, with potential brief Orders/Stock interruption disclosed. No production Auth configuration, provider account, Worker, credential, Tally setting or public link changed. Source remains `18b0631`; no repeated build/tests for this read-only prerequisite check.

## Dual public login preparation and staff safety batch — 4 October 2026

- Implemented optional peer login links: Sites retains “Sign in with ChatGPT” and can offer “Staff email / password”; staff root and `/staff-signin` can offer the configured ChatGPT peer. Server-only origin configuration validates HTTPS/origin-only destinations, rejects unsafe origins and fails closed for the optional link without disabling the existing login. No inferred acceptance link, provider fallback, shared cookie, token forwarding or automatic configuration. Operators must verify both hosts use the same production backend before setting peer origins.
- Added `pnpm build:staff:production` using the same application and architecture, with distinct Worker target `suprabha-staff`. Production and acceptance staff artifacts pin their respective expected Supabase project references; runtime and preflight reject a wrong-project URL. Existing Sites build retains its default configuration. No deployment, production binding or account provisioning performed; both public options are implemented in source but not activated publicly.
- Users now reflects the existing server email gate: disabled email actions are clearly explained, invitation/reset buttons are disabled, and Add user remains membership-only. Role/status controls remain usable. Reset requests and staff frame sign-out have 15-second deadlines; sign-out blocks duplicate in-flight clicks and preserves a visible failure notice. Preflight now requires the existing server-only provisioning key, rather than reporting complete configuration without a credential required by invitation operations.
- Sent one recovery test only to the approved owner in private project `ayrvhemxzizpkfcycvip`, using the exact isolated redirect. Provider accepted the request; owner explicitly reported “recovery complete”. Owner account remains confirmed. A later `recovery_sent_at` read was empty and the scoped audit query returned no rows, so no independently observed audit/password-update sequence is claimed. Actual Android recovery/access testing remains open. Existing deployed email gate remains false; no password read or set by the agent.
- Fresh targeted validation: 99 tests across public link/page rendering, staff authentication, configuration preflight, invitation and reset APIs passed; 30 desktop/emulated Pixel 7 browser checks passed. Typecheck, affected oxlint and whitespace checks passed. Final staff-production and default Sites builds passed; generated production target/project/email-disabled settings and default Sites absence of staff settings verified. Earlier page-render test failed only because React emitted mixed-case `autoComplete`; corrected the assertion to compare HTML case-insensitively. No full financial/database suite repeated because no financial, migration or transaction code changed.
- Files changed: `.env.example`, `app/page.tsx`, `app/staff-signin/page.tsx`, `components/staff-sign-in.tsx`, `components/stockflow-frame.tsx`, `components/user-management.tsx`, `lib/staff-auth.ts`, `package.json`, `vite.config.ts`, `tests/staff-auth-preflight.mjs`, `tests/ui/main.tsx`, `tests/unit/public-sign-in.test.ts`, `tests/unit/sign-in-page.test.tsx`, `tests/unit/staff-auth.test.ts`, `tests/unit/staff-auth-preflight.test.ts`, `tests/pricing-browser/staff-auth.spec.ts`, `tests/pricing-browser/staff-sign-in-choice.spec.ts` and this checkpoint. Existing untracked `.codex/` preserved.
- Remaining release gates: production staff credentials/Auth/SMTP/redirect setup, approved production account bootstrap, authenticated role/access checks, deployment of peer login choices with matched production data, hosted abuse/free-tier resource verification and actual Android acceptance. Do not copy acceptance credentials/accounts into production or enable a header-based identity fallback on the direct Worker. Latest local `dist` is the default Sites artifact; rebuild and verify the intended target before deployment. No paid services, production/Tally changes or merge/publication.

## Verified owner login and approved dual public sign-in — 4 October 2026

- Actual isolated Worker browser session showed `anil.mahindrakar22@gmail.com` signed in; Users loaded active Administrator membership and existing invitation/reset controls. This proves owner email/password login and administrator read access, not recovery delivery or actual Android acceptance. No membership/order mutation was performed.
- Owner requires both ChatGPT and email/password sign-in to remain available publicly. Preserve the existing Sites path. A production staff path must use the production backend and its independently provisioned Auth accounts, with the same gateway-enforced roles. Acceptance credentials, accounts and data must not become the production staff path.
- Current architecture deliberately selects Sites or Supabase authentication by deployment. The direct Worker must not accept spoofable Sites identity headers; do not enable a fallback that trusts those headers there. Two public entry points can serve the same production data once the production staff deployment is separately configured and verified; one-host dual-provider login is not implemented.
- Pending rollout: production staff hosting/configuration, exact provider redirects and SMTP delivery/recovery checks, approved account provisioning, authenticated permission/device checks, then production login-choice links. No production deployment or credentials changed. Recovery-email gate remains false. This checkpoint records the approved behavior, not completion of dual public login.

## Staff welcome email and owner bootstrap — 4 October 2026

- Configured the isolated Worker's server-only provisioning key from the private project's existing modern secret, without printing or committing its value. Supabase accepted the explicitly authorized invitation to `anil.mahindrakar22@gmail.com`, with the exact isolated `/staff-password-reset` redirect. Authoritative provider readback showed invited but not confirmed; acceptance of the send request is not proof of inbox delivery.
- Replaced the private project's default invitation subject/body with “Welcome to Suprabha Distributors” staff onboarding: personal invited email, password setup (minimum 12 characters), browser-based first sign-in, role guidance, administrator help and invitation/password safety. Preserved provider confirmation-link placeholders and configured-site sign-in link. Dashboard save succeeded and rendered preview was checked; removed the default text that the editor initially retained. No invitation resent. Existing emails are not retroactively changed.
- Email-action gate remains false. Next: recipient verifies actual receipt, completes their own password setup and signs in to the isolated Worker; then verify recovery delivery before enabling app email actions and perform authenticated Users/actual Android acceptance. No password requested in chat, production change, Tally change or paid service.
- Documentation-only repository change; no application code or migration changed and no code tests/build repeated. Template preview does not prove rendering in a recipient's email client or successful link completion.

## Isolated invitation-controls rollout — 4 October 2026

- Source `33a4687` rebuilt and deployed only to `suprabha-staff-acceptance`, Worker version `9a406b9f-23c5-4f43-8b1c-3531ebdd1f0e`. Guarded target/auth mode and preserved email-delivery gate false. Fresh affected auth/invitation/reset tests: 47 passed; staff production build passed.
- Hosted verification: sign-in HTTP 200, anonymous invitation POST HTTP 401, cross-origin invitation POST HTTP 403. No invitation sent, user created or provider key added. Authenticated Users acceptance remains unverified.
- Next setup requires explicit server-only provisioning-key configuration and first owner invitation/bootstrap, followed by delivered email and actual Android checks. Email actions are deployed but not enabled/usable yet. Production and Tally unchanged.

## App-based staff invitation implementation — 3 October 2026

- Staff-mode Users now offers Add and invite, invitation/resend for active members, and visible password-reset actions. Sites mode retains Add user with no new provider calls. Membership is saved through the existing audited/idempotent gateway before requesting an invitation; email failure explicitly reports access saved, not atomic provisioning success. Suspended members are not invitation targets.
- Added bounded, same-origin, no-store invitation API requiring verified actor and gateway-enforced administrator access. Only exact active-member email is passed to Supabase admin invitation API, with explicit `/staff-password-reset` redirect. Roles/passwords/provider user objects are not returned or sent as user metadata. New server-only modern `STOCKFLOW_AUTH_ADMIN_KEY` is separate from employee/publishable clients; placeholder, missing and wrong-type keys rejected. Delivery gate stays disabled.
- No automatic provider retries. Client prevents duplicate in-flight actions and blocks invitation resubmission after uncertain failure; existing member controls remain usable. Membership and provider email are separate operations, not one ACID transaction or guaranteed exactly-once email delivery; provider audit logs cover invitation calls.
- Targeted validation: 47 auth/invitation/reset unit tests and 4 desktop/emulated-mobile invitation UI cases passed; typecheck, affected lint and diff checks passed. Synthetic responses do not establish delivered email or actual Android acceptance.
- Not deployed or enabled. Pending: configure server-only provisioning key in isolated Worker, verify SMTP delivery and first owner account bootstrap, then enable gated email actions and perform hosted/device checks. Public app, production data and Tally unchanged.

## Private staff gateway/read credential alignment — 3 October 2026

- Supabase CLI authorization verified. Rotated only private acceptance project `ayrvhemxzizpkfcycvip` gateway/read credentials, uploaded matching Worker bindings, and updated the existing private database gateway verifier transactionally; verified the expected row matches. Production project and upload credential untouched.
- Generated 256-bit random keys locally; saved DPAPI-encrypted copies in current-user-only protected `LocalAppData/Suprabha/StaffAcceptance`. Removed transient plaintext Edge env file after upload. No plaintext keys printed or committed. Operational helper remains in existing untracked `.codex/`, not application source.
- Private backend verification passed: administrator `session` HTTP 200 and authenticated stock read HTTP 200. This is direct backend wiring evidence, not staff email/password login acceptance. Initial probe was blocked by repeated Windows ACL setter privilege error; replaced reapplication with strict verification of existing protected current-user-only ACL, then probe passed.
- Previous private Sites acceptance deployment still has old gateway/read credentials and needs separate refresh before use; new Worker has current bindings. Auth accounts, delivered setup/recovery email, abuse/resource checks and actual Android acceptance remain pending. Recovery stays disabled. No production or Tally changes.

## Five-step isolated staff deployment check — 3 October 2026

- Fresh `pnpm build:staff` passed; guarded generated configuration before deploying only `suprabha-staff-acceptance`. Invitation-compatible source `6074fd4` is now deployed as Worker version `3540beca-368c-4aae-b42b-a3c4a68b2016`. Recovery remains explicitly disabled. Startup 20 ms is not a per-request CPU/load measurement.
- Hosted probes: `/staff-signin` and `/staff-password-reset` HTTP 200; anonymous `/api/orders` and `/api/pricing` HTTP 401. These do not establish authenticated or delivered-email acceptance.
- Read-only Worker secret-name inventory confirms only origin, private Supabase URL and publishable key. Gateway/read bindings remain absent; no secret values printed or production keys copied.
- Read-only private-project Auth query confirms zero accounts and zero confirmed accounts. Staff provisioning and subsequent email/password acceptance remain uncompleted, not silently inferred from existing OMS membership.
- Checkpoint updated after these four execution steps. Next dependency: securely configure matching private gateway/read secrets, provision approved Auth accounts and verify delivered setup/recovery links, then actual Android testing. No new accounts, database mutations, public app/Tally changes, paid services or reset credits.

## Invitation password-setup compatibility — 3 October 2026

- Fixed password-setup client rejecting Supabase invitation links: accepts `invite` alongside `recovery`, clears the fragment immediately and retains the bearer only in memory. Other link types remain rejected. Server provider verification, confirmed identity, active OMS membership, password constraints and revocation controls unchanged.
- Regression demonstrated first: invitation setup button remained disabled. After fix, 20 desktop/emulated Pixel 7 browser checks and 31 affected authentication/reset unit tests passed. Typecheck, affected oxlint and diff check passed. Tests use synthetic provider responses, not delivered invitations or actual devices.
- Changed component, existing auth browser tests and this checkpoint. Not yet deployed; private gateway/read bindings, account provisioning, recovery delivery and actual Android checks remain blockers. No production/Tally changes.

## Isolated staff authentication deployment setup — 3 October 2026

- Isolated Worker deployed at `https://suprabha-staff-acceptance.anil-mahindrakar22.workers.dev`; root serves staff sign-in (HTTP 200), anonymous `/api/orders` returns HTTP 401. These probes do not prove authenticated workflows or free-tier load suitability.
- Configured private acceptance project URL, modern publishable key and exact staff origin as Worker bindings, without printing secret values. Gateway/read keys remain missing: Sites exposes their names but masks their values. No production credentials copied.
- Private project `ayrvhemxzizpkfcycvip`: saved Worker Site URL and exact `/staff-password-reset` redirect, with no wildcard; disabled public signup, preserved email confirmation and disabled anonymous login. Saved state verified in dashboard. Brevo SMTP was previously stored, but actual delivery has not been verified.
- Recovery remains disabled. Pending: private gateway/read bindings, Auth account provisioning (OMS memberships alone are insufficient), invitation/password-setup compatibility, real recovery delivery, abuse/resource checks and Android acceptance. Public app and Tally untouched; no paid plan enabled.

## Isolated staff Worker build path — 3 October 2026

- Cloudflare OAuth account authorization verified read-only. Added opt-in `pnpm build:staff` (`vinext build --mode staff`) using the existing app, vinext and Cloudflare plugin. Staff mode omits the Sites dispatcher plugin and uses Worker `suprabha-staff-acceptance`, no Sites resource bindings, Supabase authentication and recovery-email disabled. Ordinary `pnpm build` retains Sites behavior. No separate application or new dependencies.
- Fresh staff build, typecheck, affected config lint and Wrangler deployment `--dry-run` passed. Generated name/auth/recovery variables verified; dry-run bundle 1,265.46 KiB raw / 344.67 KiB gzip. This is packaging evidence, not deployed startup CPU, live load or free-tier suitability. No upload or cloud resource creation occurred.
- Fresh default build also passed and generated target `sites-project` with no staff-mode variables verified. Both commands reuse ignored `dist`; the latest artifact is the default Sites build. Rebuild with `pnpm build:staff` and recheck generated configuration before any later isolated deployment; never deploy a stale artifact.
- Files changed: `vite.config.ts`, `package.json`, this checkpoint. No full unit/browser/database suite repeated for this opt-in build-path ticket. Pending: isolated Worker creation/configuration, private provider/gateway/read settings, approved Auth accounts, verified free SMTP/reset redirects, abuse protection and actual hosted/Android acceptance. Public app, database and Tally unchanged.

## Five-part staff-login hardening batch — 3 October 2026

- Runtime configuration now rejects Sites-host activation, secret/legacy/placeholder auth keys and malformed provider origins. SDK fetches have a 15-second abort deadline while preserving upstream cancellation; existing provider identity and membership enforcement remain unchanged.
- Invalid non-finite/non-positive provider session lifetimes are rejected before issuing cookies. Login/account-switch/reset forms now guard duplicate in-flight submissions and bound browser requests to 15 seconds. Reset timeouts preserve the existing uncertain-outcome stop instead of retrying automatically. No refresh-token persistence or automatic retry added.
- Five related tasks covered: runtime configuration enforcement, provider-request deadline, lifetime validation, duplicate-submit guards, browser stalled-request handling. These are one bounded auth-safety batch, not five major business features or a live release.
- Targeted unit validation: 43 passed. Browser acceptance: 16 desktop/emulated-mobile cases passed, including four stalled-request/duplicate-submit cases. Initial affected lint found a test-only Request stringification issue; corrected to inspect Request.url/URL.href. Final typecheck, affected lint, four affected browser cases and diff check passed. No full build/suite repeated; no production, provider configuration, credential or Tally changes.
- Isolated direct hosting, approved provider accounts, verified free SMTP/reset redirect, production abuse throttling and actual Android acceptance remain required. Mocked SDK/unit and local browser evidence do not demonstrate live provider timeouts, email delivery or device acceptance.

## Staff-auth configuration preflight — 3 October 2026

- Added `pnpm check:staff-auth`: read-only environment-shape validation with credential-free output. Rejects non-HTTPS/path-bearing/credential-bearing origins, existing Sites hosts, incorrect modern publishable-key types/placeholders, missing server gateway/read keys and disabled recovery delivery. A complete configuration never claims deployment-ready; provisioning, disabled signup, SMTP/redirect, throttling/resource and real hosted/device acceptance remain mandatory.
- Extended `.env.example` with opt-in staff settings; default remains Sites and recovery remains disabled. No runtime authentication changes, deployment, credentials, provisioning, provider settings or Tally modifications. This diagnostic does not enforce hosting policy by itself or independently verify email delivery.
- Changed files: `.env.example`, `package.json`, `tests/staff-auth-preflight.mjs`, `tests/unit/staff-auth-preflight.test.ts` and checkpoint. Targeted tests: 12 passed; typecheck, affected oxlint and diff check passed. Actual preflight exited 1 as expected in the unconfigured shell, with seven configuration blockers and no credential values. No full build/suite rerun for this diagnostic-only ticket.
- Next external dependency remains an isolated direct-host account/environment and verified recovery-email setup. Do not activate this path on the public Sites app or treat fixtures as live acceptance.

## Staff-login browser acceptance and reset retry safety — 3 October 2026

- Added isolated desktop/emulated Pixel 7 tests for password-login rejection, password clearing, no token persistence, mobile overflow, missing recovery links, StrictMode recovery-token retention/removal from URL, confirmation mismatch, account-switch network failure and uncertain reset outcomes. The fixture uses synthetic responses, not production authentication or email delivery.
- Demonstrated the concrete reset defect with four failing desktop/mobile checks: a network failure or provider partial reset left submission enabled. Recovery now discards the in-memory token after network/parse failures, server errors or expired-token responses, and guards submission against missing token/busy state. Ordinary definite validation errors remain visible; no provider, gateway, role or transaction changes.
- Targeted validation: 12 browser cases passed, 25 authentication/reset unit tests passed, typecheck, affected oxlint and whitespace checks passed. No repeated full suite/build for this bounded client fix. Changed files: reset component, existing UI fixture, new staff-auth browser test and this checkpoint.
- Deployment still blocked on separate direct host, approved Auth-account provisioning, verified free SMTP/reset redirect and throttling configuration, followed by real Android/hosted acceptance. Current Sites app and Tally unchanged; not live-ready.

## Reliability acceptance batch — 3 October 2026

- Fresh targeted Vitest run passed 38 tests across pricing API authentication, offline order drafts/retry, order command idempotency and submission. Pricing API tests exercise real route functions with simulated gateway denials; they do not independently prove hosted database authorization. Preserve this distinction.
- Fresh pricing browser subset passed 26 cases on desktop Chrome and emulated Pixel 7: 401/403 authorization-loss clearing, mutation/pagination denial, uncertain contract/policy responses, account-isolated receipts, reload recovery without resubmission, and customer/base/impact lost-response retry identity. Tests use the existing local UI fixture and intercepted responses, not the hosted acceptance server or an actual staff phone.
- Read-only backup preflight found only zero-byte `production-2026-09-27.dump`. PostgreSQL restore/client tools are available, but no usable archive exists for a restore rehearsal. No credentials accessed or backups overwritten.
- All five live gates remain partial/incomplete: hosted post-commit lost-response reconciliation, separately observed restricted-role API denial, actual staff-device recovery/separation, representative office latency/resource measurements, and restore-tested backup followed by five real working days. No production code/infrastructure changes, business mutations or Tally writes. Existing runtime/browser capabilities cannot inject a controlled response loss; owner-assisted device/network and hidden-input database credential access remain prerequisites. No full build/suite rerun for this verification-only batch.

## Private Viewer acceptance and recovery prerequisite — 3 October 2026

- Owner authorized temporary Nikitesh Administrator→Viewer in isolated project `ayrvhemxzizpkfcycvip`. Guarded membership update and immutable member event were committed atomically; Viewer membership verified. Real signed-in Nikitesh navigation exposed only Stock/Orders, not Pricing/Users. Direct `/api/pricing` browser navigation was blocked by the client, so no separately observed API status/body or fresh payload denial is claimed.
- Restored active Administrator using the same guarded transaction/audit pattern. First restoration returned transport HTTP 500; authoritative reread still showed Viewer, permitting one safe retry. Retry succeeded, database reread verified Administrator, and a newly opened private browser session exposed administrator navigation again. Production Nikitesh membership independently remained active Administrator. No business transactions, Tally data or production permissions changed.
- Browser capability discovery exposes pageAssets and webmcp only, not network interception/offline/response-drop control. Hosted post-commit lost-response recovery remains untested; do not substitute a pre-send offline failure or local fixture. Actual staff-device checks and operational pilot remain open. Documentation-only diff check; no repeated full suite/build.

## Signed-in public read acceptance — 3 October 2026

- Follow-up read checks: exceptions-only selected the 20 review-needed customer items as detailed cards (23 total articles including the three overview cards), with invoice/cost provenance, margin explanations and disabled empty custom-rate approvals. Base/default prices remained a separate workbench: exact product search distinguished two Widal products; selecting Widal Test 2+2x5 loaded current cost, while the unavailable target-margin price stayed explicitly unavailable and incomplete approval remained disabled. No approval was submitted. These observations do not certify mutation recovery or restricted-role denial.

- Browser sign-in completed as the approved administrator. Public Orders displayed the new-order control, zero confirmation items and five ready-to-dispatch queue records. Inspected loaded card DOM without performing transitions; queue membership includes billed orders still labelled Tally billing with a ready-for-dispatch action, not only orders already labelled Dispatch.
- Pricing finished loading the existing 25% general gross-margin policy. Exact customer lookup selected Anugraha Diabetes & Endocrinology Center, distinct from its closed-name match. The customer price book loaded 32 purchased items: 12 ready and 20 protected/review-needed; all fit on page 1 with Previous/Next disabled. Cost-increase rows explicitly require review; a lower-cost row retains the prior selling rate. Diasys/Sysmex group-margin preview controls are present. No commercial values are copied into this checkpoint.
- These are administrator read-path observations, not approval, pagination across multiple pages, restricted-role, hosted uncertain-save, actual-device or performance certification. No orders, pricing approvals, Tally operations, database writes or settings changed. Pilot remains HOLD. Documentation-only whitespace check; no repeated test suite/build.

## Post-publication read-only follow-up — 3 October 2026

- Reconciled the pilot document with merged main `aebdcbe` and successful public version 55. Pilot remains HOLD for hosted uncertain-save, actual staff devices, representative performance, five real working days and restore-tested backup; no local fixture results promoted to hosted evidence.
- At 08:46:44 UTC (14:16 IST), snapshot upload was 08:31:38.665 UTC and source extraction 08:31:37.9836772Z, approximately 15 minutes old; JSON text 596,354 bytes. No browser freshness transition was verified. Fixed 07:46:33–08:46:33 UTC logs returned three function POSTs, all HTTP 200, maximum execution 5,720 ms, and eight PostgreSQL LOG-level events. Four PostgREST entries exist; initial timeout-message aggregation failed with a backend error. Corrected source/attribute aggregates succeeded, but PostgREST timeout/error contents remain unverified. No claim of p95 or CPU/memory recovery.
- Documentation-only reconciliation and bounded read diagnostics. Whitespace validation is the affected check; no repeat build/tests, database writes, orders, pricing decisions, connector settings, credentials or Tally operations. Actual device/controlled-network access remains unavailable here, so those acceptance gates are not marked complete.


## Merged release published — 3 October 2026

- PR #36 merged after GitHub quality/security, migration/ACID replay and CodeQL passed. Main/source SHA `aebdcbefeba523b4a1ec7a7e0d3e6f2f6146f5ce`. Published saved version 55 (`appgprj_6a9278d4a3b081918d9811fba983d54c~appgver_a8e8ac36fb48819198db376a6913ad4d`); deployment `appgdep_6ac0bfb979008191b87fbc13605b6a11` succeeded 2026-10-03 08:43:22 UTC (14:13 IST), runtime revision 4. Public URL unchanged: https://suprabha-stockflow.anil-mahindrakar22.chatgpt.site.
- Used a clean publication checkout opened from existing Sites source, fast-forwarded to the exact merged commit. Fresh locked installation, mitigation-aware security gate (21 installed regressions) and production build passed. Bundled workflow could not launch Windows pnpm shim; retry through bundled Node CLI completed checks/build. Local packaging subsequently failed because its bundled helper requires unavailable Bash. Exact source had been pushed before packaging; native source-only save and remote-build fallback succeeded. Version 55 has no local archive-backed artifact; no local archive hash is claimed.
- This publishes dependency containment and the explicit, expiring mitigation-aware audit policy alongside the already published stock timing/warning fixes. Registry advisory remains open; mitigation review expires 17 October. No database, Tally, connector schedule, access-policy or environment mutation. Native deployment success is publication evidence, not signed-in workflow, hosted uncertain-save recovery, actual staff-device acceptance or pilot certification. Those remaining checks are still outstanding.


## Mitigation-aware security gate — 3 October 2026

- Upstream braces/micromatch/fast-glob still have no released fix. Added a narrowly scoped local mitigation decision for GHSA-vfj7-8cjw-p6xm, not an upstream-resolution claim. `security:audit:raw` retains the original failing registry audit; `security:audit` prints the full raw JSON and then verifies only the exact braces 3.0.3 advisory, known dependency paths, patch SHA-256 and workspace/lockfile registration, and runs installed-package security regressions before accepting that mitigated finding.
- Any additional high/critical advisory, unexpected version/path, altered or missing patch evidence, audit/network/parse failure or regression failure remains blocking. The mitigation review expires at 2026-10-17 00:00 UTC and then fails closed until reassessed. No package-wide ignore, version spoofing, lowered audit severity or hidden raw finding. This supersedes the earlier unconditional merge hold for the same tested patch only; other release/pilot gates remain outstanding.
- Focused verification passed 33 tests: 21 actual installed-package regressions and 12 audit-policy tests covering clean reports, exact mitigation, evidence tampering, additional advisories, expiry and malformed/inconsistent results. Affected lint and live mitigation-aware audit passed. Fresh clean locked reinstall completed; full `pnpm run ci` passed lint/typecheck, connector fixtures, 565 unit tests, production build, 36 general and 86 pricing browser cases, and the mitigation-aware audit (including 21 installed-package regressions). Raw registry audit still reports the original finding. Reviewed micromatch's affected callers: they require strings or explicitly stringify patterns, matching the parser-bound mitigation scope. No local database replay rerun for this CI-only policy change; GitHub's independent database/security gates still must pass before merge. No database or Tally changes.


## Reproducible dependency containment — 3 October 2026

- Added a pnpm version-bound patch for braces 3.0.3 rather than replacing glob libraries or upgrading unrelated runtime dependencies. The parser rejects brace/parenthesis AST nesting beyond 100 before adding another nested node; escapes, quoted text and bracket literals retain existing handling. The lockfile binds the patch hash and frozen installation succeeds. This follows the upstream issue's suggested parser depth guard: https://github.com/micromatch/braces/issues/70 and pnpm's documented patch mechanism: https://pnpm.io/cli/patch.
- Initial guard regressions failed (10/14); after containment 14/14 passed. Added the third ts-morph dependency path and verified 21/21 focused tests through all three audit-reported dependency chains, including parse/compile/expand/stringify string inputs, parentheses/mixed nesting, boundary depth, ordinary alternatives/ranges and escaped/quoted/bracketed literals. Direct caller-supplied AST objects are not validated by this parser patch; no claim of general AST sanitization or upstream certification.
- Fresh `pnpm install --frozen-lockfile` passed. `pnpm test:ci` passed lint, typecheck, connector fixtures, 546 unit tests and production build; the subsequently expanded focused suite passed 21 tests. Test-file lint and diff checking passed. General browser suite passed 36 tests and pricing browser suite passed 86 tests. These are local fixture checks, not hosted acceptance or staff-device certification.
- `pnpm security:audit` still fails on GHSA-vfj7-8cjw-p6xm because the installed version remains 3.0.3. No advisory exclusions, severity reduction, version spoofing or CI bypass applied. This is tested local containment, not an audit-green release: merge/publication remains held pending a released fix or an explicitly reviewed security decision. No database, Tally, connector schedule, account or production change.


## Cached-warning fix published — 2 October 2026

- Production build passed at clean `5c30e06f28f2b6638a9bd9ae4a4e3815b5a5498e`. Exact source pushed to the existing Sites repository, not GitHub main; saved version 54 and deployed successfully as `appgdep_6abfbfa6e7e08191a715922a782d649c` at 14:29:20 UTC, runtime revision 4. Archive SHA-256 `9c5f7d0662c27a71e8d0a77ed87f7831e02e2a3e6fa980715ca0621c24e74c6c`. Public audience, connector schedule, database and Tally unchanged.
- Existing Anil session loaded hosted Stock. Fresh DOM reads show matching “Tally sync overdue” and “Tally stock extraction is overdue” for 02 Oct 07:36 PM source extraction, genuinely beyond the 20-minute threshold at observation. This verifies new wording and truthful stale-state rendering, not a live fresh-extraction transition. Prior 23-test regression evidence covers stale-to-fresh clearing and fresh-to-stale restoration. Screenshot capture was unavailable; no screenshot evidence claimed.
- Next: observe a normal fresh office extraction and confirm the banner clears; do not suppress genuine staleness or force Tally extraction to complete an acceptance check. Hosted failure/device checks remain deferred/unverified. Checkpoint only, whitespace validation before commit. GitHub main remains `6deb65b`; timing and warning commits remain local/Git-hosted-source pending normal GitHub integration.

## Cached stale-warning recovery fix — 2 October 2026

- Signed-in version-53 Stock loaded with current cloud status and a newer displayed sync time, but retained an older overdue banner. Code and executable regression demonstrate the mechanism: a cached snapshot can set the warning while the request is pending; fresh `applyData` updated status/dot without clearing that warning. No inference that cloud or Tally itself failed.
- Fresh snapshot application now clears prior warning text/class. Genuine stale extraction still restores the warning. Clarified banner wording to “Tally stock extraction is overdue”, since its threshold uses source extraction time, not cloud upload time. Polling, source timestamps, offline fallback, account-separated cache and Tally remain unchanged.
- Regression failed before the patch with `error show` retained after fresh data. Targeted sync-health and lightweight-summary suites passed 23 tests; affected test lint, typecheck and whitespace passed. Additional final stale-again check preserves genuine warnings. No full build/suite rerun or deployment for this bounded UI correction.
- Returned live worker samples around the read-only browser check: `/api/stock` outcome ok, 6 ms CPU / 2,199 ms wall; `/api/orders` outcome ok, 3 ms CPU / 1,163 ms wall. These single samples do not establish p95 or response timing stages. Browser API does not expose response headers; per-request Server-Timing capture remains unverified. Public remains version 53, GitHub main unchanged; this fix is local pending release.

## Stock timing app publication — 2 October 2026

- Fresh production build passed at clean `0c754404b445b6fc1ac298b9325fcc88d03092df`. Pushed exact source to the existing Sites repository main (not GitHub main), packaged existing hosting manifest plus build output, saved version 53 and deployed successfully: `appgdep_6abfb8b03b348191bbaaf92d9b726ed6`, runtime revision 4, 13:59:38 UTC. Public audience unchanged. GitHub main remains `6deb65b`; local timing commits have not been merged there.
- Saved version `appgprj_6a9278d4a3b081918d9811fba983d54c~appgver_2852c9accfd08191944c8dc7f3e2f1d4`, archive SHA-256 `70e272f1875739990b762304f2eff585954e49f7493e1cab1db758088326ac3f`. No environment, Tally, database or permission change. The hosting skill package was unavailable; existing Sites connector contract and manifest were used without speculative configuration.
- Anonymous deployed stock API smoke result is in the completion report. Signed-in per-request timing capture remains unverified; publication/build success is not performance or pilot certification. Existing source tests/type/lint from the previous timing ticket remain separate evidence, not rerun claims. Checkpoint whitespace validation before commit.

## Stock-route timing visibility — 2 October 2026

- Normal office upload confirmed on sync version 8: HTTP 200 POST in returned 12:31–12:37 UTC logs, 3,639 ms execution; snapshot refreshed at 12:35:17 UTC. This clears the previous post-cutover upload gap, not performance/pilot certification. Cumulative snapshot-write statistics show 1,099 calls averaging 239.95 ms, maximum 3,042.38 ms; these are not window-aligned or per-request comparisons. Function execution statistics were unavailable. Performance advisor returned INFO-only 19 unindexed-FK and 21 unused-index findings; no indexes removed or added without measured justification, especially integrity/overlap indexes.
- Stock API previously discarded sync Server-Timing. Added per-request route duration and forwarding of the exact two numeric sync/database metrics under fixed names. Unknown metrics, descriptions, negative/non-numeric/oversized durations and arbitrary upstream headers are discarded. Authorization-denied responses expose no timing; response bodies retain existing commercial sanitization, no-store and independently authorized read coalescing.
- Six timing regression cases failed on the prior route and passed after the change. Targeted stock/sync suite passed 70 tests; affected lint and typecheck passed. Final whitespace/targeted results recorded in completion. No full suite/build, schema or Tally changes. App-side timing forwarding is committed locally, not deployed; public frontend remains version 52.
- Next: integrate this bounded diagnostic change through the normal release path and measure authenticated route timings. Raw Edge logs do not retain Server-Timing, so do not infer its values from function total duration. Hosted failure/device acceptance and sustained CPU/memory evidence remain outstanding.

## Sync timing production rollout — 2 October 2026

- Published committed timing-only handler `62c30ec` to the existing production sync function. Supabase returned ACTIVE version 8, bundle SHA-256 `89e29589bdc9c027b0dd691279693b1713c77db541e00a8ba6288f00030357ae`. Existing custom read/upload authentication and `verify_jwt=false` are preserved; no credential/environment, SQL, Tally or connector change. Public frontend remains version 52/main `6deb65b`.
- Entrypoint matches prior version 7. The bundled request-gate dependency differs elsewhere, but its only function consumed by sync, `readBoundedJson`, is byte-identical. No Orders function deployment. Stored previous function source in session for rollback if a concrete regression appears.
- Fresh targeted sync tests passed 35/35. Live unauthenticated GET returned controlled 401 and no Server-Timing, proving rejection remains enforced. No valid synthetic upload or business mutation was issued.
- Immediate read-only snapshot check still showed the pre-cutover 12:19:59 UTC upload, about 11 minutes old; returned post-cutover function logs were empty at observation time. This is not evidence of failure or successful post-cutover authenticated traffic. Await a normal upload before declaring live timing acceptance or performance improvement; do not poll continuously or change connector frequency. No full suite/build rerun.
- Checkpoint whitespace validation before commit. Five-hour allowance last checked 18% used / 82% remaining, above the approved 50% remaining boundary. Hosted failure/device acceptance remains deferred/unverified; production timing capture is the next dependency.

## Sync performance boundary instrumentation — 2 October 2026

- Read-only production baseline: at approximately 12:21 UTC, latest snapshot upload was about 90 seconds old and snapshot JSON text was 594,549 bytes. Database sample showed one active diagnostic session, five idle and one null state. Returned logs for 11:20–12:20 UTC contained three sync requests, all HTTP 200, maximum execution 5,241 ms; eight PostgreSQL LOG events had SQLSTATE 00000. These sparse observations do not establish p95, CPU/memory health or browser/save latency. Initial message-based log query failed; corrected to discovered SQLSTATE/status attributes without reading credentials or customer payloads.
- Added authenticated sync Server-Timing headers distinguishing handler duration from the database fetch-to-response-headers boundary. Successful reads/uploads and backend failures include bounded numeric timings only; unauthorized responses have no timings. Request bodies, keys and commercial values are not logged. Existing single-fetch behavior, atomic upsert/import triggers, timeout, authorization, no-store and response bodies remain unchanged. Database timing includes transport and excludes response-body decoding; it is not pure SQL execution time.
- Added three deterministic timing regressions covering read/upload/thrown backend failure and retained unauthorized pre-database rejection coverage. Corrected the existing test helper's HeadersInit spread to handle Headers/tuple inputs through Headers normalization, resolving the test-file lint finding.
- Targeted sync suite passed 35 tests; typecheck and handler lint passed before the helper correction. Final focused suite/lint/whitespace results recorded in the completion report. No full build/database replay required for timing-only response headers; no live deployment or Tally operation. Next: deploy this diagnostic-only function at an explicit release checkpoint and compare authenticated request-boundary timings before choosing a performance patch. Staff-device checks remain deferred by user.

## Pilot handoff reconciliation — 2 October 2026

- Corrected the existing pilot document's current status: version 52 is published, but operational pilot acceptance remains on hold. Historical observations are retained and explicitly superseded where migration/publication/authenticated-read blockers have since cleared.
- Separated unsent-draft device testing from submitted-order testing and pre-send offline failures from lost responses after a committed mutation. Added the exact operator-dependent private network-test boundary; no fault-injection outage or business mutation.
- Documentation only: `PRODUCTION-PILOT-2026-09.md` and this checkpoint. `git diff --check` is the affected validation; no suite/build rerun. Working tree was clean at start. Five-hour allowance reset to 0% used; no reset credit consumed. External device/network evidence remains the next blocker, not additional implementation.

## Version 52 restored and signed-in reads verified — 2 October 2026

- Restored the existing saved version 52, unchanged merged source `6deb65b5db4c642bad0b5559f1176866fb098a2c`. Deployment `appgdep_6abf8711ca9c8191baaf38780a7f9453` succeeded at 10:27:51 UTC, runtime revision 4. Current public release is now version 52, superseding the version-51 containment checkpoint below. Access settings and Tally remain unchanged.
- Fresh browser identified Anil's existing authenticated session. Orders loaded confirmation queues, product requests and customer requirements; Pricing loaded the restricted workspace and 25% general gross-margin policy. Sign out is visible. Stock snapshot shown in Orders was 02 Oct 2026, 03:48:53 PM. No business mutation was made. This checks existing-session reads, not a new OAuth callback transaction or full fulfilment acceptance.
- Signed-in screenshot: `C:/Users/Admin/AppData/Local/Temp/stockflow-version52-pricing-20261002.png`. The earlier callback error did not recur in this existing session; its root cause remains unestablished.
- Hosted uncertain-response recovery and actual staff-device offline/account separation still require controlled network/device access. No unsafe outage was manufactured and no local fixture result was relabelled hosted acceptance. Representative performance, operational pilot and restore-tested backup also remain unverified; not pilot-certified.
- Checkpoint only; no application source changes or repeated full suite/build. Whitespace validation is the affected check. Latest five-hour check: 77% used / 23% remaining; user boundary is 10% remaining. Stop for the genuine external acceptance gap, not to spend the remaining allowance.

## Publication, callback investigation and allowance checkpoint — 2 October 2026

- PR #35 merged after GitHub validation/database ACID and CodeQL passed; main SHA `6deb65b5db4c642bad0b5559f1176866fb098a2c`. Public version 52 saved from that pushed source and deployed successfully (`appgdep_6abf6ad8619c8191866340e8f5ab800d`, runtime revision 4). Anonymous root/Stock returned 200; protected APIs returned 401. These smoke results did not prove signed-in acceptance.
- User reported a sign-in callback failure; worker logs confirmed `/callback` 404. Restored saved version 51 as containment (`appgdep_6abf8393f1748191836f538820e8ecea`, succeeded, revision 4). Bare callback probe also returned 404, but without an OAuth transaction it cannot prove valid-callback behavior. Subsequent browser session reached signed-in Stock and Orders on version 51. Persistent hosting defect or version-52 regression is not established; earlier causal claims must not be treated as proven.
- Sites authentication guidance confirms dispatch owns callback/sign-in/sign-out paths. No app callback, identity spoofing, custom OAuth flow or security bypass was added. No production order/pricing mutation, credential rotation, migration rollback or Tally change. Public remains version 51; merged source and six deployed migrations remain intact.
- Next: restore saved version 52 and verify signed-in reads; then complete safe hosted uncertain-save recovery on private acceptance and actual staff-device checks. Save/rejection/reload acceptance is not uncertain-network evidence. Browser signed-in Orders screenshot: `C:/Users/Admin/AppData/Local/Temp/stockflow-signed-orders-20261002.png`.
- Start-of-turn usage check is 73% used / 27% remaining, below user's 30% remaining stop boundary. No version-52 redeployment started this turn. Checkpoint-only commit; stop without reset credits or additional test-suite runs.

## Authorized production migration rollout — 2 October 2026

- User explicitly requested completion of the six pending migrations. Fresh `pnpm test:pricing:deployment` passed immediately before rollout, including ACID, concurrent reviews, bulk rollback, catalog compatibility and partial-customer preservation. Existing backup waiver remains a limitation; no restore-tested backup was created.
- Applied the six unchanged reviewed SQL files in dependency order to production `aormuidjbdqruglmyseh`. Remote versions: catalog source 20261002062743; partial customer preservation 20261002062744; product requests 20261002062746; demand requirements 20261002062748; waiting-order drilldown 20261002062750; stock increase alerts 20261002062752. All six recorded normalized hashes exactly match repository SQL. Updated the existing migration evidence map; no migration-history repair.
- Before/after counts remained 30 orders, 33 order lines, 459 customers and 3 billing snapshots. Four new public gateways deny anon/authenticated execution and allow service_role, preserving gateway membership checks. This is count/privilege evidence, not a full content reconstruction or sustained performance measurement. No order transition, pricing mutation, Tally write or connector change.
- Updated preflight expectations to 90 deployed mappings and zero pending; all 10 focused tests and evidence-only preflight passed, with whitespace validation. `releaseReady` correctly remains false; saved migration evidence cannot certify hosted/device acceptance. No public frontend deployment or main merge.
- Actual staff-device instructions sent for offline unsent-draft recovery and second-account separation; awaiting observed device/browser results. Hosted uncertain-save/network-failure recovery remains unverified; the available browser interface does not provide a safe network-fault toggle. Do not manufacture an outage by altering backend secrets or service availability. Wait to merge until these acceptance gates are completed; no claim that all requested checks are finished.

## Release-gate negative regression checks — 2 October 2026

- Started clean at `96433a4`; five-hour allowance 49% used / 51% remaining. Added two bounded existing-preflight tests: complete saved deployment evidence still cannot certify release readiness or live-history refresh, and a reviewed historical migration relabelled pending behind newer deployed history is rejected. No production code, migration, environment or Tally changes.
- Fresh focused Vitest passed 10/10 tests; affected oxlint and typecheck passed. Initial historical-case fixture incorrectly removed the latest deployed migration itself, so no newer history remained; corrected to an older migration and reran. This was a test setup error, not a demonstrated application defect.
- Remaining release blockers are unchanged: six pending production migrations/release gate, deployed uncertain-network recovery acceptance, actual staff-device offline/account separation, measured performance and operational pilot. Full consolidation evidence is recorded below; no repeated full suite/build. Next executable step requires the appropriate release environment/device access, not additional speculative features.

## Consolidation and authenticated future-price acceptance — 2 October 2026

- Started clean at `eee65e9` on `feature/keyboard-order-entry`; private candidate remains version 8 / `ca43f20`. No application source, public deployment, production schema, membership or Tally change in this batch.
- Authenticated Anil Administrator on the private candidate: native date input retained 2030-04-01 / 2031-03-31 through subsequent field edits and save. Browser locator fill had changed the DOM without persisting controlled state; native input separated that automation discrepancy from application behavior. Synthetic `ACCEPTANCE-DATES-20261002` proposal was saved then rejected; database confirmed exact dates, version 2 and requested/rejected audit events (`2cef7edc-ea19-4285-8720-a5bf8733520d`).
- Administrator self-approval passed for synthetic `ACCEPTANCE-SELF-APPROVAL-20261002`, future same-rate ₹335 agreement (`74fb09f5-4e86-44c8-8ce5-b4720a96bea4`). Creator/approver and requested/approved audit actors are Anil. Previous ₹335 agreement was preserved as superseded through 2030-03-31; date-aware resolution includes superseded historical agreements. Current customer price book still shows ₹335 fixed, with all four protected items excluded from bulk approval.
- Future base/default ₹335 from 2030-04-01 saved once for ACCEPT-CLEANER (`4ebb2457-7938-4644-ab74-d95c5b9db263`), approved version 1 with `standard_item_price_set` Administrator audit. UI confirms genuine customer history/fixed agreements retain priority. These are synthetic isolated acceptance records; no hard deletion or current public rate change. Screenshot evidence saved locally at `C:/Users/Admin/AppData/Local/Temp/stockflow-base-acceptance-20261002.png`.
- Fresh `pnpm test:ci` passed lint, typecheck, mocked connector checks, 520 unit tests in 90 files and production build. `pnpm test:pricing:deployment` passed migration replay, import privileges, compatibility/order preservation, ACID, two-session concurrency and injected-failure/bulk rollback checks. `pnpm test:e2e` passed 34 cases; `pnpm test:pricing:e2e` passed 86 desktop/mobile cases. `pnpm security:audit` reported no known dependency vulnerabilities. No live Tally was exercised.
- Fresh evidence-only release preflight passed execution but correctly reports `releaseReady=false`. Separate read-only production reconciliation found all 84 deployed migration versions/hashes match the saved map, with zero mismatches/unmapped versions; latest remains 20260928113956. Six pending migrations remain: catalog source version, partial-snapshot customer preservation, controlled product requests, customer demand requirements, requirement waiting orders and reported stock increase alerts. No migration was applied.
- Remaining: deployed uncertain-network recovery/failure acceptance (local fixtures are not hosted failure evidence), actual staff-device offline/account separation, pending production migration/release gate, representative performance/resource measurements, operational pilot and restore-tested backup. Do not claim combined pilot readiness. No routine confirmation is needed for the next safe check, but do not invent unavailable device evidence or destabilize hosted services to manufacture a failure. Latest allowance check: five-hour 47% used / 53% remaining; user stop boundary is 30% remaining, not a target to consume.

## Pricing date-entry characterization — 2 October 2026

- Extended the existing contract uncertain-response regression to enter explicit valid-from 2030-04-01 and valid-to 2031-03-31, assert both controlled input values, and assert the actual outgoing command retains those dates. Existing identical-command retry assertions also cover date preservation.
- Fresh desktop/mobile focused Playwright checks passed 2/2, affected test lint and typecheck passed. Application code unchanged: local execution did not reproduce the prior deployed browser-fill discrepancy. Do not claim its cause established or deployed/manual date entry accepted; that remains a separate acceptance gap.
- Files changed: `tests/pricing-browser/price-book.spec.ts` and this checkpoint only. No database, active pricing, deployment, production or Tally changes. Next: confirm date entry on the authenticated candidate before future-dated approval acceptance; deployed network-failure recovery and staff-device offline separation remain unverified.


## Authenticated proposal save/rejection acceptance — 1 October 2026

- Private version 8, independently identified Nikitesh Administrator session: created one synthetic Acceptance Laboratory × ACCEPT-CLEANER proposal at ₹340 with reference `ACCEPTANCE-SAVE-20261001`. Save confirmation appeared; full reload retained the pending proposal. Rejected it with an explicit synthetic-test reason; approval inbox returned to zero. No approval, active-rate replacement, hard deletion, order or Tally mutation.
- Private database read confirmed one preserved rejected proposal (`6e416e7f-6b52-48db-922c-ae3378184502`), version 2, created by Nikitesh, with separate `customer_price_requested` and `customer_price_rejected` audit events. Existing approved cleaner rate remains ₹335. Browser screenshot capture unavailable; UI accessibility state and database results are the evidence.
- The attempted future-date browser fill did not stick: actual DOM and stored proposal both retained 2026-10-01. Do not count future-date editing as accepted or diagnose an application defect without separating the automation input limitation from real user behavior. Proposal was never approved. Next bounded check: characterize date entry before additional approval acceptance.
- Fresh focused retry/recovery Playwright run passed 20 desktop/mobile cases for contract/policy uncertain responses, stable customer/base/impact retries, receipt-only reload recovery, account separation and closing only confirmed-unsaved saves. These are local controlled-failure fixtures, not deployed network-loss acceptance or actual staff-device offline testing. No full suite/build rerun, source changes, merge or publication in this turn.


## Private authorization-loss retest — 1 October 2026

- Published existing private acceptance version 8 from candidate `ca43f20c48f77982dc4a97e7f6e05a9f3020aeb9` (cherry-pick of implementation `7b78fe8`). Local production build passed. Saved version `appgprj_6aae9b06bf4081919a1f08183fb02465~appgver_ee19f57a9c5c8191a67a8b4206b2ad98`; deployment `appgdep_6abe582679c881918f052b0b8d48a129` succeeded, environment revision 2. Preserved the existing custom Anil/Nikitesh audience. GitHub main and public app unchanged.
- Actual browser independently identified Nikitesh and loaded synthetic customer rates/costs and policy. Repeated the previously user-approved private Administrator→Sales→Administrator test. Denied pricing refresh removed the entire commercial workspace, including the previously loaded table and policy, leaving only the restriction message. Reload under Sales removed Pricing/Users navigation. No separately observed HTTP status/body claim; browser UI is the live evidence, with 401/403 covered by automated tests.
- Both guarded role changes and immutable member-audit inserts were atomic. Restored active Administrator verified in database and browser navigation. No price/order/Tally mutation or connector setting change. Screenshot capture was unavailable; acceptance evidence is accessibility state plus database audit and deployment results.
- Completed this concrete release-defect retest. Remaining acceptance still includes authenticated pricing mutation/recovery/failure cases and staff-device offline separation; full combined release/pilot readiness is not certified. This turn ran the candidate production build, not a repeated full test suite.

## Private restricted-role acceptance — 1 October 2026

- User approved temporary Nikitesh Administrator→Sales→Administrator in isolated `ayrvhemxzizpkfcycvip`. Each guarded role change and member audit insertion was atomic, labelled `codex-private-acceptance:user-approved`; restored active Administrator was verified in database and reloaded browser navigation. No production role change or business transaction mutation.
- With Sales membership, the existing pricing screen refresh returned `Pricing access is restricted`. Full reload removed Pricing and Users navigation; Orders remained available. Direct API navigation was blocked by the browser client, so no claim of a separately observed HTTP status/body for that attempt.
- Concrete release defect: previously fetched pricing rows/policy remained displayed in the already-open pricing screen after refresh was denied. This is stale previously-authorized UI data, not demonstrated fresh API leakage, but must clear on authorization loss. Next ticket: fail-closed removal of restricted pricing state on 401/403 across affected pricing reads, with regression tests. Not merge-ready.


## Verified second-account read acceptance — 1 October 2026

- Private version 7 header independently identifies `nikitesh.am@gmail.com`. Orders, open product-request queue, customer-demand projection, Pricing and selected customer price book loaded successfully in this session. Four fixture price rows retained fixed/already-approved protection and bulk approval stayed disabled with zero eligible rows. No mutation or role change was submitted.
- This closes second-administrator identity/read smoke only. Both acceptance members are administrators; deployed operational-role pricing denial still requires a separately authorized restricted-role check. Offline draft separation, authenticated pricing mutations/recovery and actual staff-device pilot remain open. Public/main/Tally unchanged.


## Private sign-out publication — 1 October 2026

- At the user's explicit request, published private acceptance version 7 from `6752b12331c812d81c5030216fce46507d1ed092`; deployment `appgdep_6abe1b22431c81919890bbe3d65c9e27` succeeded. Retained the existing Anil/Nikitesh audience and runtime environment revision 2. Candidate production build passed; no database/Edge/Tally changes were required.
- Actual browser now displays the header sign-out link with authenticated identity `anil.mahindrakar22@gmail.com` and expected Sites session route. Left the session signed in for the user to switch accounts; platform cookie invalidation on click is still unverified. Public app and GitHub main unchanged.


## Visible sign-out control — 1 October 2026

- Added an always-visible header Sign out link for all roles, using the same Sites-owned full-navigation `/signout-with-chatgpt?return_to=/` route already used on the access-denied screen. Accessible name/title identify the signed-in email. Navigation remains horizontally scrollable without displacing the 44px sign-out target on mobile. No authentication bypass, new session implementation or deletion of saved business/draft data.
- Six desktop/mobile administrator/sales/warehouse browser checks passed for visibility, session route and viewport bounds; typecheck, affected lint and whitespace passed. The isolated frame fixture uses the production Vinext image shim with an empty environment (no secrets). Initial fixture import/environment failures were corrected, not product-authentication failures.
- Local UI change; actual hosting-session logout still requires private deployed verification. Public app/main/Tally unchanged.


## Private product-request mutation acceptance — 1 October 2026

- Through deployed version 6, submitted synthetic missing product `ACCEPTANCE REQUEST 20261001 READONLY-TALLY` without saving an order or consenting to device storage. Save confirmation appeared; the office queue displayed the request and creator email `anil.mahindrakar22@gmail.com`. This independently establishes that the current browser session was Anil, not a demonstrated second-account session; earlier user-reported second-account smoke must not be treated as two-account acceptance.
- Entered an explicit synthetic-test review reason and rejected the request. It left the open queue; its business record remains preserved, not deleted. No canonical product, order, price, public data or Tally operation was performed.
- Remaining: genuine second-account/operational-role deployed verification, recovery/failure acceptance and actual staff-device pilot. Do not claim merge readiness from this administrator create/review path alone.


## Refreshed acceptance session — 1 October 2026

- After the user reported signing in to the second approved account, reloaded the private candidate and checked Pricing, base/default-price workbench and purchase-cost review. Reads succeeded. Cleaner fixture kept its fixed customer rate of 335 against cost 200, displayed missing comparable historic cost rather than inventing continuity, and marked monthly-volume economics unavailable.
- No approval button was submitted and no order/business record changed. Browser identity is user-reported, not independently displayed by this UI. Both approved acceptance accounts currently have administrator membership: successful commercial reads cannot establish operational-role denial. Existing automated denial tests remain evidence only, not a deployed Sales/Warehouse check.
- Still open: authenticated mutations/recovery/failure scenarios, deployed least-privilege role checks and actual staff-device acceptance/pilot. Read-only smoke success does not authorize or establish merge readiness.


## Deployed browser acceptance: read/capture smoke — 1 October 2026

- Private version 6, using the actual signed-in in-app browser session: Orders loaded without an error; product-request inbox returned empty successfully; demand returned one fixture item with open demand 1, stock 12, shortage 0; exact-item waiting list returned its confirmed fixture order; reported-stock alert list returned zero with valid pagination. Old catalog timestamp remained visible rather than being presented as fresh stock.
- Unsaved order-entry check: customer search selected Acceptance Laboratory, recent customer product loaded, quantity 2 plus Enter added exactly one line and enabled Save. Closed the form without saving; device draft consent stayed off. No order or pricing mutation was submitted.
- Pricing page and selected customer price book loaded four fixture products with last rates, costs, GP percentages and recommended rates. Fixed/already-approved prices stayed protected and bulk approval remained disabled with zero eligible items. Existing commercial policy and group gross-margin preview controls remained visible.
- This is a deployed read/capture smoke pass, not complete acceptance. The current browser identity was not independently verified; second-account role separation, mutation/recovery/failure scenarios, actual staff mobile/tablet offline behavior and measured performance remain unverified. No public/Tally change. Merge remains gated on acceptance.


## Approved private acceptance rollout — 1 October 2026

- User authorized the private candidate and pending migration rollout only. Private acceptance version 6 deployed successfully from `7a69b57e6a817bea064b80fb3e67936ab728227f`; deployment `appgdep_6abe1511ac7881918395919ea9b71908`. URL: https://suprabha-pricing-acceptance.anil-mahindrakar22.chatgpt.site. Existing custom audience remains owner Anil and approved external viewer Nikitesh. Source integration is on candidate/pricing-acceptance, not repository main.
- Private database `ayrvhemxzizpkfcycvip` already contained catalog-source and partial-customer preservation migrations. Applied only the four missing migrations: controlled product requests, customer demand requirements, waiting orders and reported stock increase alerts. Verified new gateways deny anon/authenticated execution and permit service_role. Existing business-delete/event/command guards and order/outbox tables were checked before migration.
- Deployed private stockflow-orders Edge function version 8 with existing custom gateway-key verification and bounded request gate preserved. Private candidate frozen-lockfile installation and production build passed. Public app, production database, Tally and repository main are unchanged.
- Remaining gate: authenticated staff acceptance on deployed version 6, actual devices/offline/account separation and measured performance, then the operational pilot. Do not merge all work or add further feature builds merely because private deployment succeeded. Merge/release remains a separate approved gate after acceptance.


## Live migration-content reconciliation — 1 October 2026

- Read-only production metadata check: all 84 deployed migration versions and normalized SHA-256 contents match the existing migration-history map; no missing, unexpected or changed deployed migration was found. Compared stored statements joined with newline, CR removal and surrounding whitespace trimming against the recorded remote hashes. No business rows, secrets or database writes were involved.
- Refreshed evidence date and inspected candidate HEAD in the existing map; preserved every mapping, reviewed historical difference and six not-deployed entries. This evidence is time-specific and must be refreshed before a later release; the preflight intentionally continues to report releaseReady=false rather than infer acceptance from matching migration hashes.
- Remaining: updated private candidate/migration rollout and authenticated staff/device acceptance, followed by the operational pilot. No publication, merge or Tally change.
- Validation: eight release-preflight unit tests passed; whitespace check passed. Full suite was not repeated for this evidence-only update.


## Local consolidation and release boundary — 1 October 2026

- LOCAL CONSOLIDATION PASS / OVERALL ACCEPTANCE PARTIAL. Consolidated the transactional/pricing and Milestones 1–3 candidate through `9c81036`, without adding features or changing production/Tally.
- Patched the existing transitive Hono dependency from 4.13.5 to 4.13.11 in the lockfile after production dependency audit identified GHSA-hxh3-vqpv-xpqv. Fresh production dependency audit reports no known vulnerabilities. No architecture or package manifest changes.
- Added anonymous runtime denial/no-store tests for product-request reads/mutations and requirements, stock-alert and exact-item waiting-order reads.
- Fresh validation: lint, typecheck, 520 unit tests, production build, 34 access/runtime browser checks and 72 pricing/workflow desktop/mobile fixture browser checks passed. Connector fixture tests and the complete pricing deployment-order database replay passed, including ACID failure rollback, idempotency and two-session concurrency checks. Whitespace checks passed. Scoped independent review found no actionable regression. Fixture browser checks are not authenticated staff-device acceptance.
- Read-only production migration listing confirms 84 deployed versions, ending at `20260928113956_customer_group_gross_margin`. Six mapped candidate migrations remain undeployed: catalog source version, partial-snapshot customer preservation, controlled product requests, customer demand requirements, waiting orders and reported stock increase alerts. Migration contents were not rechecked live; do not mark the release preflight live-history/content gate complete based on version listing alone.
- Remaining gates: updated private candidate and migration rollout, live migration-content reconciliation, authenticated role/two-account acceptance, actual staff-device offline recovery/account separation and measured capture/loading/save latency, then the five-working-day operational pilot. No merge, publication, production migration or Tally write was performed. Not pilot-ready.
- Known limits remain explicit: stock increases are advisory/manual in-app notices, not allocation or push delivery; catalog quantities can be cached; trusted-device storage is unencrypted and not cross-tab atomic; office product-review recovery remains in-memory. Keep Service deferred and avoid further feature expansion before acceptance.


## Trusted-device product-request retry recovery — 1 October 2026

- HARDENING, Milestone 1/pilot recovery: missing-product create requests can explicitly opt into saving their pending command on a trusted device before the network write. Reopening restores the exact product/customer/details/idempotency reference for an explicit retry; there is no automatic submission. Successful confirmation or definitive rejection clears that reference. Cleanup failures retain the same command rather than encouraging a duplicate.
- Reused the existing offline storage module with a separate account-scoped operational-only namespace, strict bounded payload/UUID validation and permitted fields. Other accounts cannot restore the command through this workflow; permitted-role mounting and actor-keyed component state prevent inherited account state. Pending references never silently expire. Writes cannot replace an existing different reference/payload, and cleanup checks the expected reference. No pricing fields are stored; browser storage failure prevents an opted-in unprotected network write. Default remains off, with separate request-specific consent.
- Fresh checks: 33 affected storage/retry unit tests passed; six desktop/mobile restart/opt-in/account-separation/quota-failure browser checks and four existing product request/review browser checks passed, with typecheck/targeted lint. Smaller-model tests were inspected and rerun with the primary's overwrite/cleanup regressions. No database, Tally, production or deployment change.
- Limitations: browser storage is not encrypted and must be used only on trusted devices. One pending create command per account/browser is supported; localStorage checks are not cross-tab atomic locking. Office-review retry state remains in-memory. Actual staff-device and authenticated deployed acceptance, pilot and release consolidation remain pending.

## Reported stock increase alerts — 1 October 2026

- FEATURE, Milestone 3: a newer catalog-domain snapshot with a valid positive quantity increase records advisory notices for already-confirmed, unfulfilled order lines. Same-source refreshes, older versions, missing baselines, duplicate keys and invalid quantities do not invent arrivals. Initial imports/company changes establish a baseline only. Normal cached uploads exit before catalog parsing; comparisons are restricted to waiting-item keys. Connector polling and Tally remain unchanged.
- Snapshot update, immutable order audit and transactional outbox insertion are atomic. A canonical source timestamp/item/order unique index prevents replay duplication, including stale-upload/replay cycles. No order state, pricing, reservation or allocation is changed. Added a bounded, authenticated operational read with no commercial fields and a manually opened recent-seven-day alert list linking to exact-item waiting orders. No browser/background polling or push delivery; outbox is groundwork, not a claim of external notification delivery.
- Fresh integrated checks: 21 API/preflight unit tests and 16 desktop/mobile requirements/alert browser cases passed, with typecheck and targeted lint. Final database replay/ACID/concurrency passed, including duplicate-source, injected-outbox-failure rollback, alert pagination, catalog-time precedence and suspended-user tests. Fixed a test schema typo and a duplicate waiting-list display found during review. Delegate's broader 66-case pricing browser run passed before the final display correction; latest primary run is the 16 affected cases.
- Limitations: increases may be adjustments, not purchase receipts; current availability must be checked. Alerts require successive timestamped full catalog snapshots and appear on manual read, not as device push. Office authenticated acceptance, operational pilot and release consolidation remain pending. Durable product-request browser-restart recovery remains open. Not deployed or merged.

## Waiting-order drilldown — 1 October 2026

- FEATURE, Milestone 2/3 groundwork: each customer-demand item opens an explicit, read-only waiting-order list by exact canonical Tally key. Lists customer, order reference, operational status and remaining quantity; twenty orders per page with priority/age ordering. Excludes unconfirmed, closed, archived and fully fulfilled demand. No prices, allocations, stock reservations or Tally calls.
- Reused the authenticated API/Edge boundary and service-role-only database pattern. Active membership is checked at every read. No background polling or prefetch; closing/changing the demand view cancels stale requests. Smaller-model display work is reviewed by the primary agent.
- Fresh integrated checks: ten desktop/mobile browser cases, typecheck and targeted lint passed. Final database deployment replay, ACID/concurrency checks and eighteen API/preflight unit tests passed, including exact-key behavior, bounded pagination, bad gateway/nonmember/suspended denial and response field whitelist. Added a narrow partial index for unfulfilled item/order lookup. Corrected new migration evidence to use the repository's trimmed newline-normalized hash.
- Still pending: actual stock-arrival detection/notifications, durable product-request recovery after browser restart, deployed authenticated acceptance and office pilot. A stock-advisory drilldown is not an arrival notification or a reservation. Production remains unchanged.

## Customer demand requirements — 1 October 2026

- FEATURE, Milestone 2: added a read-only DB projection across all nonarchived post-confirmation open orders, aggregating remaining quantity by canonical Tally key. Confirmed demand is included even outside reorder rows; draft/unconfirmed/cancelled/delivered and fully fulfilled quantities are excluded. Shows total open demand, nonnegative shortage against reported available stock, affected-order count, priority and oldest order. Unknown/malformed/duplicate stock evidence stays unknown, never zero. No stock ledger/reservation/allocation write.
- Added authenticated read-only API/Edge routing and lazy, manually refreshed, paginated requirements view within Orders. Twenty-five items per page; full demand aggregation precedes paging. Responses expose operational facts only. Frontend rejects incomplete quantities instead of fabricating values. Reused existing patterns; smaller-model UI work was directly reviewed/integrated.
- Found catalog stock may be four hours old while upload/stock report is newer. Projection uses catalog-domain timestamp where supplied and UI explicitly warns about older catalog stock and picked-unbilled items. Did not increase connector polling or falsely claim latest upload means fresh full-catalog quantities.
- Fresh checks: complete deployment-order replay and existing ACID/concurrency tests passed, including whole-demand pagination, catalog timestamp and duplicate/malformed stock regressions. Fifteen API/preflight unit cases, four desktop/mobile requirements browser cases, typecheck and targeted lint passed. Corrected a test count assumption to include pre-existing replay fixtures. No deployment/Tally operation.
- Limitations: stock is advisory as-of catalog extraction, not current physical availability or reservation. Stock-arrival notification/affected-order drilldown still pending; requirements alone do not complete Milestone 3. Pilot/performance/release acceptance remain open.

## Controlled product requests: API and office workflow — 1 October 2026

- FEATURE, Milestone 1: missing-catalog search offers a request form for permitted capture roles; no normal product-add dialog. Requests pass through authenticated bounded API validation and the existing Edge request gate to the new governed DB gateway. Office reviewer roles can open a lazy-loaded request queue, enter a reason and resolve/reject with version/idempotency controls. Operational responses contain no pricing. Production/Tally untouched.
- Primary reviewed the delegated API adapter and integrated it with the UI/Edge routing. Unknown-outcome create/review retries retain the exact payload/reference in the open screen. Definitive validation/permission errors permit correction; successful review removes its queue entry. No background polling. CI lint includes the new component.
- Fresh checks: 18 desktop/mobile order-keyboard cases passed; latest request-focused rerun passed 4. Combined affected unit checks passed 31 (API auth/validation, timing, request gate, release preflight); typecheck/affected lint/whitespace passed after correcting React-ref rendering. Complete deployment-order replay passed including injected-failure rollback and real two-session product-review lock/stale rejection/replay, plus existing pricing concurrency. Test connection needed explicit current PostgreSQL user and was corrected before passing.
- Limits: request retry receipts are in-memory, not durable across browser restart; open request queue is bounded to 100; signed-in deployed acceptance and production migration/Edge rollout not done. No claim of full request offline recovery, production readiness or pilot acceptance. Next capability: derived confirmed customer demand/shortage requirements using trusted Tally stock, without a second inventory ledger.

## Controlled product requests: database boundary — 1 October 2026

- FEATURE foundation, Milestone 1: new operational request/review records, role-controlled gateway, bounded open-request read, exact imported-catalog-name recheck, customer validation, idempotent command recovery, row-locked/version-checked review and immutable audit events. Requests do not create or modify Product Master or Tally data. Missing catalog fails closed. Business requests cannot be hard-deleted.
- Database regression covers wrong gateway/viewer denial, same-command replay, changed-command rejection, existing catalog item rejection, immutable audit, stale review, hard-delete denial, no Product Master mutation, no authenticated RPC grant and injected audit-failure rollback of request/command receipt. Complete deployment-order migration replay and existing pricing ACID/two-session tests passed. One test-only ambiguous column reference was corrected and rerun. Eight release-preflight unit cases passed; new migration mapped as not deployed.
- Foundation only: no user-facing request workflow or deployed migration yet. API/form/admin review integration and direct new-request concurrency coverage remain before declaring the capability complete. Existing pricing and Tally authority unchanged.

## Fast Order Desk: capture measurement — 1 October 2026

- HARDENING, Milestone 1: added bounded browser-only `order_capture_ms` from explicit customer selection to accepted save, including accepted-command recovery. No names, identifiers, prices, storage or telemetry are attached. Existing save timing and transaction paths remain unchanged.
- Added five-product keyboard capture/save regression for desktop/mobile: exact customer and quantities, one create command, capture measure recorded, no restricted pricing request for Sales. Extended only synthetic fixture catalog for two extra products.
- Fresh results: 2 focused browser cases and 3 timing unit tests passed; typecheck, affected lint and whitespace check passed. Automated fixture timings are not evidence of staff completing production orders in 20–30 seconds.
- Not deployed. Next: controlled missing-product request workflow; use the existing gateway/audit/idempotency conventions, never create a Product Master implicitly.

## Fast Order Desk: recent-product quantities — 1 October 2026

- FEATURE, Milestone 1: recent customer products now accept quantity directly; Enter or Add inserts the selected quantity using the existing line path and focuses its quantity field. Whole-number bounds, duplicate prevention and 50-line limit remain unchanged. Customer selection resets unadded suggestion quantities. Unadded suggestion fields are not associated with the order form and cannot block its submission through native validation.
- No API, pricing, permission, persistence, migration or Tally changes. Suggestions still derive from the existing five recent OMS orders, not comprehensive Tally sales history.
- Regression first failed on desktop/mobile because the field was absent. Fresh keyboard suite: 12 desktop/mobile cases passed; final focused rerun: 2 passed. Typecheck, affected component lint and whitespace review passed before final form-association-only adjustment; that adjustment was covered by the focused browser rerun.
- Not published. Next ticket: measure and test the complete five-product capture/save path. Staff 20–30-second acceptance remains unverified; controlled missing-product requests and release acceptance are still pending.

## Latest private candidate publication — 30 September 2026

- Merged validated implementation `f099977` into the existing private candidate, source `22b17fe62ef18c325db8d4d3397838bfdf4df0e4`, preserving its hosting manifest and custom owner/staff audience. No public production, main merge or Tally changes.
- Saved private version 5 (`appgprj_6aae9b06bf4081919a1f08183fb02465~appgver_09eebd9c912481918f66ab82b9c75ad0`). Deployment `appgdep_6abd0f93020c819194784097ee605886` succeeded at 13:35:20 UTC, environment revision 2, at https://suprabha-pricing-acceptance.anil-mahindrakar22.chatgpt.site. Local publishing helper was unavailable; used the supported pushed-source remote-build fallback, which completed successfully.
- Fresh candidate validation: stock-handler and release-preflight suites passed 37 tests; typecheck passed. Earlier full validation is recorded below, not claimed as rerun here.
- Staff-reported signed-in mobile screenshot shows ₹100/₹170 approved and ₹335/₹800 fixed/protected, with no eligible bulk approval. Screenshot alone does not establish account identity or complete negative-role authorization. Latest deployed authenticated checks remain pending.
- Remaining blockers: authenticated role/failure acceptance, private upload-path verification, two production migration deployments and final release evidence. Staff-device offline checks, measured performance, restore rehearsal and operational pilot remain outstanding; not pilot-ready.

Branch: feature/customer-pricing-engine. Pricing checkpoint committed as f0d167f; unpublished.
Approved requirements: CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md.
Validation is batched to conserve usage; this checkpoint records remaining release work explicitly.

## Usage-reserve stop — 14 September 2026

## Migration content comparison — 15 September 2026

- Recovered the two exact production bootstrap migrations from read-only migration history:
  private snapshots and the full member allowlist (identity, auth binding, constraints, RLS
  and grants). Their normalized hashes match the evidence recorded on 15 September.
- Added `test:pricing:deployment`, which replays a disposable clean install in verified
  production deployment order, followed by the eight pending pricing migrations.
  It excludes the obsolete gateway-secret rotation. The historical archive migration keeps
  its `archived_at` schema and access predicate, but the disposable copy removes its one-time
  command that archived every order. Repository migration files remain unchanged.
- Fresh deployed-order replay passed: existing-order preservation, complete pricing integrity,
  billing evidence, atomic rollback, idempotency and two-session concurrency checks.
  This resolves the missing-bootstrap/dependency-order clean-install blocker without touching
  production or Tally. Fresh live-history comparison is still required immediately before release.

- Added a read-only local preflight: `node tests/pricing-release-preflight.mjs`.
  It validates the recorded project, complete local file inventory, normalized SQL hashes,
  unique mappings/remote versions and reviewed match statuses; returns deployed dependency
  order and only the eight explicitly allowed pending pricing migrations. Historical scripts
  cannot be relabeled as pending, and changed/unmapped files fail closed.
- This checks saved evidence, NOT fresh remote state. Output explicitly sets releaseReady
  and liveHistoryRechecked to false. It cannot execute SQL or repair migration history.
  Clean-install bootstrap recovery/replay remains incomplete; no database or Tally changes.
- Eight focused preflight tests pass, including drift, missing/new files, duplicate mappings,
  historical replay exclusion, unknown statuses, incorrect hashes and wrong-project evidence.
  Typecheck and targeted lint pass after removing an unnecessary type suppression and
  adding explicit sort comparators. The CLI successfully validates the current saved map.
- Next ticket: authenticated acceptance on an isolated deployed candidate, followed by the
  final consolidation checkpoint. The pricing branch remains unpublished.

- Read-only remote history query compared 71 local migration files against 65 deployed entries.
  Of 63 shared names, 60 SQL hashes match after CR removal and surrounding whitespace trim.
  Three formatting differences (user_management_gateway, archive_and_reset_test_orders,
  return_created_order_state) have identical non-whitespace content and quoted literals.
- Eight local pricing migrations are not deployed. Two remote bootstrap migrations
  (private snapshots and member allowlist) are absent from the local migration directory.
- Evidence is saved in supabase/migration-history-map.json; it is NOT an executable plan.
  Names/timestamps have not been rewritten, and remote migration history is untouched.
- Clean-install repair must include the two real bootstrap definitions and the deployed
  dependency order. Do not use the reduced test scaffold as a production baseline: deployed
  stockflow_members also contains id, user_id and created_at, absent from that scaffold.
- Checks performed: read-only history hashes, three SQL/literal comparisons and member
  column metadata. No application tests were needed for these evidence-only files.
- Next ticket: prepare and validate a clean-install/deployment mapping using this evidence;
  exclude historical archive/reset and credential rotation from any live replay.

Latest read-only deployment investigation:
- Supabase project aormuidjbdqruglmyseh lists delivery_exceptions at 20260902054643,
  equipment_installations at 20260902054942, then harden_business_history at 20260902081149.
  Production therefore applied dependencies in a different order/timestamp mapping from
  repository filenames. Both no-delete triggers were queried and are enabled (O).
- Remote history ends at 20260912081315 order_follow_up_queue; pricing migrations are not
  listed. Do not blindly push repository timestamps or mark migrations applied by name alone.
- Next: compare migration SQL/schema content before preparing a mapped deployment baseline.
  No remote writes, history repair, migrations, or publication performed.
- Investigation stopped at five-hour 19% remaining (weekly ignored). No tests run this turn.

- Latest recovery implementation commit: 74c09c5; still unpublished.
- Start-of-turn usage check: five-hour remaining 5%; weekly remaining 24%.
- Stopped under the approved 20% minimum reserve; no implementation or tests run this turn.
- Next ticket: unresolved pricing-save recovery and retry safety in existing contract/policy forms.
- Existing migration working change and two untracked validation logs preserved.

## Implemented locally

- Usage instruction updated: only the five-hour 20% reserve controls stopping; weekly
  allowance is no longer a user-imposed stopping threshold.
- Contract proposals, approval/rejection and policy creation now reuse unchanged commands
  after uncertain responses while Pricing stays mounted. Keys are scoped by actor, role,
  action and complete payload; edited decisions use new keys. No database safety controls
  changed. Four targeted desktop browser checks, targeted lint and typecheck passed.
- Contract/policy reload recovery now uses the existing account-scoped receipt panel and
  status-only recovery gateway. Forms remain disabled until earlier receipts are confirmed.
  The browser stores action/key only, never commercial values. Additive migration
  20260914140000 extends the gateway allowlist without changing transaction controls.
- Fresh validation: six targeted desktop browser tests, targeted lint, typecheck and pricing
  migration replay/integrity tests passed, including role denial and cross-account isolation.
- Unresolved receipts now offer an explicit Close only if unsaved action. The database
  takes the existing command lock non-blockingly, preserves completed requests and leaves
  in-flight requests unresolved. If unsaved, it atomically records a non-replayable result
  and audit event; the original key cannot apply later. No financial data is changed.
- Migration 20260914160000 adds this behavior without changing the shared command helper.
  Fresh checks passed: three targeted browser tests, lint/typecheck, pricing migration replay
  and database integrity including a real second-session lock, late-request rejection,
  duplicate closure, completed-save preservation and injected audit-failure rollback.
- Remaining limitation: browser-session closure may lose receipts. No automatic resubmission.
- Two-session customer-price approval tests now prove lock contention, stale row rejection,
  stale bulk rejection and duplicate-command replay without extra decisions. A second-row
  audit failure proves all bulk decisions, events, outbox entries and command results roll back.
  Fresh pricing database replay/integrity suite passed; no production code changed.
- Migration validation now has -StrictHistory mode (no historical edits or deferral).
  It fails at 20260902080651_harden_business_history.sql: private.stockflow_delivery_exceptions
  does not yet exist. This is a clean-install release blocker, not a passing replay.
- Default local replay now leaves all migrations from 20260913130000 byte-identical to the
  repository, verifies file hashes, and checks preservation of a pre-upgrade order and lines.
  This upgrade check plus pricing integrity/concurrency tests passed. Older baseline setup
  still uses documented compatibility adjustments; deployed schema/history has not been checked.
- Next release requirement: compare the deployed migration history and agree a clean-install
  baseline/repair process. Do not silently rewrite already-applied migration files.

- Customer-first Purchased / Exceptions / All Products worksheet, 50-row pages.
- Shared database calculation for order lines, customer book, and product cost-change impact.
- Continuity = last eligible rate + max(current comparable cost - historic cost, 0).
- Independent rounded target-margin calculation; recommendation = max(continuity, target).
- Fixed agreements preserve their rate and flag margin deterioration.
- Base/default rates apply only without eligible customer history and fixed agreements.
- Missing cost or comparable historic evidence and ambiguous latest-date sales are explicit.
- Management row and bulk approvals, evidence fingerprints, append-only decision records,
  audit events, transactional outbox references, idempotent retries, stale-decision rejection.
- Accepted book decisions feed order pricing while their evidence remains current.
- Order submission requires preview fingerprints; pending exception approval rechecks evidence.
- Entered rates below the minimum margin, and changes to fixed contract rates, require approval.
- Four additive migrations: 20260913130000, 20260913131000, 20260913132000,
  20260914100000 (revalidate approved evidence at the billing boundary).
- Order pricing offers Maintain / Recommended / Custom with independent economics and
  recommendation reasons. Fixed agreements cannot use the continuity option.
- The TypeScript calculator now follows the approved continuity/target/base rules too.
- Exceptional correction history is excluded even when its exceptional boolean is false.
- Earlier migration restored to its committed content instead of rewriting migration history.
- No Tally writes or live deployment performed.

## Fresh validation

- pnpm run ci: PASS on 14 September, lint/typecheck, connector checks, unit tests, production build,
  8 desktop/mobile access-denial E2E tests plus 6 pricing browser tests,
  production dependency audit (no known vulnerabilities).
- Pricing browser tests use actual components with fixture APIs, not authenticated live data.
- pnpm run test:pricing:db: PASS on disposable PostgreSQL 15, complete migration replay,
  existing pricing integrity scenarios and new customer price-book integrity scenarios.
- New database checks cover the approved arithmetic example, fixed/base/history precedence,
  protected bulk rows, role denial, replay, stale previews, order cost changes, immutable history,
  ambiguity, missing evidence, exceptional/zero/future sales and cost-decrease behavior.
- Billing regression verifies unchanged evidence permits handoff and changed cost evidence
  rejects billing without altering the order state or immutable snapshot reference.
- git diff --check: PASS.

## Remaining before calling this complete or release-ready

- Added actual pricing-route/auth-header/gateway serialization tests with simulated gateway
  responses: trusted actor identity, unauthenticated denial, pricing-role denial propagation,
  no-store headers, safe recovery GET/POST, invalid input and generic internal errors.
  Eleven new API cases plus five pricing-validation cases passed; targeted lint and typecheck
  passed. Tests simulate the upstream authenticated headers, not a real staff login or live RBAC.
- Authenticated end-to-end acceptance remains blocked on an isolated deployed candidate with
  test accounts/data. Production was not mutated and the unreleased branch was not published.

- Authenticated browser acceptance for customer selection, row approval, base price save,
  bulk review, mobile layout, keyboard use, paging, and errors. Fixture tests now cover
  customer selection, tabs, row submission, Accounts restrictions and order pricing options.
- Two-session price-book/bulk and same-exception approval concurrency, plus failure rollback,
  are verified locally. The losing exception approval is rejected as stale without duplicate
  snapshots, audit/outbox records or command results; the winner remains idempotently replayable.
- Billing-boundary regressions now cover Tally cost, customer-contract replacement, pricing-policy
  change and a newer accepted customer price-book decision. Each stale handoff is rejected while
  preserving the awaiting-billing order and immutable snapshot. The verified deployed-order
  PostgreSQL replay and complete pricing ACID/concurrency tests pass with these cases.
- Strengthen base-price preview UI (current rate, effective dates and margin evidence) and
  show accepted customer decisions clearly; consolidate older contract controls into exceptions.
- Reload recovery now retains only opaque action/key receipts in account-scoped session
  storage. The existing recovery gateway checks the same actor's committed command and
  returns status only, never commercial results. An unresolved receipt blocks approvals;
  absence is not treated as failure. Five targeted browser recovery/retry checks and the
  pricing database replay/integrity checks pass. In-memory unchanged retries retain their
  original payload/key. No automatic resubmission or persisted price values are introduced.
  A genuinely unresolved save needs operational reconciliation; closing the browser session
  can lose the receipt. Other pricing forms are unchanged.
- Performance review of product impact aggregation: responses are paginated, but server-side
  preview still calculates all buyers; approval is currently bounded to 1,000 customers.
- Reliable volume evidence is absent. Monthly GP values are explicitly unavailable, and
  impact ranking currently uses absolute per-unit change rather than monthly economic impact.
- No live read-only Tally evidence validation, management policy setup or office pilot performed.
- Existing migration replay harness normalizes historical Windows function text and defers
  two legacy triggers; this is not proof that an untouched raw historical chain replays directly.

This is a tested development checkpoint, not implementation-complete or pilot-ready.

## Release consolidation — 19 September 2026

- `pnpm run ci`: PASS. Fresh results: lint, typecheck, connector recovery/retention,
  80 unit files with 385 tests, production build, 8 desktop/mobile access-denial browser
  tests, 26 desktop/mobile pricing browser tests, and production dependency audit with no
  known vulnerabilities. Coverage: 95.21% statements, 88.35% branches, 100% functions,
  98.95% lines.
- Both disposable PostgreSQL 15 paths passed in this combined run: the compatibility replay
  and verified deployed-order clean install. Each completed existing-order preservation,
  pricing integrity, billing evidence, rollback, idempotency and two-session concurrency tests.
- Release preflight and branch diff checks pass. Production, Tally, remote migration history,
  hosting and customer/order data were not changed.
- Authenticated acceptance verdict: PARTIAL. Fresh browser tests cover customer selection,
  customer/base decisions, retries/failure handling, role restrictions and desktop/mobile UI;
  API tests cover trusted identity and denial; database tests exercise real transactions.
  These layers do not constitute a genuine staff login against an isolated deployed database.
- Consolidation verdict: no demonstrated implementation defect, but NOT pilot-ready and not
  approved for merge/publication until isolated staff-login acceptance passes and live migration
  history is refreshed immediately before release. Service expansion remains deferred.
- Branch `feature/customer-pricing-engine` was 14 commits ahead of its remote before this
  checkpoint; `origin/main` was `9afdbda`. No PR, merge, push or deployment was performed.
- Next action requires an explicitly authorized isolated candidate environment; do not perform
  pricing mutations against the current production company merely to satisfy acceptance.

## Additional authorized integrity slice

Completed after the user requested one more slice:

- Exception approval now revalidates all active decisions in its batch, including automatically
  approved siblings and siblings approved earlier by management.
- A regression test first reproduced successful approval with stale sibling cost evidence.
- Both sibling scenarios now reject with a concurrency error before creating any approval,
  billing snapshot, audit/outbox changes or idempotency result. Unchanged first approval and
  its idempotent replay are also checked.
- Fresh complete migration replay and both pricing database integrity suites passed.
- Application code did not change in this slice, so the earlier application/build results
  were not rerun or represented as newly executed.
- Committed as `71c62c7` and unpublished; remaining release blockers above continue to apply.

## Concurrent exception approval integrity — 19 September 2026

- Added a deterministic two-session race for two managers approving the same pending price
  exception. The test proves real lock contention rather than sequential calls.
- The first approval atomically creates the approved decision, immutable billing snapshot,
  audit event and outbox entry. The stale second approval returns `40001` and persists no
  command result or partial/duplicate state. Replaying the winner returns the original result.
- Fresh verified deployed-order pricing migration/integrity replay passed.
- No production, Tally, hosting or live customer/order data was changed. The isolated
  authenticated staff-login acceptance blocker remains.

## Pre-deployment gate refresh — 19 September 2026

- Refreshed the live Supabase migration list read-only. The production project is healthy and
  still ends at `order_follow_up_queue` (`20260912081315`); none of the eight pricing migrations
  has been applied and no unexpected later migration was found.
- Fresh verified deployed-order replay passed, including existing-order preservation, pricing
  integrity, rollback, idempotency and two-session concurrency checks.
- The current public Site is healthy, but it still targets that production database. Publishing
  the pricing UI before its database boundary exists would create a broken partial release.
- Deployment is therefore held. The remaining release gate is authenticated staff acceptance
  in an isolated candidate followed by a controlled migration/app release. A free isolated
  database environment is not currently configured; production must not be used as the test bed.
- No production database, Tally data, Site version, access policy or hosting configuration was
  changed during this check.

## Isolated authenticated candidate — 19 September 2026

- Created a zero-cost isolated Supabase project and private Sites candidate. It contains only
  synthetic acceptance data; production orders, production Tally data and the production Site
  were not changed.
- Applied the verified deployment-order schema with historical credential rotation and the
  one-time order archival command excluded. The pricing gateway, immutable snapshots and both
  approved administrator accounts are present in the isolated environment.
- Authenticated administrator access reached the restricted Pricing workspace and loaded the
  synthetic Customer × Product price book from the isolated database.
- PostgreSQL 17 exposed a release-blocking ambiguous `contract` reference in the customer-price
  listing gateway that PostgreSQL 15 did not reject. The row variable and result alias now have
  distinct names; the private candidate and local deployment replay both pass afterward.
- The candidate is deployed privately at
  `https://suprabha-pricing-acceptance.anil-mahindrakar22.chatgpt.site`.
- Full mutation acceptance (customer proposal/approval, base-price decision, bulk approval and
  recovery) remains to be completed before production migration and publication.

## Isolated mutation acceptance and independent approval guard — 19 September 2026

- Added the synthetic Tally catalogue snapshot required by the private candidate; production
  stock, production Tally and the production Site remain untouched.
- Authenticated customer-price entry passed: the administrator selected the synthetic customer
  and product, submitted an effective-dated ₹800 proposal, and the candidate persisted the
  pending contract and approval audit path.
- Acceptance then demonstrated that the same administrator could approve their own proposal.
  This violated the stated four-eyes control even though role authorization, optimistic locking
  and audit persistence were otherwise working.
- Added a database trigger that rejects a transition to `approved` when `approved_by_email`
  equals `created_by_email`. The guard applies below the API/UI boundary and therefore cannot be
  bypassed by a hidden frontend control.
- Added a regression scenario proving self-approval rolls back and a different Management user
  can approve the unchanged pending contract. The migration applied successfully to the isolated
  PostgreSQL 17 candidate. Both the focused rollback-only trigger check and the complete
  `pricing_engine_integrity.sql` transaction suite passed there.
- The local deployment replay could not be rerun in this session because the local PostgreSQL
  `createdb` executable is unavailable. Its last fresh pass remains recorded above; this new
  migration still requires the normal deployment-order replay at the final release checkpoint.
- Base-price and bulk-price mutation acceptance, opaque recovery acceptance, and a clean
  two-account UI approval pass remain release blockers. Production deployment stays held.

## Base and bulk mutation acceptance — 20 September 2026

- Ran the real pricing gateway against the isolated PostgreSQL 17 candidate using synthetic
  Cleaner evidence inside a rollback-only transaction. Production, Tally and the production
  Site were not contacted or changed.
- Base-price acceptance passed: an Administrator-approved effective-dated base price persisted
  with one audit event and one idempotency result; replaying the same command returned the exact
  original result without a duplicate price or audit event.
- Bulk-price acceptance passed after adding rollback-only historical purchase-cost evidence:
  the preview produced eligible continuity evidence, the recommended-price command created the
  expected customer decisions, audit events and transactional outbox entries, and an identical
  replay returned the original result without duplicates.
- The second approved staff identity (`nikitesh.am@gmail.com`) completed ChatGPT authentication,
  but the private candidate Site remains owner-only and denied application access. No Site access
  policy was changed. A clean two-account UI approval pass therefore remains blocked until that
  identity is explicitly granted candidate access.
- Remaining release blockers: opaque recovery acceptance, two-account browser approval, and the
  final deployment-order replay/consolidation. Base-price and bulk-price database mutation
  acceptance are complete. Production deployment remains held.

## Production release and pilot handoff — 20 September 2026

- Released commit `e7646c2cf831d8c90950d2322cbdb17cf8310acb` to GitHub `main` and
  `feature/customer-pricing-engine`, production Site version 47, and `stockflow-orders`
  Edge Function version 17.
- Applied the nine reviewed pricing migrations after refreshing the live production migration
  history. The release excluded historical credential rotation, one-time archival and all Tally
  write operations.
- Pre/post migration counts remained unchanged: 23 orders, 26 order lines, 458 customers,
  2 members and 142 order audit events. Pricing tables and the restricted pricing gateway are
  present after migration.
- The clean release gate passed: lint, typecheck, connector recovery, 385 unit tests, production
  build, 8 desktop/mobile access tests, 26 desktop/mobile pricing tests and the production
  dependency audit. Coverage was 95.21% statements, 88.35% branches, 100% functions and 98.95%
  lines; no known production dependency vulnerability was reported.
- Authenticated production smoke acceptance passed with `nikitesh.am@gmail.com`: Orders loaded
  existing operational queues and Pricing loaded the restricted price book and policy. No order,
  price, access policy or Tally data was changed during smoke acceptance. Recent production Worker
  error logs were empty.
- Supabase security advice contains informational `RLS enabled, no policy` notices for deliberately
  inaccessible private-schema tables. Performance advice includes optional covering indexes; no
  error-level database advice or release blocker was reported.
- Local database replay was unavailable because PostgreSQL `createdb` is not installed on this
  workstation. The PostgreSQL 17 isolated candidate integrity run and controlled production
  migration verification provide the release evidence for this environment.
- Deployment is complete and the combined Orders + Operations + Pricing build is ready for a
  controlled office pilot. The pilot must validate real staff handoffs and must keep Tally
  read-only; production test mutations are not required for this checkpoint.

## Administrator self-approval policy — 20 September 2026

- Owner policy now permits an active Administrator or Management user to approve a customer-price
  proposal they created. Approval remains denied to Accounts and operational roles by the pricing
  gateway.
- The forward migration removes only the independent-review trigger. Optimistic version checks,
  idempotency, immutable pricing history and pricing audit events remain unchanged.
- Focused integrity coverage now verifies administrator self-approval, exact idempotent replay,
  one command result and a durable approval audit event.
- The migration is committed for the next release but has not been applied to production in this
  ticket.

## Pricing-evidence import correction — 21 September 2026

- Tally has no reliable tender, scheme or special-price marker. The read-only connector therefore
  does not infer commercial intent from voucher references or other free text. Only objectively
  detectable FOC/zero-rate sales are marked exceptional; governed special prices belong in the
  explicit Customer × Product price book.
- Fixed populated Tally voucher-reference parsing so provenance remains available without stopping
  an otherwise valid sales-history refresh.
- Added an immutable private import-run record with received, accepted, duplicate, unmatched and
  rejected counts. Invalid or unmatched pricing evidence is now observable without exposing
  customer names, prices or other restricted commercial values in general application payloads.
- Focused connector recovery, classification and pricing-import tests pass. Local database replay
  remains unavailable because PostgreSQL `createdb` is not installed on this workstation, so the
  new migration is committed but not claimed as applied or deployed.

## Customer price-book visibility — 21 September 2026

- Customer rows now show the governed price source, current selling rate, current cost, gross
  profit per unit and margin without another disclosure click. Cost provenance and percentage
  change remain visible in the same compact card.
- Continuity and recommended prices are direct one-click approvals with a deterministic audit
  reason when no optional note is entered. Custom prices still require an explicit reason.
- The Exceptions view now includes both fixed customer agreements and calculated
  `REVIEW_REQUIRED` rows from genuine customer sales history. Pricing-role checks remain enforced
  in the database gateway, and the underlying gateway is no longer directly executable.
- Focused unit, type, lint and desktop/mobile browser checks pass. The forward migration is
  committed but not deployed; local database replay remains unavailable without `createdb`.

## Governed prices in routine orders — 21 September 2026

- Accounts, Administrator and Management can apply all current governed prices to a routine order
  with one action. Operational order-entry roles still receive no restricted commercial values.
- The shortcut is available only when every line exactly matches an effective approved customer
  agreement, the approved base price itself, or a price-book decision bound to the current evidence.
  Missing evidence, an unapproved suggestion, a changed cost/source or a review-required guardrail
  fails closed into the existing manual exception workflow.
- The action delegates within the same database transaction to the existing idempotent pricing
  decision, immutable billing-snapshot, audit-event and outbox workflow. A lost response retries
  with the same client request key.
- Focused authorization-contract, UI-contract, idempotency, release-preflight, lint and type checks
  pass. The forward migration and Worker routing change are committed but not deployed; local
  database replay remains unavailable without `createdb`.

## Simplified pricing administration — 21 September 2026

- The daily Pricing workspace keeps the customer price book and pending price decisions visible,
  while customer-agreement setup, agreement history and commercial-policy controls are grouped
  under a collapsed `Pricing administration` section.
- Removed stale four-eyes and independent-review wording. The interface now matches the approved
  policy: an Administrator or Management user can approve a price, including their own proposal.
- Focused unit, lint, type and desktop/mobile browser checks pass. This is a UI-only ticket: no
  database, pricing transaction or read-only Tally behavior changed, and it has not been deployed.

## Migration replay checkpoint — 21 September 2026

- The pending pricing release contains 13 forward migrations, ending with governed routine-order
  pricing. The repository deployment-order runner and migration-history map are present.
- Restored the official PostgreSQL 17.11 portable runtime after confirming PostgreSQL had been
  removed and the current Winget installer URL returned HTTP 403. `createdb` now creates and drops
  isolated local databases successfully; the user-local `bin` directory is on the user `PATH`.
- A fresh deployment-order replay exposed and fixed an ambiguous member-email reference in the
  price-book gateway. The concurrency fixture was also split at its transaction boundary so its
  committed setup cannot hold the evidence lock needed by the two independent approval sessions.
- Fresh deployment-order replay, existing-order preservation, pricing ACID checks, two-session
  concurrency and injected bulk-rollback checks all pass on isolated PostgreSQL 17.11. No
  production database or Tally data was changed.

## Authenticated acceptance refresh — 21 September 2026

- Fresh desktop/mobile pricing acceptance passed all 26 scenarios, covering customer and base
  decisions, bulk impact approval, pagination tabs, role restrictions, opaque account-scoped
  recovery, unchanged idempotent retries and failure handling.
- `nikitesh.am@gmail.com` authenticated successfully against production and loaded the restricted
  Pricing workspace. No application error appeared; only unrelated authentication-provider
  telemetry-size warnings were present in the browser console. The smoke remained read-only.
- The isolated mutation candidate still rejects that approved staff identity at the hosting layer
  before the application loads. Therefore two-account authenticated browser mutation acceptance
  remains partial; no Site access policy was changed and no production price, order or Tally data
  was mutated for this check.

## Final consolidation checkpoint — 21 September 2026

- The deployment-order PostgreSQL 17.11 replay passes with byte-identical order preservation,
  pricing ACID integrity, two-session approval concurrency and injected bulk-rollback checks.
- The complete repository gate passes: lint, typecheck, connector recovery/retention, 397 unit
  tests, production build, 8 desktop/mobile access-security tests, 26 desktop/mobile pricing
  tests and the production dependency audit. Coverage is 95.21% statements, 88.35% branches,
  100% functions and 98.95% lines; no known high-severity production dependency vulnerability
  was reported.
- Consolidation detected and corrected the stale reviewed checksum for the fixed price-book
  visibility migration. The focused eight-case release-preflight suite passes afterward.
- Automated engineering evidence is green, but release readiness remains `PARTIAL`: live migration
  history must be refreshed immediately before release, and the isolated candidate must permit a
  second approved staff identity for authenticated mutation acceptance. No merge, push, deployment,
  production mutation or Tally write was performed.

## Customer-first correction in progress — 23 September 2026

- Current customer price now displays the accepted evidence-bound price-book decision, not
  merely the last Tally invoice. A changed evidence hash expires that decision; the calculated
  recommendation remains a proposal, not an automatically approved current price.
- A new confirmation transaction applies fully governed order prices and creates the immutable
  billing snapshot, audit events and outbox entry together. Missing or review-required evidence
  leaves pricing unapproved. Existing confirmed orders retain an explicit apply action; viewing
  an order never silently writes pricing decisions.
- Order entry offers bounded customer-price previews only to Administrator, Management and
  Accounts. The database gateway denies operational-role access to commercial values.
- Routine bulk and contract approvals no longer require typing a reason; deterministic audit
  reasons are supplied. Custom decisions and rejections still require an explicit reason.
- Local deployment-order migration replay, existing pricing integrity/concurrency checks and
  the new confirmation/authorization/injected-rollback tests pass. Lint, typecheck, the
  production build and all 401 unit tests pass. Read-only release preflight lists this
  correction as a pending migration. This is not yet a release claim: fresh live migration
  comparison and authenticated acceptance remain open.

## Fresh production migration-history check — 23 September 2026

- Read-only live Supabase inspection found 78 deployed migrations. Their versions, names and
  normalized SHA-256 SQL fingerprints match all 78 recorded deployed entries. The new
  customer-first correction is absent from production and remains the sole pending migration.
- No live SQL was modified. The saved comparison date and inspected branch HEAD were refreshed;
  the preflight intentionally still reports `releaseReady: false` because a saved comparison is
  not a deployment or an authenticated staff workflow acceptance.
- Next gate: isolated authenticated acceptance of the correction, including two approved staff
  accounts and a real confirmation/pricing exception flow. Do not mutate production orders or Tally.

## Customer-wide approval slice — 23 September 2026

- Selecting a customer now shows purchased items in a compact price table with last rate,
  historic/current cost, current GP, recommendation and approval status. Item details remain
  available on demand; exceptions have a one-click filter.
- An Administrator or Management user can approve all eligible recommendations in one
  evidence-bound, idempotent database transaction. Fixed prices, accepted decisions, inactive
  products and review-needed rows are excluded, counted and left unchanged. Audit events and
  outbox records are written atomically with the new decisions. Accounts can view but not approve;
  operational roles cannot read prices.
- The new migration is pending, not deployed. Isolated deployment-order replay, pricing ACID
  and concurrency checks, 24 focused unit tests, lint and typecheck pass. Authenticated candidate
  acceptance and fresh release-time migration comparison remain open; no production or Tally
  data was changed.

## Isolated Pricing browser acceptance — 23 September 2026

- The browser suite now checks the customer-wide preview, eligible/excluded counts, explicit
  approval checkbox, one bound approval request, and receipt-only recovery on desktop and mobile.
  Existing per-item checks were aligned with the collapsed detail panel, and routine approval
  tests with the current optional-note behavior.
- All 28 isolated desktop/mobile Pricing browser cases pass. These use fixture API responses,
  so they do not establish two-account authenticated acceptance against a deployed candidate.
  That gate and a fresh release-time migration comparison remain open. No production or Tally
  data was changed.

## Cost-increase exception correction — 24 September 2026

- The approved pricing design now treats a verified purchase-cost increase as an administrator
  exception, including under an approved fixed customer agreement. No automatic price increase
  or billing snapshot occurs on confirmation. With comparable unchanged/lower cost and a valid
  minimum margin, repeat orders proceed at the last genuine customer selling rate rather than
  silently adopting the higher target-margin recommendation.
- Added a forward migration that gates order resolution and automatic confirmation at the
  database boundary. Customer-wide bulk approval excludes cost-increase review rows; explicit
  administrator exception approval retains the existing ACID snapshot, audit and outbox path.
- Isolated PostgreSQL migration replay and deployment-order replay pass. The rollback-only
  regression verifies unchanged-cost auto approval, increased-cost hold for regular and fixed
  items, bulk exclusion and administrator exception approval. Focused pricing unit tests,
  lint, typecheck and the updated desktop/mobile browser cases pass. GitHub quality/security
  gates and CodeQL both passed for merge commit `989e287`.
- The separate private acceptance database now has the cost-increase migration, and acceptance
  site version 3 (`20346f6`) deployed successfully. The public app and production database remain
  unchanged; no Tally write has occurred. The isolated site's authenticated two-account acceptance
  still needs the owner's sign-in and approval of a synthetic proposal. Fresh release-time
  production migration comparison remains open, so the pricing release is not yet pilot-ready.

## Private acceptance gateway and order-entry handoff — 26 September 2026

- The private acceptance database confirms a synthetic customer-product proposal requested by
  `nikitesh.am@gmail.com` and approved by `anil.mahindrakar22@gmail.com`, with separate audit
  actors and an effective approved rate of ₹335. No production pricing data was changed.
- Authenticated order entry initially showed “Customer price unavailable” for that exact
  customer/product because the private acceptance Edge Function was still version 1, whose
  action allowlist lacked `preview_customer_prices`. The database resolver itself returned the
  approved contract correctly. Deployed the repository's existing `stockflow-orders` function
  to the private acceptance project as version 2; the same form then displayed
  “Current price ₹335.00 · GREEN”. No order was submitted, and public StockFlow and Tally were
  untouched.
- Fresh local `pnpm test:pricing:deployment` and `pnpm run ci` passed. The latter covered lint,
  typecheck, connector checks, 402 unit tests, production build, 8 access browser cases,
  28 pricing browser cases and the production dependency audit (no known high-severity finding).
- Release remains held: complete the authenticated pricing-to-order state transition on the
  private candidate, refresh production migration comparison immediately before release, and
  obtain review/merge approval. The pending migrations and pricing build are not public or
  pilot-ready yet.

## Authenticated pricing-to-order acceptance — 26 September 2026

- On the private acceptance site, `nikitesh.am@gmail.com` captured synthetic order
  `SF-260926-00021` for Acceptance Laboratory × Acceptance Analyzer Cleaner, then confirmed it.
  The database shows `confirmed`, `pricing_state=approved`, a version-1 immutable billing
  snapshot at the approved ₹335 rate, and matching order/pricing audit events. No Tally action
  or public production change was made.
- This closes the isolated pricing-to-order handoff check. A fresh production migration-history
  comparison, review and controlled release decision remain before public deployment or pilot.

## Fresh production migration comparison — 26 September 2026

- Read-only live inspection found 78 production migration records, ending at remote version
  `20260921103304`. All 78 versions, names, statement counts and normalized SHA-256 SQL
  fingerprints match the saved mapping; there is no unexpected live migration.
- Three local pricing migrations remain unapplied to production: customer-first correction,
  customer-wide bulk approval, and cost-increase exception gate. Local release preflight passed,
  but its static `releaseReady: false` result is intentionally not a deployment authorization.
- No production data or schema was changed. Next gate is final review of the three-migration application
  sequence and controlled public release decision; Tally stays untouched.

## Pending migration sequence review — 26 September 2026

- Reviewed the three pending migrations in timestamp order: customer-first correction,
  customer-wide bulk approval, then cost-increase exception gate. Each later migration wraps
  functions established by its predecessor; do not reorder or skip them. No direct business
  data rewrite or deletion was found. The revised decision CHECK constraints accept all three
  existing production decision rows (current values: `price_exception` and
  `last_tally_invoice`). Production runs PostgreSQL 17.6; the isolated replay used PostgreSQL
  17.11. The local deployment-order and injected-failure checks had passed before this review;
  they were not rerun here. No DDL down-migration rehearsal exists.
- Production `stockflow-orders` Edge Function version 18 lacks the new price-preview and bulk
  actions. The safe release order is: recheck live history and preserve a recovery point; apply
  the three migrations in order; deploy the repository gateway; verify its actions; deploy the
  application; then perform authenticated smoke and staff pilot checks. Do not expose the new
  application against the old gateway (the private candidate reproduced that failure).
- PR #29 is still draft at remote head `95a656e` with an outdated description claiming two
  pending migrations and incomplete two-account acceptance. Its quality/security and CodeQL
  checks passed at that remote head. Local documentation was ahead of the remote branch; no push,
  merge, production deployment or Tally change was made during this review.

## Final review security correction — 26 September 2026

- Independent PR review found the pending bulk-approval gateway could reach its write path when
  no active member role was found: SQL `NULL NOT IN (...)` does not reject that actor. The audit
  table's non-null role constraint prevented a committed approval in the reproduced case, but
  authorization must reject it directly. The gateway now explicitly rejects a null role.
- Added rollback-only integration checks for unknown and suspended actors. The pre-fix check
  failed on an audit constraint instead of an authorization error; after the fix, normal and
  deployment-order PostgreSQL replays pass, including ACID/concurrency checks. The pending
  migration hash and eight-case release-preflight unit suite were refreshed and pass.
- This correction is not deployed. PR checks must rerun on the new commit; the production
  recovery method remains unconfirmed. No public deployment or Tally change occurred.

## Release gate status — 26 September 2026

- PR #29 is open, review-ready and mergeable at `a8be161`. Quality/security and CodeQL
  both passed on that exact commit. No new code changes were made during this check.
- Production remains on Supabase Free. No verified, recoverable database export exists yet.
  The local PostgreSQL dump client is available, but no production database connection
  credential or URL is configured in this workspace, and the Supabase CLI is not installed.
  Supabase's Free-plan guidance recommends a manual logical export. Do not apply the three
  pending migrations or deploy the gateway/app until an export and recovery check are complete.
- Next release action: obtain a production read-only/dump connection securely, create a private
  logical backup, verify the artifact and an isolated restore, then recheck migration history
  immediately before the controlled migration → gateway → app rollout. Tally remains read-only.

## Backup gate follow-up — 27 September 2026

- The production project remains healthy and the public StockFlow page returned HTTP 200 after
  the owner reset the database password. Direct PostgreSQL connections are reachable, but the
  attempted manual `pg_dump` exports were rejected for the `postgres` role. Each attempt left
  only a zero-byte file; there is **no valid recovery backup**. Do not release on that basis.
- A private local helper now prompts for the database password without echoing it, and a
  separate verification helper checks archive size, required auth/business table entries,
  full archive streaming and SHA-256. Its empty-file rejection was exercised successfully;
  positive archive and isolated-restore checks remain pending a successful export. Neither
  helper nor any backup data is in the repository.
- PR #29 remains open, review-ready and mergeable at `c23b629`, with both quality/security and
  CodeQL checks successful. Production still lists 78 migrations, ending at
  `20260921103304`; the three pricing migrations remain unapplied. No production schema,
  pricing data, Edge Function, application or Tally change was made during this follow-up.

## Controlled release progress — 27 September 2026

- The owner explicitly waived the backup gate after being informed that production contained
  28 OMS orders, 458 customer records and 2 billing snapshots, identifying those records as
  test/disposable. No valid database backup was created. This is a release risk, not evidence
  that recovery is available. Tally remains untouched.
- Fresh deployment-order local replay passed: existing order/line preservation, complete
  migration chain, pricing ACID checks, two-session concurrency and bulk rollback. The remote
  PR quality/security and CodeQL checks passed on the preceding documentation head.
- Applied the three reviewed migrations in order as remote versions `20260927060906`,
  `20260927060927` and `20260927060946`. Their remote SQL normalized SHA-256 values exactly
  match the three local files. Production now lists 81 migrations; order, line, customer,
  customer-price and billing-snapshot counts were unchanged immediately afterward.
- Deployed `stockflow-orders` Edge Function version 20. Its retrieved source exactly matches
  the repository file and includes the price-preview and customer-book bulk-approval routes.
  The function retains its existing gateway-key authentication mode. The security advisor
  reports only informational no-policy notices on intentionally private RLS tables.
- The public Site deployment, authenticated production smoke, PR merge and office-pilot gate
  are still pending. Do not report the pricing release complete from migrations alone.

## Connector upload recovery — 28 September 2026

- PR #31 merged to `main` at `dd791a9ff937feed4e667d687eec434dd8d0415b` after the quality/security and CodeQL checks passed. The production-order migration replay, connector tests, 402 unit tests, typecheck, lint and production build also passed.
- Applied only `snapshot_pricing_import_privilege` as remote migration `20260928072110`. Its normalized SQL hash matches the local file. The private import trigger now runs under its trusted owner with a pinned search path; direct table/function access for app roles was not added.
- A Tally snapshot already saved on the office PC uploaded with HTTP 200. After restarting the scheduled connector, its own cloud upload logged `status=ok` and zero consecutive failures. No Tally voucher or setting was changed.
- The cloud snapshot advanced from 21 September to 28 September. The import recorded pricing evidence and removed it from the public snapshot. Orders and billing snapshots remained at 28 and 2; one customer ledger from the saved snapshot was imported, taking the customer count from 458 to 459.
- No verified production backup exists; the owner previously accepted the risk to test/disposable records. This connector fix does not prove the broader office pilot or resolve the pricing policy values and two-role acceptance. Continue observing upload freshness and Supabase resource use.

## Cloud Stock projection — 30 September 2026

- Continued on `feature/keyboard-order-entry` from `9fe41a3`, with a clean working tree. Recent connector/browser recovery work remains intact. No production deployment or Tally write was performed.
- Read-only production measurement: the current snapshot was updated at `2026-09-30T05:10:54.472Z`; JSON text measured 577,993 bytes versus 5,859 bytes for dashboard fields (approximately 99% less). This proves the payload opportunity, not a measured reduction in CPU or query latency.
- Added repository-controlled `stockflow-sync` source. `view=dashboard` selects only required JSON paths inside PostgREST; the app forwards this opt-in flag and retains its response projection/commercial-data sanitizer. Default reads and the atomic single-row snapshot upsert remain compatible. Upload bodies are bounded to 8 MiB using the existing streaming reader.
- Removed source-literal access keys from the new implementation. Before rollout, configure private Edge secrets `STOCKFLOW_READ_KEY` and `STOCKFLOW_UPLOAD_KEY` matching the server/office clients, and ensure the existing `SUPABASE_SECRET_KEYS.stockflowedge` backend key is present. No values are committed. Stage/review this function with custom-key authentication (`verify_jwt=false`) before deployment; do not deploy it without the secrets.
- Available last-24-hour diagnostics contain 36 PostgREST `Thread killed by timeout manager` messages. Log counts are not comprehensive traffic/CPU measurements and do not establish their cause. Follow-up: controlled function rollout, authenticated dashboard/upload smoke, and before/after cloud latency/load measurements. Live source still uses full-snapshot reads until rollout.
- Validation: 38 focused tests passed across Stock API, sync handler and existing request-gate tests; application lint/typecheck and separate sync-handler lint passed. Checks cover projection, credential rejection before database access, legacy response compatibility, controlled errors, atomic-upsert request semantics and streaming size bounds. No live upload, deployment, full-suite run or new production build was performed for this slice. TypeScript now permits explicit `.ts` imports so the tested Deno handler can reuse the existing bounded reader.

## Combined recovery batch — 30 September 2026

- Starting point: clean `feature/keyboard-order-entry` at `ac204e7`. Kept the batch uncommitted until its combined validation finished; no remote push, merge, production deployment or Tally change.
- Fixed a reproducible indefinite-refresh lock: either Stock or order-summary response-body parsing could stall forever, leaving Refresh disabled and preventing all later automatic refreshes. Both browser requests now have a 20-second deadline; a missing summary does not discard valid Stock data. Stock upstream reads have a 15-second deadline, sync database HTTP requests 10 seconds, and order-gateway requests 30 seconds. These are HTTP cancellation deadlines, not proof of database rollback. Uncertain mutations are never automatically resubmitted or assigned a new idempotency key.
- Concurrent authorized Stock reads for the same view/current credential now share one in-flight upstream read and sanitization. Every caller still receives its own authorization check; legacy/dashboard views and credential rotations are separate. Settled/error results are removed immediately, not cached. This is per-handler-instance protection, not a distributed rate limiter or a measured live CPU improvement.
- Fixed another shared-device cache boundary: seven-day Stock chart history is now account-scoped after the trusted parent handoff. Legacy shared chart keys are discarded, not assigned to an unknown owner. Previous-account chart caches are cleared on account switch; unsent order drafts remain intact. Existing browser aggregate-chart history resets once; no server business records are deleted.
- Fresh production-dependency audit initially found 20 advisories, including six high-severity findings. Narrow version-range overrides update fast-uri to 3.1.8, undici 7.x to 7.29.1, brace-expansion 5.x to 5.0.12, and ip-address 10.x to 10.7.1; the lockfile contains only those dependency changes. Final production audit reports zero known advisories at all severities. No audit exception or security threshold was weakened.
- Final `pnpm test:ci` passed on the patched dependencies: lint, typecheck, both connector suites, 452 unit tests with coverage gates, and production build. Sync-handler lint and connector-control status checks also passed. Focused desktop/mobile freshness E2E passed all 16 cases. Deployment-order PostgreSQL replay passed snapshot import privilege, catalog version compatibility, existing-record preservation, pricing ACID checks, two-session concurrency and bulk rollback. One obsolete source-string test failed after the timeout wrapper rename; its expectation was updated and the full suite passed afterward.
- Remaining release boundary: configure/review sync secrets, stage the actual Edge function/runtime and both pending migrations, then perform authenticated read/upload acceptance and before/after live cloud measurements. The isolated tests do not replace production acceptance or the staff-device pilot. Service remains deferred; no new business feature or architecture expansion was added.

## Rejected connector payload retry safety — 30 September 2026

- Continued from `9ae2935` on `feature/keyboard-order-entry`. Reproduced repeated HTTP 400 uploads of identical data with the real upload function and a mocked network boundary before fixing it.
- HTTP 400/413 now retain the local snapshot and persist a validated SHA256 rejection marker. Identical payloads are paused across restart; changed data remains eligible. The loop uses a precomputed pause flag rather than hashing every poll. Network failures, 429 and 5xx remain retryable; upload-key rejection stays separately credential-scoped. Successful upload clears the payload marker. Legacy receipts remain readable; status exposes no hash, key or business payload.
- Targeted recovery, control-status and sales-window suites passed in PowerShell 7. Regression coverage includes repeated rejection, durable restart state, changed payload recovery, 413, transient 429/500, receipt privacy and invalid-marker validation. `git diff --check` passed. No full application suite/build was rerun for this connector-only ticket.
- Recovery and control-status suites also passed on Windows PowerShell 5.1 using process-only execution-policy bypass (the machine's default policy blocked script launch; no persistent policy was changed).
- No deployment, Tally access or production mutation. Rollout and authenticated acceptance remain outstanding; this fix does not establish pilot readiness or measured live cloud-resource improvement.

## Five-update sync release-safety batch — 30 September 2026

- Started clean at `fd0e318` on `feature/keyboard-order-entry`; kept the five updates in one batch. A smaller-model worker handled only the independent package-script change. No production access, Tally read/write, push, merge or deployment.
- **Receipt recovery:** injected a local disk failure after cloud acceptance. The upload function previously retained rejection flags and advanced its in-memory acknowledgement before persistence. It now clears obsolete rejection flags, persists a new receipt atomically, advances acknowledgement only after success, and remains retryable if disk persistence fails. Regression also verifies subsequent recovery.
- **Company boundary:** the new sync handler previously accepted any company into the single `suprabha` snapshot row. It now requires the exact Suprabha company scope before database access, allowing the case/whitespace normalization already used by the office connector. No database constraints, import triggers or transaction boundaries changed.
- **Source freshness:** the handler no longer fabricates an extraction timestamp for a missing source time. It rejects missing/blank or invalid supplied ISO times, including impossible calendar dates, and stores ISO extraction time when supplied. Valid legacy display-only timestamps remain supported; upload time stays a separate `updated_at` value.
- **Error privacy:** Stock API reads no longer forward raw upstream JSON/text errors or malformed successful bodies to operational users. Non-success responses use a controlled message while retaining upstream status; invalid success bodies become 502. Valid response projection, commercial-field sanitization, authorization and in-flight read coalescing remain intact.
- **Continuous regression checks:** normal `test:connector` now includes the status/privacy suite; normal lint includes the repository-controlled sync handler. No new dependency or lockfile change.
- Files: `desktop-connector/dashboard.ps1`, `desktop-connector/README.md`, `lib/stock-handler.ts`, `supabase/functions/stockflow-sync/handler.ts`, `package.json`, `tests/connector-recovery.ps1`, `tests/unit/stock-handler.test.ts`, `tests/unit/stockflow-sync-handler.test.ts`, and this checkpoint.
- Fresh validation: 52 focused Stock/sync unit tests passed; all three connector suites passed through `pnpm test:connector`; recovery and control-status also passed on Windows PowerShell 5.1 with process-only execution-policy bypass. Typecheck, lint, 16 desktop/mobile Stock freshness/cache E2E cases and `git diff --check` passed. Regression failures were demonstrated before their fixes. No full application build, full test suite or database replay was rerun for this scoped batch; those remain release-checkpoint work.
- Largest remaining items, in dependency order: refresh the remote/local release mapping and stage the sync function plus queued customer-group gross-margin/catalog-version migrations; authenticated sync and pricing acceptance against that candidate; before/after cloud CPU/latency/payload and office billing-impact measurements; then actual staff-device offline/account-isolation acceptance and the five-working-day pilot. Restore-tested backup protection is still required before genuine business-data use; the earlier waiver covered disposable testing records only. No pilot-ready claim, paid infrastructure or Service expansion.

## Consolidation and private catalog staging — 30 September 2026

- Started clean at `0797310` on `feature/keyboard-order-entry`. Fresh fetch showed 0 behind / 18 ahead of `origin/main` before this checkpoint commit. No public deployment, push or merge. A smaller-model worker inspected existing release evidence; primary retained migration, security and integration decisions.
- Refreshed migration evidence: production has 84 migrations; all 83 previously mapped normalized hashes match. Customer-group gross margin is already deployed as `20260928113956`, matching local SQL exactly. Only `20260929180000_catalog_source_version.sql` remains pending in production. Updated the saved mapping and preflight assertions; do not reapply gross margin. Corrected diagnostic SQL whitespace normalization before comparison; no migration drift found.
- Fixed a demonstrated customer-search race: a delayed blur from a previous selection could close newly reopened suggestions. Cancel the old timer on refocus and clean it up on unmount. A deterministic desktop/mobile regression failed before the fix and passed afterward; customer-scoped history behavior remains intact.
- Updated the connector source assertion to require both authentication and payload rejection pause guards, matching the existing tested implementation.
- Final `pnpm run ci` passed: lint, typecheck, three PowerShell connector suites, 469 unit tests across 87 files, coverage gates (88.69% branches), production build, 24 access/Stock browser cases, 44 pricing/order-entry browser cases and production dependency audit (no known vulnerabilities). Fresh deployment-order PostgreSQL replay passed preservation, privilege, catalog compatibility, ACID, two-session concurrency and bulk rollback checks. `git diff --check` and evidence-only release preflight passed; preflight does not certify live release readiness.
- Applied the exact catalog migration only to existing private acceptance project `ayrvhemxzizpkfcycvip`, remote version `20260930090244`. Normalized hash matches local SQL: `2c8a3ce7a76fd89bafe06a7b7128536d33476f80ce17809b06cfb8e8c8d97e0b`. All three gateway definitions now use source catalog version with legacy fallback. Anonymous/authenticated execute remains denied; service-role execute remains restricted to public gateways, not the internal legacy gateway. The repository rollback-only SQL test passed against this candidate; member/order counts and snapshot/configuration fingerprints were unchanged afterward. Production business records and Tally were untouched.
- Read-only production baseline: project ACTIVE_HEALTHY; Site version 51/environment revision 4, Orders function 25, Sync function 4. At 08:54 UTC, extraction was 08:41:43.1196949Z and upload 08:41:44.321Z (about 13 minutes old). Snapshot JSON text measured 579,832 bytes versus 6,480 bytes for the core dashboard projection; these are SQL text sizes, not network compression, CPU or latency measurements. The bounded 08:00–09:00 UTC error query returned two PostgREST matches, insufficient to attribute cause or certify a full working day.
- Security advisors returned only INFO default-deny RLS/no-policy notices (36 production, 35 candidate); no broad grants or policies were added. See [Supabase advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). This does not replace authenticated acceptance or a complete security review.
- Files changed: `components/order-workspace.tsx`, `tests/pricing-browser/order-keyboard.spec.ts`, `supabase/migration-history-map.json`, `tests/unit/pricing-release-preflight.test.ts`, `tests/unit/stock-sync-health.test.ts`, and this checkpoint.
- Remaining release gates: verified matching Edge sync secrets and runtime candidate deployment; authenticated sync/pricing acceptance; production catalog migration rollout; measured CPU/p95 latency and office Tally impact; actual staff-device offline recovery/account isolation; five-working-day pilot; restore-tested backup before real business-data use. Sites returns redacted secret values, not evidence that they are absent or correctly matched; available Supabase tools do not expose Edge secret list/set operations. Do not deploy an unverified sync replacement. No paid services, reset credits, Service expansion or Tally writes used. Not yet pilot-ready.

### Seven-gate continuation — 30 September 2026

- Started clean at `befa5d7`. Fresh live checks now establish that the authenticated Edge Secrets dashboard has no custom secrets; secure owner configuration of matching read/upload keys is a concrete deployment blocker, not merely a redacted-tool limitation. The Windows user upload credential exists; its value was not displayed. Private candidate sign-in remains at browser security verification. No security bypass, credential change, public deployment or production business mutation was attempted.
- Latest production snapshot at 09:20:53 UTC was uploaded 09:11:59.823Z, extracted 09:11:58.7246899Z (579,832 JSON-text bytes). Sampled sessions: one active, five idle, one state unavailable. Available logs in the requested 29 September 10:00 UTC–30 September 10:00 UTC window show no `40001`/`42501` string matches and 27 timeout-related PostgREST error messages; their cause remains unresolved. This is not CPU/p95 or full-pilot evidence.
- Backup inspection found only a zero-byte archive; PostgreSQL tooling exists but the process has no database password. Archive verification and isolated restore remain blocked. Actual-device testing and five real working days of pilot observations cannot be replaced by fixtures or documentation.
- Recorded all seven gate statuses and next dependency in `docs/PRODUCTION-PILOT-2026-09.md`. Fresh evidence-only release preflight and `git diff --check` passed. No source change, full-suite rerun, paid service, reset credit, Service expansion or Tally access; prior full-suite results remain the preceding consolidation evidence, not newly executed tests.

### Secure sync cutover — 30 September 2026

- Owner saved both custom Edge secrets. Dashboard SHA-256 digests match the Windows user upload credential and the deployed legacy read constant; no secret values were printed, committed or rotated. The saved-name blocker is resolved.
- Fresh focused sync-handler suite: 32 tests passed. Current Supabase changelog and named-secret documentation were checked; no database upgrade, paid service or SDK redesign was performed.
- Deployed exact repository sources (`stockflow-sync/index.ts`, `stockflow-sync/handler.ts`, shared `stockflow-orders/request-gate.ts`) first as `stockflow-sync-candidate` version 1 in the existing production project. Custom-key authentication is retained with `verify_jwt=false`, as before. Candidate unauthenticated GET returned 401; authenticated malformed POST returned 400. Snapshot timestamp and SHA-256 fingerprint were unchanged before/after these probes.
- Replaced live `stockflow-sync`; returned deployment is ACTIVE version 7, bundle SHA-256 `d25d7989b55bbe0cfba982554969af9f49b27c384f18d98c9609a09f5d01385f`, identical to the candidate. Live invalid-upload/unauthenticated-read probes again returned 400/401. At 09:47:26 UTC (15:17 IST), snapshot remained the pre-cutover 09:42:17.934 UTC upload with source extraction 09:42:14.9546436Z and unchanged fingerprint. No valid synthetic upload or Tally request was made.
- Still required: observe a successful normal office upload after cutover and an authenticated projected dashboard read before claiming sync acceptance. Runtime rejection tests do not prove backend database success. Candidate endpoint remains deployed but idle; cleanup is outstanding. No app publication, production migration, order/pricing mutation, permission change or Tally write. Other release, device, pilot and backup gates remain open.

### Post-cutover office upload — 30 September 2026

- Read-only production check at 10:06:14 UTC (15:36 IST) confirms a normal upload at 09:57:23.716 UTC (15:27 IST), after the version-7 cutover, with extraction 09:57:22.7109449Z. No manual upload or Tally request was made. This confirms post-cutover snapshot persistence; it does not prove dashboard read acceptance or pricing acceptance.
- Opened production StockFlow and followed its sign-in link. Browser authentication remains at the OpenAI security-verification page; staff-login dashboard and pricing checks require the owner to finish that normal sign-in. No bypass, synthetic session or secret disclosure. Public application publication, pending catalog migration, performance percentiles, staff-device acceptance, five-working-day pilot and restore rehearsal remain unverified.
- No source changes or test-suite rerun in this read-only acceptance step. Updated this checkpoint and passed `git diff --check`.

### Signed-in production read acceptance — 30 September 2026

- Owner completed sign-in. The production Stock dashboard rendered current reorder rows and `Last Tally sync: 30 Sep, 03:42 PM` without a visible load/error banner. Combined with the observed post-cutover office upload, this confirms the normal signed-in stock read path; it does not separately measure projected response bytes or CPU.
- Production Pricing loaded its restricted overview and approval inbox (zero pending proposals). Base/default pricing displayed its governed form with approval disabled until inputs are supplied. No price, policy or business transaction was changed. Purchase-cost review was opened but no resolved product/customer evidence was inspected; full pricing mutation and two-role acceptance remain outstanding.
- Production Orders loaded its handoff queues, search/status controls, `+ Order` button and the empty awaiting-confirmation inbox. This is a read smoke check, not a timed p95 measurement or a full order lifecycle acceptance.
- Commercial release blocker remains visible: policy `bootstrap-review-only-v1` shows minimum gross margin 99.99%. Do not treat this bootstrap value as an approved operational margin or silently replace it with guessed customer/group values. The owner previously specified 25% for general items and variable reagent group/customer gross margins; the actual effective policy and scoped approvals still require governed verification/configuration before genuine use.
- No new code/tests, public app release, migration, order/pricing mutation, Tally operation or device/pilot/backup claim. Only this acceptance checkpoint changed; `git diff --check` passed.

### General gross-margin policy activation — 30 September 2026

- Through the signed-in production Pricing administration flow, activated `general-gross-margin-25-v1` effective `2026-09-30`, using the owner's approved 25% general-item gross-margin baseline. This is a default review guardrail, not a universal reagent margin or a bulk selling-price change. Existing customer/group-specific approvals retain their separate governed resolution; missing approvals still require review.
- Preserved existing controls: override approval threshold 0%, round-up increment ₹1, rounding version `ceil-rupee-v1`, target margin unset. Supplied a management reason recording the approved general baseline and preservation of reagent decisions/cost-increase review. No customer/product/group rates were invented or changed, and no Tally operation occurred.
- Application success was followed by an authoritative policy-list refresh showing 25%, the new policy version and unchanged approval/rounding controls. Expanded history shows both versions: bootstrap `2026-04-01` through `2026-09-29`, replacement from `2026-09-30`. No historical policy was overwritten or deleted. No blind retry or direct database write was used.
- This clears the bootstrap minimum-margin configuration blocker only. It does not establish each customer's reagent margins, full pricing acceptance, backup recovery, staff-device acceptance or pilot completion. Only this checkpoint changed in source control; no application source change, migration or publication.

### Stock recovery and populated group acceptance — 30 September 2026

- Private Site environment revision 2 deployed successfully using its existing saved version and unchanged audience (deployment appgdep_6abd04cd72b08191990ade4623d3c6b5). Its read key matched the isolated sync endpoint. Credentials were transferred from Windows-protected local input without printing values or placing them in source. No production key was copied.
- Signed-in Stock revealed a malformed synthetic fixture: payload had stock/catalog but no rows/groups. Repaired only that private fixture, preserving catalog, invoices and its original extraction timestamp. The browser now shows Acceptance Glucose Reagent, one reorder item and five quantity; the old-source warning remains truthful. This verifies reads, not an office connector upload.
- Added dashboard-only collection/item validation in lib/stock-handler.ts. Missing/null/wrong-shaped collections return the existing controlled 502 rather than crashing or inventing zero inventory. Genuine empty arrays remain valid; legacy full-view behavior, sanitization, authorization and coalescing remain unchanged. Seven regression cases failed before the patch and pass after it.
- Fixture update exposed a customer-import null-check defect: absent customers bypassed the old <> array guard and soft-deactivated existing customers. CLI-generated migration 20260930125943_preserve_customers_on_partial_snapshot.sql now returns before processing missing/null/non-array/empty evidence. Existing complete-list upserts, balance updates, soft deactivation and revokes remain unchanged. The rollback-only database regression failed before the migration and passed afterward. Applied only to the private project (remote 20260930130138), restored the synthetic Acceptance Laboratory, and registered this migration as NOT deployed in production release evidence.
- Added two clearly synthetic purchased items/cost histories in the existing private customer. Authenticated group preview and approval at 40% gross margin succeeded: separate immutable rates 100 and 170, cost evidence 60 and 100, shared request f12a7e50-40e2-469f-b811-8d893bb89fe0, actor Anil. Existing fixed rates 800/335 were unchanged; approved rows no longer eligible for routine book approval. Production and Tally untouched.
- Fresh validation: 61 targeted stock/sync tests; lint/typecheck; 478 full unit tests across 87 files; complete deployment-order migration replay with customer preservation, order preservation, pricing ACID, concurrency and bulk rollback; 44 pricing/order-entry browser fixture tests on desktop/mobile; production build; production dependency audit (no known vulnerabilities) all passed. Initial type narrowing, standalone DB fixture setup and unmapped migration evidence failures were corrected and rerun. Private security advisor returned INFO-only RLS-without-policy notices for intentionally gateway-only tables; no broad policies/grants were added.
- Remaining: deploy the new Stock API validation source to the private candidate; authenticated second-account acceptance; verify actual private upload path (read configured, upload not exercised); review/apply pending production catalog and customer-preservation migrations only at authorized release; staff-device/performance/pilot and restore rehearsal. Not merged, not publicly released and not pilot-ready. Five-hour usage last checked 16% used; stop ceiling remains 60% used, not a target to consume.

### Private Stock endpoint prerequisites — 30 September 2026

- Applied the existing snapshot_pricing_import_privilege migration only to isolated project ayrvhemxzizpkfcycvip; the migration tool returned success. This preserves the qualified security-definer import trigger and removes direct execution grants rather than granting private evidence tables to service_role.
- Deployed existing repository stockflow-sync index, handler and request-gate dependency to that private project: ACTIVE version 1, bundle hash aaa1c5ac82a7dfd755f02b0c356bce43cd116cf7bedb0bbf5044cedcd4af9018. Custom read/upload header authentication is retained; JWT verification is disabled only because the handler enforces that existing custom boundary before database access.
- Fresh targeted sync handler tests passed 32 tests (exit 0). An unauthenticated live private endpoint probe returned 503 with the controlled not-configured error, as expected while its read/upload secrets remain absent. This does not prove authenticated Stock reads or upload/import success.
- Separate private read/upload key configuration, matching private Site read key, synthetic snapshot population and populated group-price acceptance remain incomplete. No production or Tally changes, no copied production credentials, no public release, and no pilot-ready claim.

### Private gateway and group-preview repair — 30 September 2026

- Owner created candidate API Secret key `stockflowedge`; verified name on project `ayrvhemxzizpkfcycvip` without revealing its value. Queried only the existing database gateway verifier, not its credential. It differs from the production default.
- Current Orders function now accepts optional server-only `STOCKFLOW_ORDER_GATEWAY_SHA256`, retaining the existing production verifier when unset. Malformed or empty configured hashes fail closed. Saved the private database-verified hash in candidate Edge settings; no credential rotation, production credential copy or broad permission grant.
- Deployed repository Orders sources to candidate only: ACTIVE version 5, bundle `d2e69b86d6fa5841490184191c8a8c3537f51c248bb320e1828ab36208878557`. Custom-key authentication (`verify_jwt=false`) remains, with pre-database verification, bounded request reader and request gate. Named backend key now works through authenticated Pricing/customer reads.
- Private history was missing two migrations. Applied existing, previously replay-tested conflict handling and group-margin SQL only to candidate: `20260930120822` and `20260930120824`, normalized hashes `2c41e1974355526524b06deb873243e729bc95fe7add3351b309131ec6226347` and `e07bf146a9a884dc27c78c47aba196c0af0669eded04046d0f8580162bd1b625`, matching repository. Production already has these; no production migration.
- Authenticated 40% synthetic group preview now returns a valid zero-eligible preview instead of a gateway/idempotency error; approval remains disabled. This verifies the repaired read path only, not populated staff approval. No lasting synthetic price decision submitted.
- Nine focused request-gate tests, affected-file lint and typecheck passed. Ran repository rollback-only `customer_group_gross_margin_integrity.sql` directly on private database successfully, exercising per-item rates, role restrictions, stale preview, idempotency and injected failure rollback. No full suite/build rerun. Stock endpoint/secrets/synthetic snapshot, populated browser approval, other-role acceptance and remaining release/pilot gates remain open. Production and Tally untouched.

### Refreshed candidate five-check acceptance — 30 September 2026

- Confirmed candidate version 4 deployment succeeded at `2026-09-30T11:50:26.104352+00:00`, runtime environment revision 1, URL `https://suprabha-pricing-acceptance.anil-mahindrakar22.chatgpt.site`. This supersedes the preceding building-status checkpoint. No public deployment or main merge.
- Existing administrator session opened the refreshed candidate. Stock now reports controlled service-unavailable rather than the former wrong-project unauthorized result; private backend has no sync endpoint. This remains a failed Stock acceptance gate, not a successful sync check.
- Restricted Pricing overview and customer search/book loaded; synthetic policy remains 20%, fixed rows remain protected. New customer/group gross-margin UI is now present on deployed source. An explicitly read-only 40% synthetic preview produced `Order service request failed`; no approval or price mutation occurred.
- Inspected private Orders version 2 source without printing credentials. It lacks both `preview_customer_group_margin` and `approve_customer_group_margin`, and uses the legacy service-role environment rather than current named `stockflowedge` integration. Current repository gateway authentication also has an approved credential verifier. Blind replacement could reject candidate clients or fail backend credentials; no unverified deployment, hard-coded-key patch or authentication weakening was performed.
- Five checks covered deployment completion, authenticated Stock, Pricing/customer book, group-preview behavior and gateway compatibility. Concrete remaining setup: separately verified candidate read/upload secrets plus named backend secret, candidate gateway credential/verifier alignment, then deploy repository-controlled sync/Orders and seed synthetic Stock evidence. Available Sites reads redact secrets; they cannot prove matching values. Production credentials, real data and Tally remain untouched.
- No new source fix or automated suite run; local typecheck/21 Stock tests/lint/build evidence is in the prior batch. Only this checkpoint changed, with whitespace validation before commit. Latest-source integrated acceptance is not passed and release remains held.

### Six-task candidate preparation batch — 30 September 2026

- Started clean at `ce58e57`. Reused private Site and its clean `stockflow-acceptance` checkout; retained custom audience and candidate-specific hosting manifest. Integrated current implementation through merge `7c41ba83b6f71641a4f8d0c2af35f8d566e3e2e8`, without merging main or changing public StockFlow.
- Completed candidate source integration, frozen-lockfile dependency installation, typecheck, 21 Stock handler regression tests, affected-file lint/whitespace checks and a fresh production-format build. No complete CI rerun; prior full consolidation evidence is separate.
- Publishing preparation exposed Windows launch incompatibility for `.cmd` commands, corrected by invoking the existing package-manager Node entrypoint. Local build then passed; bundled packaging could not start Bash because it is unavailable. Did not alter plugin scripts or bypass archive checks. The supported source-only remote-build fallback saved candidate version 4 after the workflow pushed the exact source.
- Candidate version ID `appgprj_6aae9b06bf4081919a1f08183fb02465~appgver_2c53841e550081918c8a7eea95213915`; deployment `appgdep_6abcf6d33d14819189e3f88c4d0e8005`. Last checked status building, not successful. Do not claim version 4 live until a terminal status confirms it. Runtime environment revision needs confirmation in the successful result.
- Private backend function inventory contains only Orders version 2, no `stockflow-sync`. Therefore configured-endpoint source fix is necessary but insufficient for candidate Stock acceptance. A separately credentialed candidate sync endpoint/synthetic snapshot and current Orders action compatibility must be established before integrated acceptance. No production credentials/data were copied, no broad grants or authentication bypass, no Tally or production mutation.
- Authenticated latest-candidate checks cannot proceed until deployment completes and backend prerequisites are resolved. Six requested release tasks are not all closed: local preparation is complete, publication is pending and backend setup remains blocked. Current source fix and all previous pricing controls retained.

### Candidate Stock backend isolation fix — 30 September 2026

- Demonstrated source defect: Stock route hard-coded the production sync URL while candidate runtime `SUPABASE_URL` points to the isolated acceptance project. Orders/Pricing already use that configuration. Candidate's private read credential was therefore sent to the wrong project, consistent with its unauthorized Stock response.
- Stock now resolves its server-only configured backend per request, with no hard-coded production fallback. Missing configuration fails closed after existing authentication/membership checks. In-flight coalescing is scoped to resolved endpoint/view and credential, preventing sharing across backend changes. Sanitization, deadlines and private response headers remain intact.
- Added configured-backend/missing-configuration regression. Stock handler suite passed 21 tests; typecheck and affected-file lint passed. Initial typecheck caught an incorrectly inferred zero-argument test mock; corrected its fetch type and reran successfully. No database migration, credential rotation, production/Tally operation or new architecture.
- Source fix is not yet deployed to the private candidate. Candidate backend sync availability/credential match and signed-in Stock read still require verification after release preparation. Latest-source candidate publication and remaining pricing acceptance remain open; not pilot-ready.

### Five candidate acceptance checks — 30 September 2026

- Starting HEAD `e2cd264`, clean working tree. Used existing private acceptance Site, not a replacement. Checked deployment identity/access, administrator sign-in, Stock read, customer price book and base-price workspace as one batch. No business mutation, Tally operation or publication.
- Native Sites metadata: production remains ACTIVE version 51; private acceptance ACTIVE version 3, saved source `20346f6896013d0e43251eccf4cc632e71090522`. Custom access retains Anil as owner and Nikitesh as external viewer. The candidate is an older saved source: successful checks here do not certify current local source or the latest customer/group UI.
- Completed normal ChatGPT sign-in as `anil.mahindrakar22@gmail.com` using its existing account and approved consent. Restricted Pricing loaded, including synthetic `acceptance-v1` policy (20% minimum). This candidate policy is intentionally separate from production's approved 25% general baseline; no policy was changed.
- Candidate Stock displays `Unauthorized. Connect once to save the first offline snapshot.` This is a demonstrated candidate acceptance failure, not evidence that production Stock failed. Diagnose candidate runtime credential/backend wiring before certifying integrated acceptance; do not copy production credentials blindly or loosen access checks.
- Customer search resolved synthetic Acceptance Laboratory. Its price-book table displayed two purchased items with separate historical/current/recommended rates, GP%, review buttons, exception filter and page controls. Both rows are fixed/protected; summary reports zero eligible items and bulk approval remains disabled. This verifies rendering and protected-row behavior only, not eligible bulk mutation, multiple pages, cost-increase handling or second-role authorization.
- Base/default workspace rendered product selection, price/date/reason fields, unavailable evidence labels and a disabled approval button before valid inputs. No synthetic price was submitted. Remaining acceptance needs refreshed candidate source, candidate Stock wiring, eligible synthetic mutation/recovery cases and Accounts/noncommercial-role checks. Local fixture tests from the earlier batch are not substitutes.
- Checkpoint only; no suite/build rerun. `git diff --check` before commit. Candidate authentication blocker is cleared for Anil, but release/pilot readiness remains false.

### Bounded timeout investigation — 30 September 2026

- Read-only log investigation for 09:30–10:30 UTC. Discovered actual flattened attribute names before aggregating: `request.method`, `request.path`/`request.pathname`, `response.status_code`, `execution_time_ms`. Initial unqualified status/method aggregation returned empty fields; no result was interpreted as a successful request without correcting that query. No request headers, credentials, query strings or customer data were retrieved.
- Returned function logs: 20 Orders POST requests, all HTTP 200, maximum execution 2,490 ms; four normal sync uploads, all HTTP 200, maximum 5,453 ms; three sync reads, all HTTP 200, maximum 1,312 ms. Live/candidate sync each also recorded one 400 POST and one 401 GET, consistent with the deliberate rejection probes in the preceding cutover. These counts describe returned logs, not guaranteed exhaustive traffic, browser latency or p95.
- Returned REST logs for catalog, customer, order list/summary, pricing, users and snapshot reads/uploads all show HTTP 200. Eight PostgREST timeout-manager messages in the same window carry only infrastructure metadata, without request identifiers for attribution. Two PgBouncer timeout messages describe idle connection expiry. No demonstrable failed StockFlow request or application cause established; do not label the generic messages harmless or claim the issue fixed.
- No code/configuration changes, additional probes, database writes, Tally operations or test-suite rerun. Upload maximum remains a performance signal needing representative measurements; authenticated candidate acceptance and pending catalog release remain next dependencies. Checkpoint-only change; whitespace validation before commit.

### Five live release checks — 30 September 2026

- Started clean at `f5ada5e`. Checked live migration history, sync freshness, gateway permissions, timeout diagnostics and connection activity; no application or production changes.
- Live history still lists 84 migrations, ending with gross-margin migration `20260928113956`, hash `e07bf146a9a884dc27c78c47aba196c0af0669eded04046d0f8580162bd1b625`. Catalog-source migration remains absent. Retrieved current hashes; no new automated all-hash comparison or saved-map rewrite.
- At 10:35:19 UTC (16:05 IST), latest upload was 10:27:39.574 UTC and extraction 10:27:38.3842820Z. Snapshot JSON text is 579,832 bytes. Normal office uploads continue after cutover; this is not wire-size, latency or CPU evidence. Two diagnostic queries used incorrect schema names and were corrected against the repository; no writes occurred.
- Catalog/list/internal order gateways deny anon/authenticated execution. Service role can execute catalog/list, not the internal before-auto-pricing gateway. This verifies those grants, not complete pricing role acceptance.
- Logs from 29 September 10:30 UTC to 30 September 10:30 UTC contain 34 PostgREST timeout messages (Warp timeout-manager thread termination). Two separate PgBouncer messages describe idle server connection expiry, not demonstrated order failures. No `40001`/`42501` text matches in the returned window. Affected requests and timeout cause remain unknown; do not infer sustained CPU health or a recurrence of the former retry incident.
- Connection sample: one active connection (the diagnostic), five idle, one null state, no other active query at that instant. This is not sustained resource or p95 measurement.
- Fresh evidence-only preflight exited 0, correctly reporting `releaseReady=false` with catalog migration and authenticated isolated-candidate acceptance pending. No full suite/build rerun, merge, publication, Tally operation or pricing mutation. Staff-device acceptance, measured performance, working-day pilot and restore rehearsal remain outstanding. `git diff --check` passed before commit.

### Three-check pricing validation batch — 30 September 2026

- Started clean at `5b9159a`. Completed three verification slices as one batch: customer/group gross-margin behavior, cost-increase exception behavior and release-preflight assessment. Used existing synthetic fixtures and isolated local PostgreSQL, not real customer margin approvals or live pricing mutations.
- Group checks passed in deployment-order replay: 40% gross margin with mixed product costs produces separate ₹100/₹170 rates rather than one shared group rate; fixed contracts and individual decisions are excluded. Accounts/Sales restrictions, stale preview rejection, idempotent recovery, effective dates, immutable decisions/audit, second-item failure rollback and stable approved rate behavior passed. Cost/evidence changes reopen review rather than silently altering the saved rate.
- Cost checks passed: unchanged comparable cost retains the last genuine customer rate when the margin guardrail passes; increases pause pricing, including fixed agreements, and are excluded from routine bulk approval. Governed administrator review, billing snapshot safety and rollback/concurrency remain covered by the repository database tests.
- Fresh commands/results: focused Vitest (`customer-first-pricing-correction`, `governed-order-pricing`, `pricing-engine`, `pricing-api-auth`) passed 37 tests; `pnpm test:pricing:deployment` exited 0, including complete migration replay, snapshot-import privileges, catalog compatibility, byte-identical order preservation, ACID and two-session/bulk rollback checks; price-book Playwright file passed 30 desktop/mobile fixture cases covering customer/base/impact save recovery, policy/contract retry safety, account-isolated receipts, authorization, bulk preview and hash-bound group approval. `git diff --check` passed. No source changes, full CI/build rerun or new defect demonstrated.
- Evidence-only release preflight executed successfully but correctly reports `releaseReady=false` and production catalog-source migration pending in the saved map. Fresh database replay does not refresh live migration history or complete authenticated isolated-candidate acceptance. Actual staff devices, performance/resource measurements, timeout investigation, five-working-day pilot and restore-tested backup are still release/real-use gaps. No merge, public app publication, new migration, Tally operation, paid service or reset credit.
### Pricing authorization-loss fix — 1 October 2026

- Resumed after allowance reset; revised stop boundary is 50% five-hour remaining. Completed the paused ticket without expanding scope.
- Pricing workspace and customer price book now clear loaded commercial state, discard in-memory pending commercial commands, and unmount pricing forms on any pricing HTTP 401/403 (read, mutation, preview or recovery). Late successful reads cannot restore denied state; opaque account-scoped recovery receipts are preserved. Server permissions and transaction controls are unchanged.
- Corrected the refresh promise construction so both reads have rejection handling immediately; denied refresh no longer creates an unhandled rejection. Stable callbacks/dependencies and declaration ordering pass the affected lint checks.
- Fresh final validation: price-book Playwright file passed 38 desktop/mobile cases (including eight new authorization-loss cases); typecheck and affected oxlint passed, as did whitespace validation. Initial regression run had a duplicate-text locator error, corrected without changing product behavior. No full build/suite rerun for this bounded frontend defect.
- Changed files: `components/pricing-workspace.tsx`, `components/customer-price-book.tsx`, `tests/pricing-browser/price-book.spec.ts`, and this checkpoint. Not deployed, merged or pilot-certified. Next release dependency: private candidate rollout and authenticated restricted-role retest; production migration/release and staff-device/pilot checks remain pending.

### Usage-boundary pause — 1 October 2026

- Five-hour usage is 91% used (9% remaining), below the approved 15% remaining stop boundary. Stopped implementation; no reset credit, deployment or commit of incomplete code.
- Uncommitted changes in `components/pricing-workspace.tsx` and `components/customer-price-book.tsx` clear/unmount restricted pricing after HTTP 401/403 and block late responses from restoring root pricing state. Recovery receipts remain preserved. These changes are not release-validated.
- Latest typecheck passed; affected lint failed because the customer price-book effect needs its new stable `read` callback in the dependency array. Next: add that dependency, guard late child read/preview responses, add authorization-loss browser regressions, run affected tests/type/lint, review and commit the completed ticket.
- No production, private deployment, database membership or Tally changes in this paused turn. Private acceptance retest remains pending after the completed fix is deployed.
### GitHub reconciliation security gate — 3 October 2026

- Follow-up: `braces@3.0.4` is explicitly unavailable from npm; latest micromatch 4.0.8 still requires braces ^3.0.3, and latest vinext 1.0.1 retains the same commonjs/dynamic-import dependency path. No speculative runtime upgrade, library substitution or audit exclusion applied.
- Added desktop/mobile browser coverage for stale extraction → fresh refresh (warning text cleared and hidden) → stale extraction (warning restored). Corrected two existing test-only fetch mocks to use Request.url instead of generic object stringification. Fresh affected Playwright file: 18 passed; typecheck, test-file oxlint and diff checking passed. This is local fixture evidence, not live connector or staff-device acceptance. Production code and deployments unchanged.

- PR #36 reconciles the already published sync timing and stale-warning fixes. Head tested: `d46f322c332866cb40a5c847769e802666280350`; main remains `6deb65b5db4c642bad0b5559f1176866fb098a2c`. No merge or new deployment performed.
- Fresh local targeted validation passed 93 tests, affected lint, typecheck and diff checking. GitHub CI passed 532 unit tests, production build, 34 general E2E cases, 86 pricing E2E cases, migration/ACID replay and CodeQL.
- The quality gate failed solely at production dependency audit: `GHSA-vfj7-8cjw-p6xm`, transitive `braces@3.0.3` via shadcn/vinext. Local `pnpm security:audit` reproduced the failure. `pnpm view braces version` still returns 3.0.3; GitHub advisory lists no published patch although audit metadata suggests >=3.0.4. Do not pin a nonexistent version or suppress the security gate. Dependency remediation and fresh green CI are required before merge.
- Hosted uncertain-save recovery, actual staff-device checks, representative performance evidence and operational pilot remain incomplete. Tally and production data were not changed.
### Gated staff password login implementation — 3 October 2026

- Added Supabase email/password login, verified server-side identity, secure HttpOnly/Secure/SameSite=Strict host-only access-token cookie, sign-out and restricted-account switching. Existing Sites authentication remains the default. Alternative mode ignores Sites identity headers; existing membership gateway still enforces roles and active status. No database migration, production configuration or Tally change.
- Added administrator recovery requests under Users and a staff recovery page. The administrator requests an email; the staff member chooses their own password (minimum 12 characters). Provider errors and uncertain password-update/session-revocation outcomes are surfaced without revealing credentials. Reset email is disabled until delivery is verified. Authentication provider logs cover recovery requests; no new business audit mutation was added.
- Direct-host prerequisites: free Cloudflare account/deployment and measured free-tier suitability; `STOCKFLOW_AUTH_MODE=supabase`, exact HTTPS `STOCKFLOW_STAFF_ORIGIN`, `STOCKFLOW_AUTH_PUBLISHABLE_KEY`, existing server gateway configuration; approved Supabase Auth accounts provisioned separately from OMS membership; public signup disabled; recovery redirect allowlisted; verified free SMTP delivery before `STOCKFLOW_AUTH_EMAIL_RESET_ENABLED=true`. Do not enable this mode on the current Sites deployment as an OAuth workaround.
- Sessions deliberately have no stored refresh token and expire within one hour. Sign-out clears this browser cookie, not all provider sessions. Reset requests global refresh-session revocation, but copied access tokens can remain valid until provider expiry. Provider/network calls are not one atomic database transaction. Live abuse throttling, email delivery, actual Android sign-in and hosted recovery acceptance remain deployment gates; no claim of live availability or Android repair.
- Dependency pinned: `@supabase/supabase-js@2.117.2`. New routes/pages/helpers/components and focused authorization/reset tests; existing shared identity, root page, frame and user management extended without changing transaction/pricing controls.
- Local validation: full CI lint/typecheck, connector fixtures, 590 unit tests and production build passed. Focused authentication/reset/API authorization tests passed (37). Extra affected component lint and whitespace checks passed. General browser regressions passed 36 cases; pricing browser regressions passed 86 cases. These preserve existing behavior, not live staff-auth/SMTP/device acceptance. Final lint/typecheck and production build passed after account-switch fixes. Mitigation-aware dependency audit passed with 21 patch tests; upstream braces advisory remains open, review expires 17 October.
