# Tasks: sdd-create-prompt-stdin-fix

## 1. Reproduce and pin the seam

- [x] 1.1 Build a minimal live-pty reproduction (script or test-time pty
  helper) that mounts the session picker, sends `(n)`, and asserts the
  creation prompt receives typed input; observe and record which mechanism
  (raw-mode restore race, paused/unrefed stream, unmount ordering) breaks
  the handoff — `bun test tests/sdd-runner/` (reproduction first, red)
- [x] 1.2 Add the seam-level regression test driving one shared stream
  through mount → `(n)` → unmount → readline prompt, asserting typed bytes
  are received and an empty line abandons with the notice —
  `bun test tests/sdd-runner/session-create.test.ts`

## 2. Fix the handoff

- [x] 2.1 Implement the restore-at-the-seam fix chosen by 1.1's observation
  (stdin resumed/refed, raw mode off, picker unmount settled before the
  prompt issues) — `bun test tests/sdd-runner/`
- [x] 2.2 Verify the live terminal path by hand: bare `sdd`, pick `(n)`,
  type a title and description, confirm the run starts; verify empty title
  abandons with the notice — `bun run sdd-runner:start`

## 3. Gates and docs

- [x] 3.1 Run the full gate set — `bun run test`, `bun run typecheck`,
  `bun run lint`, `bun security`
- [x] 3.2 Update docs if the runner-commands section of
  `docs/architecture/sdd-pipeline.md` mentions the seam (expected: no
  change needed; restore, don't rewrite)
