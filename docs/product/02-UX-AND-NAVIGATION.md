# UX and navigation

**Status:** canonical principles; screen plans per phase.
**Sources:** spec §2 (UX principles), §§3–9 (information architecture and screens), §29 (new-user UX); [ORDERS-UI-REDESIGN-PLAN](../ORDERS-UI-REDESIGN-PLAN.md); [UI-UX-REVIEW](../UI-UX-REVIEW.md); owner rules (13 Oct: decision value only; design reviews by Claude).
**Last verified:** 13 Oct 2026.

## Principles
- **Decision-first:** one clear next action per screen; action before analytics.
- **Progressive disclosure:** a summary first, evidence on drill-down.
- **No duplicate entry:** facts come from canonical domains. Humans enter only estimates, diagnoses and decisions.
- **Estimates look different from facts,** and every number exposes source, period and freshness.
- **Plain business language.** Indian number formatting. Asia/Kolkata dates.
- **Phone-usable operations;** desktop-first management.
- **Accessibility:** labels on every field; status never conveyed by colour alone.
- **Utility rule:** a screen element that doesn't drive a decision or give guidance isn't built.

## Navigation (built today)
**Surfaces:** Stock, Orders, Requests, Pricing, Economics, Service, Users. They are role-filtered and lazy-loaded (`components/stockflow-frame.tsx`).

## Navigation (target, added by phase)
Commercial intelligence becomes **one area**, not one area per principle:

| Entry | Phase | Notes |
| --- | --- | --- |
| **Today / Action Center** | 5 (management), 8 (role views) | landing screen for management |
| **Accounts** | 4–5 | Account workspace: wallet matrix, gaps, Power Map, installed base, timeline |
| **Market Map** | 7 | WALLET, OPPORTUNITY, ACTION and COVERAGE modes over the same records |
| **Outcomes** | 5 | matured action reviews |
| **Coverage** | 4–5 | data-quality queues |
| **Command Center** | 8 | verified KPIs |

Economics stays a finance surface. Pricing stays the price authority.

## Screen specifications
Screen specifications are the spec §§4–9 screens, refined per phase. Before a screen is built, its wireframe plan is reviewed by Claude, with screenshots on phone and desktop.
