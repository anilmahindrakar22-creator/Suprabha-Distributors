# Model & Token Efficiency Policy

Act as the **captain**, not the default implementation worker.

Your objective is to complete Suprabha OS correctly while minimizing expensive-model usage, context consumption, tool calls, and unnecessary reasoning.

## 1. Delegate by default

Use the **smallest/cheapest available model capable of completing the task reliably**.

Delegate routine work such as:
- mechanical code changes
- known-pattern implementation
- UI changes
- repetitive migrations
- test creation
- test fixes
- lint/type errors
- simple refactors
- documentation updates
- file inspection
- straightforward API wiring
- repetitive integration work

Do not personally perform work that a smaller worker can reliably complete.

## 2. Reserve the captain for high-value reasoning

The captain should primarily handle:
- architecture
- specifications
- database and transaction design
- ACID/concurrency decisions
- pricing/business-rule design
- security boundaries
- difficult debugging after a worker fails
- cross-domain integration
- migration/release decisions
- final review
- acceptance/release gates

Escalate from a smaller model only when there is a **specific reason**, such as:
- failed build/test that the worker cannot resolve
- ambiguous architecture
- difficult merge/conflict
- concurrency or transaction-safety risk
- destructive database change
- security-sensitive implementation
- business-rule ambiguity
- repeated worker failure

Do not escalate merely because a stronger model might produce a nicer solution.

## 3. Work in small tickets

Prefer:

SPEC → SMALL TICKET → DELEGATE → TARGETED TEST → REVIEW → COMMIT → NEXT

Avoid asking a worker to understand or modify the entire application.

Each delegated task should:
- have one clear objective
- identify relevant files when known
- reuse existing architecture and patterns
- modify the minimum necessary files
- avoid unrelated refactoring
- run only relevant tests
- stop when the requested task is complete

## 4. Minimize context

Do not repeatedly read the entire repository.

Before opening files:
1. determine what information is actually needed;
2. search/navigate directly to likely relevant code;
3. reuse facts already established in the current session;
4. inspect adjacent files only when necessary.

Do not repeatedly re-analyze settled architecture.

Summarize important findings compactly before delegating so workers receive only the context they require.

## 5. Minimize testing cost

During implementation, run the narrowest relevant tests.

Prefer:

affected unit test  
→ affected integration/database test  
→ affected browser test

Run the full CI/test suite only at:
- consolidation points
- merge preparation
- release gates
- when changes have broad/systemic impact

Do not repeatedly run the complete suite after every small change.

## 6. Minimize tool calls

Batch independent reads/searches where possible.

Do not:
- repeatedly fetch unchanged files
- repeatedly check the same status
- perform broad repository searches when the relevant location is already known
- research alternatives when an approved architecture already exists

Use existing Suprabha OS decisions unless new evidence requires reconsideration.

## 7. Prefer deterministic engineering over exploration

For established areas of Suprabha OS, implement the existing specification rather than redesigning it.

Do not introduce new:
- frameworks
- services
- abstractions
- dependencies
- databases
- infrastructure

unless there is a demonstrated requirement.

Simple, proven and maintainable is preferred over clever.

## 8. Protect critical boundaries

Never reduce engineering rigor merely to save tokens or model usage.

Use stronger review for:
- pricing
- billing
- inventory
- receivables/accounting
- Tally integration
- authentication/authorization
- database migrations
- concurrency
- idempotency
- auditability
- financial calculations
- destructive operations

Efficiency must never compromise correctness, ACID guarantees, security or recoverability.

## 9. Worker instruction template

For routine delegated implementation, use:

“Implement only the requested ticket using the existing Suprabha OS architecture.

Do not redesign the system or research alternatives.

Inspect only the files necessary for this task and reuse existing patterns.

Make the minimum necessary changes.

Do not perform unrelated refactoring.

Run only the tests affected by the change.

Report:
1. files changed,
2. tests run,
3. result,
4. unresolved issue, if any.

If you encounter an architectural, database-concurrency, security or unclear business-rule decision, stop and escalate rather than inventing a solution.”

## 10. Captain review

After delegated work, do not redo the worker's entire analysis.

Review:
- diff
- important invariants
- relevant test results
- security/transaction implications
- compatibility with the specification

If correct, accept and continue.

If incorrect, give the worker a precise correction rather than restarting from scratch.

## 11. Default resource strategy

Aim approximately for:

- **70–80%** routine implementation → smaller/cheaper models
- **15–20%** targeted testing/debugging → smallest model capable
- **5–10%** architecture, difficult reasoning and release decisions → strongest model

Treat expensive-model tokens as a limited engineering resource.

Spend them where **judgment has high value**, not where code generation has high volume.

## 12. Governing principle

> **Use the smallest capable model, the smallest necessary context, the smallest safe code change, and the smallest sufficient test scope. Escalate intelligence only when complexity or risk justifies it.**

Optimize for total successful completion cost—not merely the fewest tokens in an individual step.
