## Context

See `proposal.md` — Why. The state that shapes the approach:

- `AgentSession` (`agent-session.ts`) is the seam both backends implement. It declares `tokensUsed(): Promise<number>` — the ceiling's only input — and `spend(): Promise<RunSpend>` — the cost report. `token-budget.ts` _enforces_ on the first and never measures it; each adapter measures independently, which is how the two produced different numbers from the same buckets.
- On the claude route the number comes from `ClaudeUsage.total`, a convenience field `claude-contract.ts` derives by summing all four buckets. On the OpenCode route it comes from `SessionUsage.tokens`, summed from three. The archived `2026-08-20-cached-token-accounting` change established the counter-doctrine one workspace over — _keep cached counters separate, never summed into anything else_ — and `sdk-contract.ts` records it in `cacheBucketSchema`'s comment. The claude decoder was written without it.
- The claude CLI's `result` line reports usage **per invocation**, aggregated across every API iteration inside it. Verified by driving the pinned CLI (2.1.251) against a loopback stub over three chained `--resume` invocations: each reported the same single-call figures, so accumulation across turns is correct and only the per-turn definition is wrong. `native-success-turn.ndjson` shows the intra-turn aggregation directly — its top-level buckets equal `usage.iterations[0]` plus the final call.
- `STATE_VERSION` is 3, and its docstring defines a bump as a **deliberate stranding**: v-mismatched blocks are rejected, the restore scan finds nothing, and the issue restarts at `INIT_OR_CLARIFY` with its branch reset. Every additive field since has instead used a zod default and said so in its own comment.
- `opencode-agent/src/` sits outside the Write/Edit TDD hook's gateable scope (`.hooks/tdd/test-resolver.mjs:23-29` covers `src/`, `client/`, `plugins/`, `review-loop/src/`, `sdd-runner/src/`) and outside `stryker.config.json`'s `mutate` globs.

## Goals / Non-Goals

**Goals:**

- One definition of the enforced figure, written once and consumed by both adapters, so a third backend cannot invent a third scale.
- A carried total that is never the sum of two definitions, corrected without stranding an in-flight issue.
- A cost report that distinguishes _spent nothing_ from _could not be priced_.

**Non-Goals** (design-level, beyond the proposal's):

- Changing where the ceiling is checked, what it does when it bites, or the notice it posts. `token-budget.ts`'s control flow is untouched; only the figure it reads changes.
- Reporting the excluded cache-read figure anywhere. It stays in the price and in the encrypted transcript.
- Generalizing the scale-reset into a migration framework. One constant and one branch.

## Decisions

### D1 — Delete `ClaudeUsage.total` rather than redefine it

The decoder reports the four buckets it read and nothing derived. `claude-spend.ts` — the module that already holds every opinion about what a run cost — derives the enforced figure from those buckets.

_Why not redefine `total` in place?_ A field named `total` that omits a bucket is the same trap that produced this bug, one reader later. The name promises "everything the CLI reported", and the next person to need that sum will re-add the missing bucket rather than discover the omission. Removing it makes the omission a compile error at every call site instead of a silent disagreement.

`ClaudeAccounting.tokensTotal` goes with it: the struct already carries `buckets`, so the running sum was a second representation of the same fact, free to drift from it. `tokensUsed()` derives from `buckets`.

### D2 — The definition lives on the seam, in `agent-session.ts`

One exported function taking the bucket split and returning the enforced figure, beside the `tokensUsed()` declaration that both adapters implement. The seam that declares the contract defines what the contract counts.

_Alternatives considered._ A new `token-count.ts` — rejected as a file for one function when the seam file is its natural home and already the thing both adapters import. `run-spend.ts` — rejected against that module's own docstring, which declares itself _strictly downstream_ of the ceiling and explains why the separation is load-bearing: it may answer "unknown", the ceiling may not. `token-budget.ts` — rejected because it enforces on a figure that must already exist by the time it runs; the measurement happens inside each adapter, behind the session seam.

_No new module is introduced._ Neither existing module covers this: one prices, one enforces, and the measurement sits between them on the seam.

### D3 — An absent bucket spends zero but still cannot be priced

`SessionUsage`'s cache buckets are deliberately `number | undefined` — "the server did not say" is kept distinct from "the server said none", because a bucket that was never reported cannot be priced at its own rate and defaulting it to `0` would silently under-charge a cache-heavy run.

The ceiling asks a different question of the same read and gets a different answer: it must return a number, so an absent bucket contributes `0`. `priceable()` keeps its strictness untouched, so the _price_ still reports unpriced for the same envelope. One read of one envelope, two honest answers — which is what `SessionUsage`'s docstring already promises when it keeps the split unsummed.

The claude route has no equivalent case: its schema defaults both cache buckets to `0` at decode, because the CLI always reports them.

### D4 — A defaulted scale marker, not a `STATE_VERSION` bump

`tokenScale: z.number().int().min(1).default(1)` on the state block, with the current scale a named constant (`2`). A block written before this change parses, defaults to `1`, and is corrected; no block is rejected.

_Why not bump `STATE_VERSION`?_ Because the schema says what that means: stranding. Issue #385 would restart at `INIT_OR_CLARIFY` with its branch reset, losing an approved proposal and plan, to fix a counter. The additive-field-with-default precedent is recorded on five fields in the same schema and is the proportionate mechanism.

_Why a number rather than a boolean?_ A boolean answers "has the v2 fix been applied", which is a fact about a patch. A scale ordinal answers "which definition produced this figure", which is the fact that matters and stays true the next time the definition moves — bump the constant and the same one-shot branch reruns.

**Where it runs.** Once, on the restored state in `orchestrator.ts`'s `readThread` result, before `MachineInput` captures `carriedTokens` and before `triggers.ts` reads the restored figure directly. Every downstream reader then sees a corrected block; nothing else needs to know.

**What it touches.** `tokensSpent` → `0` and `tokenScale` → current. Phase, `resumeFrom`, `attempts`, `ciAttempts`, `reviewAttempts`, branch, `prUrl`, `usdSpent` and `usdUnpriced` are untouched. Cost was never measured on the old scale — the CLI's dollar figures were right throughout — so resetting it would discard a correct number.

**Idempotence.** A job that resets and then dies before persisting re-resets on the next job. That is a no-op: it re-zeroes a figure still on the old scale. The reset is safe to repeat and unsafe to skip, which is the right way round.

### D5 — A fourth cost source: `unspent`

`spendOf` keys on `sawUsage`, which conflates _no turn ran_ with _a turn ran and its usage was unrecognizable_. Only the second deserves "unpriced". The claude session counts prompts issued; zero prompts answers `{ usd: 0, source: 'unspent' }`, and the existing `{ usd: null, source: 'none' }` plus its warning stays for the case it was written for.

`spendPatch` needs no change: it already flips `usdUnpriced` on `cost.usd === null` alone, so a `0` simply stops flipping it. The same counter silences `tokensUsed()`'s "no recognizable claude usage" warning on a session that was never asked for any.

_Why not `{ usd: 0, source: 'none' }`?_ `run-spend.ts` exists to keep a `0` that means "unknown" out of the ledger; reusing `none` for a `0` that means "nothing" reintroduces exactly the ambiguity it was built to remove.

_Why claude-only?_ The OpenCode route already answers correctly by accident of its ladder: a session that never prompted reports cost `0` with complete zero buckets, falls to the catalogue rung, and prices at `$0.00` with source `catalogue`. Adding `unspent` there would change a correct answer's label for symmetry alone. Declined; the union member is nonetheless declared once, on the shared type.

## Risks / Trade-offs

- **The ceiling becomes much looser in practice** — an issue that tripped at ~5M inflated tokens now needs roughly five times the real work to trip. → The other bounds still hold (`AGENT_MAX_ATTEMPTS`, `AGENT_MAX_CI_ATTEMPTS`, `AGENT_MAX_REVIEW_ATTEMPTS`, `AGENT_JOB_TIMEOUT_MINUTES`), and the operator can lower `AGENT_MAX_TOKENS` at any time. Recalibrating the default is a stated Non-goal because it needs figures measured on the new scale; the first runs after this lands are that measurement.
- **Cache writes are still re-paid when a cache entry expires** — a very long run can pay to write the same content twice, so the ceiling is not perfectly deduplicated. → Accepted. That repeat is bounded by cache TTL, not by step count, so it does not compound the way cache reads did — the whole reason cache writes stay in and cache reads come out.
- **The reset discards a figure somebody may want to explain later** → The log line names the discarded total and the scale it was on, and the run-detail comments already published on the issue keep the old numbers in the thread.
- **Widening `CostSource` touches every consumer** → `tsgo` finds them all; the sweep is an explicit task rather than a hope.
- **No hook or mutation gate covers this workspace** — nothing mechanical will notice a test written after the fact. → Test-first order is written into `tasks.md` per section, and the ratchet that does apply (CI's full suite plus lint) runs on every task's verification command.

## Migration Plan

No database and no drizzle migration: the state lives in a hidden `<!-- AGENT_STATE: ... -->` block on the agent's own issue comment.

1. Ship the code. Every in-flight issue's next job restores its block, reads `tokenScale` as the defaulted `1`, zeroes `tokensSpent`, records scale `2`, and proceeds. No operator action, no re-triggering.
2. Issue #385 specifically: it is parked in `FAILED` with `resumeFrom: REVIEW_AND_MUTATE`, so a `/retry` after this lands resumes the planned work on a corrected count without `AGENT_MAX_TOKENS` being raised.

**Rollback.** Reverting the code is safe but not lossless. Blocks written by the new code carry `tokenScale: 2`; the old schema strips unknown keys (its own comment records this), so they parse and run. What does not come back is the pre-reset token figure — an issue reverted mid-flight carries the reset total and simply has more headroom than it used to.

**Scope model.** The one new persisted field keys on the same id as everything else in the block — the GitHub issue number. No storage-context id, config-context id, platform instance, task instance or user is involved: `opencode-agent` is developer tooling and has none of them. No new tool surface, so no capability gating or `tool_prefs` (allow/ask/deny) behavior changes.

## Open Questions

- The CLI's top-level `result.usage` omits sub-agent spend that its own `modelUsage` map reports (`native-success-turn.ndjson` carries 912 input / 11 output on `claude-haiku-4-5` that the top-level buckets do not include). That is a separate under-count in the opposite direction, it does not change any decision here, and it can be answered against a live recording later.
