# Design: fail-fast-on-provider-stall

## Context

Incident evidence (runs 32467342323, 32472832109 and their re-runs, all
2026-08-21): the provider answered HTTP 200 and streamed nothing; the OpenCode
SDK retried the identical request indefinitely (78 consecutive attempts over
57 minutes observed); the pipeline's only mid-turn bound is `AGENT_TIMEOUT_MS`
(a clock, not a health check), so the turn burned to 90 minutes and the job
parked FAILED. `provider-proxy.ts` never logged — the failures were inside
200-streams, below its visibility. Meanwhile `session.status retry` events
carried the provider's own message and `activity.ts` dropped it at decode, so
nothing anywhere names the cause. A sibling run in the same window recovered
from every short episode (≤9 attempts ≈ ≤4.5 min), which sets the default
window: above the recovering-blip ceiling, far below the dead-spiral floor.

## Decisions

### D1. The stall record gains a clock; the bound rides the heartbeat tick

`turn-stall.ts` already folds "retries since the last finished step" but has no
time dimension. `TurnStall` gains `lastProgressAt` (ms), stamped by
`progress.ts`'s tracker on every `step` activity and every tool-`running`
activity — a tool call starting is as much proof the model answered as a
finished step — and initialized at tracker creation. `foldStall` stays pure
(the tracker stamps; the fold still clears on `step`).

The watcher lives in `turn-run.ts` beside `withDeadline`, sharing the
heartbeat's injected schedule: each tick asks the tracker whether
`now − lastProgressAt ≥ stallMs` **and** the stall record shows ≥1 retry or
session error since the last progress. Both conditions required — the retry
evidence is what separates "provider down" from "one very long generation".
No new timer, no second clock to disagree with the heartbeat.

Rejection is `withDeadline`-shaped: the work promise loses the race and the
caller gets `turnStallError(stall, progress)` — a new factory in `errors.ts`
with code `TURN_STALL`, carrying the `ProgressSnapshot` like
`turnDeadlineError` does and the stall record like `providerStalledError`
does. `runTurn`'s catch passes it through before the `alive()` probe, exactly
as `isTurnDeadline` is passed through today.

### D2. `TURN_STALL` salvages like a deadline, skips the wrap-up ask

`turnDeadlineError`'s consequence — "a ceiling was reached in a run where
nothing broke" — is the right consequence here: the turn may hold partial work
(the morning's run 1 had 44 tool calls of planning reads; an implement step
may have written half its files). So every `isTurnDeadline` branch site
(`phases/implement.ts`, `implement-steps.ts`, `implement-commit.ts`,
`time-budget.ts`'s consumption of stops) also accepts `isTurnStall`, and the
park is FAILED with `resumeFrom` intact — `/retry` is the remedy, matching
`providerStalledError`'s doctrine that a wave clears with time.

One deliberate difference: the soft stop's wrap-up prompt presumes an idle
session that can still answer. A stall abort happens *because* the model
cannot answer, so `turn-stop.ts` skips the soft ask for this code and goes
straight to hard abort + salvage. Salvage fencing (some abort accepted) is
unchanged.

Not `INCOMPLETE`/`/continue`: that park means "work was unfinished, hand it
on", and a stall has no handoff to give — the wrap-up was skipped by design.

### D3. Provider text: decoded for the transcript only, never for the log

`activity-detail.ts` — the whitelist decoder that already feeds the encrypted
transcript — gains a decoder for `session.status retry` and `session.error`
events, extracting the provider's message string (field shape recorded from
the pinned SDK; re-verify against `@opencode-ai/sdk` types, re-record from a
live server if the pin has moved). Rows ride the existing `TranscriptRow`
shape: `tool: 'provider'`, `status: 'retry (attempt N)' | 'error'`,
`detail: <provider message>`, `durationMs: null` — no schema change, so the
existing viewer renders them for free.

`debug-transcript.ts` already runs `redactSecrets` **before** encryption, so a
credential quoted back by a provider is covered by value. The public-log
containment rule is untouched: `activity.ts` still decodes names, statuses and
counts only; the new decode lives in the transcript-side module, which is the
documented one place content may go.

### D4. Config: `AGENT_STALL_TIMEOUT_MS`, default 300000, 0 disables

Read in `config-values.ts` beside `AGENT_TIMEOUT_MS`: positive integer,
default 300000, minimum 60000 when non-zero (a window shorter than one retry
cycle is noise), `0` = explicitly off (an operator investigating the provider
should be able to run the old behavior). Not plumbed through
`agent-pipeline.yml` env — it rides `vars` like `AGENT_TIMEOUT_MS` when
needed; no workflow change required since the default is compiled in.

Rationale for 5 min: recovering episodes in the incident data were ≤9 attempts
(~4.5 min at the observed ~30 s/attempt); dead spirals ran 57–90 min. A window
between them catches the spiral; if a rare long-but-recovering episode trips
it, the cost is one salvaged attempt of five — never a 90-minute dead burn.

### D5. No change to proxy retries, SDK retries, or attempt policy

The proxy's 3-attempt cap is correct for what it can see (real HTTP statuses);
the observed failures were in-stream. The SDK's internal retry loop is a
pinned dependency — our abort supersedes it rather than configuring it. And a
stall does not auto-retry inside the job: waves last hours, so an immediate
re-run would burn attempts inside the same wave; FAILED + manual `/retry` (5
attempts) is the recovery cadence.

## Modules

- `opencode-agent/src/turn-stall.ts` — add `lastProgressAt` to the record; pure
  fold unchanged in kind.
- `opencode-agent/src/progress.ts` — stamp `lastProgressAt` on step and
  tool-running; expose the stall-clock read the watcher needs (extend
  `stall()`'s report rather than a new method).
- `opencode-agent/src/turn-run.ts` — the watcher: heartbeat-tick check, race
  rejection with `turnStallError`; pass-through in `runTurn`'s catch.
- `opencode-agent/src/heartbeat.ts` — allow the tick a second reader that may
  stop the turn (its docblock already anticipates a second reader; the log
  line stays first and unconditional).
- `opencode-agent/src/errors.ts` — `turnStallError` + `isTurnStall` beside the
  deadline pair; message names the window, retry count and progress.
- `opencode-agent/src/turn-stop.ts` — skip the soft ask for `TURN_STALL`.
- Deadline-branch sites in `phases/implement*.ts` — accept `isTurnStall`
  alongside `isTurnDeadline`.
- `opencode-agent/src/activity-detail.ts` — decode provider retry/error
  messages for the transcript.
- `opencode-agent/src/progress.ts` feed path — write provider rows to the
  transcript sink (public log unchanged).
- `opencode-agent/src/config-values.ts` — `AGENT_STALL_TIMEOUT_MS`.
- No new module: every need is an extension of an existing one (the
  dependency question one level in — `turn-run.ts` owns turn endings,
  `turn-stall.ts` owns the stall record, `activity-detail.ts` owns
  transcript-legal content).

## Consequences

- A provider wave now costs ≤ `AGENT_STALL_TIMEOUT_MS` + salvage per turn
  instead of up to 90 minutes, and the agent's 5-attempt budget self-heals
  across waves via `/retry`.
- The `lastError` text in `AGENT_STATE` distinguishes stall from deadline, so
  a maintainer reading the issue knows to wait out a wave rather than raise
  `AGENT_TIMEOUT_MS`.
- Transcripts grow one row per provider retry during incidents — bounded by
  incident length, encrypted at rest, and no larger than the tool rows the
  transcript already carries.
- Rollback: set `AGENT_STALL_TIMEOUT_MS=0`; behavior reverts exactly.

## Testing / TDD hooks

All writes are gated by the repo's Write/Edit TDD hook (red → green). Tests in
`tests/opencode-agent/`: `turn-stall.test.ts` (clock stamping, both-conditions
gate), `turn-run`-level tests via injected schedule + fake tracker (fires,
doesn't fire on slow-only, doesn't fire on recovered blip), `errors` message
shape, `config-values` parsing (default/0/garbage/min), `activity-detail`
decoding fixtures (retry with message, error with message, shapes from the
pinned SDK types), `turn-stop` skip-ask branch, and `phases` salvage parity.
Order: failing tests per module before each implementation slice, per tasks.
