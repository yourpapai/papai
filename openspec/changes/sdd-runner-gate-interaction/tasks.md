<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: sdd-runner gate interaction

Order: the answer renderer and session logic are pure units first; discovery,
CLI surface, and wiring follow; shared consequence copy near the end (after the
session exists to consume it); docs and full gates last. Test-first throughout:
failing test before the implementation it covers.

## 1. Answer rendering + round-trip self-check (Decision 1)

- [x] 1.1 Add failing tests in `tests/sdd-runner/gate-answers.test.ts` (new): collected answers render to gate-file text that `parseGateResponse` reads back as the identical outcome — approve-all, veto with inline redirect, cap-hit blocker free-text answer, blocker OVERRIDE, the extend directive, ABORT, and the affirmed trajectory ack (T1). Verify: `bun test tests/sdd-runner/gate-answers.test.ts` (red)
- [x] 1.2 Implement `sdd-runner/src/gate-answers.ts` (answers → gate-file grammar) until 1.1 is green; existing parser tests stay green. Verify: `bun test tests/sdd-runner/gate-answers.test.ts tests/sdd-runner/gate-model.test.ts`

## 2. Prompter + session flow (Decisions 1-2)

- [ ] 2.1 Add failing tests in `tests/sdd-runner/gate-session.test.ts` (new) over a scripted prompter: walkthrough covers every finding and assumption with accept/veto/inspect; inspect prints the item's evidence and blast radius; veto collects the redirect inline; a cap-hit blocker prompts for a free-text answer or explicit override; approve is unavailable until T1 is affirmed and all blockers are answered; abandoning the session before the final decision writes nothing. Verify: `bun test tests/sdd-runner/gate-session.test.ts` (red)
- [ ] 2.2 Implement `sdd-runner/src/gate-session.ts` — the `prompter` interface, `scriptedPrompter`, and the session flow ending in gate-answers generation + the write-then-parse self-check — until 2.1 is green. Verify: `bun test tests/sdd-runner/gate-session.test.ts`
- [ ] 2.3 Add the `readlinePrompter` adapter (`node:readline`, no new deps) and TTY detection, wired as the default prompter; keep it thin (behavior is covered via the scripted prompter). Verify: `bun run sdd-runner:typecheck && bun run sdd-runner:lint`

## 3. Pending-gate discovery + run-id resolution (Decision 3)

- [ ] 3.1 Add failing tests in `tests/sdd-runner/run-state.test.ts`: `listPendingGates` scans `runs/*/state.json`, keeps only gate-pending runs, and returns change name, gate version, and wait time sorted by recency; `resolveRunId` accepts exact ids and unambiguous prefixes, and fails on unknown ids and on ambiguous prefixes with the candidate ids listed. Verify: `bun test tests/sdd-runner/run-state.test.ts` (red)
- [ ] 3.2 Implement `listPendingGates` and `resolveRunId` until 3.1 is green. Verify: `bun test tests/sdd-runner/run-state.test.ts`

## 4. CLI verbs, flags, and wiring (Decisions 4-5)

- [ ] 4.1 Add failing tests in `tests/sdd-runner/cli.test.ts`: parse `--extend`; repeatable `--veto <id>=<redirect>` splitting on the first `=`; `--extend` rejected in combination with `--confirm-all`/`--veto`/`--abort`; bare `gate`; `continue` with and without a run id. Verify: `bun test tests/sdd-runner/cli.test.ts` (red)
- [ ] 4.2 Implement the CLI parsing (including USAGE text in `index.ts`) until 4.1 is green. Verify: `bun test tests/sdd-runner/cli.test.ts tests/sdd-runner/index.test.ts`
- [ ] 4.3 Add failing tests: `resume` on a gate-pending run prints that the run awaits a gate decision plus the exact gate command with the run id (no silent exit); halting at a gate prints a next-step line carrying the full resume command and run id. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (red)
- [ ] 4.4 Implement the loud gate-pending message and the halt next-step line until 4.3 is green. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`
- [ ] 4.5 Add failing tests for the flag desugar: `--confirm-all` accepts all items then each `--veto` un-accepts its id with the redirect; an unknown veto id fails before any pipeline action; non-TTY input never prompts and acts on flags/file alone. Verify: `bun test tests/sdd-runner/gate-session.test.ts tests/sdd-runner/orchestrator.test.ts` (red)
- [ ] 4.6 Wire the gate-resume entry: TTY with no decision flags → interactive session; otherwise the flags/file path — until 4.5 is green. Verify: `bun test tests/sdd-runner/gate-session.test.ts tests/sdd-runner/orchestrator.test.ts && bun run sdd-runner:typecheck`
- [ ] 4.7 Add failing tests for `continue`: routes gate-pending → gate flow, interrupted-mid-stage → stage resume, completed → report pointer; with no id, a single pending/active run routes directly and several produce the picker on TTY or a plain list otherwise. Verify: `bun test tests/sdd-runner/cli.test.ts tests/sdd-runner/orchestrator.test.ts` (red)
- [ ] 4.8 Implement the `continue` router until 4.7 is green. Verify: `bun test tests/sdd-runner`

## 5. Session decision menu + shared consequence copy (Decision 6)

- [ ] 5.1 Add a failing test: the session's decision menu prints consequence lines from the same mode-conditional copy source the gate file uses (early vs final wording matches; no duplicated strings). Verify: `bun test tests/sdd-runner/gate-session.test.ts` (red)
- [ ] 5.2 Extract the consequence-lines helper from `gate-render.ts` into a shared module consumed by both the file renderer and the session until 5.1 is green and existing render tests stay green. Verify: `bun test tests/sdd-runner/gate-render.test.ts tests/sdd-runner/gate-session.test.ts`

## 6. Docs + full verification

- [ ] 6.1 Rewrite the gate-protocol section of `docs/architecture/sdd-pipeline.md`: the interactive session as the primary path, the hand-edited file as the power path, `continue`, the flag reference, and pending-gate discovery. Verify: `bunx openspec validate sdd-runner-gate-interaction --strict`
- [ ] 6.2 Run the full gates. Verify: `bun test && bun run typecheck && bun run lint`
