# Design: sdd-create-prompt-stdin-fix

## Context

See proposal.md — Why. Today `runSessionPicker` (Ink, `useInput` holds stdin
in raw mode) resolves `(n)` by calling `instance.unmount()` and settling the
promise synchronously inside Ink's key handler; `runInteractive` then
immediately calls `runSessionCreate`, whose `readline.createInterface`
attaches to the same `process.stdin`. On a live terminal the first
`rl.question` resolves empty/EOF at once — typed input never arrives. The
hermetic suites never exercise this: picker tests use `keyScript` feeds,
create tests inject fake streams.

## Goals / Non-Goals

Goals: the creation prompt is usable on a live terminal after the session
screen closes; the seam is pinned by a test so it cannot silently regress.

Non-Goals (design-level): replacing the readline prompt with an Ink form,
looping back to the session screen, changing gate/run-screen stdin handling —
all owned by `sdd-runner-session-manager`, which will delete the seam this
change repairs.

## Decisions

- **Reproduce before fixing.** The exact failure mode (raw-mode restore race
  vs paused stream vs Ink's unref/unmount ordering) is a hypothesis until
  observed. Task 1 builds a minimal live-TTY reproduction outside the suite
  (a script mounting the picker, feeding `(n)` via a pty, then prompting) and
  records which mechanism fires. The fix follows the observation, not the
  guess. Alternative rejected: blind `await new Promise(setImmediate)` —
  timing luck is not a contract.
- **Restore-at-the-seam.** The repair belongs at the transition point (after
  picker unmount, before readline attaches): ensure raw mode is off, the
  stream is resumed/refed, and Ink's cleanup has run to completion (await its
  unmount settlement if it exposes one). This keeps the fix local; gate and
  run screens never hand off to readline and stay untouched. Alternative
  rejected: reworking Ink's stdin management inside the picker — broader
  blast radius for a seam `sdd-runner-session-manager` deletes anyway.
- **Seam test shape.** A test can't hold a real pty portably; instead the
  seam test drives one shared `PassThrough`-style stream through
  mount → key → unmount → readline prompt, asserting typed bytes arrive and
  empty-line abandons. It pins ordering (prompt issues only after unmount
  settlement) rather than terminal internals, which is the property that
  broke.

## Risks / Trade-offs

- [Root cause differs from hypothesis] → Task 1's reproduction decides the
  concrete fix; the spec scenario is mechanism-free, so only the design's
  candidate fix would change.
- [Fix is timing-sensitive on some terminals] → prefer awaiting explicit
  settlement/resume signals over timeouts; if a delay is unavoidable, gate it
  behind the seam and keep it minimal with a comment-free named constant.
- [Mutation gate] → the fix likely lands in one small function; keep it
  branch-minimal so the Stryker per-file ratchet stays satisfiable.

## Migration Plan

Single PR; no persisted state, flags, or config. Rollback is revert.

## Open Questions

(none — resolved during task 1.1)

**Observed mechanism (task 1.1, pty reproduction):** the entry is
`void runEntry()`-shaped (index.ts), so the module body completes while the
run promise floats. At `(n)`, Ink's unmount teardown (`disableRawMode`) runs
`stdin.setRawMode(false)` **and `stdin.unref()`**; readline then attaches
with listeners only and never re-refs stdin. Once the remaining transient
handles settle, the event loop drains → `beforeExit(0)` → clean exit
mid-prompt (heartbeat trace: `MAIN_ENTER → (n) → BEFORE_EXIT code=0 → EXIT
code=0`, ~instant after the keystroke; exit code 0, title-restore escape as
final bytes). Every hermetic variant survived only via pending top-level
await holding module evaluation — the shipped entry is the only void-shaped
path, which is why only it dies. Fix validated in the repro: re-ref + resume
at the seam keeps the process alive through the prompt; post-main exits are
explicit `process.exit(code)`, so the extra ref cannot hang completed
actions.
