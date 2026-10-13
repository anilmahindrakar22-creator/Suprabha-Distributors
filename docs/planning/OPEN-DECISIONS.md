# Open decisions (owner approval required)

Items marked **decided below** have an owner decision in the Decided section. All other items remain open and must not assume an answer.
**Last verified:** 13 Oct 2026.

| ID | Decision | Options and trade-offs | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| D-01 *(decided below)* | Add **HbA1c** as a diagnostic division? | (a) Add it: it matches the dominance framework and gives finer gaps. (b) Fold it into Biochemistry: fewer divisions to estimate | (a) if HbA1c instruments and reagents are a material, separately sold line | Phase 5 wallet entry |
| D-02 | **Capital Priority Score** weights (35/25/15/10/10/5) | (a) Use now: fast, but false precision (spec §15). (b) Keep as a versioned policy, off until outcome data exists, with V1 using EV bands | (b) (ADR-0014) | Phase 2/5 capital ranking |
| D-03 | **Salesperson scorecard** (weighted) | (a) Adopt: it aligns incentives. (b) Defer: spec §22 lists "salesperson surveillance metrics" as a non-goal | (b) Defer. If adopted later, it's visible to the salesperson, with drill-down, never a hidden ranking | Phase 8 |
| D-04 *(decided below)* | **Director** tier for 37–48-month placements | (a) New `director` role. (b) Map to `administrator`. (c) Two-person approval (management + administrator) | (b) or (c); keep the role set small | Phase 2 approval routing |
| D-05 *(decided below)* | Remove the **dormant inventory ledger/allocation objects**. **Also:** decide the future of `stockflow_products`, which is no longer refreshed but still read by the price book; replace it with the live snapshot or restore a governed refresh | (a) Archival migration in the Phase 0/1 hardening: less dead code. (b) Leave them dormant: zero risk now | (a), as its own reviewed migration after the pilot. **Never inside a docs PR** | none (hygiene) |
| D-06 | **Hosting direction**: the design branch proposes office-PC hosting, then an in-house server, then in-house AI; production runs on Cloudflare + Supabase | (a) Stay managed: lower ops burden. (b) Move to an office PC: no hosting cost, but ROADMAP warns "never make a daily-use Tally workstation the only database or backup". (c) Hybrid per the architecture doc's "local-capable" stage | Stay managed until Phase 0 closes, then evaluate (c) with measured cost and backup evidence | none now |
| D-07 | **Power Map personal-data policy** | Fields, visibility, retention, erasure by redaction (ADR-0018) | Approve ADR-0018 | Phase 6 |
| D-08 | **Prospects** as Customer-domain accounts | ADR-0009 vs a separate CRM lead table (duplicate master) | ADR-0009 | Phases 4–5 |
| D-09 *(decided below)* | Adopt the **master roadmap** (ADR-0010) and its three dependency corrections | — | Adopt | all planning |
| D-10 | **Branch disposition** | `docs/power-map-social-styles-roadmap`: content consolidated here; archive the branch after this PR. `feature/customer-pricing-engine`: 13 commits not patch-identical in the RC, so a content check is needed before archiving. `claude/market-w1`: keep parked until Phases 4/5, then rework to ADR-0006/0007. Old `feature/*` branches with 1–2 leftover commits: review, then archive | As stated | hygiene |
| D-11 | **Receivables / COLLECT** | Owner deferred receivables (13 Oct). Confirm that COLLECT stays disabled until governed receivables exist | Confirm | Phases 5, 8 |
| D-12 | **Urine** division | Seeded inactive on `market-w1`; re-enable? | Leave inactive unless it's a material line | Phase 5 |
| D-13 | **Account class thresholds**: A ≥ ₹2 L/month, B ₹75 k–2 L; is there a C class? | Configurable policy (dominance framework) | Keep A/B; treat the rest as "unclassified" until a need appears | Phase 5 |

## Decided (owner, 13 Oct 2026)

| ID | Decision | Effect |
| --- | --- | --- |
| D-09 | **Master roadmap adopted.** ADR-0010 is Accepted. The other proposed ADRs (0008, 0009, 0011, 0012, 0014, 0018) stay **Proposed** for later review | [MASTER-ROADMAP](MASTER-ROADMAP.md) is the only roadmap |
| D-04 | **Director tier = Administrator.** 37–48-month payback placements are approved by an `administrator`; no new role | Phase 2 approval routing |
| D-05 | **Investigate now; remove the dormant tables after the pilot.** A real bug found during the investigation is fixed promptly | See the finding below |
| D-01 | **HbA1c becomes a separate division** | Division list: Biochemistry, Haematology, Immunoassay, Molecular, Microbiology, Rapid, Coagulation, Electrolytes, **HbA1c**, Others |
| D-14 | **ADR-0011 accepted** (owner, 13 Oct 2026): one persistent instrument ID per physical machine; relocation keeps the ID and opens a new placement; nothing financial is duplicated | Build after the Economics cutover ([INSTALLED-BASE-REGISTER-DESIGN](../INSTALLED-BASE-REGISTER-DESIGN.md)) |
| D-15 | **Placements with payback ≤ `attractive_months` (24) are approved automatically** (owner, 13 Oct 2026) | Placements only (groups stay manual); capital must be recorded. Approved in the same transaction as the command that makes them eligible, with the same frozen baseline and an "Automatic" reason. 25–36 months: Management; 37–48: Administrator; > 48: blocked. Only an Administrator can change the band (D-04) |

### D-05 investigation finding (13 Oct 2026, read-only code inspection)
**The facts:**
- `private.stockflow_products` was filled only by the trigger `stockflow_sync_inventory_products`, which `20260903121500` dropped. No later migration, Edge function or connector script writes to it.
- These still depend on it:
  - **`set` price-book commands reject items missing from it**: `20260913132000_price_book_gateway.sql:101`, "Select an active Tally product";
  - the "all" price-book tab and its search: lines 47–48;
  - visibility and search (`20260921123000`);
  - customer-first pricing (`20260921160000:445`, inner join);
  - bulk approval (`20260923150000`);
  - group gross margin (`20260928110000:55, 182`, inner join).
- The SQL tests insert products by hand, so they don't detect this.

**Likely effect:** items created in Tally after about 3 Sep 2026 can't be priced through the price book, and are excluded from group-margin decisions. Renamed items show old names.

**Hosted gap confirmed** by the integration owner on 13 October 2026, read-only: production has 1,940 snapshot item keys, 1,929 active products and 17 snapshot keys absent from the active pricing mirror; newest product created 2 September 2026. Acceptance has 2 snapshot keys, 4 active products and no missing key. This establishes missing coverage, not the number of failed staff attempts. The fix still needs integration and acceptance verification.

**Proposed fix (P1, Phase 0):** restore a governed refresh of the product *master mirror* (not inventory, so ADR-0001 holds):
- upsert identity, name, group and unit from each accepted Tally catalogue snapshot;
- the current fix never deactivates products, including on partial snapshots; any future removal requires separate completeness and audit review;
- add a regression test that starts from an empty products table.