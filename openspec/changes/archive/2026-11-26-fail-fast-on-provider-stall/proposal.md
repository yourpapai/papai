# Proposal: fail-fast-on-provider-stall

## Why

On 2026-08-21, four `OpenCode Issue Agent` runs (32467342323, 32472832109, and
their `/retry` re-runs) burned 90 minutes each in a provider retry spiral: the
gateway answered HTTP 200 and then never produced a token, the OpenCode SDK
retried the identical request indefinitely (78 consecutive attempts observed),
and nothing in the pipeline stopped the turn until the whole-turn deadline
(`AGENT_TIMEOUT_MS`) killed it. A sibling run in the same window recovered from
every brief episode, so the waves pass — but a dead spiral never self-heals, and
each one cost the job most of its wall clock and a FAILED park.

Worse, the provider's own failure text — carried inside the `session.status
retry` events — is discarded at decode (`activity.ts` keeps only the attempt
number), so no log, artifact, or transcript anywhere names what the gateway
actually said. The encrypted debug transcript is the designated place for
exactly this content, and it does not receive it.

## What Changes

One capability, `agent-turn-stall`, extending the `opencode-agent/` turn
machinery (`src/turn-run.ts`, `src/turn-stall.ts`, `src/progress.ts`,
`src/activity-detail.ts`, `src/errors.ts`, `src/config-values.ts`):

- A mid-turn stall bound: a turn that has made no progress (no finished model
  step, no tool call started) for `AGENT_STALL_TIMEOUT_MS` while provider
  retries or session errors accumulate is aborted and failed as a distinct
  `TURN_STALL` classification — cheaply, long before the whole-turn deadline.
- The stall stop reuses the turn-stop/salvage semantics of `TURN_DEADLINE`
  (salvage the tree on the implement path, park FAILED with `resumeFrom`
  intact elsewhere), minus the wrap-up ask, which presumes a reachable model.
- Provider retry and failure messages are recorded in the encrypted debug
  transcript (redacted before encryption), while the public Actions log keeps
  carrying names, statuses and counts only.

Scope model: no platform/task instances, no DB rows, no config-context state —
the only persisted shape touched is the existing `AGENT_STATE` block's
`lastError` text. The new `AGENT_STALL_TIMEOUT_MS` is a repo variable read once
per job beside `AGENT_TIMEOUT_MS`.

## Capabilities

- **`agent-turn-stall`** (new): without it, a provider wave converts every
  in-flight turn into a 90-minute dead burn and a manual `/retry`, and the
  root cause stays unnamed because the provider's message is dropped at decode.
  No existing capability covers turn liveness mid-flight: `turn-stall.ts`
  judges a stall only when a turn *returns* (`requireAnswer`), which a
  never-returning turn bypasses, and `TURN_DEADLINE` is a clock, not a health
  check.

## Non-goals

- Changing `provider-proxy.ts` retry policy — the observed failures arrive
  inside HTTP-200 streams, below its visibility; its 3-attempt cap stays.
- Capping the OpenCode SDK's internal retries — it is a pinned dependency; our
  bound supersedes it by aborting the session.
- Auto-retrying a stalled turn within the same job — waves last hours; the
  existing FAILED + `/retry` machinery (5 attempts) is the recovery path.
- Cross-job concurrency gating on the shared LLM key.
- Any heartbeat wording or cadence change.

## Affected docs

- `opencode-agent/CLAUDE.md` (local rules: stall bound + transcript widening)
- `docs/architecture/behaviors.md` — not affected (no papai runtime behavior)
