# Financial breakdown and Accounts review correction — 15 October 2026

Codex owns integration/deployment. Baseline RCde67ce5, acceptance Worker210e6769/history69/Orders14/Sync4. Owner asked to fix confusing recovery, two zero cards and unrelated Debit Notes in instrument tasks.

Read-only evidence: instrument cost₹6,25,000; billed₹4,00,000; net investment₹2,25,000; cumulative reagent sales₹4,52,669.52 and GP₹2,98,537.06 from35July/August lines. Total recovery₹6,98,537.06 includes instrument billing; surplus₹73,537.06. The two zero cards were September-only fields beside cumulative recovery, not missing cumulative data.

Changes: cumulative breakdown uses existing lifetime evidence, distinguishes recovered investment from total including billing, preserves separate monthly report and unknown/partial-cost/date states. Single-column phone metrics prevent currency splitting. All existing ledger calculations and dates remain unchanged. To do keeps instrument purchase-cost tasks; a clearly labelled Accounts review link opens global rejected documents separately, with a back action and existing read permissions. Four primary tabs unchanged; no extra editable fields or role grants.

No migration, gateway, connector filter, source/classification, coverage, role or production change. Unknown stock adjustments are retained in Accounts review, not silently discarded. Owner explicitly deferred the11-document Accounts review; financial signoff and remaining role/class/register/production gates remain held.

Evidence: financial phone regression fails before because₹4,52,669.52 is absent; focused40 units and10 desktop/mobile cases pass after changes. Initial6 browser failures were exact accessible-name mismatch from the review button's descriptive text; explicit accessible name corrected, same assertions pass. Includes contribution-vs-GP separation, unavailable lifetime, missing sale date, partial/all missing cost, real-value phone unbroken currency and Accounts read-only navigation. Full lint/typecheck pass from isolated scratch; fresh full release checks/CI/hosted promotion pending. Screenshot suites only in ignored archives;76 starting dirty files have byte backups.
