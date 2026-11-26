<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

# Evidence notes — afk-runner-service

## Phase 0 — gate attendance over the retained corpus (2026-09-09)

Command (read-only, exit 0), the five retained workdirs (the U13 substrate —
2 C9 + 3 C8 workdirs, 9 runs, 0 era-contaminated):

```
bun afk-runner/src/cli.ts analyze \
  ~/Projects/yourpapai/u3-live-proof-target-p/.sdd-runner \
  ~/Projects/yourpapai/u3-live-proof-target-u/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-a/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-b/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-c/.sdd-runner \
  --json
```

Aggregate (`aggregates.gateAttendance`):

| fact                    | value                                        |
| ----------------------- | -------------------------------------------- |
| answered gates          | 29                                           |
| human-settled           | 26 (rate **0.897**)                          |
| policy-settled          | 3 (all presentation-time prelude, ~0m waits) |
| waiter-settled          | 0                                            |
| never-answered pending  | 0 (beside the rate, per the spec)            |
| unknown / reduced cover | 0                                            |
| human-wait median       | 748,807 ms (~12.5m)                          |
| human-wait upper bound  | 35,719,321 ms (~595m ≈ 9.9h)                 |

Per-run shape: the two C8 matrix runs carry 8 and 12 human-settled gates with
waits from 2m to 595m (the long tail is the overnight-parked pair 329m/595m);
the scratch/short runs contribute 1–2 gates each at 1m–13m; the three
`count-killed-turns` policy settles are R-rule prelude records with ~0m waits.

### Promote/demote reading for the Phase 3 settle plane (design D6)

- **Promote.** 89.7% of answered gates were settled by a human and the median
  human wait is ~12.5 minutes — supervision demand is real, recurrent, and the
  waits are operator-visible wall time. Under design D6's rule ("high
  human-settle rate → settle plane early"), the settle delegation half of the
  bridge earns the first slot when Phase 3 is proposed.
- The waiter settled nothing in this corpus — the deadline ladder absorbed
  what it could before presentation, so remote settle would not be competing
  with automation; it replaces the human channel for the 89.7%.
- Caveats per the design's risk row: this measures the past, n=9 runs from 3
  cycles, one operator, and the corpus's gates skew toward the C8 matrix's
  attended drills. Pricing input, not proof; the metric re-runs cheaply
  (`analyze --json`) on every future corpus, and the numbers land in this
  section each time.

## Phase 1 — central-store dogfood

### WorkDir ⊆ repoRoot audit (task 2.2, 2026-09-09)

Swept every path construction in `afk-runner/src/` for an assumption that
bookkeeping sits under the repo root. **Zero defects found.**

- Bookkeeping paths all flow from the resolved config —
  `path.join(workDir, 'runs', …)` in `run.ts`, `run-state.ts`, `run-index.ts`,
  `run-stop.ts`, `run-resume.ts`, `run-lite.ts`, `accounting.ts`,
  `work/report.ts`, `serve/load.ts`, `serve/sweep.ts`, `analyze-io.ts`, `cli.ts`
  — and runDir-derived joins (`gate-waiter.ts`, `stop-controller.ts`,
  `session-ledger.ts`, `drive/loop.ts` `dirname(logPath)`) inherit the same
  root. No verb re-derives workDir from repoRoot.
- `config.ts:141` resolves `workDir` via `path.resolve(repoRoot, workDir)` —
  an absolute value wins; pinned as contract by the new `config.test.ts`
  cases (task 2.1), including "nothing under `<repoRoot>/.afk-runner/` beyond
  the config" and "the store's own config.json is never a launch surface".
- Near-finding examined and cleared: `work/gate-prelude.ts:96` computes
  `path.relative(repoRoot, runDir)` for the R3 assumption-boundary join. With a
  relocated store this yields a `../`-prefixed string, but the join is
  transform-consistent — the artifact-event paths it is compared against are
  recorded through the same `path.relative(repoRoot, …)` (`work/materialize.ts`)
  — and any mismatch classifies fail-closed (high-blast), never vacuously
  low-blast. Not a defect.
- The write guard (`write-guard.ts`) judges git-dirty repo paths; a store
  outside the repo never appears in `git status`, so guard semantics are
  unchanged by relocation.
- The memo already persists `repoRoot` (`run.ts` `seedRepoState`) — the field
  the shared-store spec needs to attribute runs to worktrees.
- Agent scratch/report paths (`agent-layer.ts` → `agentWritePath`) resolve
  against the agent's cwd, not the run dir — unaffected.

Verification: `bun run typecheck` clean; `bun test tests/afk-runner/` green.

### Dogfood record (tasks 3.1–3.3)

#### 3.1 Move-and-cutover (2026-09-09, copy-never-move)

Store: `~/.afk-runner/projects/papai/` (slug = repo dir name, design's Phase 1
choice). The two live worktrees of the papai repo — `afk-runner-u13` (2 runs)
and `agent-mcp-live-target` (1 run) — were cut over:

1. `mkdir -p ~/.afk-runner/projects/papai/runs`; `cp -R` each worktree's
   `.afk-runner/runs/<id>` into it (originals left intact).
2. Each worktree's `<repoRoot>/.afk-runner/config.json` rewritten as the
   pointer: `{"repoRoot": <abs worktree>, "workDir": "/Users/ki/.afk-runner/projects/papai", …}`
   — model/budget/deadline keys carried over unchanged.
3. Verification (this worktree's CLI, `cwd` = each target worktree):
   - `runs` from **both** worktrees renders the identical 3-run roster with
     the shared-store repo column distinguishing the two `repoRoot`s.
   - `status afk-runner-agent-mcp` from `afk-runner-u13` resolves and folds a
     run **started by the other worktree** through the store.
   - `serve --port 4699 --token …`: `/api/portfolio` returns 3 cards each
     carrying its `repoRoot`; wrong token → 401; board stopped cleanly.

#### 3.2 Attended gate cycle through the store (live, 2026-09-09)

A depth-S scratch run (`store-dogfood-scratch`, metered, $0.38) started in
`agent-mcp-live-target` with the pointer config in place:

- **Pointer names the store**: the park line printed
  `resume: afk-runner resume store-dogfood-scratch — answer /Users/ki/.afk-runner/projects/papai/runs/store-dogfood-scratch/gate-1.md`.
- **Hand settle at the store location**: `APPROVE` appended to that gate file;
  `resume` re-entered, the waiter picked the answer up **11.4s** after the
  hand-edit (resume startup + the 1s poll — no observable cross-directory
  polling latency), settled through the standard render-back/integrity/mover
  seam (`gate-hashes-1.json` verified, gate file answered in place), and the
  run completed. No waiter/steer latency change is observable at 1s poll
  granularity across directories on one machine.
- **Repo attribution**: the completed memo carries
  `repoRoot: …/agent-mcp-live-target`, `workDir: /Users/ki/.afk-runner/projects/papai`.
- **Change folder locality**: the mover wrote
  `openspec/changes/store-dogfood-scratch/` in the worktree only; the store
  holds nothing but `runs/`.

**Grouping-by-project decision: ride Phase 2.** The repo column (roster) and
repoRoot lines (portfolio cards) already distinguish worktrees in one store —
at the dogfood's scale (2 worktrees, 1 project) grouping UI adds nothing; the
Phase 2 one-board-over-N-stores daemon is where per-project grouping earns
its keep. Consistent with the proposal's non-goal.

#### 3.3 Rollback drill (2026-09-09)

`afk-runner-u13`'s config flipped back to `"workDir": ".afk-runner"` (its
original keys; the store's copies and the other worktree's pointer untouched):

- A new run (`rollback-probe-scratch`, depth-S, interrupted ~20s after start —
  the landing, not the drive, is the drill) created its full bookkeeping set
  (events.ndjson, state.json, task.md, holder.json, sessions.jsonl,
  transcripts/) under `<repoRoot>/.afk-runner/runs/`; its memo carries the
  local workDir and the worktree repoRoot.
- The store was not touched: `runs` from the still-store-pointed
  `agent-mcp-live-target` lists all 4 historical runs (including the completed
  3.2 dogfood run) folding and rendering unchanged — no migration step.
- Rollback = one config key flip; nothing else to undo.

### Cost of the dogfood

Two live runs: the attended cycle ($0.38, completed) and the interrupted
rollback probe (partial, < $0.10 of intake work). Both artifacts left in place
as drill evidence, matching the repo's live-proof idiom.
