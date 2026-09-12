<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## Why

Supervising an armed run's execution half from the board answers "which task is running" but not "what is that task" or "what is the agent doing inside it": the walk names tasks by number only, and todo capture is opportunistic — one live run emitted todos for 1 of 7 implementer spawns, falsifying agent-todos-capture's recorded premise that implementers already use the todo tool. The item text exists in `tasks.md` at append time and is dropped; the todo mandate was declined on evidence that no longer holds.

## What Changes

- `task started` events carry the item's text in the existing optional `detail` field (single line, bounded), so the walk, the feed, and the memo project task names from the log alone — fold-is-truth preserved, old logs degrade to numbers.
- The implementer spawn prompt mandates todo-tool usage ("plan with the todo tool before editing; keep it current").
- An L0 `todos_missing {agent}` mark is appended when an implementer spawn settles without a single todo snapshot — honest compliance telemetry, never a failure.
- The web board's task walk renders `id · text`, and the todos panel names implementers that emitted none.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `afk-runner-execution`: "Sequential task walk in implement" gains the item-text stamping on started events (reusing `detail`, already carried by `task failed`); "Execution events are additive" extends to the memo's tasks projection carrying optional per-task text. Without this, board walk rows, feed lines, and memos stay number-only and `task failed`'s recorded tail stays the only task fact with content. The todo mandate + compliance mark extend the walk's spawn contract — no existing module mandates emission; agent-todos-capture deliberately declined it on since-falsified evidence.
- `afk-runner-web-board`: "Run-detail view" walk rows carry the item text, and the todos panel surfaces non-emitting implementers. Without it the detail view cannot answer "what is task 7" and silently omits todo absence.

## Non-goals

- Mandates for think-half stage agents (drafter/reviewer/skeptic never todos today; recorded as declined — a later change on fresh evidence).
- Hard enforcement: no halt, no report-schema requirement for todos — telemetry never gates work.
- Runner-synthesized pseudo-todos — the panel stays agent-emitted.
- The board reading `tasks.md` from the change folder — breaks log portability; the event stamp is the only source.
- `analyze` todo-compliance metrics — future reader over the new event.
- Scope model impact: none — all state is run-scoped files under the runner work dir; no platform/task instances, no config-context, per-user, or thread-isolated keys.

## Impact

- `afk-runner/src/work/implement.ts` (started-event detail, mandate line), `kernel/{types,fold,machine}.ts` (mapped `detail`, `TaskRecord.text`), `run-state.ts` (memo projection), `agent-reporter.ts`/`agent-layer.ts` (zero-snapshot detection, `todos_missing`), `agent-noise-schemas.ts` (new tolerated event), `serve/run-detail.ts` + `static/index.html` (rendering).
- Parity untouched (tasks records are non-projected residue); docs: `docs/architecture/afk-runner.md`.
