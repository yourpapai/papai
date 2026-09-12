# sdd-runner-simplify

## Why

sdd-runner's option surface has outgrown its users: 7 subcommands, ~20 flags, and 13 config keys across 3 blocks encode the same three decisions (how many rounds, how much spend, when does a human look) in up to six places each. A newcomer cannot make a first run without internal knowledge (autonomy levels, rules R1–R5, `roundCap` vs `depth`, `budgetUsd` vs `costCeilingUsd`). Meanwhile the actual target — fully autonomous, durable execution — is undermined by the one gap that matters: a crash mid-agent loses the opencode session; resume re-enters at stage boundaries and re-spawns from rebuilt prompts, re-spending every token the lost agent burned.

## What Changes

- **BREAKING** — CLI collapses from 7 subcommands to a routing verb `sdd [<target>]` (absorbs `start`/`resume`/`continue`/`gate`/`report`/`audit`/`watch`), plus `sdd stop [id]` (calm, boundary-honoring stop — today there is no stop verb at all). `--depth S|M|L` stays as the single start-time override; `--pr`, `--config`, `--reopen <n>` are the only other flags.
- **BREAKING** — one interactive view: on an interactive non-CI TTY, `sdd` renders an Ink TUI (progress, findings, burndown) that is also the gate decision surface, absorbing `watch`, the hand-rolled `DynamicRenderer`, and the `@clack`/readline gate session. The TUI writes the same `gate-<n>.md` (via the existing `gate-answers.ts` self-check) and `steer.md` files — files stay the protocol, the TUI is a front-end over them, not a fourth decision grammar. Non-TTY/CI keeps the append-only `LineRenderer` byte contract and the hand-edited gate file.
- **BREAKING** — config drops from 13 keys to 5: `repoRoot`, `workDir`, `model`, `budget`, optional `deadline`. Removed: the `autonomy` block (level, `costCeilingUsd`, `autoExtendMax`, `rules`), per-role `models` map, `timeouts`.
- Autonomy becomes single-mode: always autonomous within `budget`, gating on the existing never-cut invariants (open BLOCKER always gates; budget/reversibility always gate). `observe`/`assist`/`auto` levels and R1–R5 toggles are removed; the ladder stays as internal policy.
- Gate interaction keeps exactly two front-ends: the Ink TUI (interactive TTY) and the hand-edited gate file (non-TTY/CI). All decision flags (`--confirm-all`, `--veto`, `--extend`, `--abort`, `--wait-deadline`, `--no-wait`) are cut; the file grammar already covers them.
- Durability: every spawn records its opencode session id to `runs/<id>/sessions.jsonl`; crash mid-agent resumes via `opencode run --session <id>` at exact context instead of stage-boundary prompt rebuild. Raw agent transcripts (already appended per spawn) are promoted to `runs/<id>/transcripts/` as a first-class debugging surface.

## Capabilities

### New Capabilities

- `sdd-runner-cli`: the two-verb routing surface (`sdd` router, `sdd stop`) and flag inventory. Without it, a newcomer needs the architecture doc open to start, stop, or resume a run — today's common case.
- `sdd-runner-tui`: the single interactive Ink view — progress/findings/burndown display, in-TUI gate decisions and steering, calm-stop key handling, TTY/CI detection with LineRenderer fallback. Without it, three disjoint terminal surfaces (ANSI block, stubbed watch, clack prompts) each show a fraction of run state and none supports interaction.
- `sdd-runner-config`: the five-key config schema and the derivation rules that replace the removed keys. Without it, three spend/round knobs keep drifting apart and every config review re-litigates `budgetUsd` vs `costCeilingUsd`.
- `sdd-runner-durability`: session capture/restore, transcript storage, and calm stop. Without it, any interruption re-spends a full agent's tokens and there is no supported way to stop a run cleanly.

### Modified Capabilities

None — `openspec/specs/` is empty; the existing sdd-runner behavior is documented in `docs/architecture/sdd-pipeline.md` (Commands, Autonomy, Auto-level deadline sections rewrite here), not in capability specs.

## Non-goals

- In-TUI mid-run steering keys (`e`/`a` while a round is live) — `steer.md` stays the only steering surface; gate-pending screen decisions are the gate, not steering.
- Pipeline stage semantics (INTAKE → … → GATE) are unchanged; this is a surface + durability change, not a re-architecture.
- Per-role model maps (declined: anticipated need; a single `model` covers observed use — `config.json` in this repo uses none).
- The `/sdd:auto` papai chat wrapper — separate change, unchanged dependency on `bun run sdd-runner:start`.
- review-loop's own CLI/config — untouched; only the shared `review-loop/src/agent-runner.ts` seam gains session capture.
- Backward-compatible parsing of old config keys or removed flags — fails loudly with the new shape (local tooling, not a deployed API).
- Session forking (`--fork`) — a resumed spawn continues the same context; branching is unwanted.
- New dependency for session restore — none needed: the installed opencode documents `run --session <id>`, and JSON event lines carry `sessionID` (verified by spike, see design.md Context).

## Impact

- `sdd-runner/src/`: `cli.ts`, `cli-flags.ts`, `config.ts`, `index.ts` (USAGE), `auto-policy.ts` (levels/toggles removed, ladder inlined), `run-state.ts` (autonomy fields), `orchestrator.ts`, `deadline-waiter.ts` (wait flags derived from TTY); TUI: `watch-view.ts` components finish, `watch-loop.ts`/`watch.ts` folding absorbed into the run view, `live-renderer.ts` (DynamicRenderer) and `gate-session.ts`/`clack-prompter.ts`/`composition-prompter.ts` deleted.
- `review-loop/src/agent-runner.ts`: session-id capture seam (shared with sdd-runner; review-loop behavior unchanged).
- `sdd-runner/package.json`: `@clack/prompts` removed; `ink`/`react`/`ink-testing-library` move from vestigial/dynamic-import to the main view.
- `docs/architecture/sdd-pipeline.md`: Commands, Live rendering, Autonomy, and deadline sections rewritten; the pending `shared-tui-renderer` change's sdd-runner scope shrinks to format helpers (DynamicRenderer deleted).
- No papai runtime impact: local developer tooling; no platform or task instances, no config-context scope changes.
