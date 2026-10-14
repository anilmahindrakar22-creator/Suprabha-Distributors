# Phase 4: person-confirmed customer–Tally links (design)

This implements the integration decision `docs/CUSTOMER-TALLY-LINK-CONFIRMATION-DECISION-20261015.md` (directive item 3).

**Utility:** an account can only get an A/B class, and economics can only attribute sales to it, once its Tally ledger is linked. Today most customers have no link. This screen lets management confirm many exact matches in a few taps, with a person accountable for each batch.

## 0. What exists today (read-only map, 15 Oct 2026)
- **Customer master:** `private.stockflow_customers` (`tally_key` unique, name, …). There is **no GUID column**.
- **Verified link:** `private.stockflow_economic_customer_identities(company_id, source_id, customer_id, verified_by, recorded_at)`.
  - Primary key `(company_id, source_id)`, plus `unique(company_id, customer_id)`.
  - `source_id` is the **Tally ledger GUID**: the connector sets `customerSourceId = $ledgers[PARTYLEDGERNAME].guid`.
  - The only writers are the `create_target` and historical-registration inserts (`on conflict do nothing`).
  - **There is no change or correction path.**
- **Ledger masters (name ↔ GUID):** the connector builds them, in `desktop-connector/economics.ps1`, including an ambiguity check ("Ambiguous … master identity"). **It doesn't upload them**, and no table stores them.
- A/B classes treat "linked" as "an identity row exists" (`20261014120000_account_classes.sql:42`).

## 1. Dependency on the integration owner: the connector uploads the ledger master
In `economicEvidence`, add `customerLedgers: [{ guid, name }]`. Build it from the same `$ledgers` index the export already uses, filtered to Sundry Debtors when the parent is available, for the same `companyId` and the export's `sourceVersion`. Ledgers without a GUID are skipped, and the existing ambiguity throw stays.

**This is a connector change, so it's the integration owner's area.** Until it ships, the screen shows "Waiting for the Tally ledger list" and offers nothing to confirm.

## 2. Server (Claude builds; the integration chat reviews identity, financial joins and concurrency)
1. **`private.stockflow_economic_ledger_masters`**
   - Columns: `company_id`, `source_version`, `guid`, `name`, `observed_at`, `imported_at`.
   - `unique(company_id, source_version, guid)` and `unique(company_id, source_version, name)`.
   - Append-only, with RLS and grants revoked.
   - It's filled by the existing economic import trigger in the same transaction as that export's coverage row. A stale observation (older than the latest for that company) is rejected, as the item catalogue already does.
2. **Current generation:** per company, the latest `source_version` by `observed_at`. Suggestions use **only** this generation; there is no mixing across exports or companies.
3. **Read `get_link_suggestions {companyId?, search, page}`**: Management or Administrator; 25 per page; server-side search on customer name or ledger name.

   **Row states:**

   | State | Meaning | Selectable |
   | --- | --- | --- |
   | `suggested` | The active customer's `tally_key` equals exactly one ledger `name` in the current generation (exact, case-sensitive), and neither the customer nor that GUID has an identity in this company | yes |
   | `linked` | An identity already exists with this GUID for this customer | no |
   | `conflict` | The GUID is linked to another customer, or the customer is linked to another GUID | no; shows who it's linked to |
   | `no_match` | No exact ledger name | no (listed only when searched) |

   Each row returns: customer id, name and city; ledger name; GUID; company; state; and the generation's `sourceVersion` and `observedAt`.
4. **Command `confirm_customer_links {companyId, sourceVersion, rows:[{customerId, ledgerGuid}] (1–50, distinct), reason (3–300), idempotencyKey}`**
   - It lives in the **economics gateway**, which owns the identity table. Writes are Administrator or Management (current role check), under that gateway's existing advisory lock.
   - It takes `begin/finish_stockflow_command`. An identical replay returns the stored result; the same key with different content → PT409.
   - **Steps, all or nothing:**
     1. `sourceVersion` must still be the current generation, else PT409 "The Tally ledger list changed. Reload and review."
     2. Process the rows in customer `id` order (no customer row locks; see Locking below).
     3. Re-check every row under the advisory lock: the customer is active; the ledger with this GUID exists in that generation, and its name equals the customer's `tally_key`; there is no identity for the customer or the GUID in this company.

        Any failure → PT409 "{customer name}: no longer an exact unlinked match. Reload." The whole batch rolls back, with no partial write.
     4. Insert the identities (`verified_by` = actor).
     5. Append one row per link to the new append-only `private.stockflow_customer_identity_events`: `company_id`, `source_id`, `customer_id`, action `confirmed`, actor, reason, `source_version`, `ledger_name_at_confirmation`, `request_id`, `recorded_at`.
   - **Result:** `{ok, confirmed: n, customerIds}`.
   - "Expected binding version": the identity table has no version, so the expected state is **unbound on both sides**, re-checked under the lock (step 3).
   - **Locking (no deadlock):** **don't** lock customer rows. The snapshot upload's customer-sync trigger updates them, so locking them would deadlock the command against an upload (40P01). Instead:
     - identity writes are serialized by the economics advisory lock and the two unique constraints;
     - `active` and `tally_key` are re-read under that lock;
     - the identity FK takes only a KEY SHARE lock, which is compatible with the sync's non-key updates.

     Two-session test: a confirm running concurrently with a snapshot upload, modelled on `product_master_refresh_lock.sql`.
   - **Matching rule:** the connector stores `tallyKey` as the ledger NAME, trimmed (`dashboard.ps1:216-224`). Compare `tally_key = btrim(ledger name)`, exact and case-sensitive.
5. **Financial effect (for the integration owner's review):**
   - Economics targets reference identities through a foreign key `(company_id, customer_source_id, customer_id)`, and the rebuild attributes sales via the targets' `customer_source_id`. So **a new identity changes no published or approved economics and doesn't need a rebuild**. The 54000 rebuild cap isn't touched.
   - The identity's only current reader is A/B classes (`account_classes.sql:42-53`), which stay off behind the full-sales seam.
   - **Future effect:** confirmed identities let `create_target` and historical registration use these customers.
6. **Existing writer gap, proposed for the integration owner's decision:**
   - `create_target` inserts an identity `on conflict (company_id, source_id) do nothing` **without checking** that the existing row names the same customer. Only historical registration has that guard.
   - Once links are common, two failures become reachable:
     - a target for the same GUID with another customer silently keeps the other mapping;
     - the same customer with a different GUID raises a raw 23505.
   - Package A proposes the same fail-closed guard as historical registration (22023, "Canonical customer identity conflicts with existing verification") as an anchored patch of `create_target`. It needs the integration owner's approval, because it is their identity authority.
7. **Later name changes:** the identity is keyed by GUID, so a renamed Tally ledger keeps its link. The event row keeps the confirmed name as provenance.
8. **Not included:**
   - Corrections or unlinking. No governed change path exists today; it needs its own design and decision. A wrong confirmation is fixed by the integration owner through a reviewed migration until then.
   - Fuzzy or cross-company matching, and automatic confirmation.
   - Any re-import, coverage relabelling or class activation. Classes stay behind the full-sales seam.

## 3. Screen
Accounts → **Link to Tally** (Management and Administrator only; it's a page under More, beside Accounts).
- **Header:** "Tally ledger list from {observedAt}, {company}". Search box. Filter: Suggested (default) · Linked · Conflicts.
- **Each row is a card:**
  - a checkbox (only for `suggested`);
  - **customer name** · city;
  - "Tally: {ledger name}";
  - a muted short GUID (last 8 characters);
  - the state chip.

  Conflicts show "Linked to {other customer}" and no checkbox.
- **Nothing is preselected.** "Select all on this page" selects the visible suggested rows only, and its label says so.
- **Sticky bottom bar** when anything is selected: "{n} selected", a required **Reason** field (placeholder "e.g. Checked against Tally ledger list"), and the **Confirm {n} links** primary button.
- **Results:**
  - success → "{n} linked", and the list reloads;
  - PT409 → a blocking notice naming the customer, then a reload. Selections that are still suggested stay selected; the others drop off, with a visible note "2 rows changed and were removed from your selection".
- **Phone first:** cards and 44 px targets; no table.

## 4. Acceptance (from the decision)
- Two exact matches confirmed together once; replay → no duplicate events.
- Duplicate name or GUID, a fuzzy name, cross-company, stale generation, export changed or conflicting rows → the whole batch fails, with no partial write.
- Sales and viewer writes → 42501.
- A later ledger rename keeps the GUID link and the confirmed-name provenance.

## 5. Order of work
1. Integration owner: the connector `customerLedgers` change (§1).
2. Claude: package A (table, import, read, command, SQL tests including two-session concurrency), then package B (screen and browser tests).
3. Integration owner: review of identity, financial joins and concurrency, then release.

**Release gate:** production has no canonical Economics source tables yet (integration note, 15 Oct 2026). The identity table and the economic import trigger arrive with the **Economics cutover**. So, like the instrument register, this screen **releases only after the Economics cutover**. Acceptance can host it earlier.

Packages A and B can be built and tested with fixture ledger masters before the connector change ships.
