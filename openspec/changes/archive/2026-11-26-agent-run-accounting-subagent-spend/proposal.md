# Count every model a run billed, not just the main loop

## Goal

A run's token and cost accounting must cover **all** spend the backend reports, including work billed to auxiliary/sub-agent models. Today the claude route reads only the `result` line's top-level `usage`, which the CLI populates from the main conversation loop; its own `modelUsage` map is the complete per-model account. The recorded fixture `tests/opencode-agent/fixtures/claude-cli/native-success-turn.ndjson` proves the gap:

- top-level `usage` = `4 + 155 + 28005 + 61460` = **89,624** tokens (`claude-sonnet-5` only)
- `modelUsage` = the same sonnet buckets **plus** `claude-haiku-4-5-20251001` at `912 + 11` = 923 tokens → **90,547**
- `total_cost_usd` (0.126837) equals `0.000967 + 0.125870`, i.e. the CLI's *cost* already includes the model the token buckets omit

So `ClaudeAccounting.tokensTotal` under-reports the ceiling, and rung ② of the cost ladder (catalogue reprice, used whenever the CLI reports no `total_cost_usd`) reprices an incomplete bucket set. This is a fix restoring the intended behaviour of the existing accounting pipeline — "what the run spent" — not a new contract.

## Files to touch

- `opencode-agent/src/claude-contract.ts` — extend `resultLineSchema` with an optional `modelUsage` record (`inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, optional `costUSD`), tolerant per the file's existing doctrine: an unrecognised or partial entry degrades that entry, never the line. Surface the folded per-model totals on the decoded `result` line (e.g. `usage` derived from `modelUsage` when it is non-empty, plus the per-model split kept for the log/future per-model repricing).
- `opencode-agent/src/claude-spend.ts` — `recordLine` folds the complete figure: when the line carries a non-empty `modelUsage`, `tokensTotal` and `buckets` accumulate the summed per-model buckets; when it is absent or `{}` (as in `auth-error-turn.ndjson` / `native-auth-error.ndjson`), behaviour is byte-identical to today's top-level read. `costUsdTotal` keeps folding `total_cost_usd` — it already covers sub-agent spend.
- `opencode-agent/src/sdk-contract.ts` and `opencode-agent/src/opencode-connect.ts` — on the opencode route, make the session reading complete by construction: `usage(sessionId)` sums the session's own totals with those of its descendant sessions (`client.session.children`, which the pinned `@opencode-ai/sdk@1.18.23` exposes at `/session/{id}/children`), since an opencode sub-agent (`task`) runs in a child session whose tokens never appear in the parent's totals. A children read that fails or decodes as unknown degrades to the parent-only figure and warns — the `decodeSessionUsage` doctrine that a budget must never fail the work.
- Tests: `tests/opencode-agent/claude-contract.test.ts`, `tests/opencode-agent/claude-adapter.test.ts`, `tests/opencode-agent/adapters.test.ts`.

## Behaviour change

- **claude backend**: a turn whose `result` line reports two models bills both. Against `native-success-turn.ndjson`, the run's token total becomes 90,547 (was 89,624) and the repriced buckets carry the haiku tokens. `total_cost_usd` reporting is unchanged. A result line with no/empty `modelUsage` behaves exactly as before, including the `sawUsage === false` → `unpriced` distinction.
- **opencode backend**: reported `SessionUsage` covers the parent session plus its descendants. Where the server reports no children the figure is identical to today's.
- Nothing in the ladder's ordering, the unpriced state, the rate-limit windows, or the run-comment rendering changes.

## Assumptions

- Sub-agent tokens are folded into the run's existing single bucket set rather than repriced per model. Rung ② still reprices through one `modelRef`; a per-model reprice is a larger change and is out of scope here — the per-model split is decoded and logged so it can be built on later.
- On the opencode route no profile currently grants the `task` tool (`opencode-agent/src/permissions.ts` denies `*` and allows only read/write/propose tools), so the child-session sum is defensive today: it makes the reading correct rather than fixing an observed number. It is included because the issue names both backends.
- Descendant traversal is recursive with a small depth/visited guard so a nested sub-agent session is not missed or double-counted.

## Verification

- New unit assertions over the recorded fixtures (no credentials, existing corpus): `native-success-turn.ndjson` folds to 90,547 tokens with both models present in the decoded split; `success-turn.ndjson` and `resume-turn.ndjson` (single-model `modelUsage`) keep today's totals; `auth-error-turn.ndjson` and `native-auth-error.ndjson` (`modelUsage: {}`) keep today's totals and their `unpriced` outcome.
- An adapter-level test stubbing `session.children` proves the opencode sum adds child usage, and that a throwing/undecodable children read degrades to the parent figure, warns, and never fails the turn.
- Repo gates: `bun test` for the `tests/opencode-agent` suite, plus the workspace's lint/typecheck and mutation-gate scripts as configured.
