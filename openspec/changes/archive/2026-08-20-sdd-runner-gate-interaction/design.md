<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: sdd-runner gate interaction

## Context

See `proposal.md` (Why / What). The load-bearing current state:

- The gate contract is file-based: `presentGateAt` writes `gate-<n>.md` plus
  `gate-hashes-<n>.json`; `resumeGate` (`gate.ts`) re-reads and parses the file
  (`parseGateResponse` in `gate-model.ts`) and acts on the outcome. Nothing in
  the runner reads stdin; the only human input channel is that file.
- Run identity is the directory name under `.sdd-runner/runs/` — a 37-char
  timestamp-plus-suffix that `loadRunState` joins verbatim; no listing,
  prefix, or "latest" resolution exists.
- `runResume` returns `{ halted: 'gate-pending' }` for a gate-pending run and
  the CLI prints nothing for that result — the silent exit.
- A dynamic TTY renderer already exists (`live-renderer.ts`), so terminal
  output idioms (erase/redraw, styled lines) are established. Dependencies are
  `p-limit` + `zod` only.

## Goals / Non-Goals

**Goals:**

- A gate decision is a guided interaction on a terminal, with zero protocol
  knowledge required; the file becomes an audit artifact the session writes.
- Every halt tells the operator the exact next command, run id included.
- One routing verb (`continue`) that never fails silently.
- Full non-interactive parity via flags for CI and scripts.
- No new runtime dependencies.

**Non-Goals:**

- A full-screen TUI (cursor-addressable forms, mouse). Line-oriented prompts
  are sufficient and testable via scripted stdin.
- Changing gate *semantics* (what approve/extend/veto/abort do downstream) —
  that is the sibling change `sdd-runner-pipeline-completion`; this change's
  session prints consequences abstractly from the current pipeline state so
  the two changes compose in either landing order.
- Notifications beyond the terminal (desktop/Telegram push). Deferred; the
  printed next-step is the notification contract.

## Decisions

### Decision 1 — The session writes the file; the parser stays the single reader

The interactive session collects answers in memory, then **generates**
`gate-<n>.md` via a new answer-rendering function that emits the *same grammar*
the parser accepts (checked/unchecked checkbox lines, `→ <redirect>` lines
beneath vetoed items, blocker answer lines, the extend directive) — deliberately
not the presentation renderer, which renders unanswered gates. The existing
`resumeGate` path then parses that file as usual. Generation is verified by a
write-then-parse self-check: the session re-parses its own output with
`parseGateResponse` and refuses to proceed if the parsed outcome differs from
the collected answers. This keeps one grammar, one parser, one audit format —
the session can never drift from the hand-edit path, and the hash/drift
machinery (`gate-hashes-<n>.json`, which hashes change-directory artifacts, not
the gate file) is untouched.

Item kinds mirror the parser's three channels: assumptions and findings get
accept / veto(+redirect) / inspect; cap-hit **blockers** get answer (free text)
/ override; the **trajectory acknowledgment** (T1 at cap-hit gates) is an
affirm prompt that gates the approve decision, mirroring the parser's
`requiredAck` hard failure.

**Alternative considered:** bypass the file and construct the `GateOutcome`
directly from session answers. Rejected: it forks the contract (two producers
of truth), loses the file as the audit record of *what was decided*, and
complicates the drift check that keys off the file.

### Decision 2 — Line-oriented prompts over `node:readline`, injectable for tests

The session module depends on a tiny `prompter` interface (`ask(item) →
answer`, `decide(options) → decision`) with two implementations:
`readlinePrompter` (real TTY) and `scriptedPrompter` (answers from an array,
for tests and `--yes`-style scripting). TTY detection (`process.stdin.isTTY`)
selects interactivity; flags always win over prompting. This matches the
repo's DI-first testing convention and avoids a TUI dependency.

### Decision 3 — Pending-gate discovery scans run states

A `listPendingGates(workDir)` helper scans `.sdd-runner/runs/*/state.json`,
filters `gate !== null`, and returns `{ runId, changeName, gateVersion,
updatedAt }` sorted by recency. Run-id arguments pass through a resolver:
exact match → that run; else unique prefix among known runs; else error
listing candidates. `gate` with no id uses the list: one pending → open it
directly; several → picker on TTY, printed list with per-run commands
otherwise.

### Decision 4 — `continue` is a pure router; `resume` gets loud, not redefined

`continue <runId>` maps `loadRunState` + gate field to the existing flows
(gate-pending → `runGateResume` path; otherwise the stage-resume path of
`runResume`; completed → report pointer). `continue` without an id uses the
same discovery as bare `gate` (one pending or active run → route it; several →
picker/list). `resume` keeps its meaning (stage
resume) but its gate-pending branch now prints the gate command and run id.
Keeping `resume` narrow avoids surprising scripts that may parse its output,
while `continue` absorbs the "just do the right thing" intent.

### Decision 5 — Flag composition mirrors the file grammar

Flags desugar to the same answers the session collects: `--confirm-all` accepts
every item; each `--veto <id>=<redirect>` (split on the *first* `=`, ids
validated against the gate's item set, unknown id → error before any action)
then un-accepts that item with its redirect; `--abort` and `--extend` map to
their parser directives. `--extend` short-circuits in the parser, so combining
it with `--confirm-all`/`--veto`/`--abort` is rejected as incoherent rather
than silently ignored.

### Decision 6 — Consequence text is sourced from pipeline state, not hardcoded

The decision menu's consequence lines ("approve → …") are rendered from the
run's gate mode and depth profile via a small descriptor the orchestrator
already knows (early vs final gate, remaining stages), so when
`sdd-runner-pipeline-completion` changes those semantics the session text
changes with it — no string drift between the two changes.

## Risks / Trade-offs

- **[Session/parser skew]** the generator could emit a file the parser reads
  differently → Mitigation: Decision 1's write-then-parse self-check fails
  closed before any pipeline action.
- **[readline quirks under Bun]** → Mitigation: the prompter interface is the
  tested unit; the readline adapter stays thin; flags bypass it entirely.
- **[Prefix resolution hides full ids in scripts]** → Mitigation: halt lines
  and listings always print full ids; prefixes are an interactive convenience
  only, and ambiguity fails loudly with candidates.
- **[Two front-ends (session vs hand-edit) confuse which one "happened"]** →
  Mitigation: the gate file is the single record either way; the session's
  generated file is byte-identical in format to a hand edit, and the events
  log records the outcome, not the input modality.

## Migration Plan

- Code-only. Gate files, run states, and the events log are format-compatible
  both directions; an operator can hand-edit gate v1 and use the session on
  v2 of the same run.
- Rollout: land with tests (`tests/sdd-runner/`), rewrite the gate-protocol
  section of `docs/architecture/sdd-pipeline.md` in the same change.
- Rollback: revert; pending gates remain decidable by hand-editing (the
  parser is untouched).

## Open Questions

- Whether `sdd-runner gate` with multiple pending runs should additionally
  notify on `start` of a *new* run ("N other runs await gate decisions").
  Deferrable polish; the listing covers discovery.
