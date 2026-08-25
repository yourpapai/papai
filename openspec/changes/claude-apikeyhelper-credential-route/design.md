<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

The parent change `build-claude-code-cli-as-a-selectable-model-backend-in-opencode`
landed the claude route: guard, decoders, argv builder, connect layer, adapter,
workflow pins. Its credential model injects the chosen spelling into the child
env. The live probe on pinned CLI 2.1.239 recorded that under `--bare` the env
OAuth token is never read (`apiKeySource: "none"`) — an OAuth-credentialed turn
fails `CLAUDE_RESULT`. The parent's README documents this as "one caveat
pending the credentialed recording". This change resolves the caveat by giving
the OAuth spelling the CLI's other sanctioned `--bare` carrier: `apiKeyHelper`.
See proposal.md — Why. The specs' requirements own the behavior contract.

Sequencing: this change's apply presupposes the parent change's claude route
(merged on this branch); its archive presupposes the parent's archive, since
the spec delta layers over the parent's capability the way
`opencode-agent-fix-command` layered over `agent-ci-repair`.

## Goals / Non-Goals

**Goals:**

- Make `CLAUDE_CODE_OAUTH_TOKEN` able to authenticate a `--bare` turn on the
  pinned CLI, by mechanism the CLI itself sanctions, proven by a credentialed
  recording.
- Keep the API-key spelling byte-identical to today.
- Keep secret handling (scrub/redaction/teardown) covering the token across
  the new file carrier.

**Non-Goals:**

- Moving the API-key spelling onto the helper (no gain; touches a proven path).
- Claiming a security-boundary change: same-user `Bash` children can read the
  helper as easily as an env var — the recorded residual stands.
- Touching the guard, the workflow, phases, budgets, or any papai runtime
  surface (proposal Non-goals).

## Decisions

### D1. The helper is config-dir state, materialized once at adapter boot

`claude-connect.ts` owns everything a CLI process sees (env composition, the
job-scoped `CLAUDE_CONFIG_DIR`). The helper belongs to that surface: a single
materialization at `createClaudeAgent` boot — when the credential's name is
`CLAUDE_CODE_OAUTH_TOKEN` — writes into the config dir the CLI's settings file
naming the helper, before any spawn. No per-turn work; the CLI re-runs the
helper itself per turn.
*Alternative*: materialize lazily at first spawn inside `childEnv` — rejected:
env composition is per-spawn and must stay pure; file state deserves a
single, testable boot-time step with one failure point named in the error.

### D2. One file carries the token; the settings file carries only a path

`settings.json` holds `{"apiKeyHelper": "<configdir>/credential.sh"}` — no
credential value in it. The helper script embeds the token literally:

```sh
#!/bin/sh
printf '%s' 'sk-ant-oat01-…'
```

mode `0700` (it must execute), settings mode `0600`. The settings file is
**named on every invocation's argv** as `--settings <path>` — the pinned
CLI's own `--bare` help reads "Anthropic auth is strictly
`ANTHROPIC_API_KEY` or apiKeyHelper via `--settings`", so under `--bare` the
config-dir placement alone is never auto-discovered (the first 5.1 run paid
for that lesson: the pair present but unnamed is the un-credentialed
`CLAUDE_RESULT` shape). `printf` over `echo` so no trailing newline rides
along until the recording says one is wanted — the exact accepted shape
(newline tolerance, per-turn invocation) is a recorded fact, not a guess.
The writer refuses a token value containing a single quote or newline at
write time with a loud named error rather than emitting a broken script.
*Alternative*: helper reads a second token file — two secret files, same
exposure, no gain.

### D3. Env injection becomes spelling-dependent; credential becomes optional

`childEnv` keeps name-stripping both Anthropic spellings, then re-adds exactly
the chosen one **only when it is the API key**. On the OAuth spelling no
Anthropic value enters any env. Booting with no credential at all stays
representable (it is the recorder's un-credentialed auth-error leg): the
adapter's `credential` option becomes optional, absent → no injection, no
helper. The guard's startup rules are untouched — this is the spawn layer
only.

### D4. The recorder proves the mechanism; a raw leg captures the init line

The adapter never surfaces the init line's `apiKeySource`, and should not grow
a surface just for proof. The recorder, driven with the OAuth token, does two
things: (a) its existing adapter-driven turns now exercise the helper
end-to-end (success, resume, adversarial, token accounting), with the
recording spawn seam asserting the child env holds no Anthropic spelling and
the config dir holds the two files before the first spawn; (b) one raw
`rawRun` leg against the same materialized config dir parses the init line
straight from the stream and records `apiKeySource` into `facts.json`,
stamping the corpus. The init-line schema in `claude-contract.ts` gains
`apiKeySource` as an optional decoded fact so the recorded shape is pinned by
the decoder tests, not just by the fixture's presence.

### D5. Recorded-failure contingency inverts the change

If the credentialed recording shows the helper is not consulted under `--bare`
on the pinned CLI, the helper route does not ship: the change is revised via
the update workflow to remove the OAuth spelling from the guard's accepted
spellings (making `ANTHROPIC_API_KEY` the only claude-route credential), and
the README caveat resolves to that recorded outcome. The spec already states
this either-way obligation; tasks keep the recorder run as the gate.

### D6. Workflow untouched

The workflow already forwards `CLAUDE_CODE_OAUTH_TOKEN` on the claude route;
the pipeline moves it from step env into the helper behind its own scrub. No
workflow edit, no new pins — the existing forwarding pin covers the spelling.

## Risks / Trade-offs

- [Helper ignored under `--bare` on the pinned CLI] → D5 contingency: record
  first (task 1.x before implementation lands on the route), ship only a
  proven mechanism; the fallback removal is the recorded outcome, not a
  failure of the change.
- [CLI version bump changes helper semantics] → the corpus `VERSION` stamp
  equals the workflow's install pin by existing test; a pin move forces the
  recorder re-run that re-proves the helper.
- [Token embedded in a world-visible tmpdir path] → dir is `mkdtemp` 0700
  job-scoped, files 0600/0700, teardown removes the dir with the rest of the
  job's CLI state; same-user readability by the CLI's own children is the
  already-recorded residual, restated in docs.
- [Helper stdout shape (trailing newline, quoting) rejected by the CLI] → the
  writer's strict-value refusal plus the recorded corpus pin the accepted
  shape; a mismatch surfaces at recording cost, never as a silent auth
  failure mid-job.
- [Auth-error recorder leg now authenticates by accident] → the un-credentialed
  leg boots the adapter with no credential (D3), so no helper exists to
  consult; the leg keeps producing the real un-credentialed failure shape.

## Migration Plan

Nothing to migrate: the OAuth spelling never authenticated a turn, so no
working setup depends on any prior behavior. Rollback is revert; the API-key
route and default route are untouched by construction (spelling-gated writes,
guard unchanged).
