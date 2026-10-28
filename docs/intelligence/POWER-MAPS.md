# Stakeholder Power Maps and Social Styles

**Purpose and scope:** who influences a customer's purchase decision, how that influence flows, and how to communicate with each person. This is a **relationship model, not a geographic map** (ADR-0005).

**Status:**
- APPROVED DESIGN ONLY: source is [`cba7f67` ROADMAP §Stakeholder Power Map / §Social Styles](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/cba7f67/docs/ROADMAP.md), on an unmerged branch.
- Nothing is built.
- Phase 6 of the [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Sources:** the above; owner brief §Phase 6 (13 Oct 2026); dominance framework (A accounts require a full Power Map).
**Last verified:** 13 Oct 2026.

## 1. Model
- **People** are canonical `customer_contact` records (Customer domain), never duplicated.
- **Assessments** are append-only `stakeholder_assessment` records (Commercial Intelligence). Each records:
  - **decision role**: Economic buyer/Decision maker, Champion, Influencer, Technical evaluator, User, Gatekeeper, Blocker or Coach;
  - **formal authority**, kept separate from **observed influence**;
  - **support or opposition** toward Suprabha, with sentiment and engagement;
  - optional: brand preference, price sensitivity, technical influence, access, key concern;
  - **relationship owner**, **last interaction** and **last verified**;
  - **evidence** and **confidence**;
  - **opportunity-specific relevance**, linked to the single `opportunity` entity (ADR-0008, proposed).
- **Relationships** are directional `influence_edge` records (A influences B) with strength (strong, medium, low), evidence and confidence.

## 2. Views
- **Graph:** stakeholders as nodes; directional, weighted edges; the decider, champion and blocker highlighted; the strongest known influence path shown.
- **List** (same data): role, influence, stance, owner, last contact, confidence. It's the default on phones.
- **Decision value** (each view must drive an action):
  - a high-influence person who is sceptical, blocking or unknown → meet the decider;
  - the only champion is a user → no access to the decider;
  - a decider not contacted within the policy window → defence risk;
  - a focus account with no known decision maker → coverage queue.
- These feed the CONSTRAINT engine as **RELATIONSHIP** evidence ([SUPRABHA80 §4](SUPRABHA80.md)).

## 3. Social Styles (communication aid; ADR-0018, proposed)
- **Styles:** Analytical, Driving, Expressive, Amiable, or **Not enough information**.
- **Stored:** primary style, optional secondary style, **full score distribution**, confidence, evidence, recorded by, last verified. It is editable.
- **Classify only after several interactions** (guideline: 3–5).
- **Ten-question salesperson observation questionnaire** (A = Analytical, B = Driving, C = Expressive, D = Amiable), as defined in `cba7f67`. The full distribution is kept.
- **Guidance:**

  | Style | Lead with |
  | --- | --- |
  | Analytical | data, validation, CPT |
  | Driving | results, ROI, a clear recommendation |
  | Expressive | differentiation, demos |
  | Amiable | trust, service, training |

- Social Style is **never** a psychological diagnosis, and never decides *whether* to act.

## 4. Requirements
- **Security and privacy:**
  - business data only;
  - visible to administrators and management, plus the assigned owner (needs `customer_assignment`);
  - an erasure request redacts the record and keeps an audit stub ([D-07](../planning/OPEN-DECISIONS.md)).
- **Audit:** every assessment, edge and style change is append-only, with actor and reason.
- **Inheritance:** existing row scope, auditability, and one source of truth (`cba7f67` guardrail).

## 5. Dependencies
- Phase 4: `customer_contact`, `customer_assignment`.
- Phase 5: `opportunity`.

## 6. Acceptance criteria
- A graph and a list render the same records.
- No stakeholder is duplicated outside the customer contacts.
- "Not enough information" is the default until evidence exists.
- An erasure request leaves no personal fields.
- The RELATIONSHIP constraint can cite an assessment.

## 7. Open decisions
D-07 (data policy), D-08 (prospects: Power Maps for prospects need prospect accounts).
