# Acceptance role walkthrough — trains 1–3 (3 Nov 2026)

Precondition 1 of `RELEASE-PACKAGE-20261108.md`. About 30–45 minutes, phone first.

**Acceptance state, checked read-only by Claude on 3 Nov:**
- all 37 release migrations present, through `20261116170000_prospects_focus_first`;
- `stockflow-orders` v18, deployed 3 Nov 21:40 IST;
- the active economics run is unchanged (16 Oct), and there are 22 runs.

## Rules
- **Who signs in:** the owner, with the spare login (`nikitesh.am@gmail.com`, normally Accounts). The owner switches its role in a separate Administrator window (Users). Codex and Claude never handle credentials.
- **After each switch:** sign out and back in, or reload, so the new role is applied.
- **Stop rule:** if a role that must not see money sees ₹, a rate, cost, GP or a wallet amount, that is a **FAIL that stops the release**. Take a screenshot and tell Claude.
- **Other failures:** an error, a blank screen or a wrong button is a finding. Note it and carry on; Claude decides whether it blocks.
- **Test data only:** use `ROLE WALK Test Lab`. Don't cancel or change real orders.
- **When done or interrupted:** set the spare back to **Accounts** only.

Mark each line ✅ or ❌, with a note when ❌.

## 1. Administrator (your own login is fine)
| # | Check | Result |
|---|---|---|
| H1 | **Orders:** urgent and high orders are at the top; the Recent chip filters. | |
| H2 | **Requests → To order** lists items. "Lowest supplier" may be empty until the connector's first upload; that's expected. | |
| H3 | **Purchase orders:** open one or start a new one (don't send it), and see the supplier rates. | |
| H4 | **Today** opens with decisions, and there's no error. | |
| H5 | **Wallet** opens. The header says "not certified". **Quick entry** opens; enter one estimate for ROLE WALK Test Lab and save. | |
| H6 | **Customer map** shows pins; **Move pin** is offered. | |
| H7 | **Prospects:** pick a brand; it opens with no error, and no lab shows "Focus lab". | |
| H8 | **Instrument register** opens; **Economics** opens with figures. | |

## 2. Management
| # | Check | Result |
|---|---|---|
| B1 | Today, Wallet and Prospects open; amounts are visible. | |
| B2 | Customer map: **Move pin** is offered. | |
| B3 | Power map opens for a customer. | |

## 3. Sales
| # | Check | Result |
|---|---|---|
| A1 | Orders: create a test order for ROLE WALK Test Lab (draft is enough) at customer price only; there's no purchase rate or cost. | |
| A2 | Wallet / My actions: **no ₹ amounts**, only labs and actions. | |
| A3 | Customer map: pins show and **Move pin is not offered**; a GPS check-in can be recorded. | |
| A4 | Prospects: labs are listed with **no amounts**. | |

## 4. Accounts
| # | Check | Result |
|---|---|---|
| D1 | Navigation as on 28 Oct (Stock, Orders, Requests, Pricing, Economics); no Users or Service. | |
| D2 | Customer links: the conflicts list opens (it may be empty). | |

## 5. Billing
| # | Check | Result |
|---|---|---|
| E1 | The billing sheet for an existing test order shows its rate check; delivery on challan is offered where appropriate. Don't submit it. | |

## 6. Warehouse
| # | Check | Result |
|---|---|---|
| C1 | Stock and Orders open; packing works on a test order view; **no purchase rates**. | |

## 7. Operations (most important for the stop rule)
| # | Check | Result |
|---|---|---|
| F1 | Requests and To order: items and quantities only, **no ₹ and no supplier rate**. | |
| F2 | Purchase orders: if visible, **no rates or amounts**. | |
| F3 | Customer map and Prospects: **no ₹**; Move pin is not offered. | |
| F4 | Wallet, Economics and Today money tiles are **absent**. | |

## 8. Viewer
| # | Check | Result |
|---|---|---|
| G1 | Read-only: no create, edit or Move pin buttons, and no purchase rates. | |

## Finish
- [ ] Spare login set back to **Accounts** only.
- [ ] Tell Claude the results ("all ✅", or the ❌ lines with screenshots). Claude records them here and clears or holds the production window.
