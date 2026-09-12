<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

Three recorded layers underlie this change. (1) The bare route (parent change
`build-claude-code-cli-as-a-selectable-model-backend-in-opencode`): one
`claude -p` per turn, `--bare`, env-injected API key, allowlist confinement.
(2) The helper dead end (`claude-apikeyhelper-credential-route`, revised to
the removal outcome): `--bare` never reads OAuth; the apiKeyHelper loaded
(`apiKeySource: "apiKeyHelper"`) but the API refused the call — the helper is
API-key-shaped; the fixture `oauth-helper-init.ndjson` and the recorded
negative legs keep that provenance. (3) The 2026-08-25 exploration (this
change's raw material): the neutralized-native profile authenticated a valid
OAuth token end to end. Every design decision below cites which recording
carries it. See proposal.md — Why.

Sequencing: apply presupposes the helper change's removal revision merged;
archive presupposes both predecessors archived. The capability layers the
way `opencode-agent-fix-command` layered over `agent-ci-repair`.

## Goals / Non-Goals

**Goals:**

- Subscription billing for the agent pipeline, selected by which credential
  secret the operator set — no new knobs (`AGENT_BACKEND=claude` stays the
  one switch; the spelling is the profile).
- Byte-identical bare route for the API-key spelling.
- Every native-profile property pinned by a recorder leg — free census pins
  wherever the question costs nothing, credentialed pins only where it must.

**Non-Goals:**

- Any surface above the session seam (phases, budgets, state machine).
- Retry/queueing around the five-hour subscription window; quota exhaustion
  is a turn failure under the existing families (proposal Non-goals).
- Re-introducing apiKeyHelper, or moving the API-key spelling off `--bare`.

## Decisions

### D1. Profile selection derives from the credential spelling, not a knob

The adapter receives the guard's chosen `ClaudeCredential` already; the
profile is `credential.name === 'CLAUDE_CODE_OAUTH_TOKEN' ? native : bare`.
No new environment variable: `AGENT_BACKEND` already says *which backend*,
the spelling says *which profile* — two knobs for one fork would admit
nonsense states (OAuth + bare) the guard would then have to refuse anyway.
The argv builder takes the profile as a parameter (`ClaudeInvocationProfile`)
rather than reading the credential, keeping `claude-argv.ts` about
composition and testable without a credential value.
*Alternative*: an `AGENT_CLAUDE_PROFILE` knob — rejected for the
nonsense-state reason above; a mis-set pair fails at startup instead of at
the first turn only if the guard enumerates pairs, which is more code for
less safety than deriving.

### D2. Neutralization is three flags on the argv, not a settings file

`--setting-sources ''` (kills repo-skill discovery and settings-file loads;
recorded census: skills = built-ins only), plus `--strict-mcp-config
--mcp-config <empty>` (kills `.mcp.json` auto-connect; recorded census:
`mcp_servers: []`). The belt-and-braces pair exists because either flag
alone leaves one surface (strict alone still loaded repo skills in the
census). The empty MCP document is written beside the session files in the
job-scoped config dir at boot — it is inert content, not a secret, and the
dir already has the right lifetime. CLAUDE.md suppression rides the fresh
config dir (memory defaults off — recorded `/context`: no Memory-files row);
because that is a *default*, not a structure, the recorder pins it free
(spec: census requirement). Keychain non-interference is pinned by the
dummy-token instant-401 leg (env token authoritative).
*Alternative*: carry the neutralization in a settings file named via
`--settings` — rejected: this is exactly the mechanism the helper dead end
burned, and flags are censused by the init line for free.

### D3. `childEnv` learns the symmetric re-add

Today: strip both spellings, re-add exactly the API key. Becomes: strip
both, re-add exactly the *profile's* credential — API key on bare, OAuth
token on native. One rule, spelled twice, both sides pinned by the existing
connect tests gaining the native-profile cases. The recorder's spawn seam
already asserts env shape per spawn; it gains the native expectation.

### D4. Proof-of-authentication is the rate-limit signature, not `apiKeySource`

The init line's `apiKeySource` reads `none` on the native path even when the
env token authenticates (recorded: your successful `"ready"` run) — the
field tracks API-key-shaped sources only. So the native proof is the
subscription signature: the `rate_limit_event` line carrying
`rateLimitType: "five_hour"`. The line-decoder schema gains an optional
`rate_limit_event` fact (type + window) so the corpus pins its shape; the
adapter otherwise ignores it — it is the recorder's evidence, not a budget
input (`total_cost_usd` doctrine: decoded, never gating).
*Alternative*: treat `apiKeySource !== 'none'` as the proof — recorded false
on this path; would ship a broken gate.

### D5. The recorder's native legs: free census first, credentialed last

Leg order, cheapest first: (a) un-credentialed census — init line
(`mcp_servers: []`, skills built-ins) and `/context` (no Memory row) —
asserting neutrality at zero cost, so a CLI pin move re-answers it before
anything spends; (b) the dummy-token negative — instant `api_error` shape,
recorder-safety pin (also stamps the failure fixture); (c) the adversarial
WebFetch refusal under the `plan` allowlist (confinement parity); (d) one
credentialed proof turn — `rate_limit_event`/`five_hour` + reply text —
plus the corpus turns the adapter drives. All legs compose the native argv
through the adapter's own builder (the bare route's "recording cost"
doctrine: a flag the pinned CLI no longer accepts fails the recorder, not
the pipeline). The corpus gains `native-success-turn.ndjson` and
`native-auth-error.ndjson`, both `VERSION`-stamped.

### D6. The guard: wording only

`claudeCredential(env)` keeps its shape — exactly one spelling, both-set
fails, neither-set fails — but the single-spelling messages stop calling the
OAuth route "removed" and name the native profile as its meaning (the
removal revision's wording is superseded here). `refuseGatewayKeyOnClaude`
unchanged. The workflow needs nothing: it already forwards
`CLAUDE_CODE_OAUTH_TOKEN` on the claude route, and the pipeline moves it
from step env to child env behind its own scrub.

### D7. Failure classification: the existing families own the new shapes

The recorded native auth-failure (`terminal_reason: "api_error"`,
`api_error_status: 401`, synthetic assistant message, exit 0) lands in
`classifyTurn`'s `is_error` branch — `CLAUDE_RESULT`, the same family the
bare route's auth shape uses; no new code. The `<synthetic>` model id in
that message is why the assistant-line decoder stays names-only. A quota
429 mid-run presents as an error-signalling result or a non-zero exit and
follows the same families; the README documents the five-hour window as a
billing trade-off, not a pipeline state.

## Risks / Trade-offs

- [CLI pin move reintroduces repo state on the native profile] → the free
  census legs run before any credentialed turn (D5a), so drift surfaces at
  zero spend; the `VERSION` stamp ties the pins to the binary.
- [CLAUDE.md suppression rests on a config-dir default] → deliberately
  promoted to a pinned census fact (spec requirement), not trusted
  silently; a default flip fails the recorder, not a job.
- [Subscription quota exhausted mid-job] → turn fails under
  `CLAUDE_RESULT`/`CLAUDE_EXIT`; no retry layer (route doctrine); the
  failure comment's `/retry` advice is time-based recovery — document the
  five-hour window in the README row.
- [Bigger built-in toolset widens the prompt-injection surface] → the same
  `--allowedTools` confinement, pinned by the WebFetch refusal; the residual
  (built-in skills in context, ~1.5k tokens recorded) is documented, not
  neutralized — they are CLI-shipped, not repository-controlled.
- [Env token visible to the CLI's own same-user children] → the recorded
  residual of the bare route's API key, unchanged by spelling; restated in
  docs.

## Migration Plan

Nothing to migrate: the OAuth spelling previously failed the guard (removal
revision) or failed its first turn (helper attempt); no working setup
depends on any prior behavior. Rollback is revert; the bare route is
untouched by construction (spelling-gated composition, guard shape
unchanged).

## Open Questions

None blocking: every question raised in the exploration was answered by a
recording (facts table in the exploration summary; D2/D4/D5 cite them). The
one deliberately open *documentation* choice — whether the README presents
the profiles as "two profiles" or "one route, two credentials" — is wording,
resolved at the docs task.
