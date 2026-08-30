# StockFlow testing strategy

StockFlow uses risk-based testing. The goal is confidence in daily distribution operations without building a slow or brittle test suite.

## Test layers

1. **Static checks** run first: lint rules, strict TypeScript, dependency audit, and CodeQL.
2. **White-box tests** cover authorization branches, validation, business rules, controlled errors, and service boundaries. External services are replaced with deterministic fakes.
3. **Integration tests** cover API contracts and persistence boundaries without testing implementation details.
4. **Black-box browser tests** exercise critical journeys through the visible UI and HTTP endpoints on desktop and mobile Chromium.
5. **Manual exploratory checks** cover usability, operational wording, unusual data, and real Tally integration before production approval.

The majority of tests should be fast white-box tests. Browser tests are intentionally limited to high-value journeys so the pipeline remains lightweight.

## Required rules

- Tests must be deterministic, independent, and safe to run repeatedly.
- Use Arrange–Act–Assert and describe behavior rather than implementation.
- No test may contain a real credential, customer record, or production stock export.
- Black-box tests must not mutate production data.
- Every defect fix requires a failing regression test before the correction where practical.
- Authorization tests must cover unauthenticated, unauthorized, approved, missing-configuration, and upstream-failure paths.
- Financial and stock mutations require idempotency, transaction, concurrency, and rollback tests before release.
- Order state changes require valid-transition and invalid-transition tests.
- Date, expiry, batch, quantity, tax, rounding, and duplicate-order boundaries require explicit tests when introduced.
- Flaky tests are defects. Fix or remove their nondeterminism; do not add automatic retries to unit tests.
- Browser retries are CI-only and retain trace, screenshot, and video evidence on final failure.
- Coverage is a guardrail, not a target. Current critical-library thresholds are 90% lines/statements/functions and 80% branches.

## Release evidence

A release candidate must provide:

- Passing lint and type checks
- Passing white-box suite with coverage thresholds
- Passing desktop and mobile black-box journeys
- Successful production build from the exact commit
- No critical or high production dependency vulnerabilities
- CodeQL results reviewed when available
- Manual approval for production publication

Tests are added alongside each feature in the same pull request. A test-only follow-up is acceptable only for exploratory findings or legacy coverage work.
