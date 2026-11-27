# Local prepush gate (Windows PowerShell 5.1)
Run `powershell -NoProfile -ExecutionPolicy Bypass -File tests/prepush.ps1` before every push.
Rule: nothing is pushed unless prepush passes. The conductor enforces this rule.
Use `-DryRun` to print changed files, commands and exact spec lists without running checks.
Use `-Base <ref>` to override the merge-base with `origin/feature/phase3-order-exceptions`.
Changes include branch, staged, unstaged and untracked files; UI previews and work are ignored.
Typecheck, package lint and unit tests always run; connector changes run every connector script.
UI changes select pricing specs by changed spec, filename or API route; component changes add screen-fit-audit.
Stock shell changes also run Stock e2e specs; playwright.config.ts starts `pnpm dev` on port 3000.
Install repo dependencies and browsers first; CI's offline build precedes pricing browser tests. Browser ports are checked afterward.
`-SkipBrowser` / `-SkipReplay` explicitly omit those gates; skips appear in the plan and final table.
Supabase or tests/pricing-* changes run replay last; replay must never run alongside unit or browser tests. First failure stops the gate.
