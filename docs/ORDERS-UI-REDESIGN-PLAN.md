# Orders screen redesign: plan for owner approval

Owner of this file: Claude Code, "instrument eco development" session (see the coordination log in `CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md`). Prepared 11 October 2026. **No code has been changed.** This plan waits for owner approval. Integration and deployment belong to ChatGPT / Codex.

Mockups: `docs/UI-PREVIEWS/orders-redesign-mobile.png` and `docs/UI-PREVIEWS/orders-redesign-desktop.png`.

## 1. The problem, measured

The current Orders screen was measured with 12 active orders (about one busy day) in the repo's UI test harness, using synthetic data.

| | Mobile (Pixel 7, 839 px tall) | Web (1366 × 768) |
| --- | --- | --- |
| Where the first order starts | 626 px down: 75% of the first screen is header and filters | 591 px down |
| Height of one order | about 285 px (card with up to 8 badges, an action and two disclosures) | list rows are fine, but the list pane starts below the fold |
| Orders visible per screen | about 3 | about 2 rows before scrolling |
| Page length for 12 orders | 4,058 px (about 5 screens) | inner panes scroll |

Causes:
1. **Two unrelated panels sit above Orders:** Product requests and Customer demand / requirements.
2. **The header stacks on mobile:** title, a full-width "+ Order" button, a horizontal queue strip, then search, a status dropdown, "My work" and "More filters".
3. **Each order is shown in full in the list:** number, stage, pricing, owner, delivery, follow-up and mismatch badges, phone, action button and invoice field, "More order controls" and "View order details".
4. **The status dropdown has 25 options**, many overlapping (for example "Active", "Needs attention", "Billing attention" and "Urgent").
5. **No grouping or ordering by urgency.** At 10+ orders a day, an urgent or overdue order is just one card among many.

## 2. Design principles

- **List first.** On mobile the first order appears within about 150 px of the top. Header and filters together are at most about 120 px and stay pinned.
- **One line of facts per order:** who, what stage, how old, and whether anything is wrong. Two lines, about 60 px per row, so 10–12 orders fit on one phone screen.
- **One colour per stage**, used everywhere: Confirm (blue), Pick & pack (purple), Bill in Tally (amber), Dispatch (teal), Delivered (green). Red is only for problems (urgent, overdue, billing mismatch, delivery exception). At most two badges per row; the rest live inside the order.
- **Problems float to the top.** A "Needs action" group (urgent, overdue, stalled or mismatched orders), then "Today", then earlier days.
- **Open an order to work on it.** Mobile: full-screen order page with a back arrow. Web: the existing side pane. Each shows a five-step progress bar and **one primary button for the next step**, pinned where the thumb or eye is. Everything else (items, delivery, billing and pricing, notes and follow-up, assign/priority/edit/cancel, history) sits in short, collapsed sections or tabs.
- **No change to order rules, roles, commands or data.** This is presentation only. Every existing action stays reachable.

## 3. Proposed layout

### Mobile (under 1024 px wide)
1. **Pinned top bar:** "Orders" title, search icon (opens the search field), bell with count, compact "+ Order".
2. **Pinned stage chips with counts:** Active · Confirm · Pack · Bill · Dispatch · Issues. These replace the queue strip and the common dropdown choices. "My work" and the rarer filters (dates, unassigned, follow-ups, back-orders, cancelled, history, export) move to a **Filters** sheet.
3. **Compact rows**, grouped under Needs action / Today / Yesterday / Earlier. Each row shows a coloured stage bar, customer, age, stage chip, at most one problem flag, and the order number with quantity. Tapping opens the order.
4. **Order page**, full screen:
   - header: customer, order number, age and a Call link;
   - progress bar and status pills;
   - the items list;
   - collapsed sections for Delivery, Billing & pricing, Notes & follow-up, More (assign, priority, edit, cancel) and History;
   - a pinned bottom bar with the next-step button (for example "Confirm order" or "Enter Tally invoice no.") and a "⋯" menu.

### Web (1024 px and wider)
1. **One-line top bar:** title, search field, stage chips, My work, bell and "+ Order". The separate filter card and queue strip disappear, which recovers about 300 px.
2. **Left: a dense list table** (Order, Customer, Status, Age, Owner), 44 px rows. About 15 rows show on a laptop and the full height is used. Problems come first; recently delivered orders show faded at the bottom. Arrow-key navigation is kept.
3. **Right: the selected order**, with a pinned header (customer, progress bar, next-step button, "⋯") and tabs for Summary, Items, Delivery, Billing, Notes and History, instead of one long column.

### Product requests and Customer demand
Move these two panels off the Orders page into their own navigation entry, "Requests", with a count badge. Alternatively, collapse them into one line at the bottom of the page. Recommendation: their own entry.

## 4. Scale: 10+ orders a day

- The default "Active" view only shows undelivered orders: at 10 a day with 2–3 days in flight, about 20–30 rows, which is 2–3 phone screens and one laptop screen.
- Delivered and cancelled orders stay findable through search and the Filters sheet ("History"). Search continues to cover customer, order number, invoice, product and note.
- The page size grows from 25 to 50, with a "Load more" button instead of numbered pages on mobile.
- Counts on the chips and the bell come from the existing operations summary, so nothing new is queried.

## 5. Delivery in phases (each phase separately testable and shippable)

1. **Mobile list:** pinned compact header, stage chips, Filters sheet, compact grouped rows, and moving Requests out. Biggest gain; no change to order actions.
2. **Order page/pane:** progress bar, pinned next-step button, collapsed sections on mobile and tabs on web. Reuses the existing panels (pricing, fulfilment, dispatch, edit, exceptions, installation, notes, history) unchanged inside the sections.
3. **Web list table** with a one-line top bar.

Each phase needs:
- updates to the existing browser tests (`order-entry-layout`, `order-keyboard`, `order-opening`, `responsive-usability`, `button-feedback`, `offline-*`);
- new checks: first order within 150 px on mobile, at least 10 rows per phone screen, the next-step button visible without scrolling, no sideways scroll at 320–1366 px, and keyboard navigation on web;
- lint, typecheck, unit tests and the staff build;
- handover to ChatGPT / Codex for integration and deployment.

Main file: `components/order-workspace.tsx` (1,704 lines). It would be split into smaller pieces (list row, order page/pane, filters sheet) as part of the work. Its claim would be recorded before editing.

## 6. Decisions for the owner

1. Approve this direction (mockups) or note changes.
2. Should Product requests and Customer demand get their own navigation entry (recommended), or collapse to a line at the bottom?
3. How long should delivered orders show faded at the bottom of "Active": 2 days (recommended), or not at all?
