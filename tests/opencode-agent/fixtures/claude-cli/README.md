<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# claude CLI fixture corpus — provenance

The decoders in `opencode-agent/src/claude-contract.ts` are tested against the
`.ndjson` files in this directory, and the workspace doctrine is **recorded,
never guessed** (the `live-sdk.integration.ts` rule: when the pin moves, re-run
the recorder rather than adjusting a decoder by inspection).

State of this directory:

- `auth-error-turn.ndjson` — **genuinely recorded** from `claude` 2.1.239 on
  2026-08-24, driven `--bare -p --output-format stream-json --verbose
--permission-mode default` with no credential set. An un-credentialed turn
  costs nothing and still emits the real `system`/`assistant`/`result` line
  shapes — with `is_error: true`, `terminal_reason: "api_error"` and exit code
  0, which is itself a load-bearing recorded fact: the error-to-non-zero-exit
  correlation is relied on for nothing.
- `oauth-helper-init.ndjson` — written by the recorder's standing zero-spend
  negative leg (`CLAUDE_CODE_OAUTH_TOKEN=<dummy>` mode, or any credentialed
  run): the init line of a raw `--bare --settings` invocation whose only
  credential was a deliberately invalid dummy token behind the CLI's own
  `apiKeyHelper` shape in a throwaway config dir, both env spellings deleted.
  Recorded on `claude_code_version` 2.1.239 (the line carries its own version
  stamp): the CLI **loads** the helper — `apiKeySource: "apiKeyHelper"` — and
  the API **refuses** the OAuth token it echoes (401
  `authentication_failed` over the retry ladder, synthetic assistant message,
  `api_error` result, usage zero). The config guard's startup refusal cites
  exactly this recording, and the leg re-asserts both halves at every CLI pin
  move: a helper that stops loading, or an OAuth-over-helper call that starts
  succeeding, fails the recorder loudly.
- `native-auth-error.ndjson` — written by the native mode's dummy-token
  negative leg (`CLAUDE_CODE_OAUTH_TOKEN=<dummy> bun run
opencode-agent:test:claude-live`): the whole stream of a neutralized native
  invocation (`--setting-sources '' --strict-mcp-config --mcp-config` over the
  empty document) whose env carried only a deliberately invalid OAuth token.
  Recorded on 2.1.239: the refusal is **prompt** (~2s, two `api_retry` lines
  then the result), `api_error_status: 401`, `terminal_reason: "api_error"`,
  exit 1 — the pin that the env token is authoritative over any local
  keychain, so a local recording cannot silently authenticate through the
  operator's own credentials.
- `native-success-turn.ndjson` — written only by the native mode's
  credentialed proof turn (`CLAUDE_CODE_OAUTH_TOKEN=<token>`), and only when
  the turn answered. **Recorded 2026-08-25 on 2.1.239**: one answered native
  plan turn whose stream carries the top-level `rate_limit_event` line with
  the window nested at `rate_limit_info.rateLimitType` — `"five_hour"`, the
  subscription signature that is the native path's proof of authentication
  (`apiKeySource` reads `none` on that path and cannot serve). The line
  arrives even with `status: "allowed"` — every credentialed subscription
  turn carries it. A re-run that answers without it fails the recorder
  loudly. **It is also the corpus's two-model fixture**: the `result` line
  carries `modelUsage` naming both `claude-sonnet-5` (the main model the
  top-level `usage` already spans, its four buckets summing to 89624) and
  `claude-haiku-4-5-20251001` (912 in / 11 out, invisible to the top-level
  figure) — the recording the decoders' complete-figure reading, the
  per-bucket maximum of the CLI's two readings, is pinned against.
- `stub-rate-limit-turn.ndjson` + `stub-facts.json` — **genuinely recorded,
  and credential-free**, by `claude-stub.integration.ts`
  (`bun run opencode-agent:test:claude-stub`) on 2.1.251. The CLI honours
  `ANTHROPIC_BASE_URL`, so the lane drives the real binary on the native
  profile's own flags against a loopback stub that answers with the
  `anthropic-ratelimit-unified-*` headers. The bytes are the CLI's own
  serializer's, which is what this corpus means by _recorded_ — the technique
  `live-sdk.integration.ts` already uses on the OpenCode route. It costs
  nothing, needs no token, and re-runs on any machine.

  **What it pins:** the _shape_ of `rate_limit_event` on 2.1.251 —
  `unifiedWindows.five_hour` and `.seven_day`, each with `utilization`
  (a 0–1 fraction) and `resetsAt` — plus a `result` line carrying a real
  `total_cost_usd` over populated cache buckets.

  **What it does NOT pin, and must never be read as pinning: authentication.**
  The native profile's proof is that a _real subscription_ answered; a stub
  answering proves only that a stub answered. `native-success-turn.ndjson`
  remains that proof and keeps its own 2.1.239 provenance.

  **The finding that made this lane a fix rather than an addition:** the
  recorded 2.1.251 line carries **no `rateLimitType` at all**, and the decoder
  in `claude-contract.ts` used to require one (`z.string().min(1)`). Against
  the newer CLI it therefore failed the line and skipped the whole fact — a
  rate-limit render over that schema would have reported nothing while looking
  correctly implemented. The decoder now reads both shapes.

  **A census pin moved.** `stubCensusSkillCount` reads **17** on 2.1.251 where
  `facts.json` recorded **15** on 2.1.239; `stubCensusMcpServers` (`[]`) and
  `stubApiKeySource` (`none`) are unchanged. Recorded here rather than
  overwritten into `facts.json`, which is the credentialed lane's record: a
  hermetic run has not re-answered the legs it does not cover, and merging the
  ones it shares would leave the rest reading as current.

  **Version skew is deliberate and bounded.** `VERSION` (and the workflow's
  install pin, which `workflow.test.ts` holds equal to it) is 2.1.251, because
  2.1.239 emits no `unifiedWindows` and the feature would be silently empty on
  it. The credentialed `.ndjson` files below were recorded on 2.1.239 and are
  **awaiting a re-record by a token holder**; until then they document the
  older CLI's shapes, which the decoder still reads.

- `success-turn.ndjson`, `adversarial-plan-bash-refused.ndjson`,
  `resume-turn.ndjson` — **provisional, documented shapes**. An API-key-mode
  credentialed recorder run (`ANTHROPIC_API_KEY=<key> bun run
opencode-agent:test:claude-live`) replaces the bare corpus with
  recordings from the live pinned CLI. These three files stay
  shape-documentation until such a run re-records them — the native mode
  stamps `VERSION` and its own fixtures without touching them (that
  re-record is task 5.2 of `claude-native-oauth-profile`, deferred
  2026-08-25), so a `VERSION` stamp alone is not proof the bare corpus is
  genuine. `tests/opencode-agent/workflow.test.ts` asserts that stamp equals
  the workflow's install pin whenever it exists.

The recorder is the only writer of this directory; nothing here is edited by
hand once recorded. One credentialed run (`bun run
opencode-agent:test:claude-live`) asserts the whole corpus's behaviours and
stamps `VERSION` (plus `facts.json` — the determinism findings); re-run it
with `CLAUDE_LIVE_REFRESH_FIXTURES=1` to mark the `.ndjson` corpus for
re-recording, and see the recorder's header for what each file must carry.
