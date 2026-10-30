# StockFlow release, Sunday 8 November 2026: "Market & Pilot"

*Draft by Claude, 30 Oct 2026. Final contents depend on the Friday 6 Nov gate; anything that doesn't pass moves to the next weekly release.*

## For the owner (one page)
**What's new:** a commercial layer that helps you decide **which labs to work on, why we aren't winning them, what to do next, and whether it worked**.

| You can now… | Where |
| --- | --- |
| Record each lab's monthly wallet (what it spends in total), quickly, for many labs at once | Accounts → Wallet → Quick entry |
| See the Focus band: the few labs holding most of the gap to the 80% wallet-share target | Accounts → Wallet |
| Record why we aren't winning a lab, with facts and a graded source; price reasons are flagged "not proven" until there's a document | the lab's sheet → Why we're not winning |
| Plan one next action per opportunity (who, what, by when) and see what's due or overdue | the lab's sheet; Wallet → Actions due |
| See who decides at a lab and the route to reach them | Accounts → contacts (Power Map) |
| See whether closed opportunities moved the lab's sales | the lab's sheet → Past opportunities |

**Before it shows real numbers:**
1. Confirm customer links: Accounts → Review links → "Select all on this page".
2. Enter wallet estimates (Quick entry).
3. Tally sales coverage must be **certified**. Until then, sales, share and gap figures stay **blank, never guessed**.

**Who sees what:**
- Wallet, diagnosis, Power Map and outcomes: **Administrator and Management only**.
- Sales and Operations see only **My actions**: the lab, the task, the due date, the reason type and whom to meet. Never wallet figures, evidence or prices.

**Also fixed:** a role change now reaches people who are already signed in. They see "Your access has changed. Reload to update."

## What's new, by role
**Administrator / Management**
- **Wallet:** estimates, Focus band, "Start diagnosis" on Focus labs with no opportunity yet, and Quick entry for many labs.
- **Why we're not winning:** pick the reason, fill in the facts (for Price: competitor, product, their price and ours) and say where it came from (document / told by someone at the lab / our view). The chips show only real problems; "All records" shows the rest.
- **Opportunities:** Capture, Defend or Recover, for the whole lab or one division. Close them as Won, Lost or Dropped with a reason.
- **Next action:** Plan next action → type, owner, due date and expected gain. Price review is allowed only when the price reason is proven.
- **Actions due:** everything due this week, with overdue items in red.
- **Power Map:** new roles (Champion, Technical evaluator, Coach) and alerts ("Influential person, stance unknown", "No influential supporter"). Influence links show "Route to decider: A → B → Decider".
- **Past opportunities:** the outcome, and sales per month before vs now (once certified).

**Sales / Operations**
- **My actions** (Accounts): your open actions only, with "Meet: A → B → Decider". **Mark done** asks for the visit outcome on a Visit and records the visit automatically. **Drop** asks for a short note.

**Everyone**
- After your role changes, you'll see a bar asking you to reload. Nothing is lost by tapping it.

## Known limits
- Sales are measured for the whole lab; Tally sales aren't split by division yet.
- No Power Map diagram yet (deliberately deferred until there's more data).
- Receivables aren't shown (not imported from Tally).

## For the integration chat (release owner)
- **Branch:** `claude/train-20261106`.
- **Migrations, in order:** `20261030130000_wallet_v2`, `20261031090000_wallet_diagnosis`, `20261031120000_wallet_actions`, `20261031130000_wallet_my_actions`, `20261031140000_power_map_enhancement`, `20261031150000_power_map_influence`. All are additive; one widens the Power Map role and alert checks.
- **Gate:** full replay (timestamp and deployment order), full pricing-browser suite, stock e2e, unit, `test:connector` (needs pwsh 7), and the phone walkthrough per role.
- **Deploy-day check:** run `supabase/scripts/pilot-verification.sql` (read-only; see `docs/PILOT-VERIFICATION.md`).
- **Evidence so far:** see the handover entries of 29–30 Oct.
