<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Read-only / exploration coding sessions — Phase 1 design

Status: approved (brainstorming) — ready for implementation plan
Date: 2026-06-30
Scope: cross-service (papai + magi); geofront unchanged

## Problem

A user can ask a coding agent an exploratory question through papai
(`plugin_acp__start_session`), e.g. "summarize the README in magi". The agent
runs, produces an answer, and the user gets back only status pings:

```
papai_bot: [waiting_input] agent finished a turn and is waiting
papai_bot: [waiting_input] agent finished a turn and is waiting
```

The agent's actual answer is never delivered. Two root causes in magi:

1. **The answer text is discarded.** The agent's prose streams to magi as ACP
   `agent_message_chunk` updates, but `runTurn`'s `onUpdate` handler only
   `logger.debug`s them (`magi/src/session/manager.ts`). The turn result keeps
   only `stopReason`.
2. **The session parks indefinitely.** `statusForStopReason('end_turn')` →
   `waiting_input` (`magi/src/session/state.ts`), and the session lingers there
   waiting for a manual `finish`/`cancel` that never comes for a question.

`waiting_input` is also widely misunderstood: it is **not** the agent asking a
question and is **not** related to the permission preset. It is the normal
terminal state for _any_ turn that ends with ACP `end_turn`. By the time it is
reached the agent process has already been torn down (`runLifecycle`'s `finally`
runs `teardown` before `emitTerminal`); the only things that persist are the git
worktree on disk and the session DB row. The genuinely-interactive pause is the
_other_ waiting state, `waiting_permission` (milestone `needs_permission`), which
is already supported via `answer_permission`.

## Goal

Make exploratory sessions usable with **no new tool or parameter**: the agent's
answer is delivered to chat, and the session finishes itself instead of
lingering. Sessions start exactly as they do today.

Non-goals (Phase 2+): multi-turn follow-up / session resume; an explicit
read-only mode selector and the hard `readonly` permission guarantee; a
faster/lighter sandbox for quick Q&A; round-tripping an agent's clarifying
question back to the user.

## Lifecycle today (reference)

`magi/src/session/manager.ts` `runLifecycle`:

```
try {
  prepared = await workspace.prepare(...)   // git worktree add -b <branch>
  await runtime.provision(...)
  store.setCwd / setBranch
  launched = await runtime.launch(...)      // geofront agent runtime
  await runTurn(...)                         // exactly one ACP turn
} finally {
  await teardown(...)                        // SIGTERM geofront: agent runtime,
                                             //   egress proxy, workspace runtime.
                                             //   Worktree on disk is KEPT.
  emitTerminal(...)                          // notify milestone -> papai /api/notify
}
```

Consequences relevant to this design:

- Heavy sandbox compute is **already freed after every turn**. What persists in
  `waiting_input` is only the **worktree directory + session row**, kept so
  `finishSession` can rebuild `prepared` from `session.cwd`/`branch` and
  commit/push later.
- The agent's answer text is available _during_ `runTurn` (via `onUpdate`) but is
  thrown away.

`statusForStopReason` (`magi/src/session/state.ts`): `end_turn → waiting_input`;
`cancelled → cancelled`; `max_tokens`/`max_turn_requests`/`refusal → failed`.

## Design (Phase 1) — all changes in magi unless noted

### 1. Capture the agent's answer

In `runTurn`'s `onUpdate`, accumulate text from `agent_message_chunk` updates
into a per-turn buffer. On turn end, persist it on the session as `lastMessage`.

- New column `last_message TEXT` on the session store
  (`magi/src/session/store.ts`) + `setLastMessage(id, text)`.
- "The answer" = the agent's final assistant message text for the turn (the
  prose it emits around/after its tool calls).
- Persisting (vs in-memory) is deliberate: it survives a failed notify delivery
  and lets a future `session_status` surface it ("what did it find?").

### 2. Deliver via a dedicated `answer` milestone, rendered clean

- Add `answer` to `MilestoneKind` (`magi`).
- In the notifier (`magi/src/notify/notifier.ts`), special-case `answer`: send
  `markdown = text` verbatim, **no `[kind]` prefix**. All other kinds keep
  `[${kind}] ${text}`.
- papai posts the `markdown` it receives unchanged, so the answer reads as a
  normal bot reply. **No papai rendering change.** The answer is delivered bare
  (no attribution header), per decision.

### 3. Auto-finish lifecycle

After the turn ends (`end_turn → waiting_input`), magi auto-finishes instead of
parking the session:

1. Emit the `answer` milestone (deliver the reply). If the captured answer is
   empty, fall back to the existing generic `waiting_input` ping so the user
   still knows the turn ended.
2. Inspect the worktree with `git status --porcelain` in `session.cwd`:
   - **Clean (the exploration norm)** → remove the worktree
     (`workspace.cleanup`) and transition the session directly to terminal
     **`done`** (add a `waiting_input → done` edge to `TRANSITIONS` in
     `magi/src/session/state.ts`). The session is fully finished; nothing
     lingers.
   - **Dirty (the agent changed files)** → **do not auto-discard or auto-push.**
     Leave the session in `waiting_input` so the existing `finish_session`
     (commit + push / PR) and `cancel_session` flows keep working. The delivered
     answer already describes the changes; append a short trailer noting the
     session awaits `finish`/`cancel`.

Rationale: every session flows through this single path (no mode selector), so
auto-finish must complete the exploration case (nothing to keep) without silently
destroying or silently pushing a session that produced real edits. The
`git status` check is the discriminator. `--porcelain` counts untracked scratch
files as changes (conservative: keeps the session; the user can cancel).

## Error handling & edges

- **Empty answer** → generic `waiting_input` ping, then auto-finish per §3.
- **Failed turn** (`refusal`/`max_tokens`) → emit `failed` including any partial
  captured text; remove the worktree (nothing to finish).
- **Long answer** → delivered in full; papai already chunks per platform.
- **Notify down / non-2xx** → fire-and-forget as today; `lastMessage` is
  persisted so the answer is not lost and can be surfaced later.
- **Delivery routing** → already fixed in papai: the notify route decodes the
  scoped storage context id to native ids and routes a group session into its
  originating thread, a DM to the user (`src/debug/notify-route.ts`).

## Testing

magi unit tests:

- Answer accumulation from a faked ACP update stream → `lastMessage` set.
- Auto-finish emits `answer` with the captured text; falls back to the generic
  ping when empty.
- Notifier omits the `[kind]` prefix for `answer`, keeps it for other kinds.
- Clean worktree → session transitions to `done` and the worktree is removed.
- Dirty worktree → session stays `waiting_input`; `finish`/`cancel` still reach.
- Failed turn → `failed` milestone (+ partial text) and worktree removed.

papai: existing `tests/debug/notify-route.test.ts` already covers delivery; the
answer is plain markdown, so there is no new papai code path.

Optional E2E: a read-only prompt against a fixture repo → chat receives the
agent's text, the session ends `done`, and the worktree is gone.

## Files likely touched (magi)

- `src/session/manager.ts` — capture in `onUpdate`; auto-finish in `runLifecycle`
  / `emitTerminal`.
- `src/session/state.ts` — `MilestoneKind += 'answer'`; `TRANSITIONS`
  `waiting_input → done`.
- `src/session/store.ts` — `last_message` column + `setLastMessage`.
- `src/notify/notifier.ts` — `answer` prefix special-case.
- `src/acp/client.ts` — surface `agent_message_chunk` text to `onUpdate` if not
  already shaped for accumulation.
- `src/workspace/git-workspace.ts` — reuse `status --porcelain` / `cleanup`.

papai: none required for Phase 1 (the notify-route delivery fix is already
committed).
