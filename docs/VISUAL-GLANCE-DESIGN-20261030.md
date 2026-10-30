# Design: at-a-glance visuals (owner direction, 30 Oct 2026)

*Claude (design owner). Train `claude/train-20261113` onward.*

**Owner:** "I prefer visual more… Design goal is to bring information at a glance, not read… to achieve our goal of 50 cr."

## 1. Principles
1. **Glance first.** Each card answers one question with one visual (a number, a bar, a ring or an icon), plus at most one short word. Detail stays behind a tap, as the declutter rule already requires.
2. **Colour means one thing everywhere.** Use only existing tokens:
   - **success** (`sf-success`): on track or done;
   - **warning** (`sf-warning`): waiting or due soon;
   - **danger** (`sf-danger`): stuck, overdue or ended;
   - **info** (`sf-info`): neutral information;
   - **stages:** the existing `sf-stage-confirm`, `sf-stage-pack` and `sf-stage-bill`.

   Never use colour for decoration, and never use colour alone. Every coloured mark has an icon or a word.
3. **One icon vocabulary** (lucide-react, already used). One concept, one icon, app-wide (§3).
4. **Unknown stays visibly unknown.** A bar with no data is an empty, dashed outline labelled "Awaiting Tally", never a zero bar. This is the fail-closed rule, applied to visuals.
5. **Accessible.** Icons are `aria-hidden`, and the word next to them carries the meaning. Bars expose `role="meter"` (or `img` with `aria-label`) with the value in words. Text sizes stay as they are, and nothing is smaller than 12px.
6. **Phone first.** Everything works at 375px with no horizontal scroll, and tap targets are at least 44px.
7. **Type size.** Numbers inside chips and cards are 15–16px; only one hero figure per screen may be larger, at 20px at most. Labels are 12px; icons are 26–32px circles.
8. **Don't add visuals to screens that already work at a glance; operational lists (Orders) stay as they are.**

## 2. Shared primitives (`components/ui/glance.tsx`)
| Component | Props | Look |
| --- | --- | --- |
| `ToneIcon` | `icon`, `tone`, `size` 'sm'\|'md' | the icon in a soft tinted circle (tone-soft background, tone foreground) |
| `MeterBar` | `value` 0–1 or null, `target?` 0–1, `tone`, `label` | an 8px rounded track with a fill in the tone, an optional 2px target tick, and a dashed empty track when the value is null |
| `CountdownBar` | `daysLeft`, `horizonDays`, `label` | fill = elapsed share of the horizon. Warning when 0 < daysLeft ≤ horizon; danger when daysLeft < 0 (full bar); success when there's plenty of time |
| `StatusChip` | `icon`, `tone`, `children`, `count?` | a pill: icon, word and an optional count |
| `StageStrip` | `stages: {key, icon, label, count, tone}[]` | equal columns, each with a ToneIcon, the count (large) and the label (small). It wraps into 2 rows below 360px |

Tones resolve to the existing `sf-*` tokens; add soft variants only where they're missing. The primitives are pure presentational components with no data fetching, and each has unit tests (tone mapping, the null state, aria text).

## 3. Icon vocabulary (lucide)
- **Order stages:**
  - confirm `ClipboardCheck`;
  - waiting for stock `PackageSearch`;
  - pick/pack `Package`;
  - bill `ReceiptText`;
  - dispatch `Truck`;
  - delivered `CircleCheck`;
  - stuck `TriangleAlert`.
- **Commercial:**
  - lab `FlaskConical`;
  - wallet `Wallet`;
  - gap `TrendingDown`;
  - on target `Target`;
  - lock-in `Lock`;
  - tender `FileBadge`;
  - open question `CircleHelp`;
  - decider `Crown`;
  - contact `User`;
  - influence `ArrowRight`.
- **Constraint reasons:**
  - price `IndianRupee`;
  - portfolio `LayoutGrid`;
  - instrument `Microscope`;
  - service `Wrench`;
  - relationship `Handshake`;
  - credit `CreditCard`;
  - availability `PackageX`;
  - clinical `Stethoscope`;
  - contract/tender `FileBadge`;
  - competitor lock-in `Lock`;
  - unknown `CircleHelp`.
- **Action types:**
  - visit `Footprints`;
  - demo `Presentation`;
  - get competitor proof `FileSearch`;
  - add product `PackagePlus`;
  - fix service `Wrench`;
  - fix supply `Truck`;
  - instrument proposal `Microscope`;
  - credit terms `CreditCard`;
  - price review `IndianRupee`;
  - no action `CircleSlash`.
- **Purchasing:** PO `ClipboardList`; Tally receipt `ReceiptText`.

## 4. Screen rollout (each is its own package and browser-checked)
- **V1:** the primitives and the icon map (`lib/glance-icons.ts`), with unit tests.
- **V2, Orders:** Withdrawn 30 Oct: the owner prefers the existing Orders list.
- **V3, Wallet:**
  - each lab row gets a `MeterBar` (share with the 80% target tick; a dashed track when uncertified) and a gap figure in danger;
  - the current constraint shows as an icon chip;
  - the Focus band card gets one big number plus a bar.
- **V4, Deadlines, Actions due and My actions:**
  - deadline rows: a `ToneIcon` (lock, tender, question) plus a `CountdownBar` (120-day horizon for contracts, 14 for questions);
  - action rows: an action-type `ToneIcon`;
  - "Meet: A → B → Decider" as chips, with a crown on the decider.
- **V5, Today (decision screen):** see `docs/TODAY-DECISIONS-DESIGN-20261030.md`.
- **V6, Purchasing and Requirements:** stage icons, the Tally receipt chip with the `ReceiptText` icon, and shortage counts as chips.

Every package keeps all existing text that tests or screen readers rely on. Visuals are added beside the words; they don't replace them, unless this doc says a sentence becomes a bar.

## 5. The ₹50 cr goal (owner, 30 Oct)
₹50 cr is the **outcome the decisions drive, never a display**. The owner said: "The stockflow app should make it possible to bring 50 cr revenue by faster easier targeted decision making and not just track revenue. Decisions should bring revenue." No goal ring or revenue tracker is built. The visuals serve the next decision: the ₹ at stake and one tap to act.
