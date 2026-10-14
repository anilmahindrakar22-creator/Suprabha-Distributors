# Phase 6, slice 2: Social Styles from observed behaviour (D-22)

**Owner decisions (14 Oct 2026):**
- **Who rates:** any user who logs visits (administrator, management, sales, operations) and met the person.
- **Who sees the style and guidance:** administrators, management, and the **account's current owner** (option b).
- ADR-0018 guardrails apply: a communication aid, never a judgement; business behaviour only; editable.

**Utility:** tells the salesperson *how* to pitch to each buyer: which evidence to bring and how fast to move.

## 1. Observation (after a visit)
For a contact who was ticked in "Who did you meet?" on a visit in the last 30 days, the visitor can rate **eight behaviours**, each on four points (1 to 4):

| # | Scale | 1 | 4 |
| --- | --- | --- | --- |
| A1 | Assertiveness | Speaks slowly and carefully | Speaks quickly and firmly |
| A2 | Assertiveness | Asks questions, holds back opinions | States opinions |
| A3 | Assertiveness | Follows our agenda | Takes control of the meeting |
| A4 | Assertiveness | Wants time and consults others | Decides on the spot |
| R1 | Responsiveness | Talks tasks, facts, numbers | Talks people, stories |
| R2 | Responsiveness | Formal, reserved | Warm, animated |
| R3 | Responsiveness | Strict on time, straight to business | Relaxed, enjoys small talk |
| R4 | Responsiveness | Asks for proof and data | Goes by trust and peer labs |

**Optional cue ticks** (what they asked for):
- cost per test or comparison data;
- validation or QC papers;
- uptime or turnaround time;
- price or a fast decision;
- new technology or demos;
- reference labs;
- service and training;
- staying with the current supplier.

Cues are shown as evidence; they don't change the computed style.

## 2. Computation
- Average A1–A4 across all of the contact's observations gives **assertiveness**; R1–R4 gives **responsiveness**. Midpoint 2.5.
- **Quadrant:**

  | Assertiveness | Responsiveness | Style |
  | --- | --- | --- |
  | > 2.5 | ≤ 2.5 | **Driving** |
  | > 2.5 | > 2.5 | **Expressive** |
  | ≤ 2.5 | ≤ 2.5 | **Analytical** |
  | ≤ 2.5 | > 2.5 | **Amiable** |

  If either average is exactly 2.5 → **Not clear yet**.
- Fewer than **3 observations on 3 different visit dates** → **Not enough information**.
- **Confidence:** the share of individual observations whose own quadrant matches the overall one.
  - **High:** ≥ 75 % with at least 5 observations.
  - **Medium:** ≥ 60 %.
  - **Low:** otherwise.
- **Manual override:** administrators and management can set a style, with a reason. The override is shown as "Set by …"; the computed style stays visible beside it.

## 3. Guidance shown with the style
| Style | How to approach |
| --- | --- |
| Analytical | Bring the data: cost per test, validation papers, a written comparison. Don't rush. |
| Driving | Lead with the result: savings, uptime, a clear recommendation. Keep it short. |
| Expressive | Demo it, name reference labs, tell the bigger story. |
| Amiable | Build trust: service plan, training, reliability. Reduce the risk of switching. |

## 4. Visibility
- **Style, confidence, guidance and cue summary:** administrators, management and the account's owner (open assignment). Left out of the response entirely for everyone else.
- **Raw observations:** who rated and the individual scores. Administrators and management only.
- **Rating** is open to any visit-logging role, for contacts they met within 30 days.

## 5. Screen
- **After a visit is saved** with met contacts: a short prompt per met contact, "How did Asha behave? (optional, 30 seconds)", with the eight four-point controls and the cue ticks. It can be skipped.
- **The contact line** shows, for people allowed to see it: `Analytical · medium confidence`, plus a one-line approach tip; or `Style: not enough information (2 of 3 meetings)`.
