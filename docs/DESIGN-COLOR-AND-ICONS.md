# StockFlow colour and icon standard

Owner direction (15 Oct 2026): "use icons where appropriate. Color and icons philosophy. Color should be intuitive psychological." Claude owns this standard and reviews every screen against it.

## 1. Colour means one thing, everywhere
People read colour before words, so each colour carries **one** meaning across the whole app. Never use a colour for decoration if it already has a meaning.

| Meaning | Token family | Psychology | Use for | Never use for |
| --- | --- | --- | --- | --- |
| **Act here** | `sf-brand` / `sf-ink-hover` (deep teal) | trust, calm authority | the **one** primary action per card or screen (Log visit, Save, Confirm) | status, decoration |
| **Good / done / safe** | `sf-success` (green) | go, healthy, complete | saved, approved, in stock, met recently, supporter | primary buttons |
| **Needs attention** | `sf-warning` (amber) | caution, "look at me soon" | due soon, waiting, sceptical, low stock, not enough information | neutral categories, behaviour scales |
| **Problem / irreversible** | `sf-danger` (red) | stop, loss | overdue, blocker, failed, Remove, Erase, cancel order | anything merely new or different |
| **Information** | `sf-info` (slate blue) | neutral fact, calm | hints, notes, "how this works", source freshness | warnings |
| **Inactive / secondary** | `sf-muted`, `sf-faint`, `sf-line` (grey) | quiet, unimportant now | metadata, "added by", disabled controls | anything a person must act on |
| **Neutral scales** | `sf-cool` (blue) vs `sf-warm` (orange) | cool = calm, reserved, analytical; warm = energy, expressive, fast | two ends of a behaviour that are **neither good nor bad** (Social Style ratings) | status of any kind |

**Rules:**
1. **One filled primary per card.** Everything else is outlined (secondary) or text (tertiary).
2. **Red only for loss or irreversibility.** Destructive buttons are outlined red; the final "Erase permanently" style confirmation is filled red.
3. **Amber means "attention", never a category.** That's why behaviour ratings use cool vs warm, not amber.
4. **Colour is never the only signal.** Always pair it with a word and, where useful, an icon (colour blindness, sunlight on phones).
5. **Soft tints for states, solid only for the selected or primary.** A chip uses `-soft` background + `-line` border + the strong text colour. A selected choice is solid with white text and a check.
6. Text colour on tints must pass contrast: always use the strong token (`sf-success`, `sf-warning`, …) on its `-soft` background.

## 2. Icons: one concept, one icon
- **Library:** `lucide-react` 1.31 (already installed). Use the canonical names in the registry; old aliases such as `AlertTriangle` and `CheckCircle2` still work in existing screens. Size 16 in chips and meta lines, 18 in buttons, 20 in rating choices. Stroke 2. Always `aria-hidden`, because the text carries the meaning.
- **An icon never replaces a word** on actions. Icon-only is allowed only for universally known controls (close ×, phone, email) and then needs an aria-label.
- **The same concept uses the same icon everywhere.** The registry below is the source of truth; add a row before using a new concept.

| Concept | Icon | Concept | Icon |
| --- | --- | --- | --- |
| Log visit / visit | `CalendarCheck` | Visit overdue | `CalendarX` |
| Next visit due | `CalendarClock` | Never visited | `CalendarPlus` |
| Location / pin | `MapPin` | Open map | `MapIcon` (import name; avoids the JS `Map` global) |
| Outside market area | `MapPinOff` | Add contact | `UserPlus` |
| Contact | `User` | Owner (assign) | `UserCog` |
| Phone | `Phone` | Email | `Mail` |
| Edit | `Pencil` | Remove | `Trash2` |
| Erase personal data | `ShieldX` | More actions | `Ellipsis` |
| Set role (Power Map) | `Network` | Decision maker | `Crown` |
| Supporter | `ThumbsUp` | Sceptical | `CircleQuestionMark` |
| Blocker | `Ban` | High influence | `Signal` |
| Rate behaviour | `ClipboardList` | Ratings history | `FileClock` |
| Override style | `Wand` | Style tip | `Lightbulb` |
| Last order | `ShoppingBag` | Class / tier | `Award` |
| Saved / done | `CircleCheck` | Warning | `TriangleAlert` |
| Error | `CircleAlert` | Info / hint | `Info` |
| Back | `ArrowLeft` | Skip | `SkipForward` |

**Social Style rating icons** (content icons, one for Slightly, two for Clearly) are listed in `components/accounts-workspace.tsx` next to the behaviour texts.

## 3. Applying it
- Accounts is done first (owner is testing it). Then Orders, Stock, Requests and Economics are audited against this page by Claude; Codex gets exact fix specs.
- Every design review checks: one primary per card; colour meanings above; an icon from the registry or none; the word is always present.
