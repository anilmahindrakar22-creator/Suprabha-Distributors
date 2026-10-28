# Instrument Economics change review — 10 October 2026

Compared current local code with the saved Claude handover. HEAD remains `6925c91`; most economics work is untracked/uncommitted, so there is no committed baseline for a complete post-handover source diff. Deployment and pilot numbers below are from the updated rollout record, not fresh hosted readback in this review.

## Changes since handover

- Five further migrations add readable voucher numbers, automatic purchase cost, cross-batch FIFO fallback, a one-year purchase candidate window, and ignoring sales mapped to no instrument when assessing unresolved attribution.
- Automatic costing prefers an exact batch capable of covering the whole sale, otherwise FIFO across batches. Current manual verifications take precedence; quantity is reserved per rebuild. Recorded owner policy accepts genuine zero-value supplier purchases as zero cost. Allocations are immutable per-run evidence.
- UI now has Instruments, To do, Set up and Advanced. Routine setup has three steps; leakage, reports and detailed actions moved under Advanced. Cards lead with investment/recovery and lifetime reagent sales/GP.
- An Items panel lists mapped groups/single items, supports adding/removing them and suggests items bought by this customer but counted for no instrument. Removals and re-additions preserve dated rules.
- Connector exports older purchases month by month, with 12-month purchase history and a shorter sales history.
- Rollout record reports an owner approval audit, acceptance deployments and further source imports. Its latest recorded pilot calculation costs all 28 reagent lines: GP/recovery ₹2,48,177.54 against ₹2,25,000 investment, balance ₹0 and surplus ₹23,177.54.
- Latest recorded acceptance Worker is `0c1029a5-7639-4134-a023-d80004a4ac6a`; its rollback is `40dc6d66-7137-47a0-8c08-147af3b0c8ad`. The date correction below is not included. Production promotion remains pending.

## Material finding: historical stock depletion is incomplete

**High impact; high confidence in the mechanism, but the pilot's monetary error is not established.** Older-month imports retain purchases and discard sales (`desktop-connector/economics.ps1:274`). Automatic candidates subtract current manual links and allocations from imported sales; omitted older sales cannot reserve stock. If 8 of a 10-pack lot were sold before the imported sales window, a subsequent 5-pack sale can still be costed against that lot although only 2 remain absent other movements.

FIFO and exact-batch availability can both be affected when omitted sales depleted those lots. The rollout record's statement that batch matches are unaffected is too broad. Passing no-reuse checks proves conservation within imported evidence, not complete historical inventory depletion. Import/reconcile relevant depletion or verified opening-stock evidence before certifying recovery; do not guess quantities or force a different purchase match.

The reported ₹2,48,177.54 recovery therefore remains a recorded calculation rather than proof of reconciled historical stock. Separate authenticated Accounts/Sales/Operations acceptance, packing-charge classification and unsupported purchase Debit Note treatment still require the candidate checklist. Sales-only access remains denied by financial API role checks; UI/document language about Sales seeing economics does not establish authorization.

## Owner instruction implemented locally: count from instrument sale date

New migration `supabase/migrations/20261011000000_instrument_reagent_sale_date.sql` derives a separate `salesFrom` from the current compatible linked Tally instrument invoice and uses an inclusive attribution boundary. It keeps physical installation dates and immutable history intact. Mapping effective dates, end dates and group membership rules remain respected. Placements without instrument billing retain their existing start date.

Revised invoice dates restate reagent GP/recovery through the existing ledger. A cancelled, invalid or unresolved linked invoice leaves sales start unavailable instead of substituting installation. Coverage uses the sales start, workspace exposes it, UI lifetime labels use it and simple group/item mapping defaults inherit it. Deliberately edited mapping dates remain supported.

Affected files:

- `lib/instrument-economics-types.ts`
- `components/instrument-economics-workspace.tsx`
- `components/instrument-economics-evidence-forms.tsx`
- New migration and `supabase/tests/instrument_economics_sale_date.sql`
- Unit/browser regressions, database replay runner, release-history map/checks

For MS Palya, billing and installation are both 23 July 2026, so the date-only correction should not alter its totals. The correction is **local only**: no hosted migration, Worker, Edge Function or connector activation occurred in this review. The production history map now lists 13 pending economics migrations; this is not a claim that all 13 are applied to acceptance.

## Fresh verification

- Existing automatic-cost work: 57 affected units, connector fixtures, lint/typecheck and full isolated deployment-order database replay passed.
- New UI and database regressions failed against the old placement-date behavior for the intended reason.
- Corrected implementation: 69 affected unit/release-preflight checks passed, plus six desktop/mobile browser checks for invoice-date labels, group/item defaults, explicit date edits and existing simple mapping flows. Lint, typecheck and staff build passed.
- Final complete database replay passed with the new date suite and existing integrity, item-group, automatic-cost and two-session concurrency suites. New checks cover pre-sale exclusion, same-day inclusion, invoice before installation, revised invoice after installation, cancellation, ledger reversal and private helper privileges.
- The existing local PostgreSQL cluster was stopping, so testing used a separate temporary loopback-only cluster and disposable database. Hosted and existing local business databases were unchanged.
- Release preflight rejected the new migration until its normalized hash/pending status/reviewed file list were added. The count fixture changed from 12 to 13; deployed history was not altered.

Full unit coverage and hosted acceptance were not rerun. Keep earlier recorded broad validation separate from these fresh focused checks. The rollout document changed during review; its latest recorded deployment explicitly excludes the concurrently edited local mapping forms. Verify current source and hosted versions before publishing.

## Later continuation: fixes deployed to acceptance

The earlier local-only state is superseded. Hosted migration `20261010171033` includes invoice-date counting and available-stock reservations for insufficiently covered sales; full cost/GP remains unavailable for those sales. SQL regression reproduced later stock reuse before the fix and passes after it. Workspace evidence names partial reservations explicitly.

The connector retains only relevant older item movements, with whole voucher identity preserved, across customers. Unrelated verified history is excluded; cancellations/unverified evidence and combined payload bounds remain explicit. This limits upload/storage; monthly Tally exports still read the same bounded periods. A guarded small pilot import added 16 verified vouchers, exposing earlier depletion. New run `631f4191-25e4-4ed6-b34f-030b1b33e4c4` has known GP/recovery ₹2,07,208.39, balance ₹17,791.61 and one LDL-C cost unavailable. Snapshot checksum is unchanged. Earlier full-recovery numbers are superseded, not certified.

The owner also reported unrelated item suggestions. Suggestions and the simple picker now use canonical current Tally parent-group relationships: SYS 480's parent is Diasys Diagnostic India Pvt Ltd. This removes Sysmex while retaining sibling Diasys items. Existing customer/company, unattributed-sale and sale-date conditions remain; selecting a suggestion still submits an explicit dated mapping.

Fresh checks passed: complete deployment-order SQL/integrity/concurrency replay; connector fixtures and bounds; 103 affected unit/preflight checks; eight desktop/mobile checks; lint, typecheck and staff build. Final acceptance Worker is `899f3e03-e5b8-48f2-afcd-c9546a0241b9`. Production and complete financial/separate-role acceptance remain pending. See the final rollout checkpoint for source counts, exceptions, rollback and staged connector details.

Signed-in hosted readback confirms MS Palya's corrected provisional figures and sale-date labels. The final Items panel retains Diasys Alpha-Amylase suggestions and excludes Sysmex from both suggestions and its related picker; no real mapping was submitted during verification.

## Later owner clarification: all-group search and compact source review

The related-only picker is superseded. Empty-query suggestions remain related; explicit search now covers all current same-company Tally items, including other groups, with related results first and explicit Add commands. Existing-instrument selling lines use a searchable combobox with exact source IDs and stale selection clearing. Import review retains a visible count and Accounts explanation while repeated technical rows are collapsed. No attribution, cost policy, ledger, role, schema or source data was changed for this UI work.

Fresh validation: 45 focused unit checks, eight search/date/read-only desktop/mobile checks passing across runs after correcting the reproduced stale picker filter, two collapsed-document desktop/mobile checks, lint, typecheck and staff build. Acceptance Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` is live; production and real financial/separate-role acceptance remain pending. Hosted read-only inspection already verified cross-group Sysmex results and exact SYS 240 billing by serial; no live command was submitted.
