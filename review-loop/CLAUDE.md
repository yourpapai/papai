# review-loop Workspace

## Purpose

`review-loop/` is a standalone Bun workspace for the shell-invoked autonomous code-review loop runner. It spawns reviewer and fixer `opencode run` agent subprocesses via shell calls with file-based JSON exchange, collects reviewer issues into a durable ledger, and drives multi-round verify/fix cycles. It is local developer tooling, not a papai runtime dependency.

Agent subprocess guards live in `src/spawn.ts` + `src/agent-runner.ts`: besides the wall-clock `timeout`, an optional `inactivityTimeoutMs` watchdog kills a child that produces no stdout (hung LLM stream) and reports `stalled: true`; `runAgent` retries a stall once but never retries a wall-clock timeout. Callers opt in by passing `inactivityTimeoutMs` through `RunAgentOptions` (mutation-improve wires it from `agent.inactivityTimeoutMs`; review-loop's own config does not yet).

A run has a **soft stop** of its own (`src/stop-controller.ts`): `runTimeoutMs`
(config, `0` = no budget) and `SIGINT`/`SIGTERM` both ask the loop to stop, and it
honours that between two issues and between two rounds — the boundaries where the
fix in hand is committed, build-checked, merged and, under `mergeEachFix`,
published. A stopped run writes its artifacts, **skips `finalizeRun`** (a
multi-minute build gate whose only possible outcome, on a run out of time, is to
throw away what the stop existed to keep), prints `[review-loop] stopped:` and
exits **75** — neither 0 nor 1, because the loop neither finished nor broke.
`doneReason: 'stopped'` rides out through `summary.txt` and `metrics.json`. A
second signal exits 130. `opencode-agent` sets `runTimeoutMs` from the job's own
clock and kills the child a wrap-up slice later; see its `reviewBudget`.

`commitAuthor` (config, optional) is applied as `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
on the process at startup (`src/git-identity.ts`), so every git child — commit,
rebase, merge, and the fixer subprocess's own commits — inherits it. Absent means
"whoever git already thinks", which is right on a laptop and impossible on a
hosted runner: with no `user.name` anywhere, `git commit` fails outright with
_Author identity unknown_ and the fix is recorded as `needs_human`.

`mergeEachFix` (config, default off) moves the merge back into the checkout from
"once at the end, behind the build gate" to "each fix, as it is accepted", and
prints `[review-loop] published …` when it does — see `src/publish-fix.ts`. It is
for unattended runs whose checkout is deleted when the job ends: there, an atomic
merge means a red build gate or a killed runner takes every accepted fix with it,
and the marker is what lets the caller push. The hook runs under the pool's
primary lock and never throws; `finalizeRun` still does the final merge.

## Fix instruction contract

Three rules the fix prompts carry, all of them shaping the fix at generation time rather than
gating it afterwards — a gate rejects only once the fixer's 5–21 minutes and the build check are
already spent.

**Minimality** (`MINIMALITY_LADDER`) runs _after_ comprehension: must it exist, is it already
here, does stdlib or an installed dependency do it, can it be one line. It says outright that a
smaller diff is not the goal, so it cannot be read as licence to drop validation, error
handling, security, or a test. Both retry prompts carry it too — a second attempt is where scope
creeps, because the first failed and more feels like the answer.

**Check-behind** (`CHECK_BEHIND_RULE`) requires non-trivial logic to leave one runnable check in
the test path this repo already maps the file to, and states that a scratch reproduction deleted
afterwards does not count.

**No prose** (`NO_PROSE_RULE`) extends the existing plan/spec prohibition to architecture
documentation: name the file and report the gap in `reasoning` instead. The loop cannot keep
prose true — no actor sees two fixes, and the terminal round's fixes are never reviewed — so a
paragraph one fix writes and a later fix invalidates ships confidently wrong.

The orchestrator records one advisory boolean per accepted fix: did its diff touch a test path
(`measureCheckBehind`, `commit-attempt.ts`). It gates nothing and touches no retry budget; it
exists to say whether the check-behind rule is being followed. It is measured **before** the
merge, because `mergeWorkerIntoPrimary` rebases the worker branch and the baseline stops being
an ancestor. A measurement that fails is `unmeasured`, reported apart from both answers — an
unreadable diff is not a fix that skipped its test. See the `Checks left behind:` summary line
and [ADR-0425](../docs/adr/0425-review-loop-fix-minimality-and-check-behind.md), which records
why the inspector was the wrong host for any of this.

## Exposure

Severity grades what happens _if_ the code is reached; **exposure** records whether it is
reached at all. Both the reviewer and the fixer report it, as a citation rather than a rating:
the file, line, and quoted line of a caller they actually found, or `{kind: 'none'}` if they
searched and found nothing. Absent is a third state — `unknown` — meaning nobody answered, and
it is never read as "nothing reaches this".

It is **advisory and gates nothing**. Its one effect is dispatch order (`orderByExposure` in
`src/issue-processor.ts`): cited callers are fixed first, then unknown, then none. That is the
loop's first ordering of any kind — `processPendingIssues` previously walked `pending` by index,
fixing issues in whatever order the reviewer emitted them. A run that reaches the end still
fixes everything it admitted; ordering only decides what gets fixed while budget remains, which
is the whole of what a stopped run spends.

The fixer's answer is asked for independently and never resolves the reviewer's — the two are
compared, not reconciled. Divergence is counted per fixer result (`tallyExposure`), rides the
`verify_complete` trace event, and lands in `RoundMetric` and the summary's `Exposure:` line.
An `unknown` on either side is silence, not disagreement, and is not counted.

That divergence record has one named reader: the later change that decides whether exposure may
ever gate admission. Nothing verifies a citation mechanically, and deliberately so — caller
analysis is blind to this repo's manifest dispatch (`plugin.json` `main`) and its string-path
`bun run <daemonEntry>` spawn, so it would report live plugin entry points as unreachable.
Mutation score can be verified because Stryker is an oracle; reachability has none, so the loop
measures whether its two actors agree instead of pretending to check them.

## Storage / Artifacts

- The default `workDir` is `.review-loop/` relative to `repoRoot` (see `config.example.json`). The directory is created on demand via `mkdir`.
- `createWorktree` runs `bun install` in the fresh worktree (skipped when no `package.json`): worktrees live under the main checkout so most deps resolve by walking up to its root `node_modules`, but non-hoisted workspace deps (e.g. opencode-agent's `@octokit/rest`) do not, and the build gate fails on TS2307/import errors without the install.
- Per-run state lives at `<workDir>/runs/<runId>/state.json` (see `src/run-state.ts`).
- Progress logs and transcripts land alongside the run state (see `src/progress-log.ts`).
- `config.example.json` at the workspace root documents the expected config shape; real configs are loaded from the path passed via `--config` (defaults to `.review-loop/config.json`). The optional top-level `pricing` map (USD per 1M tokens, glob-matched against the agent model) enables estimated-cost display.

## Run Stats

`src/run-stats.ts` (pure aggregate), `src/cost.ts` (pricing lookup), and `src/diff-stats.ts` (git numstat at worker merges) feed the `LiveRenderer` footer's aggregate segments (total tokens, `~$ est`, tool calls, `+a/-r`) and the final summary's `Stats:` line. Aggregates persist to `metrics.json` (`runStats` block) and rehydrate on `--resume-run`; stats accumulation is independent of the EPIPE downgrade, and segments are hidden when zero/unpriced.

The `LiveRenderer` folds all agent progress into one live line per slot key; `commit(key, line?)` freezes a slot as a permanent scrolled line (line-handler commits on agent dispose unless `commitOnDispose: false`). Non-TTY output prints only `event()`/`commit()` lines — `slot()`/`live()` updates are suppressed.

## Scripts

Run workspace commands from the repo root:

- `bun run review-loop:test`
- `bun run review-loop:typecheck`
- `bun run review-loop:lint`
- `bun run review-loop:format:check`
- `bun run review-loop:start -- --config <path> --plan <path>`

`--plan` is plan-format-agnostic (it parses `- [ ]` checkboxes from any markdown
file resolved against the repo root). For OpenSpec-tracked work, point it at the
change's task list: `--plan openspec/changes/<name>/tasks.md`.

## TDD Hooks

The repo TDD resolver treats `review-loop/src/**` as gateable implementation code and maps it to `tests/review-loop/**`. New review-loop work must follow the same test-first flow used under `src/` and other repo-owned implementation paths.

## Dependencies

- `zod` — runtime config/schema validation (shared with root).
