> **Superseded (owner, 14 Oct 2026):** the Tally contacts mirror is dropped. Contacts are app-only (§3b). Sections 1–3 are kept for history only.

# Phase 4: customer contacts from Tally ledgers (D-07 source decision)

**Owner decision (14 Oct 2026):** "Names should come from Tally ledger." Tally is the **authority** for contact names. The app never creates or edits a contact name.
**Author:** Claude. **Utility:** reach the right person at an account, and (Phase 6) attach Power Map annotations to real, Tally-owned contacts.

## 1. Source contract (connector: integration chat)
Add to the customer-ledger fetch in `desktop-connector/dashboard.ps1` (`DashboardCustomerLedgers`):
- `LedgerContact` (the contact person);
- `Email`;
- `ContactDetails.List` (TallyPrime multiple contacts: name and phone), if your Tally version has it.

Each `customers[i]` gains:
```json
"contacts": [ { "name": "Dr. R. Patil", "phone": "98xxxxxxx", "email": "lab@example.in", "source": "ledger_contact" }, … ]
```
- **Ledger contact:** the `LedgerContact` name with `LedgerMobile` (or `LedgerPhone`) and `Email`. Use source `ledger_contact`.
- **Contact list entries:** each `ContactDetails.List` entry, with source `contact_details`.
- **No contacts field** (older connector) means "unknown". The server keeps what it has.
- **An empty array** means "Tally has no contacts". The server clears that customer's Tally contacts, and **only** on a complete customer-list snapshot (the existing partial-snapshot rule).

## 2. Server (Claude, via Codex, on a branch)
- **Table:** `private.stockflow_customer_contacts`
  - Columns: customer, ordinal, name, phone, email, source, `source_seen_at`. Unique `(customer_id, ordinal)`.
  - RLS on; not readable by clients.
  - Replaced per customer from the snapshot by a **separate** trigger that runs after the existing customer sync; it doesn't patch that sync.
- **Read:** `get_accounts` adds `contacts: [{name, phone, email}]` (up to 5) per account.

## 3. Screen
- Each Accounts card gets a "Contacts" line: the first contact's name with a tap-to-call link.
- "+N more" expands the rest.
- It's read-only, labelled "from Tally".
- No app-side edit or add. The hint reads "Update contacts in Tally".

## 3b. App-added contacts (owner, 14 Oct 2026: "Contacts can be added to an account")
- **Who:** administrators, management, sales and operations (the same roles that log visits) can add a contact to an account.
- **Fields:** name (required), business role (optional, for example "Lab head", "Purchase", "Pathologist"), phone, email.
- **Stored in** `private.stockflow_account_contacts`, separate from the Tally mirror. Shown under the Tally contacts with the label "added by {name}".
- **Editing:** the person who added a contact, or management, can edit or remove it.
  - Removal is a soft "remove": hidden, with history kept.
  - Edits are versioned (`expectedVersion`, PT409) and audited.
- **No duplicates:** the same phone already on the account (Tally or app) → warning, still allowed.
- **Tally contacts stay read-only.** If an app contact should be permanent, staff add it in Tally; the hint says so.

## 4. Personal-data rules (recommended defaults; owner may change)
- Store only what Tally holds: name, phone, email.
- Visible to the roles that can read Accounts.
- No personal notes.
- Removing a contact in Tally removes it here on the next complete sync.
- Power Map annotations (Phase 6) are separate, app-owned records linked to these contacts, under ADR-0018.
