# Braces mitigation reassessment — 18 October 2026

Primary reviewer: Codex integration chat. This is the existing dependency gate's required reassessment, separate from the order UI change. Review expires **25 October 2026 at 00:00 UTC**. It does not certify a clean upstream audit or remove the advisory.

## Why the release gate stopped

CI39113687297 passed lint, types, connector checks, 1,479 units, the build, 36 general browser cases, 573 staff browser cases (15 intended skips), and 20 offline cases. The last security step rejected the previously accepted mitigation because its review expired on 17 October. It correctly failed closed.

## Current upstream evidence

On 18 October, the [GitHub advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists no patched version. The [npm registry package metadata](https://registry.npmjs.org/braces) reports latest 3.0.3 and no published 3.0.4. The raw audit suggests >=3.0.4, which is not currently an installable published fix. No dependency upgrade, package substitution or advisory ignore was applied.

## Reassessed local protection

The existing parser patch is unchanged: SHA256 **2882843b9208645c81fd1ab72aacc28cebb92e2651b795bece8a4d1e8a03958f**. It rejects brace and parenthesis nesting deeper than 100 before recursive processing of parsed patterns. The workspace and lockfile still bind this exact patch to braces3.0.3.

Installed-module regression tests traverse all three accepted dependency paths:

- shadcn → fast-glob → micromatch → braces
- shadcn → ts-morph → @ts-morph/common → fast-glob → micromatch → braces
- vinext → vite-plugin-commonjs → vite-plugin-dynamic-import → fast-glob → micromatch → braces

All 21 installed-module security tests passed during reassessment. They cover 4,000-level inputs through parse, compile, expand and stringify, excessive parentheses and mixed nesting, normal alternatives/ranges/literals, the depth boundary, and escaped/quoted/bracketed input. The 12 existing audit-gate tests also passed. The renewal adds a pre-cutoff boundary check; the current-date acceptance and exact cutoff rejection remain tested.

The order UI delta adds no dependency import or exposure. Focused source inspection found no direct braces/micromatch/fast-glob imports in application routes, components or runtime libraries. These reviewed chains use parsed string patterns. The parser patch is a scoped local mitigation: it is not a claim that arbitrary externally supplied prebuilt ASTs or every upstream API use is universally repaired.

## Decision and retained restrictions

Renew only the existing exact-patch assessment for one week, through the cutoff above. The installed patch, dependencies, lockfile, application runtime, permissions, data model and accounting behavior do not change.

The gate still requires the exact advisory ID, high severity, braces3.0.3, all findings restricted to the three reviewed paths, matching patch/workspace/lockfile hashes, a structurally valid audit, and passing installed-module regressions. Additional high/critical advisories, changed versions/paths/patches, unavailable or malformed audit output, and the cutoff still block release. The raw upstream advisory remains visible. No environment clock override or package-wide suppression is used.

The final candidate must pass normal CI, including the real dependency audit. Before 25 October, reassess the upstream release and current exposure again or install and test a published fix. Do not automatically extend this assessment or infer approval for unrelated security exceptions.

Private evidence: work/next-step-lint-proposal-20261018/security-review-tests.log, corrected CI job117634966216 logs, npm registry readback and release handover. This record is committed with the gate/test metadata renewal so a reviewer can audit the decision.
