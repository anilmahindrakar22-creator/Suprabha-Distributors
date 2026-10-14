> **Approved (owner, 14 Oct 2026; D-21):** scope and data rules approved. Visibility = **administrators and management only**, including the alerts. People are app-added contacts only (the Tally mirror was dropped), so §4 no longer applies.

# Phase 6, slice 1: Power Map on the account (design for owner approval)

**Author:** Claude, 14 Oct 2026. **Builds on:** Accounts (W1), A/B classes, and contacts (Tally and app). **Full model:** [POWER-MAPS](intelligence/POWER-MAPS.md).
**Utility test:** every field drives one of three actions: **meet the decision maker**, **win over a blocker**, or **find out who decides**.

## 1. Slice 1 scope
**Per contact on an account** (Tally or app-added), three quick choices, all optional, each defaulting to "Unknown":

| Field | Options |
| --- | --- |
| Decision role | Decision maker, Influencer, User, Gatekeeper, Unknown |
| Stance toward us | Supporter, Neutral, Sceptical, Blocker, Unknown |
| Influence | High, Medium, Low, Unknown |

- Saved as an **append-only assessment** (who, when, an optional reason), so history is kept. The latest assessment is shown.
- **"Who did you meet?"** is added to **Log visit**, as an optional choice of contacts. That gives each person a **last met** date without extra typing.

**Account-level alerts** (shown on the card, and filterable):
1. **No decision maker known**: no contact on the account is marked as decision maker.
2. **Decision maker not met in 60 days**: the decision maker's last-met date is older than 60 days, or they have never been met.
3. **Blocker or sceptic with high influence**: plan a meeting with the decision maker.

On a phone the Power Map is a **list** inside the account card ("Who decides"), not a graph.

## 2. Not in slice 1 (no decision needs them yet)
- **Social Styles** (Analytical, Driving and so on): they need several meetings' evidence. Slice 2, after use.
- **Influence links** between people and the graph view: slice 2, once accounts have three or more mapped people.
- Champion, Coach, Technical evaluator and Economic buyer roles: folded into the five above to keep it quick.

## 3. Data rules (ADR-0018, for approval)
- Business facts only: role, stance, influence, last met. **No personal notes, no personal opinions about the person.** The reason field is for business evidence, for example "Chose competitor reagent in tender".
- An erasure request blanks the person's fields and keeps an audit stub.

## 4. Technical prerequisite
**Stable Tally contact IDs.** Tally contacts are currently deleted and re-inserted on each sync, so their IDs change. The sync becomes an **upsert by account + normalised name**: contacts that disappear from Tally are marked removed, not deleted. Assessments then stay attached to the same person.

## 5. Decisions for the owner
1. **Who can see Power Map details?**
   - (a) Administrators, management **and the account's owner** (recommended; ADR-0018). Other staff still see the alerts, not the person details.
   - (b) Everyone who can open Accounts (matches D-16).
2. **Approve the slice 1 scope** above: three fields, "who did you meet" and three alerts. No Social Styles or graph yet.
3. **Approve the data rules** in §3.
