# Design: "Sales falling" signal (Recover)

*Claude, 30 Oct 2026. Status: **DESIGN. Build when certified sales cover at least 9 months.** Owner direction: decisions that bring revenue. This is the highest-value design not built yet (see the chat ranking on 30 Oct).*

## 1. Decision it drives
"Which existing customers are quietly buying less from us, and by how much per month?"

Catching a fall in month 2 is cheap: a visit or a price check. Catching it in month 8 usually means the lab has moved to a competitor.

The output is a card in Today's **Grow** lane: `Recover · Care Lab · ₹35k/mo less`, with the button **Open Recover**. The button opens a `recover` opportunity on that lab, which then flows into the existing diagnosis → action → outcome loop.

## 2. Rule (policy `recover-v1`, versioned and stored like the wallet policy)
For each lab (customer, via its confirmed Tally links):
- **Baseline:** the median monthly net sales over the 6 certified months before the recent window. The median resists one-off big orders.
- **Recent:** the mean monthly net sales over the last 3 complete, certified months.
- **Drop:** `baseline − recent`.
- A lab **signals** when all of these hold:
  - the baseline is at least ₹20,000/month, so small labs don't create noise;
  - the drop is at least 30% of the baseline;
  - the drop is at least ₹10,000/month;
  - all 9 months are certified for every company linked to the lab;
  - the lab has no open `defend` or `recover` opportunity.

All five thresholds sit in the policy row and can change without a migration, with a new version.

**Fail closed:** if any of the 9 months isn't certified, there's no signal for that lab, never a guess. Today shows "Recover signals need 9 certified months" until the data exists.

## 3. Data and authority
- **Sales:** the same certified source and the same net-sales definition the wallet read uses (`private.stockflow_wallet_read`: certified coverage per company-month, linked customers, `net_sales_paise`). The new read reuses that definition; it doesn't re-derive one.
- **Opportunity:** ADR-0008 already reserves an origin for system suggestions. This adds `origin = 'defend_signal'`, plus the `policyVersion` that produced it, recorded in the opening reason. Under ADR change control, widening the origin check is a recorded ADR amendment.
- **Person decides:** a signal is a suggestion. Nothing opens automatically; **Open Recover** is a person's action, with the usual idempotency and audit.
- **Visibility:** administrator and management only, like the rest of Grow.

## 4. Screen
- **Today, Grow lane:** the card type `recover`.
  - Icon: `TrendingDown`, in the danger tone.
  - Title: `Recover · <lab>`.
  - Subtitle: `₹1.2L → ₹85k a month`, baseline to recent.
  - Value: the drop per month (`valueKind: 'lost'`).
  - Ranking: the same as other Grow items, by ₹ known.
- **Lab sheet:** one small line beside the share bar, `Sales down 30% vs last 6 months` with a down-arrow icon. The line appears only while the signal is active, so there's nothing when there's no problem (the declutter rule).
- **No charts.** The owner wants small, at-a-glance visuals. A sparkline is optional later, if the owner asks.

## 5. Checks (write these first)
SQL on a real database, with dates relative to today and 9 certified fixture months:
- **R1:** a 35% and ₹15k drop signals, and the value equals the drop.
- **R2:** a 25% drop doesn't signal. A ₹8k drop on a ₹20k baseline doesn't signal.
- **R3:** one uncertified month among the 9 → no signal.
- **R4:** an open `recover` opportunity suppresses the signal. Closing it brings the signal back.
- **R5:** median baseline: one huge month doesn't hide a real fall.
- **R6:** **Open Recover** creates exactly one opportunity with `origin = 'defend_signal'` and the policy version. An idempotent replay creates no duplicate.
- **R7:** sales and operations get `PT403`, and no response contains cost or margin.

Browser: the Today `recover` card at 375 and 1280, Open Recover, and the uncertified line.

## 6. When to build
- After the 8 Nov release deploys, the integration chat certifies Tally coverage month by month.
- Build once 9 certified months exist. If certification goes back to earlier months, that may be soon after the first certified window.
- Estimated as 2 Codex packages (SQL plus Today wiring), about 1 day including review.
