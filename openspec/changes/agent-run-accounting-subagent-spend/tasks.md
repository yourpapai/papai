<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Claude result line: decode the per-model split (design D2, D3)

- [x] 1.1 Add failing assertions to `tests/opencode-agent/claude-contract.test.ts` over `native-success-turn.ndjson`: the decoded `result` line's `usage.total` is exactly `90547`, its buckets are `input 4` / `output 155` / `cacheWrite 28005` / `cacheRead 61460 + 0`, and its `models` split names both `claude-sonnet-5` and `claude-haiku-4-5-20251001` with the haiku entry at `912` in / `11` out. Verify: `bun test tests/opencode-agent/claude-contract.test.ts` — fails, `models` does not exist and the total reads `89624`.
- [x] 1.2 Add failing no-regression assertions to the same file: `success-turn.ndjson` and `resume-turn.ndjson` (single-model `modelUsage`) decode to today's exact totals, and `auth-error-turn.ndjson` / `native-auth-error.ndjson` (`modelUsage: {}`) decode to today's exact totals with an empty `models` split. Verify: `bun test tests/opencode-agent/claude-contract.test.ts`.
- [x] 1.3 Add failing tolerance assertions to the same file over hand-built `result` lines: one entry with a renamed/absent token field degrades that entry only (the line still decodes, keeps its `text`, `session_id` and `is_error`); a `modelUsage` that is not an object degrades the whole split, never the line; and the per-bucket maximum rule holds — a partial split whose sum falls below the top-level `usage` still publishes the top-level figure. Verify: `bun test tests/opencode-agent/claude-contract.test.ts`.
- [x] 1.4 Extend `opencode-agent/src/claude-contract.ts`: add the optional, entry-tolerant `modelUsage` record to `resultLineSchema` (`inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, optional `costUSD`; every level `.optional().catch(undefined)`), publish `models` on the decoded `result` line, and compute `usage` as the per-bucket maximum of the top-level reading and the decoded split, with `total` the four published buckets summed. Verify: `bun test tests/opencode-agent/claude-contract.test.ts && bun run typecheck`.
- [x] 1.5 Record the decisions in the file's own doctrine comments — why `modelUsage` may never fail the `result` line the adapter needs to end a turn, and why the figure is a maximum rather than a plain fold. Verify: `bun run lint` (no `max-lines` / `max-lines-per-function` violation; if the file trips it, split along the usage seam rather than relaxing the rule).

## 2. Claude accounting and progress read the complete figure (design D1, D4)

- [x] 2.1 Add failing assertions to `tests/opencode-agent/claude-adapter.test.ts`: a run over `native-success-turn.ndjson` reports `tokensTotal === 90547` and repriced buckets that include the haiku tokens, while `total_cost_usd` folding is unchanged. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` — fails at `89624`.
- [ ] 2.2 Add failing assertions to the same file that the `unpriced` path is untouched: an auth-error turn still reports `sawUsage === false` → `{ usd: null, source: 'none' }`, and the rate-limit windows still fold independently of usage. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts`.
- [ ] 2.3 Confirm `opencode-agent/src/claude-spend.ts` needs no arithmetic change and update only its doc comment to state that `line.usage` is now the complete per-turn account. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts`.
- [ ] 2.4 Add a failing assertion for the progress log line (`tests/opencode-agent/progress.test.ts` or `claude-adapter.test.ts`, wherever the claude progress reporter is already driven): the `claude: turn result` record carries the per-model split alongside `tokens`. Verify: `bun test tests/opencode-agent/progress.test.ts tests/opencode-agent/claude-adapter.test.ts` — fails, the field is absent.
- [ ] 2.5 Extend `opencode-agent/src/claude-progress.ts` to log the split on the existing result line, giving `models` its one consumer. Verify: `bun test tests/opencode-agent/progress.test.ts tests/opencode-agent/claude-adapter.test.ts && bun run typecheck`.

## 3. OpenCode: decode children and sum a session tree (design D5, D6)

- [ ] 3.1 Add failing assertions to `tests/opencode-agent/adapters.test.ts` for a children decoder that reads only `id` from each entry: a well-formed array yields its ids, an entry missing `id` is dropped, and a payload of an unrecognised shape yields `null` rather than throwing. Verify: `bun test tests/opencode-agent/adapters.test.ts`.
- [ ] 3.2 Add failing assertions to the same file for summing `SessionUsage` values: `tokens` and `cost` add across sessions, and an absent `cacheRead`/`cacheWrite` on any summand leaves that bucket absent on the sum (so `run-spend` reports unpriced rather than under-charging). Verify: `bun test tests/opencode-agent/adapters.test.ts`.
- [ ] 3.3 Implement the children decoder and the usage sum in `opencode-agent/src/sdk-contract.ts`, beside `decodeSessionUsage` and following its non-throwing doctrine. Verify: `bun test tests/opencode-agent/adapters.test.ts && bun run typecheck`.

## 4. OpenCode: walk the tree behind `usage()` (design D5, D7)

- [ ] 4.1 Add failing assertions to `tests/opencode-agent/adapters.test.ts` with a stubbed client: `usage(sessionId)` over a parent with two children reports the summed tokens and cost; a grandchild is included; a cycle or a repeated id is counted once; and the traversal stops at the node/depth cap. Verify: `bun test tests/opencode-agent/adapters.test.ts`.
- [ ] 4.2 Add failing degradation assertions to the same file: a `session.children` call that throws, that never settles (deadline), or that decodes as unrecognised yields the parent-only figure, emits a warning through the injected logger, and never fails the turn or the phase. Verify: `bun test tests/opencode-agent/adapters.test.ts`.
- [ ] 4.3 Thread a `Logger` into `connectSdk` from the adapter's existing `options.log` call site (`opencode-agent/src/opencode-adapter.ts`), leaving the `SessionUsage` type free of any degradation marker. Verify: `bun test tests/opencode-agent/adapters.test.ts && bun run typecheck`.
- [ ] 4.4 Implement the breadth-first walk in `opencode-agent/src/opencode-connect.ts`: visited set, depth/node cap, per-node usage through the recorded `session.get` path, the whole walk bounded by `withDeadline` and degrading to parent-only on expiry. Verify: `bun test tests/opencode-agent/adapters.test.ts && bun run typecheck`.
- [ ] 4.5 Confirm the unrelated seams are untouched — `alive`'s probe, `abort`, `close`, and the token-budget call site still behave as pinned. Verify: `bun test tests/opencode-agent/turn-run.test.ts tests/opencode-agent/turn-stop.test.ts tests/opencode-agent/time-budget.test.ts`.

## 5. Whole-suite verification and docs

- [ ] 5.1 Confirm the downstream ladder is unmoved: no change to rung ordering, the `unpriced` state, or the rate-limit fold. Verify: `bun test tests/opencode-agent/run-spend.test.ts tests/opencode-agent/rate-limit-windows.test.ts`.
- [ ] 5.2 Confirm no cross-workspace drift gate trips — `review-loop/src/claude-stream.ts` keeps its own independent decoder and is out of scope for this change. Verify: `bun test tests/review-loop/claude-stream.test.ts tests/opencode-agent/claude-doctrine.test.ts tests/opencode-agent/minimality-rule.test.ts`.
- [ ] 5.3 Confirm the mutation gate still passes with the new arithmetic pinned by exact-value assertions (not comparisons). Verify: the repo's configured mutation gate script for the changed files, and `bun test tests/opencode-agent/claude-contract.test.ts`.
- [ ] 5.4 Update the affected prose: `opencode-agent/CLAUDE.md` (a run's account covers every model the backend billed, on both routes) and `docs/architecture/sdd-pipeline.md` where run spend and the unpriced marker are described; note in `tests/opencode-agent/fixtures/claude-cli/README.md` that `native-success-turn.ndjson` is now the two-model fixture. Verify: `bun run lint`.
- [ ] 5.5 Run the full gates. Verify: `bun test`, `bun run typecheck`, `bun run lint`.
