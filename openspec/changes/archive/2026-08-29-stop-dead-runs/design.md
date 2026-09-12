# Design — stop-dead-runs

## Context

Calm stop today is marker-only (`stop-controller.ts`): `requestCalmStop` writes
`stop-requested` into the run dir and a live `CalmStopController`
(`createStopMarkerSeam`) consumes it at the next stage/round boundary, settling
`status: stopped` via `settleStoppedResult` (`resume-flow.ts`). No component
answers "is a process actually driving this run?" — `state.json.status` stays
`running` forever when the process dies, and routing (`cli-routing.ts`) treats
`running` as resumable, producing the unsupported "resume from stage 'intake'"
crash. See proposal.md — Why.

## Goals / Non-goals

Goals: one liveness-aware stop seam shared by the session screen `s` key and
`sdd stop`; dead runs settle immediately to an honest state; existing zombie
runs (no holder) become settleable with no backfill.

Non-goals (beyond proposal.md's): changing routing rules, resume stage support,
or the picker UX beyond the stop key's outcome message.

## Decisions

### D1 — Ownership via a holder file, pid-liveness checked on demand

`holder.json` in the run dir: `{ pid: number, startedAt: ISO }`, Zod-validated.
The orchestrator writes it at entry to `runStart` / `runResume` / `runContinue`
(which delegates to the former two) and `runGateResume`'s decision-execution
half (extend/approve/veto re-run review work, so that process owns the run
too) — always before any stage runs — and removes it in the same `finally`
that unmounts the run screen. Liveness = `process.kill(pid, 0)` succeeds
(`ESRCH` → dead; `EPERM` → alive, another user's process). A crashed process
leaves the file; the pid check answers dead. Runs that die between
holder-write and stage work are still covered: status stays `running`,
holder pid is dead → settle path.

Why not alternatives:
- *Heartbeat with staleness threshold* — needs a timeout tune, races a
  long agent step, and answers "maybe dead", not "dead".
- *flock/exclusive lockfile* — auto-release on process death is elegant, but
  Bun exposes no flock API; an `flock(1)` subprocess is heavier than a pid
  check for a single-host tool.
- PID recycling: accepted residual risk (mitigated by `startedAt` being
  recorded for future hardening; a recycled pid would need to be a process on
  the same host started after the holder). Local dev tool — not worth more.

`isAlive(pid)` is injectable (DI over `mock.module`, per repo convention) so
tests simulate live/dead holders without real processes.

### D2 — One stop entry point, three outcomes

New `stopRun(workDir, runId, deps)` in `stop-controller.ts` (the existing
module already owns stop semantics — no new module) returning a discriminated
result consumed by both callers (`cli.ts` stop verb, `session-flow.ts` stop
target — the latter already delegates to the harness's `requestCalmStop`):

1. state not `running`, or gate-pending (`gate !== null` — a human decision
   awaits, there is no pipeline work to stop; settling it would hide the
   pending-decision affordance) → `{ kind: 'no-op', status }`
2. holder alive → `{ kind: 'marker-requested' }` — exactly today's
   `requestCalmStop(runDir)` write
3. dead → `{ kind: 'settled', to: 'stopped' | 'aborted' }` — persist
   `status`, consume a stale `stop-requested` marker, bump `updatedAt` via
   `saveRunState`

The harness's `requestCalmStop` member (index.ts) becomes a thin wrapper over
`stopRun`, so the CLI verb and the picker get identical behavior without
touching `session-flow.ts`'s contract.

### D3 — Per-stage settle state (the honest rule)

Settle target derived from `state.json` alone, mirroring what resume could
actually do (`deriveResumePoint` keys on exactly this):

- `depth === null` → `aborted`. Intake never classified: no artifacts, no
  sidecars, and `resumeFromPoint` throws for intake — a `stopped` husk would
  recreate the original crash through routing. (In practice `depth === null`
  implies the run never left intake; keying on depth matches the resume
  decision exactly.)
- otherwise → `stopped`, identical to a live calm-stop settlement, resumable
  through the existing supported stages.

Why not a new status value: `stopped`/`aborted` already exist in
`PersistedRunStateSchema`, route correctly (`isInterrupted`, terminal set), and
render in the session screen glyph/label set — no schema, routing, or TUI
changes.

### D4 — Feedback lines

`stopRun`'s outcome maps to stdout lines the two callers print (replacing the
hardcoded `session-flow.ts:54` message):
- marker: `calm stop requested for <id> — honored at the next boundary`
- settled/stopped: `run <id> has no live process — settled as stopped · resumable via sdd <id>`
- settled/aborted: `run <id> has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>`
- no-op: `run <id> is <status> — nothing to stop`

### D5 — Routing follow-up (discovered in apply)

Settling the zombie removed the only `running` run, leaving a sole
`completed` run — and the no-target TTY routing direct-routed to its report
and exited, stranding the session screen's create flow. A sole gate-pending
or interrupted run keeps its direct route (the obvious next step); a sole
completed run now falls through to the session screen on a TTY (its report
is passive output, one Enter away, and `n` stays reachable). Non-TTY keeps
the report shortcut for scripts.

## Risks / Trade-offs

- [Holder pid recycled by an unrelated process → run looks alive, stop writes a
  marker nobody consumes] → acceptable for a single-host dev tool; `startedAt`
  is recorded so a future hardening can compare process start times.
- [Two processes drive one run concurrently] → pre-existing hazard, unchanged;
  the holder write-over is last-writer-wins and stop only reads it.
- [Settle writes state.json from a second process while owner is mid-write] →
  settle only runs when the owner is provably dead; no live contention.

## Migration Plan

None beyond the holder lifecycle itself: legacy runs lack `holder.json` and
read as dead (D1) — the first `sdd stop <id>` (or picker `s`) settles them.
Rollback = revert; holder files left behind are inert JSON.

## Open Questions

None blocking. Footer wording ("(s)top active" vs naming settle) can be
settled during implementation.

## TDD / hook pipeline

New files gated by the Write/Edit TDD hooks: none mandatory — logic lands in
existing `stop-controller.ts` + `orchestrator.ts` + `index.ts` and their test
suites (extend `tests/sdd-runner/…` per existing naming; check
`sdd-runner/tests/` layout at apply time). Test-first order: D1 holder
schema/write/remove → D2 `stopRun` outcomes with injected `isAlive` → D3
settle-state derivation → D4 wiring (`cli.ts` verb message, harness wrapper)
→ picker `s`-key E2E via scripted keys (existing `keyScript` harness).
