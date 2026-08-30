## 1. The shared definition

- [ ] 1.1 Write the failing test for the enforced-figure function in `tests/opencode-agent/agent-session.test.ts`: it sums uncached input, output, reasoning and cache-write; it excludes cache read entirely (a run of 4/155/0/28,005 with 61,460 cache reads answers 28,164); an absent `reasoning`, `cacheWrite` or `cacheRead` contributes zero rather than throwing or returning `NaN`; the answer is a non-negative integer for fractional inputs. Verify: `bun test tests/opencode-agent/agent-session.test.ts` (fails)
- [ ] 1.2 Export the function from `opencode-agent/src/agent-session.ts`, beside the `tokensUsed()` declaration, taking the same bucket shape both adapters already build for pricing (design D2). Verify: `bun test tests/opencode-agent/agent-session.test.ts && bun run typecheck`

## 2. Claude route: buckets only, no derived total

- [ ] 2.1 Rewrite the usage assertions in `tests/opencode-agent/claude-contract.test.ts:116,140,160` against the four decoded buckets rather than a `total` field, keeping the recorded fixture figures they assert on. Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (fails)
- [ ] 2.2 Extend `tests/opencode-agent/claude-adapter.test.ts`: a session whose turns report cache reads answers `tokensUsed()` without them; two turns' buckets accumulate; the figure equals the shared definition applied to the accumulated buckets. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (fails)
- [ ] 2.3 Remove `total` from `ClaudeUsage` and its computation in `opencode-agent/src/claude-contract.ts` (design D1). Verify: `bun test tests/opencode-agent/claude-contract.test.ts`
- [ ] 2.4 Remove `tokensTotal` from `ClaudeAccounting` and derive `tokensUsed()` from `accounting.buckets` via the shared function in `opencode-agent/src/claude-spend.ts` and `claude-adapter.ts`; update the struct's doc comment to say what the figure now counts and why cache reads are absent. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/claude-contract.test.ts && bun run typecheck`
- [ ] 2.5 Confirm the pricing path is untouched: `spendOf` still hands all four buckets to `resolveRunCost`, and `tests/opencode-agent/run-spend.test.ts` passes unchanged with no edits to it. Verify: `bun test tests/opencode-agent/run-spend.test.ts`

## 3. OpenCode route: cache writes join the ceiling

- [ ] 3.1 Extend the `decodeSessionUsage` cases in `tests/opencode-agent/adapters.test.ts`: a reported `cache.write` contributes to the enforced figure; a reported `cache.read` does not; an **absent** `cache.write` contributes zero and still yields a figure; the unsummed `cacheRead`/`cacheWrite` fields stay `undefined` when absent so pricing can still refuse to price them. Verify: `bun test tests/opencode-agent/adapters.test.ts` (fails)
- [ ] 3.2 Fold cache write into the enforced figure in `opencode-agent/src/sdk-contract.ts` via the shared function, leaving `cacheBucketSchema` and the optional-bucket split exactly as they are, and update the `SessionUsage.tokens` comment to name the new definition (design D3). Verify: `bun test tests/opencode-agent/adapters.test.ts && bun run typecheck`
- [ ] 3.3 Assert both routes answer identically: add a case pinning that the same four buckets produce the same enforced figure through `decodeSessionUsage` and through the claude accounting. Verify: `bun test tests/opencode-agent/adapters.test.ts tests/opencode-agent/claude-adapter.test.ts`

## 4. A run that spent nothing is not a run that could not be priced

- [ ] 4.1 Extend `tests/opencode-agent/claude-adapter.test.ts`: a session that was never prompted reports `{ usd: 0, source: 'unspent' }` and logs no "no recognizable claude usage" warning; a session that was prompted and whose usage was unrecognizable still reports `{ usd: null, source: 'none' }` with that warning; rate-limit windows are reported on both. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (fails)
- [ ] 4.2 Add `'unspent'` to `CostSource` in `opencode-agent/src/run-spend.ts`, count prompts issued in the claude session, and branch `spendOf` and `tokensUsed()`'s warning on that counter (design D5). Verify: `bun test tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/run-spend.test.ts && bun run typecheck`
- [ ] 4.3 Sweep every `CostSource` consumer the widened union reaches (run detail, budget notices, logging) and give `'unspent'` a rendering that reads as `$0.00`, never as unknown. Verify: `bun run typecheck && bun test tests/opencode-agent/`
- [ ] 4.4 Write the failing test for the stop paths in a new `tests/opencode-agent/token-budget.test.ts`: an over-budget park on a never-prompted session leaves `usdUnpriced` as it was restored and reports the carried cost exactly; the same stop after an earlier phase in the same job prompted still adds that phase's spend; a genuinely unpriced turn still sets the flag; the flag stays sticky once set. Verify: `bun test tests/opencode-agent/token-budget.test.ts` (fails)
- [ ] 4.5 Make it pass without changing `spendPatch`'s flip condition — the `unspent` source alone should do it. If a change to `token-budget.ts` proves necessary, keep it to the money half and leave the stop's control flow untouched. Verify: `bun test tests/opencode-agent/token-budget.test.ts && bun run typecheck`

## 5. A carried total on one scale only

- [ ] 5.1 Extend `tests/opencode-agent/state-manager.test.ts`: a block written without `tokenScale` parses and reads scale 1; a block carrying the current scale round-trips; `STATE_VERSION` is unchanged at 3, so no existing block is rejected. Verify: `bun test tests/opencode-agent/state-manager.test.ts` (fails)
- [ ] 5.2 Add `tokenScale` with its default and the current-scale constant to `opencode-agent/src/agent-state.ts`, with the doc comment the schema's siblings carry explaining why it needs no `STATE_VERSION` bump (design D4). Verify: `bun test tests/opencode-agent/state-manager.test.ts && bun run typecheck`
- [ ] 5.3 Extend `tests/opencode-agent/orchestrator.test.ts`: a restored block on the old scale is corrected once — `tokensSpent` zeroed, scale set — before `carriedTokens` is captured; phase, `resumeFrom`, `attempts`, `ciAttempts`, `reviewAttempts`, `prUrl`, `usdSpent` and `usdUnpriced` survive it; a block already on the current scale is carried through untouched; the correction is idempotent across two consecutive restores. Verify: `bun test tests/opencode-agent/orchestrator.test.ts` (fails)
- [ ] 5.4 Apply the correction to the restored state in `opencode-agent/src/orchestrator.ts`'s thread read, before `MachineInput` is built, logging the discarded total and the scale it was on. Verify: `bun test tests/opencode-agent/orchestrator.test.ts && bun run typecheck`
- [ ] 5.5 Extend `tests/opencode-agent/triggers.test.ts`: the trigger-layer budget refusal, which reads the restored figure directly rather than through `MachineInput`, sees the corrected total. Verify: `bun test tests/opencode-agent/triggers.test.ts`

## 6. Docs, doctrine and full verification

- [ ] 6.1 Update `opencode-agent/README.md`: the budgets table's `AGENT_MAX_TOKENS` row and the environment table's description say what the ceiling counts; add the claude-route note that cache reads are priced but not counted, and why. Verify: `bun run lint`
- [ ] 6.2 Update `opencode-agent/CLAUDE.md` with the ceiling's definition and the scale-marker mechanism, so the next backend author reads it before writing a third `tokensUsed()`. Verify: `bun run lint`
- [ ] 6.3 Re-run the credential-free CLI recorder to confirm the pinned CLI still reports per-invocation usage on `--resume`, so the accumulation this change leaves in place stays pinned by a recording rather than by inspection. Verify: `bun run opencode-agent:test:claude-stub`
- [ ] 6.4 Validate the change artifacts. Verify: `bunx openspec validate token-ceiling-excludes-cache-reads --strict`
- [ ] 6.5 Run the full suite and the checks, and refresh any `docs/architecture/*.md` page a changed file maps to. Verify: `bun test && bun run typecheck && bun run lint`
