# Behavior-safety test audit before restarting the plugin-core refactor (issue #453, re-run of #448)

## Goal
Answer, with measured data reported durably: can the plugin-core refactor (PR #166, branch `plugin-core-separation`) restart safely — i.e. would current master's tests catch any regression an end user would notice? The deliverable is the report itself, posted as comment(s) on issue #453 (the #448 lesson: its report died in gitignored `reports/`), plus the OpenSpec change folder carrying a durable copy. No production or test behavior changes.

## Capabilities
None — skip_specs proposed because this is research-only measurement and reporting; a downstream observer of the system's contract sees no added, changed or removed requirement.

## Context already verified on master
- Coverage ratchet: `scripts/coverage/floor.json` = lines 0.90 / functions 0.90, enforced by `bun run coverage:ratchet` (wired into `scripts/check.sh`). Story-lane floor: `scripts/story/coverage-floor.json` = 0.72 lines / 0.70 functions via `test:stories:coverage` gate.
- Mutation gate: `scripts/mutation/baseline.json` (per-file floors, ~1850 lines), planner `test:mutate:plan`, ratchet semantics per AGENTS.md.
- Lanes per `bunfig.toml`: default hermetic suite excludes `tests/e2e/**`, `tests/client/**`, `tests/visual/**`, `tests/stories/**`, `docs/**`; lanes run via `test:e2e`, `test:smoke`, `test:platform`, `test:operational`, `test:client`, `test:stories`.
- Refactor sources: branch `plugin-core-separation` is fetched locally (origin ref 5646138d); `openspec/changes/hermetic-e2e-core-separation-proof/` describes its cut lines (`src/modules/`, `src/ports/`); `plugin-core-separation-toolgate` change and `docs/superpowers/plans/2026-07-08-plugin-core-separation-*.md` describe phases. All to be re-read against current master, not trusted stale.

## Method (every number cites the command that produced it)
1. Refactor map: `gh pr diff 166` / `git diff master...origin/plugin-core-separation`; list modules separated, where the plugin interface level sits, seams cut; map onto current master `src/`/`plugins/`; measure staleness (merge-base date, files changed since).
2. Coverage: `bun run test:coverage` (full suite) → per-module line/branch table over `src/`, `plugins/`, `client/`, workspace roots, parsed from `reports/coverage/lcov.info` using existing readers (`scripts/coverage/normalize-lcov.ts`, `ratchet-lib.ts`) — reporting only; lane coverage via `test:platform:coverage`, `test:operational:coverage`, `test:stories:coverage`; record verdicts: `coverage:ratchet` vs 0.90/0.90 and story floor vs 0.72/0.70; name weakest-covered modules the refactor will touch or extract.
3. Taxonomy: hermetic units / integration / behavioral lanes (T0 stories, e2e, smoke, platform, operational, visual) per bunfig lanes + `bun run test:audit`; flag implementation-coupled vs behavior-pinning suites.
4. Protection matrix: message pipeline, tool-call loop, response delivery, settings persistence + migrations, deferred-prompts scheduling/firing, opencode-agent phases, git/issue flows × (protecting tests, red lane). Empty cell = gap.
5. Quality machinery: `bun run test:mutate:plan` scope + per-module floors from `scripts/mutation/baseline.json`; ratchet behavior; known flakiness; runtimes — can these gates carry a refactor of this size?
6. Gap map: criticality × refactor exposure (from the step-1 extraction map); one line per gap naming the user-observable contract a new test would pin — never an internal.
7. Verdict: restart-safe as-is, or minimum coverage additions that must land first, under the mechanical rule: floors green under ratchets AND no empty matrix cell on an extracted path.

## Deliverable discipline
- Post the full report to issue #453 as comment(s) (`gh issue comment`), split across comments if over the size cap; retry on failure; if posting fails, state that explicitly in the thread attempt and keep the report in the change folder.
- State the verdict explicitly even if partial; unmeasurable items are reported as such, never silently skipped. Checklist ticks reflect reality.

## Files to touch
- `openspec/changes/behavior-safety-test-audit/` only (scaffolded via `openspec new change`; carries proposal/design/tasks + durable report copy; rides its own PR per pipeline reality).
- No production code, no existing tests, no new tooling — the audit must measure the project as it is. `reports/` stays gitignored; the thread is the deliverable.

## Intended behaviour change
None.

## Verification
- Report posted on issue #453 (comment URL recorded in the change folder).
- All 7 sections present; each measured claim cites its producing command.
- Floors verdicts stated: `coverage:ratchet` pass/fail vs 0.90/0.90; story gate vs 0.72/0.70; `test:mutate:plan` scope summarized.
- No diffs outside `openspec/changes/behavior-safety-test-audit/`.

## Assumptions (maintainer may veto on the thread)
- The LLM-driven `audit:behavior` pipeline is out of scope (needs an OpenAI key; not among the issue's listed tooling) — taxonomy comes from bunfig lanes, suite structure, and `test:audit` output.
- "Per-module table" granularity = top-level module per root (`src/<module>`, `plugins/<name>`, `client/<area>`, workspace roots), not per file.
