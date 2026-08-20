<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: sdd-runner gate interaction

## Why

The gate is conceptually a dialog — the runner presents findings and assumptions,
the human decides — but it is implemented as a document: hand-edit a markdown file,
learn an unspoken checkbox protocol (unchecked means *veto*), type magic strings
(`→ RUN 1 MORE`, bare-line `ABORT`), memorize a 37-char run id, and choose between
two easily-confused resume verbs (`resume` exits *silently* on a gate-pending run).
Every one of these failure modes was hit in a single real run. Adoption requires
the human checkpoint to become an interaction, not homework.

## What Changes

- **Interactive gate session on TTY**: `sdd-runner gate resume <runId>` on a
  terminal walks each finding and assumption as a prompt — accept / veto (typing
  the redirect inline) / inspect evidence and blast radius — then offers the
  decision (approve / extend / abort) with each choice's downstream effect printed
  beside it. The session **writes** `gate-<n>.md` from the answers: the file
  remains the audit record and hash anchor, but becomes an output of the
  interaction instead of the input medium.
- **Pending-gate discovery**: halting at a gate prints a next-step line that
  always carries the concrete run id (multiple runs may be gate-pending at once).
  `sdd-runner gate` with no id lists all gate-pending runs — an interactive picker
  on TTY, a plain list otherwise. Exact ids and unambiguous prefixes keep working.
- **`sdd-runner continue` smart verb**: inspects run state and routes —
  gate-pending → gate session; interrupted mid-stage → stage resume; completed →
  report pointer. `resume` on a gate-pending run prints a loud pointer to the
  correct command instead of exiting silently.
- **Non-TTY and CI path**: new `--extend` and repeatable `--veto <id>=<redirect>`
  flags alongside the existing `--confirm-all` / `--abort`; interactive mode is
  entered only on a TTY, flags otherwise. Hand-editing the gate file stays a
  supported power path — the existing parser is retained.
- No new runtime dependencies: prompts use `node:readline` under Bun.

## Capabilities

### New Capabilities

- `sdd-runner-cli`: the runner's human-facing command and interaction surface —
  gate session modes (interactive vs flags), pending-gate discovery and run-id
  ergonomics, the `continue` routing verb, halt notification content, and the
  gate-file audit contract.

### Modified Capabilities

None — `openspec/specs/` has no existing capability specs for the runner.

## Impact

- **Code:** `sdd-runner/src/cli.ts` (new verbs/flags), `sdd-runner/src/index.ts`
  (USAGE), a new gate-session module (`node:readline`), `sdd-runner/src/gate.ts` /
  `gate-model.ts` (answers → gate-file generation; parser retained for the
  hand-edit path), `sdd-runner/src/orchestrator.ts` (loud gate-pending message,
  halt next-step lines), `sdd-runner/src/run-state.ts` (scan `runs/` for
  gate-pending states), `sdd-runner/src/renderer.ts` / `live-renderer.ts`
  (session styling consistent with the existing TUI idiom).
- **Docs:** `docs/architecture/sdd-pipeline.md` (gate protocol section rewritten
  around the session; file protocol documented as the power path).
- **Tests:** `tests/sdd-runner/` — session flows (scripted stdin), flag
  equivalence with file edits, pending-gate discovery, `continue` routing.
- **Compatibility:** all existing commands, flags, and the file-editing protocol
  keep working unchanged.
