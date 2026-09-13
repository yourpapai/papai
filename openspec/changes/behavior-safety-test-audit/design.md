# Design: behavior-safety test audit

## Context

The audit answers one question with measured data — can the plugin-core refactor (PR #166, branch `plugin-core-separation`) restart safely — and its only deliverables are the report on issue #453 plus a durable copy in this change folder (see proposal.md, Why and Deliverable discipline). Current state that shapes the how:

- The machinery the audit must judge already exists and is wired: coverage floors `0.90/0.90` (`scripts/coverage/floor.json`, enforced by `coverage:ratchet` inside `scripts/check.sh`), story lane floors `0.72/0.70` (`scripts/story/coverage-floor.json` via `test:stories:coverage`), and per-file mutation floors (`scripts/mutation/baseline.json`, plan → shard → gate). `bunfig.toml` defines the lane split: the hermetic default excludes `tests/{e2e,client,visual,stories}/**` and `docs/**`; the other lanes run via their dedicated scripts.
- Coverage output is parseable today: `reports/coverage/lcov.info` plus existing readers (`scripts/coverage/normalize-lcov.ts`, `scripts/coverage/ratchet-lib.ts`). No lcov tooling needs to be written or installed.
- The refactor branch is fetched locally (origin ref `5646138d`), but its cut lines are described by stale artifacts (`openspec/changes/hermetic-e2e-core-separation-proof/`, `plugin-core-separation-toolgate`, `docs/superpowers/plans/2026-07-08-plugin-core-separation-*.md`) that must be re-derived from git, not trusted.
- `reports/` is gitignored build output — the #448 failure mode (report died in `reports/`) this change exists to avoid.
- The audit is measurement and reporting only: `skip_specs: true`, no runtime or test behavior change, so every design decision below is about evidence capture, aggregation, and delivery.

## Goals / Non-Goals

**Goals:**

- An evidence-first execution order: every measured claim enters the report only after the command that produced it has run and its output is persisted or captured.
- A durable, self-contained artifact pair inside the change folder (`report.md`, `posting-log.md`) that survives independently of gitignored `reports/` and of the GitHub thread.
- A mechanical, pre-agreed verdict rule, so `restart-safe` is not a judgment call made after seeing the data.

**Non-Goals:**

- No production, test, or tooling changes — where gaps are found, the report names the missing user-observable contract; it does not write the tests.
- No new lint/type/mutation/CI machinery and no `.github/workflows/` files (none is needed, and this pipeline's token could not push one).
- No re-implementation or wrapping of coverage/mutation parsing.

## Decisions

### D1 — Evidence-first order of work (the TDD analogue for a report-only change)

Sections are produced in proposal method order (map → coverage → taxonomy → matrix → machinery → gaps → verdict), with a hard rule: a number may enter `report.md` only after its producing command's output exists in the session or under `reports/`. Expensive commands (`test:coverage`, lane coverage runs, the hermetic suite) execute once; every follow-up question is answered from the persisted artifact (`reports/coverage/lcov.info`, `reports/test/last-run.json`), per the repo's `run once, then read` convention — which also bounds wall time on a shared host.

*Alternative considered*: reusing the #448 audit's numbers. Rejected — they describe an older master; measuring staleness against current master is the point, and every section re-measures.

### D2 — Durable artifacts live only in the change folder

Two files join the scaffolded folder:

- `report.md` — the full audit, one section per method step 1–7; each measured claim cites `command → run date → source artifact`.
- `posting-log.md` — per comment: content range, byte size, post result, comment URL or failure text, with timestamps.

Raw command transcripts stay in gitignored `reports/` and are cited, never committed. The report header stamps the exact HEAD SHA, the merge-base SHA of the refactor branch, and the audit date, so later master movement cannot silently invalidate the numbers.

### D3 — Reuse the existing coverage readers; no new module, no new dependency

Per-module tables are aggregated from `reports/coverage/lcov.info` using the existing `normalize-lcov.ts` / `ratchet-lib.ts` exports; the grouping itself (top-level `src/<module>`, `plugins/<name>`, `client/<area>`, workspace roots) is trivial and done in throwaway `bun -e` expressions. If aggregation ever outgrows a one-liner, the helper is written inside `openspec/changes/behavior-safety-test-audit/` — putting it under `scripts/` would contradict the proposal's `no new tooling` boundary.

*Dependency question, one level in*: the parsing need is already covered in-repo (the two readers), so no lcov library is added; GitHub posting is the `gh` CLI named by the proposal; the runtime stack (AI SDK, Grammy, discord.js, Zod, drizzle) is irrelevant to a measurement change. Zero npm dependencies are added.

### D4 — Refactor map re-derived from git at audit time

The map comes from `gh pr diff 166` / `git diff master...origin/plugin-core-separation`, with the merge-base recorded in the report. The stale design docs are read as hypotheses to verify against the current tree, never as inputs. Staleness itself is measured (files changed under refactor-touched paths since the merge base), which also feeds the gap map's refactor-exposure axis.

### D5 — Mechanical verdict rule, stated before the data

`restart-safe as-is` ⇔ (`coverage:ratchet` green vs `0.90/0.90`) ∧ (story gate green vs `0.72/0.70`) ∧ (no empty protection-matrix cell on an extracted path). Otherwise the verdict lists minimum additions: exactly one behavior-pinning test per empty cell, each phrased against a user-observable contract (message pipeline, tool-call loop, response delivery, settings persistence + migrations, deferred-prompt scheduling, opencode-agent phases, git/issue flows) — never an internal. The rule is written into the report before the measurement sections, so it cannot be bent to fit the outcome.

### D6 — Posting mechanics

`gh issue comment 453`, split at section boundaries into comments of ≤ ~55 000 characters (GitHub's 65 536 cap with margin), posted sequentially; each comment's URL lands in `posting-log.md` and the report header references the list. Failures retry with backoff; if posting proves impossible (auth, network), the attempt is logged explicitly and the durable copy stands alone — never silence. `gh auth status` is checked before any posting work so degradation happens early, not after the report is final.

### D7 — Governance surface impact (required notes)

- **Capability / tool-prefs gating**: no impact. The change introduces no papai tool, no capability, no `tool_prefs` entry; `gh` and `bun` are agent-side CLIs, not runtime tool surfaces.
- **Scope model**: no impact. No new persisted application state — nothing keyed by storage context id, config context id, platform instance, or user. The only durable state is git-versioned files in the change folder (global, not context-scoped) plus the GitHub thread keyed by issue number.
- **DB**: none. No drizzle migration, no backfill.
- **New modules**: none — the existing coverage readers and lane scripts cover every need (D3).

### D8 — Hook / TDD pipeline interactions

New files are all under `openspec/changes/behavior-safety-test-audit/`: `design.md`, `tasks.md`, `report.md`, `posting-log.md`. None matches `isGateableImplFile` (gateable roots: `src/`, `client/`, `plugins/`, `review-loop/src/`, `opencode-agent/src/`), so the Write/Edit hook pipeline never fires — no write-policy block (plain markdown, no suppressions), no test-first nudge, no import gate — and the mutation ratchet selects zero targets for this change. Since no `tests/` file is created, TDD order has no hook enforcement here; D1's evidence-first rule is its substitute, and D5's pre-committed verdict rule keeps the reporting honest.

## Risks / Trade-offs

- [Stale refactor map misleads the gap map] → Re-derive from git (D4); record merge-base SHA; stale docs are hypotheses only.
- [Long or flaky lane runs produce a misleading matrix] → Every verdict cites its command and run date; one logged re-run separates flake from regression; a red cell is reported red with the failure attached, never re-run until green.
- [Unmeasurable items tempt silent omission] → Proposal discipline applies: reported as unmeasured with the blocking reason, and the verdict states partiality explicitly.
- [A comment exceeds the size cap or posting fails mid-split] → ≤ ~55k per comment, split at section boundaries so each is self-contained; `posting-log.md` preserves order and failure text; the durable copy is the source of truth either way.
- [`gh` lacks auth in the CI job] → `gh auth status` before posting work; degrade early to durable-copy-only with an explicit log entry.
- [Master moves mid-audit] → HEAD SHA and date stamped in the report header; post-snapshot movement is noted, never silently absorbed.

## Migration Plan

None applicable — no runtime, schema, or config artifact changes. Rollout is this change's own PR carrying `report.md` and `posting-log.md`; rollback is reverting the PR. Corrections to the issue thread are follow-up comments, never silent deletes or edits.

## Open Questions

None. Remaining unknowns (exact comment split points, retry counts, helper form) are pinned above with defaults and are not load-bearing for the specs, the approach, or the task breakdown.
