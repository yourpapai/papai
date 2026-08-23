# Tasks: sdd-runner-session-manager

## 1. Creation form reducer

- [x] 1.1 Write failing scripted-key tests for the form reducer module
  (title/description field focus and navigation, char input, backspace,
  empty-title submit → validation notice + form stays open, cancel →
  cancelled outcome, valid submit → submit outcome with composed task text) —
  `bun test tests/sdd-runner/session-create-form.test.ts`
- [x] 1.2 Implement the form reducer (pure, generalizing the gate input
  reducer's handling) until the tests pass —
  `bun test tests/sdd-runner/session-create-form.test.ts`

## 2. Screen-switch state machine

- [x] 2.1 Write failing tests extending the session-screen reducer with a
  screen dimension (`list ⇄ create`): `n` opens the form, form cancel returns
  to the list with cursor preserved, existing row actions unchanged —
  `bun test tests/sdd-runner/tui-session-screen.test.ts`
- [x] 2.2 Implement the screen-switch state and render the form lines (title,
  description, footer hints, validation notice) —
  `bun test tests/sdd-runner/tui-session-screen.test.ts`

## 3. Loop driver

- [x] 3.1 Write failing tests for the looping picker driver: report shown →
  any key → refreshed list re-rendered; action rejection → notice → list;
  quit outcome only via explicit quit key; rows re-read between iterations —
  `bun test tests/sdd-runner/tui-session-picker.test.ts`
- [x] 3.2 Implement the loop in the picker driver around
  `executeSessionTarget` and the creation starter (try/catch at the loop
  boundary, notice screen with any-key return) —
  `bun test tests/sdd-runner/tui-session-picker.test.ts`

## 4. Wiring and seam removal

- [x] 4.1 Wire the harness: `sessionCreate` starts a run from the form's
  composed task text; `runInteractive` calls the looping picker once; update
  `USAGE` text — `bun test tests/sdd-runner/ && bun run typecheck`
- [x] 4.2 Delete the readline creation path and the stdin-fix seam; remove
  their now-dead tests, keeping coverage that still pins live behavior —
  `bun test tests/sdd-runner/ && bun run typecheck`

## 5. Gates and docs

- [x] 5.1 Run the full gate set — `bun run test`, `bun run typecheck`,
  `bun run lint`, `bun security`
- [x] 5.2 Update `docs/architecture/sdd-pipeline.md` (session screen loop,
  in-screen creation, quit semantics) and the USAGE block if key hints
  changed — `bun run lint`
