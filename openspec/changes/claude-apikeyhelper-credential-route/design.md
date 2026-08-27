<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

This change originally proposed delivering the OAuth spelling through the CLI's `apiKeyHelper` mechanism. The apply executed sections 1–4 of that plan (writer, spelling-dependent env, `--settings` argv, recorder proof legs — commits `a8c66…` through `3d3e2fdc8`), and the credentialed recording then settled the question the spec's inversion clause anticipated, with a sharper verdict than anticipated: on the pinned CLI 2.1.239, with a token proven valid on the CLI's native path, the helper **was** consulted (`apiKeySource: "apiKeyHelper"` on the init line) — and the API refused the call (401, `authentication_failed`). The helper is not ignored; it is API-key-shaped. `--bare` reads neither the env token nor OAuth by any path. The original spec's inversion clause (design D5) therefore fires with the recorded amendment: the helper route does not ship, the spelling is refused, and the successor change `claude-native-oauth-profile` re-admits it through the neutralized native profile these same recordings proved. See proposal.md — Why.

Sequencing unchanged: apply presupposes the parent claude-route change merged on this branch; archive presupposes the parent's archive; the successor applies only after this revision is merged.

## Goals / Non-Goals

**Goals:**

- Make a set OAuth spelling fail at startup, citing the recorded reason, instead of buying a first-turn `CLAUDE_RESULT` at model spend.
- Retire the helper machinery from production while keeping the recordings' load-bearing seams: the optional credential (credentialless boots), the `apiKeySource` decoder fact, the fixture provenance.
- Leave a standing zero-spend recorder leg that re-answers "can the helper carry OAuth on this CLI?" at every pin move.

**Non-Goals:**

- Any part of the native OAuth profile — that is the successor change, sequenced after this one (proposal Non-goals).
- Touching the API-key spelling, the argv shape it runs, or the workflow file.
- Weakening secret handling: the OAuth value stays in the scrub/redaction set while the guard's messages name the variable.

## Decisions

### D1. The guard refuses the spelling outright, with the recorded reason as the message

`claudeCredential(env)` becomes: both-set fails, neither-set fails (message now naming the API key as the accepted spelling), and **oauth-set fails** — same `CLAUDE_CREDENTIALS` failure code family, message stating that the token is not necessarily invalid but that this route's `--bare` invocations have no carrier for it, pointing operators with a subscription at the API key (and, once the successor ships, at its native profile). The refusal fires where the guard already fires: ahead of the logger, the scrub, every GitHub call and every spawn. A separate failure code for the oauth-set case is not warranted — one code already distinguishes this guard family from every other startup failure, and the three messages name their trigger.
*Alternative*: keep admitting the spelling and fail the first turn — the recorded status quo; spends model budget to relearn a settled fact.

### D2. Retirement keeps the seams the recordings made load-bearing

Removed: `claude-credential.ts` (the writer and its refusal), the `--settings` composition in `claude-argv.ts`, the boot-time materialization in `claude-adapter.ts`, and their tests. Kept, each with its recorded reason: the **optional `credential`** (the recorder's auth-error leg boots credentialless — the probe that first exposed this whole finding), the **`apiKeySource` decoder fact** (the init-line shape that pinned "helper loads, `none` for env OAuth"), and the **fixture + README provenance** (`oauth-helper-init.ndjson`). The successor change builds its profile parameter exactly on these seams; removing them would only force it to re-add them.
*Alternative*: full revert to the parent's shapes — rejected as recorded-fact vandalism: the optional credential and the decoder fact are observations, not helper machinery.

### D3. The standing negative leg materializes its own dummy helper

The recorder's OAuth legs stop driving the adapter's (now nonexistent) helper path and become self-contained: the leg writes its own dummy token behind an `apiKeyHelper` shape into a throwaway config dir, names it via `--settings` on a `--bare` invocation, and asserts the recorded two-part outcome — init line reporting the helper as source, turn ending in the API-refusal shape. Invalid token ⇒ zero model spend (the recorded fast-fail: ~4 s, synthetic assistant message, `api_error` result). This pins the **CLI's** behavior, not ours, which is the point: a pin move that either breaks the helper load or makes OAuth-over-helper succeed fails the leg and names the change — the successor's green-path precondition arriving as a loud signal rather than a surprise.

### D4. Workflow and secrets untouched

The workflow's `CLAUDE_CODE_OAUTH_TOKEN` forwarding line stays: a set secret now produces a loud startup refusal naming it — the correct operator signal — and workflow edits are maintainer-only by the parent's protected-path rule. The value stays in `pipelineSecrets` so the refusal's own diagnostics and any echoed token remain scrubbed and redacted by value.

### D5. The successor inherits the recordings, not the machinery

`claude-native-oauth-profile` cites this change's recorded facts (native-path success, helper dead end, dummy-token fast-fail) and re-admits the spelling via its native profile. This change must not pre-build profile selection, native argv, or native env rules — the refusal is the honest floor, and each successor decision stays citable to a recording rather than to half-built code left lying in the tree.

## Risks / Trade-offs

- [An operator with only a subscription token is locked out until the successor ships] → the refusal message names the recorded reason and the API-key alternative; the successor is scaffolded on the same branch with every credentialed question already answered — the gap is one apply cycle, not a redesign.
- [Reverting landed code regresses a tested surface] → the retirement tasks are test-first in both directions: the removal suites assert the absent surfaces (no writer import, no `--settings`, no materialization) so a merge mishap fails loudly.
- [The dummy-helper leg drifts from the CLI's real behavior] → the leg asserts the two recorded observations (helper-source init line, API-refusal result), so drift in either direction — helper stops loading, or OAuth starts succeeding — is the failure the leg exists to raise.
- [Guard wording rot as the successor lands] → the successor's guard task owns the wording flip; this change's message is written to be superseded, naming the mechanism (no carrier on `--bare`) rather than denying the token's existence.

## Migration Plan

No working setup can regress: the OAuth spelling never completed a turn on this route (the helper attempt is unshipped; the parent's env spelling failed `CLAUDE_RESULT`). Rollback is revert; the API-key route is untouched by construction after the retirement tasks.
