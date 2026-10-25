# Billing release dependency correction — 25 October 2026

Primary reviewer/integrator: Codex. This is the dependency-only correction required by PR70 CI40177147754. The owner-pinned a3d37d5 application, migration and access rules are unchanged.

## Evidence and correction

All feature checks passed (1511units,36general591staff20offline browser,48SQL). The final audit reported6high/10moderate/3low findings, and its high-filtered advisory list did not match metadata totals. The existing gate failed closed.

Isolated proposal work/billing-role-security-proposal-20261025 has its own node_modules, not the shared repository junction. Exact manifest changes: shadcn4.18.0->4.22.1 and Vite8.0.16->8.1.6. Updated existing override lower-version ranges to MCP SDK1.32.0, Undici7.30.1, fast-uri3.1.9, ip-address10.7.4; added body-parser2.4.0. Other manifest versions and package-manager pin remain unchanged. The lockfile records the actual graph; no production install or staff/business mutation.

Current public audit advisories identify patched thresholds:

- MCP SDK1.32.0: https://github.com/advisories/GHSA-22jm-h49p-29qw and https://github.com/advisories/GHSA-46jr-4wx8-v453
- Vite8.1.6: https://github.com/advisories/GHSA-587h-7wmj-h5pm
- Zod4.6.6 or later through the updated shadcn graph: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- body-parser2.4.0: https://github.com/advisories/GHSA-27r3-jxmh-p828
- Undici7.30.1: https://github.com/advisories/GHSA-xjj6-f33q-929c

After manifest updates alone, audit retained2high/5moderate/2low in old pinned transitive versions. After the focused override updates, the COMPLETE production-dependency audit reports0info/0low/0moderate/0high/0critical and zero advisories. The existing pnpm security:audit gate passes UNCHANGED. Installed-parser and gate regression tests34/34 pass, including exact patch/version/path checks and fail-closed malformed/extra/expired cases.

## Retained controls

No change to lib/dependency-audit.mjs, its tests, the braces parser patch, mitigation cutoff or severity policy. No advisory ignore, clock override, package substitution or broad audit exception. GitHub withdrew GHSA-vfj7-8cjw-p6xm on23October2026 as not practically exploitable (https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The existing exact parser patch and its21 installed-module regressions remain. No renewal of the expired18October assessment is claimed; the current raw audit no longer contains that withdrawn advisory. If it reappears, the unmodified expired gate still blocks it.

This correction does not add new application functionality or modify Billing's approved-only data boundary. Final integrated source must pass normal CI and both frozen target builds, then be redeployed to acceptance before production. Acceptance billing migration already applied remains the exact same69a3ffd SQL. Preserve all unrelated work and the active Claude checkout.

Private evidence: audit-before-all.json in work/billing-role-release-20261025-v2; audit-after-all.json, audit-after-overrides.json, security-gate.log, security-tests.log and install logs in the isolated security proposal. This is a point-in-time audit result, not a future assurance of no vulnerabilities.
