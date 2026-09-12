# Tasks: Behavior-safety test audit before restarting plugin-core separation

Research-only change: no production/test code is written or edited (see design.md — Non-Goals). Order is evidence-before-synthesis: each data-collection task feeds the synthesis and report groups. All artifacts live in gitignored `reports/audit/issue-448/`.

## 1. Branch shape & staleness (metadata-only)

- [x] 1.1 Fetch origin and pin divergence evidence: capture `master` and `origin/plugin-core-separation` SHAs, `git log --oneline master..origin/plugin-core-separation`, and `git diff --stat master...origin/plugin-core-separation`; write the header block (SHAs + divergence date) to `reports/audit/issue-448/behavior-safety-audit.md` — verify: `git fetch origin && git log --oneline master..origin/plugin-core-separation && git diff --stat master...origin/plugin-core-separation`
- [x] 1.2 Read `openspec/changes/plugin-core-separation-toolgate/` and `openspec/changes/hermetic-e2e-core-separation-proof/`; draft the module-extraction map (planned `src/modules/`, `src/ports/`, `src/composition/` extractions onto current master modules: `src/plugins/`, `src/llm-orchestrator*`, chat providers) as report section 1 — verify: `grep -n "plugin-core-separation" reports/audit/issue-448/behavior-safety-audit.md`

## 2. Static taxonomy (sub-second data first)

- [x] 2.1 Run `bun run test:audit` and capture the per-file case/assertion fragmentation table into working notes — verify: `bun run test:audit`
- [x] 2.2 Classify `tests/` entries into lanes (hermetic DI units, legacy `mock.module()`/delayed-import, integration `tests/db/`, T0 `tests/stories/`, T1 `tests/e2e/`, T2 `tests/smoke/`, T3 `tests/platform/`, `tests/operational/`, `tests/visual/`) from directory layout + `bunfig.toml` exclusions; flag implementation-coupled vs behavior-pinning suites; write report section 3 — verify: `grep -n "Taxonomy" reports/audit/issue-448/behavior-safety-audit.md`

## 3. Expensive measurements (one pass each, cost order)

- [x] 3.1 Run full-suite coverage with a ≥20 min shell timeout (wrapper demotes to serial under load; never run two full suites concurrently): `bun test:coverage`; parse the lcov report via the repo's `scripts/coverage/` modules into a per-module line/branch table over `src/`, `plugins/`, `client/`, workspace roots — verify: `bun test:coverage`
- [x] 3.2 Run the coverage ratchet and record its per-file verdict vs the 0.90 lines/functions floor — verify: `bun coverage:ratchet`
- [x] 3.3 Run the T0 story-lane coverage gate and record its verdict vs `scripts/story/coverage-floor.json` — verify: `bun test:stories:coverage`
- [x] 3.4 Run the mutation planner (scope + floors only, no Stryker measurement) and extract per-module floors from `scripts/mutation/baseline.json` plus gate semantics (plan → shard → gate, ratchet rules) — verify: `bun test:mutate:plan`
- [x] 3.5 Assemble runtime/flakiness evidence from persisted reports only — suite/gate runtimes via `bun run test:slowest` and `reports/checks/*.log`; note JUnit basename collision and load-demotion behavior; write report section 5 — verify: `bun run test:status && bun run test:slowest`

## 4. Synthesis: matrix, gaps, verdict

- [x] 4.1 Build the critical-path protection matrix (message pipeline `bot-message-handler`, tool-call loop `llm-orchestrator-*`, response delivery, settings persistence + DB migrations, deferred-prompts scheduling/firing, opencode-agent phases, git/issue flows) × (protecting tests, red lane); empty cell = gap; write report section 4 — verify: `grep -n "Protection matrix" reports/audit/issue-448/behavior-safety-audit.md`
- [ ] 4.2 Score each gap as criticality × refactor exposure (exposure from the 1.2 extraction map); write one line per gap naming the behavior-pinning assertion — the user-observable contract a new test would pin, never an internal; write report section 6 — verify: `grep -n "Gap map" reports/audit/issue-448/behavior-safety-audit.md`
- [ ] 4.3 Apply the mechanical verdict rule (restart-safe ⇔ both coverage floors green AND no empty matrix cell on a path the branch extracts); otherwise list the ordered minimum coverage additions, each one testable contract; write report section 7 — verify: `grep -n "Verdict" reports/audit/issue-448/behavior-safety-audit.md`

## 5. Report assembly & posting

- [ ] 5.1 Finalize the report (sections 1–7 per proposal.md — Audit plan; reproducibility self-check: every number cites its command); keep tables compact against the ~65k-char GitHub comment cap and predefine the follow-up-comment split — verify: `wc -c reports/audit/issue-448/behavior-safety-audit.md`
- [ ] 5.2 Post the report to the issue thread: `gh issue comment 448 --body-file reports/audit/issue-448/behavior-safety-audit.md`; if `gh`/token is unavailable, leave the file and record the handoff in the file header instead of installing anything — verify: `gh issue comment 448 --body-file reports/audit/issue-448/behavior-safety-audit.md`
- [ ] 5.3 Final verification: `bun run typecheck && bun run lint`; confirm the full suite's green verdict via `bun run test:status` (the ordinary suite already ran under coverage in 3.1 — read the persisted report, do not re-run on a shared host); `git status --porcelain` must be empty (no tracked file modified, nothing committed); confirm no `docs/architecture/*.md` page needs updating — the report only *proposes* a permanent home (`docs/operations/test-strategy.md`), it never creates one — verify: `bun run typecheck && bun run lint && bun run test:status && git status --porcelain`
