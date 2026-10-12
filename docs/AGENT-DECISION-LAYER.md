# Agent decision layer (Jev-style), v1: observation only

Owner request (11 Oct 2026): "Design a minimal Jev-style typed decision layer, beginning in observation-only mode. Preserve existing agent routing and all database safety guarantees. Implement only after identifying existing orchestration hooks."
Source idea: *Jev Engineering for Coding Agents* (independent synthesis). A small decision layer sits beside the coding model. The harness asks it predefined questions about the current state and gets back **typed answers** (a choice, a score, or an explicit null) that code can validate, threshold and branch on.

## 1. Existing orchestration, as found

| Piece | Where | Role |
| --- | --- | --- |
| Codex worker launcher | `~/.claude/skills/codex-conductor/run-codex.ps1` (outside this repo) | **The only launch point for every Codex worker.** It knows the handoff file, tier (model), effort, sandbox and network flag, and writes `<handoff>.report.md`, `.log` and `.session`. This is the hook point. |
| Routing rules | `~/.claude/skills/codex-conductor/ORCHESTRATION.md`, `~/.claude/CLAUDE.md` | Small first; route by risk; claims; one integrator. |
| Repo policy | `AGENTS.md` | Pricing, billing, Tally, security, migrations, concurrency and final integration stay under primary-agent review. |
| Ownership | `docs/CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md` | Free-text claims per agent. |
| Database safety | `tests/pricing-release-preflight.mjs` (evidence only, no DB connection), `supabase/migration-history-map.json`, sandboxed workers (no network, `--ignore-user-config` so no Supabase MCP), Codex chat as the sole deployer | Must be preserved unchanged. |

In-repo orchestration code: **none.** The `hooks/` folder is a React hook. There are no Claude Code hooks configured.

**Not covered by this hook:** the Claude Agent tool's subagents, the Codex plugin's `/codex:rescue` and the ChatGPT/Codex integration chat do not go through `run-codex.ps1`.

## 2. v1 scope: three typed questions, observation only

Every answer is recorded. **Nothing is enforced:** the launcher's tier, model, sandbox and arguments are never changed by the observer, and any observer failure is ignored (fail open).

| Question id | Typed answer | Inputs |
| --- | --- | --- |
| `security.sensitivity` | `{ class: 'public' \| 'app' \| 'sensitive' \| 'restricted', score: 0..1, matches: [{ path, class, rule }] }` or **null** | Declared read/write files × policy globs |
| `permission.handoff` | `'allow' \| 'ask' \| 'deny'` or **null** | Write set's sensitivity; handoff keywords (deploy, hosted database, secrets, dangerous Codex flags) |
| `route.tier` | `'light' \| 'standard' \| 'heavy'` or **null**, plus `requested` (the tier actually launched) and `agrees: boolean` | Number of write files, sensitivity class, permission answer |
| `ownership.overlap` (cheap extra) | `{ overlapping: [{ path, handoff }] }` or **null** | Write sets of other handoffs in the same folder that have a decisions record but no outcome yet (in flight) |

Each answer also carries `confidence` (0..1, **uncalibrated**: a rule-based score, not a probability) and short `reasons`. Weak or missing inputs yield **null** (abstain) rather than a guess.

### Declared file block (machine-readable; no prose parsing)
Handoffs gain an optional fenced block:

````
```agent-files
read: lib/order-types.ts, components/page-header.tsx
write: components/requests-workspace.tsx
actions: edit, test
```
````

No block → `security.sensitivity`, `permission.handoff` (unless a keyword already forces `deny`), `route.tier` and `ownership.overlap` abstain. So old handoffs keep working.

## 3. Policy (derived from AGENTS.md)
`tests/agent-decision-policy.json` maps globs to classes; first match wins, checked from most to least sensitive:
- **restricted:** `.env*`, `**/*.pem`, `**/*.key`, `.codex/setup-*keys*.ps1`, `wrangler*.json*`, `**/wrangler.toml`, `tests/pricing-release-preflight.mjs`, `supabase/migration-history-map.json`.
- **sensitive:** governance files `tests/agent-decision-*`, `tests/*preflight*.mjs`, `AGENTS.md`, `.github/**`, `.gitignore`; plus `supabase/**`, `app/api/**`, `lib/*pricing*`, `lib/*economic*`, `lib/*price*`, `lib/access-control.mjs`, `lib/staff-auth*`, `lib/*tally*`, `desktop-connector/**`, `public/sw.js`, `lib/order-gateway.ts`.
- **app:** `app/**`, `components/**`, `lib/**`, `hooks/**`, `offline/**`.
- **public:** `docs/**`, `tests/**`, `*.md`.
- Unmatched → `app`.

Scores: public 0.1, app 0.4, sensitive 0.75, restricted 1.0. The task's score is the maximum over its files.

**Permission rules** (v1.1, 12 Oct 2026; first match wins). They come from the **declared `actions:` line**, not prose. Real handoffs say "no deployments" and list secret patterns to scan for, so prose matching produced false ask/deny on almost every run.
- **deny:** actions include `deploy`, `hosted-db` or `secrets`, or the requested sandbox is `danger-full-access`.
- **ask:** actions include `migrate`, `commit`, `push` or `network`, or any restricted or sensitive file is in the write set.
- **allow:** otherwise. With no block: abstain.
Prose matches of the deny/ask patterns are recorded as informational `mentions` only.
**Tier rules:**
- heavy: if permission is ask (because of sensitive/restricted writes), or if more than 5 write files touch the sensitive class.
- standard: if there are 2–5 write files, or the class is app with logic keywords.
- light: a single write file in public or app class.

These are the conductor's routing rules written down, so agreement can be measured.

## 4. Records (one file per run, no shared log)
- Before launch, the observer writes `<handoff>.decisions.json`. After the run, it appends an `outcome` (exit code, seconds, tokens) to the same file.
- Writing one file per handoff avoids interleaved writes from parallel workers.
- Records store a SHA-256 digest of the handoff and file paths only, **never the handoff text**.
- Location: next to the handoff in the git-ignored `work/codex-handoffs/`.
- `node tests/agent-decision-observer.mjs summary <dir>` aggregates: agreement rate of the suggested vs the requested tier, outcome by tier, and how often ask/deny would have fired.

Record schema `jev.decision/v1`:
`{ schema, policyVersion, createdAt, handoffDigest, files: { read, write }, requested: { tier, effort, sandbox, network, resume }, decisions: [{ question, answer, confidence, reasons }], observedOnly: true, actionTaken: 'launched-unchanged', outcome?: { exitCode, seconds, tokens } }`

## 5. Hook in the launcher (fail open)
In `run-codex.ps1`, the `observe` call runs just before Codex launches and the `outcome` call runs right after it. Both:
- run `node` by full path with a 5 s timeout, inside `try/catch` with error handling relaxed;
- capture Codex's exit code before calling the observer;
- never touch `$Tier`, `$model`, `$sandbox` or `$arguments`;
- skip silently if the repository has no observer.

## 6. Moving from observation to enforcement (not in v1)
Requires an explicit owner decision, backed by summary data, such as tier agreement and how often ask/deny would have fired over N real runs. The first candidate would be **deny → refuse to launch** for dangerous flags. Routing changes come later and need calibration.

## 7. Cost and performance (targets)
- No model calls: zero tokens.
- The observer is local regex and glob work over a small file. Median wall time is expected under 150 ms, mostly Node start-up, against 20–400 s Codex runs.
- There are no savings until anything is enforced. v1 only gathers evidence.
