# Tally diagnostic error — 15 October 2026

## Cause and impact

The owner screenshot reads `Error in TDL. Collection:release-company-before. Could not find description!`. That collection name occurs only in Codex's new private release-completion diagnostic (`work/release-completion-20261015/read-native-periods.ps1`), not in the installed scheduled connector. The diagnostic incorrectly passed its hyphenated filename label to `Get-TallyEconomicCollection` as a definition name. Tally opened a blocking error dialog, and HTTP requests subsequently timed out. The earlier claim that the export timeouts established Tally unavailability is withdrawn.

[Tally's definition naming rules](https://help.tallysolutions.com/definitions-attributes-and-modifiers-in-tdl/) prohibit special characters and numeral-leading definition names. The diagnostic also had date-leading monthly labels, which were never reached and needed the same correction. Requests were Export requests; this diagnostic did not send a voucher/ledger import or any accounting write. The modal disrupted the user's Tally screen. Dismissing it is required before further live verification.

## Correction

- `desktop-connector/economics.ps1`: shared generated collection builder now rejects names outside a letter followed by letters/digits. Validation happens before XML is returned to transport, so unsafe names fail locally without opening a Tally dialog. Existing `EconomicCompany`, `EconomicLedgers`, `EconomicProducts`, `EconomicGroups`, `EconomicVouchers` and numeric collection names remain valid.
- `tests/connector-economics.ps1`: rejects the exact failing name, numeral-leading, empty, underscore and XML-special-character inputs; verifies matching safe request/definition identity. No Tally process or network is used by these fixtures.
- Private diagnostic separates the filename label from a prefixed alphanumeric TDL name and requires explicit `-Execute`. It is not scheduled or running and has not been retried after this correction.

## Verification and next step

The new offline regression failed on the original builder (`collection-name-regression-before.log`), then the full economics connector fixture passed after the fix (`collection-name-regression-after.log`). All four full connector suites (`pnpm test:connector`) then passed. The task-path/hash inspection is saved in `installed-connector-readonly.json`; release commit/PR is recorded in the shared handover once available. Source/readiness evidence is private under `work/release-completion-20261015/`.

Read-only task inspection found that the scheduled office connector points to this repository's `desktop-connector/dashboard.ps1`, not a separate installed copy. Therefore the shared helper guard is now changed on that disk path; the already-running task has not been restarted, and no task/state/credential/policy configuration was changed. The helper contains no `release-company-before` diagnostic name. Do not describe repository edits as separate from the installed source path in future release records. The new staged release package must be refreshed to include this fix before any future activation. No production database/deployment or acceptance business mutation was made for this correction. Do not claim live Tally success from offline tests. Await owner confirmation that the normal Tally screen is usable; then send only one corrected company export and verify canonical company identity before considering further bulk reads. If another dialog occurs, stop and inspect it rather than retrying the bulk capture.
