# Colour and icon audit against `DESIGN-COLOR-AND-ICONS.md` (15 Oct 2026)

Claude design review. The inventory is from a read-only scan of `stockflow-classes` @ `claude/accounts-icons`; line numbers are approximate.

## Findings, by priority
| # | Screen | Finding | Rule broken | Fix |
| --- | --- | --- | --- | --- |
| 1 | Orders (`order-list.tsx:10-14`) | The **Bill** stage uses `sf-warning` (amber), so every order at the Bill stage looks like it needs attention | Amber = attention, never a category | New stage token `sf-stage-bill` (deep rose-violet `#8a3f8f`, soft `#f7ecf7`), distinct from the other stages and from danger. Stages stay a sequence: Confirm blue → Pack purple → Bill plum → Dispatch teal → Delivered green |
| 2 | Orders (`order-workspace.tsx` ~978-989) | Status chips have no icons: Urgent, High priority, Delivery overdue/today/soon, Follow-up, Billing mismatch, Pricing verified or approval required, Short by N | Colour is never the only signal | Add registry icons (§ new rows below) |
| 3 | Orders (~831, 1135, 1153, 1156) | Success shown as `text-sf-success` on `bg-sf-accent-soft` | One meaning per colour family | Success notices use the success family (`-soft`, `-line`, strong text) with `CircleCheck` |
| 4 | Economics (`instrument-economics-workspace.tsx` 39-41, 155, 169, 238-241, 259, 267, 296, 531-542, 812-839) | Raw Tailwind `emerald/amber/red/blue/slate` instead of tokens | Tokens only | Map emerald→success, amber→warning, red→danger, blue→info, slate→neutral grey. The meanings are already right |
| 5 | Service (`service-workspace.tsx:18`) | The "Open" request chip is amber | Open is a normal state, not attention | Open → neutral grey with `CircleDot`; Urgent stays red, High amber, Resolved green with `CircleCheck` |
| 6 | Frame (`stockflow-frame.tsx:318`) | Device notice bar in amber | OK (attention) | Add the `TriangleAlert` icon |
| 7 | Procurement (`procurement-requirements.tsx`) | Shortage in amber text only; "fully covered" in green text only | Never colour alone | Shortage → `PackageX` + amber; covered → `CircleCheck` + green |
| 8 | Requests (`requests-workspace.tsx`) | No status colour at all | — | Check on screen; apply status chips if requests have states |
| 9 | All | Local `BackIcon`, `BellIcon` and `ChevronDownIcon` duplicate lucide | One icon library | Replace with lucide `ArrowLeft`, `Bell`, `ChevronDown` when those files are next touched |

## New registry rows (to add to the standard)
| Concept | Icon | Concept | Icon |
| --- | --- | --- | --- |
| Urgent priority | `Flame` | High priority | `ArrowUp` |
| Delivery due/overdue | `Truck` | Follow-up | `PhoneCall` |
| Billing mismatch | `ReceiptText` | Pricing verified | `ShieldCheck` |
| Approval required | `ShieldAlert` | Short by N / shortage | `PackageX` |
| Assigned to | `UserCheck` | Possible repeat order | `Copy` |
| Order changed since editing | `RefreshCw` | Open (request) | `CircleDot` |

## Order of work
1. Accounts (in progress).
2. Orders: findings 1–3 (most-used screen).
3. Economics token swap (finding 4).
4. Service, frame and procurement (5–7).
5. Requests on-screen check (8); local icons (9) opportunistically.

Each step is UI only, with phone design review by Claude.
