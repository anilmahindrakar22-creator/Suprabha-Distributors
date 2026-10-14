# Accounts series integration — 14 October 2026

Integrator: Codex. Owner directive: merge only `claude/accounts-release` at `7643746c345272a5210612de540593646ba0a506`, which contains current RC `7f67fca`. Supersedes separate Accounts branches; Tally contacts excluded. Acceptance-only release; register held until Economics cutover.

## Scope and primary review

Classes and advisory district pin check, app-only contacts, management-only Power Map and Who decides, Social Styles and administrator contact erasure. Four migrations in order: `20261014120000_account_classes.sql`, `20261014160000_account_contacts.sql`, `20261014180000_power_map.sql`, `20261014190000_social_styles.sql`. Exactly-once gateway anchors fail closed; gateway stays service-only, private tables have RLS and no client grants. Existing admission/authentication controls preserved; eight new actions route to Accounts. Parent/customer lock before contact lock; contact edit/remove expected-version checks and stored idempotent receipts retained. Style remains a business communication aid and is available only to Management/Administrator or the current account owner; Power Map omitted for other roles. An ordinary non-owner Sales session sees neither. Completeness seam stays false, so no class is published from partial Tally data.

Primary review corrected two approved-design gaps before any deployment: rating on another person's visit was accepted, and free-text style override reasons survived erasure. Regression SQL reproduced the visitor defect. The Social Styles migration now verifies the visitor, active same-account met contact and 30-day range; the UI only offers rating on that visitor's recent meeting. Erasure clears style reasons to a fixed placeholder while retaining immutable IDs/actor/time/style metadata; arbitrary history changes and deletes remain denied. Regression covers both; Edge execution tests cover all thirteen Accounts actions with existing key/body/admission checks.

No fifth migration, connector change, automatic customer link, full-sales activation, production mutation or register integration. New local migration hashes are recorded as pending production in `supabase/migration-history-map.json`; acceptance applied versions will be recorded separately.

## Checks and release evidence

Evidence candidate `work/accounts-series-release-20261014/` (ignored). Fresh UTC disposable replay in deployment order passes after the correction, including all four new suites and existing financial/role/summary/concurrency suites. Initial failing regression log retained. Unit/static/browser/build/exact-head CI and hosted promotion evidence pending at initial creation.

Six requested phone checks: Sales adds a test contact and logs a met visit; optional ratings prompt and one-of-three state for Management; Management sets decision role; non-owner Sales sees no Power Map/style/Who decides; Administrator erases only a disposable test contact; incomplete sales shows the note and no class. Automated phone fixtures and real SQL roles will be verified, with real hosted role availability explicitly recorded. No role impersonation, hosted business fixture creation or permanent contact erasure without concrete authorization/confirmation. Screenshots will show the final hosted read-only surface. Existing Accounts/Sales/Operations role sessions are still not available from prior acceptance, so code checks cannot be described as their live acceptance.

## Following directive items

After Accounts release: read-only monthly production sales/returns/credit counts, then reply to full-sales rebuild-cap proposal; decide on person-confirmed batch customer–Tally links; retain instrument register hold; reconcile and merge two docs-only branches. Record every outcome in both shared logs. Preserve all existing uncommitted work.
