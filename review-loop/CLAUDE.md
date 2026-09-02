# review-loop Workspace

## Purpose

`review-loop/` is a standalone Bun workspace for the shell-invoked autonomous code-review loop runner. It spawns reviewer and fixer agent subprocesses via shell calls with file-based JSON exchange, collects reviewer issues into a durable ledger, and drives multi-round verify/fix cycles. It is local developer tooling, not a papai runtime dependency.

## Agent Backend Selection

One run-wide knob selects which CLI serves every agent role. The `backend` field
lives **inside the per-role agent blocks** (`reviewer`/`fixer`/`matcher`/`inspector`)
with values `"opencode"` (the default) and `"claude"` — there is no top-level key,
and a top-level spelling is silently stripped by config parsing. Each role may
omit the field; every role that names it must agree, or config validation fails
naming "one backend per run". The default `opencode` route is byte-identical to
the pre-knob loop: no `claude` process spawns and no Anthropic credential is read.

The `claude` route shells out to the official Claude Code CLI instead of
`opencode run`:

- **Credentials select the profile.** Exactly one of `ANTHROPIC_API_KEY`
  (→ the bare profile, `--bare`) or `CLAUDE_CODE_OAUTH_TOKEN` (→ the native
  profile with the neutralization flags) must be set — both or neither refuse
  before any spend, as does a set `LLM_API_KEY`. A present-but-empty value
  reads as unset, because CI forwards unset secrets as `''`.
- **CLI state is run-scoped.** Each spawn gets its own `CLAUDE_CONFIG_DIR`
  under an OS-tmp parent created at run start and removed at teardown — never
  inside a worktree, so no loop commit can stage it.
- **One model knob serves either backend**: a `provider/model` spelling keeps
  its model id.
- **Usage accounting is unchanged** — token/cost totals, live lines and
  `metrics.json` carry the same fields, counted once per turn from the claude
  `result` line.

Operator trade-offs on the claude route: analysis roles (reviewer, matcher,
inspector) get **no `Bash`** — the prompts direct `git diff`/`rg` calls those
roles cannot run, so each turn eats refused calls (recorded refusal shape, no
tool effect); turns killed before their `result` line are invisible to usage
totals (under-count, same as the parent route); there is no retry layer beyond
the loop's standing retry-once-on-stall; the OAuth spelling bills against
five-hour subscription windows and a quota exhausted mid-run is an ordinary
turn failure. The credential is readable by the fixer's `Bash` children (the
accepted fixer residual); the loop scrubs it from its own logs and captures.

**Install the pinned CLI** — `@anthropic-ai/claude-code@2.1.251`, the version
the fixture corpus and the allowlist doctrine were recorded against. A drifted
CLI presents as the missing-`result`-line attempt failure (every NDJSON line
unrecognized); an absent binary presents as `spawn claude ENOENT` — retried
once per the standing policy, then an `AgentRunError` naming the label. Both
mean "install the pinned CLI", not a PATH problem.

## Agent subprocess guards

Agent subprocess guards live in `src/spawn.ts` + `src/agent-runner.ts`: besides the wall-clock `timeout`, an optional `inactivityTimeoutMs` watchdog kills a child that produces no stdout (hung LLM stream) and reports `stalled: true`; `runAgent` retries a stall once but never retries a wall-clock timeout. The stall retry continues the killed attempt's session when its line handler captured an id — the re-spawn carries the backend-mapped continuation flag (`--session <id>` opencode, `--resume <id>` claude, composed in `buildAgentCommand`) instead of minting a fresh session, and re-sends the same prompt into it; with no captured id the retry argv is byte-identical to the pre-change fresh re-spawn (escalation-retry-session-continuation D4, unconditional for every consumer). Callers opt in by passing `inactivityTimeoutMs` through `RunAgentOptions` (mutation-improve wires it from `agent.inactivityTimeoutMs`; review-loop's own config does not yet).

A run has a **soft stop** of its own (`src/stop-controller.ts`): `runTimeoutMs`
(config, `0` = no budget) and `SIGINT`/`SIGTERM` both ask the loop to stop, and it
honours that between two issues — between two batches under `batchVerify`, which
also asks `remainingMs()` before each batch starts so a cluster the budget cannot
fit is deferred instead — and between two rounds: the boundaries where the
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

Four rules the fix prompts carry, all of them shaping the fix at generation time rather than
gating it afterwards — a gate rejects only once the fixer's 5–21 minutes and the build check are
already spent.

**Minimality** (`MINIMALITY_LADDER`) runs _after_ comprehension: must it exist, is it already
here, does stdlib or an installed dependency do it, can it be one line. It says outright that a
smaller diff is not the goal, so it cannot be read as licence to drop validation, error
handling, security, or a test. Both retry prompts carry it too — a second attempt is where scope
creeps, because the first failed and more feels like the answer.

That constant is **exported and shared beyond this workspace**. `opencode-agent` carries the
same text as `MINIMALITY_RULE` in its own `prompts.ts` — duplicated rather than imported,
because it drives this workspace as a subprocess and imports nothing from it — and
`tests/opencode-agent/minimality-rule.test.ts` asserts the two are equal. `CLAUDE.md` states it
a third time for the main agent, in prose no test can pin. Reword it here and that test fails;
that is the intended way to find every carrier.

**Check-behind** (`CHECK_BEHIND_RULE`) requires non-trivial logic to leave one runnable check in
the test path this repo already maps the file to, and states that a scratch reproduction deleted
afterwards does not count.

**No prose** (`NO_PROSE_RULE`) extends the existing plan/spec prohibition to architecture
documentation: name the file and report the gap in `reasoning` instead. The loop cannot keep
prose true — no actor sees two fixes, and the terminal round's fixes are never reviewed — so a
paragraph one fix writes and a later fix invalidates ships confidently wrong.

**Protected paths** (`PROTECTED_PATHS_RULE`) forbids creating or editing a file under
`.github/workflows/` — a push from the pipeline's token cannot carry one, and the refusal
discards the whole commit — and lands the "say what a maintainer should apply by hand" half on
the fixer's result schema: a fix that genuinely requires such an edit is verdict `needs_human`
with the exact change described in `reasoning`, editing nothing. All three fix prompts carry it,
retries included, for the same reason the ladder is. The reviewer prompt carries the reporting
half: a workflow-fix finding describes the change in `suggestedFix` for manual application —
self-contained, the exact replacement text or a copy-pasteable patch, because it may be the
only record of the change that survives the run. The defect is real, it just does not route to
an edit that can never be pushed. Run 32992114904 (issue #360) is the cost of the gap: the
fixer edited `.github/workflows/ci.yml`, the push guard reverted it, and the run died on a push
GitHub refused whole. And PR #362's `#35d7c517` is the cost of the _reporting_ gap the loop
has since closed: a needs-human finding reached the maintainer as a title line while the exact
change sat in a `ledger.json` that dies with the runner — so the run summary now renders the
suggested fix and the fixer's reasoning under each needs-human line, bounded, with a ledger
pointer when neither exists.

Like the ladder, that constant is **duplicated across the workspace boundary and pinned**:
`opencode-agent`'s `protected-paths.ts` owns the text, this workspace's copy carries it verbatim
plus the one fixer-only mapping line (a fixer has no reply, it has a JSON result), and
`tests/opencode-agent/protected-paths-rule.test.ts` asserts the containment. The inspect prompts
carry nothing — they judge diffs and write nothing. The prompts are the courtesy; the mechanism
is the push guard in the opencode-agent phase that reverts what they could not prevent.

The orchestrator records one advisory boolean per accepted fix: did its diff touch a test path
(`measureCheckBehind`, `commit-attempt.ts`). It gates nothing and touches no retry budget; it
exists to say whether the check-behind rule is being followed. It is measured **before** the
merge, because `mergeWorkerIntoPrimary` rebases the worker branch and the baseline stops being
an ancestor. A measurement that fails is `unmeasured`, reported apart from both answers — an
unreadable diff is not a fix that skipped its test. See the `Checks left behind:` summary line
and [ADR-0425](../docs/adr/0425-review-loop-fix-minimality-and-check-behind.md), which records
why the inspector was the wrong host for any of this.

## Deletion findings

The fixer was taught to reach for the smallest thing that works before the reviewer could
report that the code already there is over-built, so for a while the ladder only ever shrank
fixes the loop was already making and nothing it read got smaller. It can now report both:
every issue carries `kind` — `defect` or `cleanup` — and a cleanup is one of exactly **five**
forms, `delete` / `stdlib` / `native` / `yagni` / `shrink`.

The set is **closed**, and that is the guard. An open category collects everything a reviewer
mildly dislikes, which is what the standing "correct but I would write it differently"
exclusion exists to prevent and which a deletion vocabulary is uniquely able to reopen — that
exclusion survives verbatim, pinned by a test. Every cleanup must **name what replaces** the
code it cuts: a named function, a named platform feature, an existing helper, the shorter
form, or nothing at all for code nothing reaches. "Nothing replaces it" is a complete answer;
being unable to name one is a reason to omit the finding. Same discipline as exposure — a
citation, not a rating.

**Ordering is kind-first** (`orderByExposure`, `issue-processor.ts`). Every defect is
dispatched before any cleanup; exposure orders within each group exactly as it did, as the
tiebreak. Without that, a cleanup whose caller was found would be dispatched ahead of a
critical defect whose caller nobody found — exposure grades reachability, never worth. What it
buys is what a stopped run spends: the soft stop is honoured between two issues, so the tail
the run drops is now cleanups.

A cleanup is **never above medium**. `capCleanupSeverity` (`review-round.ts`) clamps at ingest,
before matching and before the ledger — the prompt states the rule, the clamp makes it true.

Counts are reported per kind (`Findings:` line, `reviewerKind` in `metrics.json`), and
`Checks left behind:` reports the **defect** ratio with cleanups named beside it rather than
folded in: a cleanup that deletes code introduces no non-trivial logic, so it leaves no check
and is right not to. Pooled, cleanups would drag down the very ratio the check-behind rule is
measured by. Nothing here gates anything; it exists so the effect can be read afterwards.

Open question carried from the change's `design.md`: whether **`shrink`** earns its place. It
is the least objective of the five and the only one whose replacement is "the same logic,
written shorter" rather than a name. If the first runs show it producing most of the noise,
dropping it is one line in `CLEANUP_FINDINGS` and one in the closed set — it touches neither
the ordering, the schema, nor the counts. The per-kind numbers are how that gets decided.

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
- `config.example.json` at the workspace root documents the expected config shape; real configs are loaded from the path passed via `--config` (defaults to `.review-loop/config.json`). The optional top-level `pricing` map (USD per 1M tokens, glob-matched against the agent model) enables estimated-cost display; entries take optional `cacheRead`/`cacheWrite` rates, and cached tokens contribute 0 to estimates when a rate is unpublished.

## Run Stats

`src/run-stats.ts` (pure aggregate), `src/cost.ts` (pricing lookup), and `src/diff-stats.ts` (git numstat at worker merges) feed the `LiveRenderer` footer's aggregate segments (total tokens, `~$ est`, tool calls, `+a/-r`) and the final summary's `Stats:` line. Aggregates persist to `metrics.json` (`runStats` block) and rehydrate on `--resume-run`; stats accumulation is independent of the EPIPE downgrade, and segments are hidden when zero/unpriced.

Cached-token accounting: opencode's `step_finish` reports `tokens.input` as **uncached input only**, with cache hits in a sibling `tokens.cache: { read, write }` object. The event parser surfaces `cacheRead`/`cacheWrite`, and usage flows track them as separate counters (`cachedReadTokens`/`cachedWriteTokens`) — never folded into `inputTokens`, which everywhere means uncached. Live lines, the footer, and summaries render `in X · cached Y / out Z` (reads only; hidden when zero); `metrics.json` and `events.ndjson` carry both counters additively, so pre-change artifacts replay/rehydrate with cache 0.

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

## Batch Verification

When `batchVerify: true` (`config.ts`, default `false`), the reviewer may coalesce same-class findings into one theme issue with `spans: {file,lineStart,lineEnd,evidence}[]` (`issue-schema.ts`, `prompt-templates.ts` coalescence rule). `clusterRecords` (`issue-clustering.ts`) groups flat pending issues by kind + title n-gram, preserving kind-first order. `processPendingIssues` dispatches one fixer per cluster sequentially (still `poolSize=1`), with no per-issue or per-batch `build`/`inspect`. After all batches, the round runs **one `build` (`runAggregatedBuild`) and one `inspector` (`runAggregatedInspector`)** over the aggregated working-tree diff (`git add -N .; git diff baselineSha`). Build/inspect failures attribute via claimed files (issue `spans` + fixer `targetFiles` vs build output + `git diff --name-only`); ambiguous failures mark all batched members `needs_human`. Surviving members are committed per batch (`fix(review-loop): <title> (+N)`) and the stacked commits are published by **one** `mergeWorkerIntoPrimary` — never a failing fix; a surviving member whose files a decided member also claims is held back for split retry, because `git add` stages the file's current content, rejected edits included. A cluster is deferred before its fixer starts (`shouldDeferBatch`, `batch-defer.ts`) when the run budget no longer fits the median batch duration: `low`/`cleanup` first, `medium` at half that margin, `critical`/`high`/caller-exposed defects never; deferred records stay `discovered` and are counted in the summary's `Deferred:` line. This is the deferred-verification counterpart to ADR-0303's per-issue gate — see `design.md` D2–D5.

## Dependencies

- `zod` — runtime config/schema validation (shared with root).
