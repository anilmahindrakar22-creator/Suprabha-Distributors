# StockFlow UI/UX review and polish plan

Owner of this file: Claude Code, "instrument eco development" session. Prepared 11 October 2026 after the owner asked: "Look for other UI/UX issues as well. Make it a polished professional app with best practices and design philosophy."

Method: every screen in the UI test harness was captured at phone width (Pixel 7, 412 px) and laptop width (1366 px) with realistic synthetic data (`work/ux-orders/audit/`, ignored). The harness has no live APIs, so some error states below came from missing data. They still show what staff would see when a request fails.

## Design philosophy (applies to every screen)

1. **The work comes first.** The first item of work (an order, a request or an instrument) should appear in the top third of a phone screen. Headings, explanations and summary numbers must not push it down.
2. **One look, one language.** Use the same page header, background (`#f7f6f1`), card style, button sizes and status colours on every screen. Stage colours: confirm blue, pack purple, bill amber, dispatch teal, done green. Red is used only for problems.
3. **Say what to do next.** Each item shows one primary next action. Rarer controls sit behind "Filters" or "More".
4. **Plain language.** Staff never see technical errors such as `Unexpected token '<' â€¦ is not valid JSON`. Say what happened and what to do.
5. **Phone-ready.** Tap targets are at least 44 px. There is no sideways scrolling from 320 px upward. Dates and times show in IST in a readable form, never as raw ISO text.
6. **Simple first, complex later.** Admin-only and advanced tools stay in an Advanced area, as already done for Instrument Economics.

## Done in this change (Orders, Requests)

| Issue | Fix |
| --- | --- |
| First order 626 px down; about 285 px per order; about 3 orders per phone screen | Pinned compact header with search, stage chips and Filters. Grouped rows of about 60 px, so about 9â€“10 orders fit per phone screen. |
| Product requests and Customer demand above the Orders list | Moved to their own **Requests** navigation entry |
| 25-option status menu as the main filter | Stage chips (Active, Confirm, Pack, Bill, Dispatch, Issues) with counts. The full menu stays inside Filters. |
| Urgent or overdue orders lost among others | **Needs action** group first, then Today, Yesterday, Earlier |
| Delivered orders | Shown only on the day they are delivered, under "Delivered today". Pending orders stay until delivered or cancelled. |
| Up to eight badges per order | At most one problem flag per row, with short labels such as "Urgent", "Overdue", "Back-order" and "Stalled" |
| Order details opened inline and made the list longer | On phones, tapping an order opens a full-screen order page with back, stage, a five-step progress bar and the next action. On web, the selected pane shows the progress bar. |
| Raw ISO timestamp "2026-10-10T19:34:35Z" | "Tally stock updated 1:04 am" |
| Emoji bell, text chevrons | Consistent line icons |
| Raw JSON parse errors in Orders | Plain message: "StockFlow returned an unexpected page. Check your connection, sign in again if asked, then retry." |

## Work notifications: done in this change (owner direction, 11 Oct 2026)

Owner: "people with roles have to understand when the work is getting assigned to them for action at the earliest"; "when work progresses from pack to billing, accounts will receive it, and when accounts does their work it should go to dispatch"; "Will only bell UI work? Relook the design philosophy."

A bell alone is not enough, because people have to remember to open it. New work now reaches people where they already are:

| Hand-off | Who is told | Message |
| --- | --- | --- |
| New order | Administrator, Management, Sales (confirmers) | New order to confirm |
| Confirmed | Warehouse, Operations | Ready to pick & pack |
| Packed â†’ sent to billing | **Accounts** | Packed Â· ready for Tally billing |
| Billed in Tally | **Operations (dispatch)** | Billed Â· ready for dispatch |
| Assigned to a person | That person | Assigned to you |

Signals, in order of reach:
1. **Arrival banner** on any screen (bottom on phones, top-right on web): customer, order number, what to do and an **Open** button that goes to that exact order. It stays until opened or dismissed, never blocks work and has no sound.
2. **Count badge on the Orders tab** (top navigation on web, bottom bar on phones).
3. **Browser tab title** `(2) StockFlow`, for staff working in another tab.
4. **"New" tags** on those orders in the Orders list. Orders already opens on each role's own queue.
5. **The bell**, the place to review: New for you, Assigned to you, Your queues (with "+N new") and Also needs attention. New markers clear when the bell is closed.

How it works: a single foreground check per signed-in session, once a minute while StockFlow is visible and online. It starts 4 s after load so it does not slow the first Stock screen. It makes one request at a time, uses a 15 s timeout, backs off after failures and stops after sign-in loss. Each minute it reads only the small summary. It re-reads the assignee and queue lists, which are heavier, when a count moves (every stage change moves one), or every 5 minutes, so a reassignment between two people can take up to 5 minutes. Orders you moved or created yourself are never announced back to you. It uses only existing access-checked endpoints (no server, database or Tally change). Work already waiting at sign-in shows as waiting, not as new. Seen order IDs are kept in memory only. Opening an order from a notification searches by its number through the normal list and matches its ID. If the person cannot see it, a plain message says so.

Limits (to be covered by Codex's event feed in `docs/ORDER-NOTIFICATIONS.md`):
- Nothing reaches someone whose app is closed. When they return, the work is waiting in their queue, but it is not flagged as new.
- A role queue is read from its first page (20 orders). An arrival beyond that page shows in the queue count but not as a named new order.
- Reaching people with the app closed needs phone push (Web Push through the existing service worker; free, but each person must allow notifications) or WhatsApp/SMS. That is an owner decision.

## Remaining issues, by priority (not yet changed)

### P1: affects every user, daily
1. **Raw technical errors on other screens.** Pricing, Users, Instruments, Economics, Service, Requests and Offline preparation still show `Unexpected token '<' â€¦ not valid JSON` when the server returns a page instead of data. There are 24 `response.json()` call sites across 11 components. Fix: one shared `readJsonResponse` helper with the plain-language message, adopted everywhere.
2. **Phone navigation is cut off.** Admins see up to seven tabs (Stock, Orders, Requests, Pricing, Economics, Service, Users, plus Offline) in a sideways-scrolling strip, and "Economics" is clipped at 412 px. Fix: a bottom tab bar on phones (Stock, Orders, Requests, More) with the rest under **More**, and count badges on Orders and Requests. Desktop is unchanged.
3. **Summary cards push work down on phones.** Pricing shows three full-width KPI cards (about 600 px) before the Price book. Instruments shows a 2Ã—2 grid of large cards that read "â€”" while loading. Fix: one compact horizontal summary strip, like the Orders stage chips, and loading skeletons instead of dashes.

### P2: consistency and polish
4. **Five different page-header styles.** Examples: an "eyebrow + giant title + paragraph" block on Pricing, Users and Instruments; "Back to workspace" links on Instruments. The headings are 40â€“48 px on phones. Fix: one shared `PageHeader` (title of 20â€“24 px, an optional one-line description hidden on phones, actions on the right).
5. **Background and border colours vary** between `#f7f6f1`, `#f3f6f5` and white. Fix: shared colour tokens.
6. **The Users role picker** wraps checkboxes with large gaps. Fix: a two-column checkbox grid with role descriptions.
7. **The order page on phones** repeats the order number and customer, now removed. The next-step button is not yet pinned to the bottom of the screen; that is Orders phase 2.

### P3: Orders phases 2â€“3 (already approved)
8. Order page: pinned next-step bar, and sections or tabs for Items, Delivery, Billing, Notes and History.
9. Web: a dense list table (Order, Customer, Status, Age, Owner) with a one-line top bar.

## Done in the polish round (11 Oct 2026)
- **P1-1 plain-language errors:** shared `lib/http-json.ts` across all screens.
- **P1-2 phone navigation:** bottom bar (Stock, Orders, Requests, More) with an Orders count badge.
- **P1-3 summary cards:** compact `SummaryStrip` (Pricing) and compact Instruments tiles. One row on phones, loading placeholders instead of "â€”".
- **P2-4 page headers:** shared `PageHeader` on Pricing, Instruments, Instrument economics, Equipment & service and Users. Title 20â€“24 px; label and description shown from tablet width.
- **P2-6 Users role picker:** a grid of tappable role chips (checked chips are highlighted).
- **Orders phase 2:** next-step button pinned on the phone order page.
- **Notifications:** role-to-role work bell, arrival banner, Orders badge, tab title; phone push client side (dormant until the backend exists); customer name on the lock screen.

- **P2-5 colour tokens (12 Oct 2026):** about 1,400 raw hex classes replaced with 36 semantic `sf-*` tokens in `app/globals.css` by a deterministic codemod. Near-duplicates merged; light grey text darkened for contrast.

- **Orders phase 3 (12 Oct 2026, desktop):** a one-line top bar and single-line 44 px queue rows show about 13 orders at 1366×768 (previously 9). The row shows a next action only when there is a real one. The order number appears in rows from 1536 px wide and always in the selected pane.

Still open: real-phone checks once the push backend exists.

## Proposed order of work
1. P1-1 shared error helper (small, low risk, every screen).
2. P1-2 phone bottom navigation (frame only; navigation tests updated).
3. Orders phase 2 (pinned next step).
4. P1-3 and P2 shared `PageHeader` / summary strip, screen by screen: Pricing, Instruments, Users, Service, Economics.

Each step will be claimed in the coordination log first, tested on phone and web, and handed to ChatGPT / Codex for integration. Claude does not deploy.
