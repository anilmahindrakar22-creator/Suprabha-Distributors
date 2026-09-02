# StockFlow development workflow

StockFlow uses a lightweight trunk-based workflow. `main` must always be safe to release.

All changes must follow [Suprabha OS engineering principles](ENGINEERING_PRINCIPLES.md), the [architecture](docs/SUPRABHA_OS_ARCHITECTURE.md), and the phased [roadmap](docs/ROADMAP.md). StockFlow is the first operational module of Suprabha OS, not a disposable or separate application.

## Branches

- `feature/<short-name>` for planned capabilities
- `fix/<short-name>` for defects
- `security/<short-name>` for security corrections
- `docs/<short-name>` for documentation-only changes

Branches should be short-lived and merged through a pull request. Do not create a permanent `develop` branch. Delete the branch after merge.

## Required checks

Before requesting review, run:

```text
pnpm install --frozen-lockfile
pnpm run ci
```

`pnpm run ci` runs linting, strict type checks, white-box tests with coverage, the production build, desktop and mobile black-box tests, and a production-dependency audit. Critical and high vulnerabilities block release. Never commit secrets or local `.env` files. See `TESTING.md` for the testing philosophy and release evidence.

## Review and merge

Use a pull request with one reviewer when possible. Prefer small changes with a single purpose. Use squash merge so `main` has one clear commit per change. Emergency fixes use a `security/*` or `fix/*` branch and follow the same checks.

Recommended repository rules for `main`:

- Require a pull request before merging
- Require the `Validate release candidate` check
- Require one approval and dismiss stale approvals
- Require conversation resolution
- Block force pushes and branch deletion
- Allow only squash merges

## Versioning and releases

Use semantic versions: patch for compatible fixes, minor for compatible features, and major for breaking operational changes. A merged `main` commit is a release candidate, not an automatic production release.

Production release procedure:

1. Confirm CI passes for the exact commit.
2. Build and save an immutable Sites version from that commit.
3. Obtain explicit production approval.
4. Publish the saved version without rebuilding it.
5. Verify sign-in, stock loading, and error logs.
6. Roll back to the previous saved Sites version if verification fails.

This manual production gate is intentional: StockFlow contains business data and the current site endpoint is publicly reachable, even though application data requires an approved account.
