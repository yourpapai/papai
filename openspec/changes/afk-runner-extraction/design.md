<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why. The facts that shape the approach:

- The kernel (`kernel/`, `graph/`, `drive/`, `work/`) is DI-pure: only type imports cross to papai. All runtime coupling concentrates in the edge — `agent-layer.ts`, `agent-seam.ts`, `cli.ts`, `write-guard.ts` — through exactly one call: `runAgent(options) → { value, usage }` plus `agentWritePath`, `realSpawn`, `parsePorcelainPaths`, and the seam types.
- The transitive closure behind `runAgent` is review-loop's whole agent-spawn subsystem: 18 files, 2,886 lines (`agent-runner`, `spawn`, `progress-log`, `line-handler`, `backend-select`, `claude-stream`, `event-stream`, `cost`, `run-stats`, `config`, `worktree`, `todo-capture`, `live-format`, `trace-log`, `diff-stats`, `claude-argv`, `agent-command`, `claude-spawn-dir` — the last joined via `agent-runner`'s imports with #432).
- afk-runner already owns its validation (`z.unknown()` passed; schema parsed in `agent-layer.ts`), session ledger, reporter, retries, and timeouts. `SpawnFn` is already injected; `tests/afk-runner/fixtures/fake-pipeline.ts` already stubs `runAgent`.
- C1's re-homing doctrine was "work modules are copies, never imports" — applied everywhere except this seam, deliberately, because papai was the host. Extraction inverts hostship.
- 105 commits touch `afk-runner/` + `tests/afk-runner/`; 71 also touch `openspec/` (decision artifacts ride with the code). Sole authorship of all of them: verified one author, 110/110.

N/A for this change: chat tool surface / tool-prefs gating (none touched), scope-model ids (no persisted papai state — runner state lives in untracked `.afk-runner/` workdirs inside *target* repos), drizzle migrations (no DB).

## Goals / Non-Goals

**Goals:**

- afk-runner standalone and self-contained: zero imports reaching outside its own root, own toolchain, clone-and-run usable on any repo.
- Full decision lineage travels: code + tests + docs + afk/sdd openspec changes and spec dirs + `sdd-runner/` ancestor paths.
- Every behavioral step proven inside papai's full gates *before* history splits; the split itself is purely mechanical.
- papai-side retirement follows the R5 doctrine: drain-gated deletion commit, rollback = `git revert`, openspec tree untouched.

**Non-Goals:** (beyond proposal.md's list — design-level boundaries)

- No rewrite of the agent backend: behavior-preserving copy, then extract-by-deletion prune. No new abstraction layer over `runAgent` — the existing call shape becomes the seam.
- No attempt to keep filtered history buildable across the pre-severance range.

## Decisions

### D1 — Seam resolution: copy-then-prune to an opencode-only owned backend

Copy the 18-file closure verbatim into `afk-runner/src/agent-backend/` (behavior-identical, diff-reviewable, papai's suite proves the copy), then a separate change-step prunes the claude-API paths (`claude-argv`, `claude-stream`, `backend-select`, `claude-spawn-dir`, the claude branches of `agent-command`/`line-handler`), leaving the opencode-CLI spawn path as the runner's native backend. Provider breadth is delegated to opencode itself — consistent with the default model `opencode` and with the #403 research recommendation (runner builds `OPENCODE_CONFIG_CONTENT` per spawn; opencode is the agent plane).

Alternatives rejected: (a) permanent full-closure fork — a 2,886-line twin diverging from review-loop's copy, carrying a claude-API backend that is review-loop's need, not the runner's; (b) shared `@papai/agent-seam` package — makes the "fully generic" runner depend on papai, backwards; (c) fresh minimal implementation — a rewrite of live-proven behavior where extract-by-deletion keeps the tested paths and their tests.

`write-guard.ts`'s `parsePorcelainPaths` (49 lines, zero imports) and the `p-limit` declaration fold into this phase — after it, a no-upward-imports guard test pins the boundary permanently.

### D2 — Extraction mechanics: `git filter-repo` on a scratch clone

Papai is never touched by the split itself — the new repo is produced from a scratch clone:

```
git filter-repo
  --path afk-runner/ --path tests/afk-runner/ --path sdd-runner/
  --path docs/architecture/afk-runner.md
  --path docs/architecture/afk-runner-mcp-research.md
  --path glob:openspec/changes/afk-runner* --path glob:openspec/changes/sdd-*
  --path openspec/changes/think-half-on-graph --path openspec/changes/gate-as-state
  --path openspec/changes/tail-on-graph --path openspec/changes/agent-failed-recovery
  --path openspec/changes/task
  --path glob:openspec/changes/archive/*afk* --path glob:openspec/changes/archive/*sdd*
  --path glob:openspec/specs/afk-runner-* --path glob:openspec/specs/sdd-*
  --path-rename afk-runner/:./ --path-rename tests/afk-runner/:tests/
```

Plus a fresh minimal `openspec/config.yaml` (papai's is chat-bot-scoped) and a `PROVENANCE.md` recording the extraction source SHA. Alternatives rejected: single-path `git subtree split` (can't carry the multi-path set; deprecated tooling); fresh repo + import commit (loses lineage — declined).

Accepted caveat: commits older than the severance reference `review-loop/` paths that won't resolve — blame and log archaeology work everywhere, bisect-buildability holds only from the severance tip backward. Papai retains the original SHAs.

### D3 — Publish shape: clone-and-run, Apache-2.0

No npm/`bin`/semver. Self-contained toolchain: own `.oxlintrc.json` (copied, pruned to what the runner's tree needs), own format config, package.json scripts without `cd ..`, `p-limit` declared, README covering `bun install` / `bun run src/cli.ts` / the `.afk-runner/config.json` ladder.

License: **Apache-2.0** — reuse is the goal, and BUSL-1.1's default grant is non-production-use-only, which defeats it; Apache adds the patent grant and contribution terms. **FSL-1.1-MIT** is recorded as the operator-reversible alternative if competitor-productization becomes a concern (fair-use grant, auto-converts to MIT in 2 years). Sole authorship makes the re-grant legitimate; Phase C re-headers the copied files. The choice must be final before the new repo's first public push.

### D4 — papai retirement: drain-gated deletion, openspec untouched

Deletion commit inventory: `afk-runner/`, `tests/afk-runner/`, both `docs/architecture/afk-runner*.md` (docs index gets a tombstone pointing at the new repo), root `package.json` workspace entry + `afk-runner:start`, `.claude/` + `.opencode/` `commands/sdd-auto.md` (tombstone), `scripts/mutation/baseline.json` afk entries + README mention, `.gitignore` `.afk-runner` entry, `AGENTS.md`/`CLAUDE.md` references. `openspec/` stays untouched — R5 precedent left `openspec/specs/sdd-runner-*` in place after retirement. `opencode-agent/src/pricing.ts`'s historical comment mention stays.

Drain protocol: Phase C's papai commit lands only when no in-flight runs launched from master checkouts remain (`afk-runner runs` clean); worktree-pinned runs hold their checkout and are unaffected. In-flight processes hold loaded code — Phases A1–A3 (behavior-identical) and A4 (default-model path unchanged) may land while runs are live.

### D5 — Ordering: harden in host → split → retire

Phase A lands inside papai so every step passes the full gate suite (typecheck, lint, mutation ratchet, write-hook TDD); Phase B then splits a green, self-contained tip; Phase C's new-repo CI proves the tip again before papai deletes its copy. The alternative — split first, harden in the new repo — would do behavioral work outside papai's gates with no CI yet standing.

### D6 — In-flight branch disposition: wait-for-landing (complete)

Three worktree branches held work on paths this change moves. The adopted disposition was wait-for-landing — extraction starts only after all three land and merge, so nothing is frozen or re-homed — and it is complete as of 2026-09-09:

- `afk-runner-board-tools` — board tool reports (honest delta spend, tiered feed, history pagination, per-stage accounting): every path (`afk-runner/src/serve/*`, `tests/afk-runner/serve/*`, `docs/architecture/afk-runner.md`, the `afk-runner-board-tool-reports` change) is in D2's filter set; merged into master and travels with the split.
- `agent-mcp-live-target` — the `afk-runner-agent-mcp` change (implementation of the #403 recommendation), merged whole via PR #432 (84ebb2c26, complete incl. the live smoke): the seam work (`opencodeEnv` in `review-loop/src/agent-command.ts`/`agent-runner.ts`) rides the Phase A copy, the afk-runner-side modules (`mcp-servers.ts`, `agent-config.ts`, `agent-spawn.ts`, …) and both `afk-runner*.md` docs travel with the split, and the change dir matches the `afk-runner*` glob. Nothing to re-home.
- `afk-runner-mcp` — empty placeholder branch (0 commits); retired unused.

Rejected and now moot: freeze-and-re-home (would have re-implemented live-proven work on the extracted backend); letting board-tools ride the new repo's history unmerged (filter-repo carries only merged history — which is why wait-for-landing was the gate).

### D7 — Execution vehicle: the runner extracts itself (A and C); the split stays operator-run

Phases A and C are executed by afk-runner itself — the last runs of the papai-hosted runner, and the new repo's first live-proof. Phase A: one run, repoRoot = papai, task ordering copy → rewire → prune-last. Phase C setup (tasks 3.1–3.3): a second run, repoRoot = the new repo. Phase B's `git filter-repo` stays a single operator command — the runner's worktrees and state live under the target's `.afk-runner/`, and a history rewrite beneath a live run destroys its own state; only the post-split validation (task 2.2) is runner material. The Phase C papai deletion stays drain-gated on operator confirmation (D4).

Mid-run safety: the runner loads the closure in-process (`runAgent` is a same-process import), so the running process's module graph is frozen — Phase A's on-disk edits never affect the live run. The one hazard is a *resume* across half-migrated code; excluded by prune-last ordering and run completion before any resume. Gate coverage: per-task gates during the run are the runner's — TDD discipline is baked into each task's red→green verification commands, because the spawned opencode agents do not carry papai's write-hook pipeline; merge-time gates remain papai's full PR suite (test, lint, typecheck, mutation plan/shard/gate), since the run's branch lands through a PR. The worktree-pinned run is exempt from the drain gate by D4.

Target repo: `yourpapai/afk-runner`, private, created during prep — resolving the open question below. Visibility can be revisited before any public push, by which point the D3 license choice must be final.

## Risks / Trade-offs

- [Prune drops a path a live-proven scenario needs] → U13 audit complete; default model `opencode` everywhere; no claude-model configs exist; golden fixtures (`tests/afk-runner/fixtures/real/`) are opencode runs and must stay green through the prune.
- [Filtered history unbuildable before severance] → accepted (D2); `PROVENANCE.md` records the boundary; papai keeps originals.
- [New repo's gates weaker than papai's] → CI replicates test/typecheck/lint; mutation ratchet and write-hook TDD deliberately declined (proposal Non-goals) — explicit quality debt, revisit after the runner's first standalone cycle.
- [filter-repo path set misses something] → post-split validation checklist as a task: tree diff against the source paths, `openspec validate` in the new repo, full suite green at tip, U-ledger doc present.
- [Run launched mid-cutover from master] → drain gate + tombstone command file states the new entry point; rollback is `git revert`.
- [Runner run resumes across half-migrated backend code] → D7 ordering: the prune is the Phase A run's last task and the run completes before any resume; a broken mid-run state still rolls back with `git revert` plus runner-state cleanup.

## Migration Plan

Phase A (papai, landable independently): A1 copy closure → A2 rewire imports (10 src, 19 test) → A3 `p-limit` + no-upward-imports guard test → A4 opencode-only prune (behavior change, own review). Phase B: scratch-clone filter-repo, validation checklist, push new repo. Phase C: new-repo setup (license re-header sweep, CI, configs, README, fresh openspec config) → drain gate → papai deletion commit. Execution vehicle (D7): Phase A as one runner run (prune-last), Phase B as one operator command (filter-repo → push to `yourpapai/afk-runner`), Phase C setup as a second runner run in the new repo, papai deletion drain-gated on the operator. Branch pre-flight (D6) is complete — all three branches landed. Rollback: A/C = `git revert`; B = delete the new repo (papai untouched until C).

## Open Questions

- Resolved (D7): the new repo is `yourpapai/afk-runner` (private), created during prep. Only visibility/naming at a future public push remains open — which affects no path rename or task; the D3 license choice must be final before that push.
