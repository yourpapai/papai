# Design — sdd-runner-fancy-ui

## Context

See proposal.md — Why. The interactive surfaces exist and are semantics-complete: the running screen (`tui-run-session.ts` mounting `run-view.ts` over the fold layer), the gate screen (`tui-gate-session.ts` + `tui-gate.ts`, decision logic in `gate-session-state.ts`), the session screens (`tui-session-picker.ts` + `tui-session-screen.ts`, creation form in `session-create-form.ts`), and the any-key ack shell (`tui-ack-screen.ts`). Rendering today is monochrome `<Text>` lines — `## Header` headers, code-unit `padEnd` alignment, one inline hint line. Width is captured once at mount (`process.stdout.columns ?? 100` in `tui-run-session.ts:107`, a hardcoded `width: 100` in `tui-gate-session.ts:104`); only `renderPipelineMap` takes a width (stage map joins at 60+ cols). Screens are factory components (`createRunView`/`createGateScreen`) re-created inside render bodies, so every frame remounts the whole tree. Keys flow through pure reducers with a scripted `KeyFeed` test seam. Ink 7.1.1 supplies `Static`, `useStdout`, `useWindowSize`, and resize notification; `string-width@8`/`cli-truncate@6` are already in `bun.lock` through ink.

Constraints carried from the wired TUI: gate settling runs the write-then-parse self-check; the TUI holds no decision state (disposable view, `events.ndjson` replay-sufficient); the non-TTY LineRenderer byte contract is frozen; `renderModeFor` never gives a non-TTY sink the TUI.

## Goals / Non-Goals

**Goals:**

- One presentation layer — semantic color tokens, framed and display-width-aligned panels, key-hints footer, `?` help overlay, width-aware reflow, Static/live render split — composed into all interactive screens without touching their state machines or key semantics.
- Decision parity provable by test: identical key sequences produce identical gate files under any presentation state.
- Degradation to today's monochrome under `NO_COLOR` with structure (panels, alignment, footer, overlay) intact.

**Non-Goals:**

- Beyond the proposal's exclusions: no restructuring of the fold/replay layer, no edits to `renderer.ts` or its frozen output, no theming surface, no alternate-screen/pager mode. Presentation never grows a second source for screen semantics.

## Decisions

### D1 — Five sibling `tui-*` presentation modules; screens compose them

- `tui-tokens.ts` — semantic→visual token map + `colorModeFor(env)`. No existing module covers color anywhere.
- `tui-panels.ts` — one frame style, display-width pad/truncate helpers, `joinOrStack(width, threshold)` layout. `renderer.ts` covers line-mode formatting only (non-TTY, untouched); its 60-col join rule is the seed generalized here.
- `tui-chrome.ts` — `keyHints(screen, state)` + `reduceHelpOverlay` pure reducer + footer/overlay components. Key affordances today live in scattered inline strings and `docs/architecture/sdd-pipeline.md`.
- `tui-width.ts` — `useTerminalWidth()` over ink's stock `useWindowSize` + `WidthFeed` scripted seam. The locked ink 7.1.1 already ships the hook (`useStdout()` + `resize` subscription + rerender on change, `use-window-size.js`); the module adds only the width-prop plumbing and the scripted seam — no subscription is hand-rolled.
- `tui-history.ts` — pure `historyRows(fold)` splitter for the append-only region. No module splits finalized from live rows.

Alternative: one `presentation.ts` (rejected — five distinct concerns would fight `max-lines`; the `tui-*.ts` naming convention already encodes this granularity). Alternative: per-screen styling (rejected — the spec's same-semantic-value-same-treatment-on-every-screen invariant needs one shared source).

### D2 — Color through `<Text>` props resolved by tokens; chalk is never imported

chalk 5 is ink's transitive dependency — importing it directly would be a phantom dependency under bun's isolated workspace links. Tokens map semantic values (severity blocker/material/nitpick, stage pending/active/done/skipped, cost known/estimated/unknown, retry) to Ink color props; a disabled color mode omits the prop. Every distinction already carries a non-color marker (`2b 1m 0n` counts, `✓ ▶ · —` stage icons, `metered`/`estimated`/`unknown` digest wording, `$`/`cost ?` cost labels, `[retry n]` badge text) — tokens only decorate, which is what makes D8's NO_COLOR parity test pass by construction.

### D3 — Display-width alignment via `string-width`/`cli-truncate` as direct sdd-runner deps

The existing stack already truncates wide-char-aware — `renderer.ts` exports `truncateVisible` (local range table + `Intl.Segmenter`, no dependency) — but computes no display-width padding (`padEnd` pads by UTF-16 code units, today's `finding.class.padEnd(8)`) and exports no width function; the Non-Goal bars editing frozen `renderer.ts` to add one, so reuse would mean duplicating its range table, and one aligned row padded by one width authority and truncated by another would drift. `tui-panels.ts` therefore holds the single width authority for the TUI's intra-line string columns: `string-width` measures (CJK/emoji plus the combining marks and ZWJ sequences the local table misses) for display-width padding, `cli-truncate` truncates by the same measure. Both packages are already locked through ink, so declaring them in `sdd-runner/package.json` grows nothing; Ink's Box layout handles panel geometry, and `renderer.ts` keeps its local helper untouched for the frozen non-TTY path. Alternative: restructure every row into Box columns and let yoga align (rejected — a far larger diff for the same invariant; helpers are the smallest change that aligns by visible width).

### D4 — One frame style, join/stack reflow by width

`joinOrStack` generalizes `renderPipelineMap`'s existing 60-col rule into the shared primitive (the pipeline map keeps its behavior). `renderer.ts` stays untouched per the Non-Goal — its 60 stays inline — so the threshold constant is defined once, in `tui-panels.ts`, and pinned to `renderPipelineMap`'s boundary by a test (join at 60, stack at 59) that fails if either side drifts. Side-by-side arrangement applies to panelar content (run screen: findings beside burndown; gate: items beside their evidence); single-logical-line rows (session rows, status line) truncate by display width instead of reflowing. Both behaviors are pure functions of `width`.

### D5 — Width lives inside the React tree

Width comes from ink's stock `useWindowSize()` — the locked ink 7.1.1 exports exactly the hook this decision would otherwise hand-roll (reads `useStdout()`, subscribes to `resize`, re-renders on change, non-TTY size fallback), so `useTerminalWidth()` is a thin wrapper over it, replacing the mount-time capture and the gate's hardcoded 100. The problem today is that the width prop is computed outside the tree where a rerender never refreshes it; the stock hook fixes that by construction. Components stay pure functions of a `width` prop (the `tui-narrow.test.ts` pattern keeps working — ink-testing-library's fake stdout is fixed at 100 columns and never resizes, which is exactly why the prop stays injectable); the `WidthFeed` push seam (mirroring `KeyFeed`) drives scripted resizes by updating `columns`/`rows` on an injected stdout and emitting `resize` there — live `render` takes an injectable stdout (the existing `AckMount` seam pattern), so the seam composes with the stock hook instead of reimplementing it. Text-entry buffers survive reflow by construction — they are reducer state, not render output; a resize test drives a mid-entry resize through the feed and asserts the buffer and cursor position.

### D6 — Static/live split requires stable component identity (precondition fix)

Ink's `Static` renders `items.slice(index)` exactly once per item — but resets if the component remounts, and today's factory pattern (`createRunView()` called inside a render body) creates a new component type every frame, remounting the tree. So: (a) factory components are instantiated once per session mount (module-level or memoized const), not per render; (b) `tui-history.ts` derives finalized rows — closed-round burndown rows, filed findings, done-agent rows — exactly the finalized rows the running screen renders today, as an append-only, stably-keyed list from the existing folds (`ReplayState.autoDecisions` stays unrendered as today — only the never-mounted `WatchView` drew it, and showing it would be a content change, not presentation); (c) `foldSlots` gains an additive in-memory `spawn` ordinal (monotonic, assigned on `spawned`), because slots are keyed by agent label and a re-spawned label would collide with its own history row. The ordinal exists only in the fold — no event-grammar, sidecar, or persisted-format change. Live region: pipeline map, active/retrying slots, status line, decision surfaces, footer.

### D7 — Footer and help overlay are pure chrome composed above the reducers

`keyHints(screen, state)` lists only currently-active bindings (e.g. `(e)xtend` only on early gates, `(d)elete` only on a deletable hover). `reduceHelpOverlay` composes above each screen's reducer with a fixed routing order: text-entry contexts consume `?` as literal input first (gate `SessionState.input !== null`, creation-form fields, blocker answers — all already reducer-owned); an open overlay swallows every key except dismiss (`?`, Esc); otherwise `?` opens. No existing binding uses `?`. Any-key surfaces are never composed with the overlay: on the ack shell every key, `?` included, acks, and on the session screen's delete-confirmation sub-screen every key except `y`, `?` included, cancels back to the list — both keep their documented any-key contracts (`docs/architecture/sdd-pipeline.md`), and each keeps the single any-key affordance it already renders. The overlay renders in the live region; dismissal restores the frame exactly, and nothing about overlay state feeds any settle path.

### D8 — Decision-parity and degradation invariants are pinned tests, not hopes

1. Same gate key script with and without interleaved `?` toggles, color-mode flips, and width changes → byte-identical `GateAnswers` and gate-file markdown. 2. Structural equality: the `NO_COLOR` frame equals the colored frame line-for-line once ANSI sequences are stripped. 3. The non-TTY sink stays byte-frozen: the exclusivity suite extends to assert no presentation-layer (or any) ANSI escape reaches a non-TTY stream. These extend `tui-gate-session.test.ts`, `tui-narrow.test.ts`, and `tui-exclusivity.test.ts` — the pure reducers already guarantee the mechanism; the tests pin it against presentation-layer mistakes.

## Risks / Trade-offs

- [Static output repeats inside ink-testing-library debug frames, so "emitted once" is not frame-observable there] → split the assertions: the pure splitter is unit-tested for append-only monotonic idempotence; the once-emitted semantics are asserted through Ink's `render` with an injectable fake stdout (the existing `AckMount` seam pattern — "ink-testing-library exposes frames, the live ink instance does not"), checking the write stream rather than frames.
- [A factory-identity regression silently re-emits history every frame] → the first task is a walking skeleton that rerenders N times and asserts each history row appears exactly once in the stream.
- [Duplicate keys from re-spawned agent labels] → the `spawn` ordinal keys history rows; pinned by a fold test that spawns the same label twice.
- [Wide-char edge cases beyond CJK/emoji (combining marks, ZWJ)] → `string-width` handles the standard cases; tests pin representatives; the worst case is one column of visual misalignment, never a line overflow — truncate-by-display-width guards the invariant that matters.
- [Resize sequences differ across terminal emulators] → the stock hook re-reads terminal size per resize event and reflow is a pure function of width; no state can be corrupted by an odd sequence.
- [Color/distinction parity drifts between screens] → one token module with one mapping; the NO_COLOR structural-equality test renders the same semantic content on every screen shape.
- [New pure modules face the mutation ratchet] → exact-value assertions on token maps, hint lists, and splitter output; snapshot-only tautologies are not relied on.

## Migration Plan

One branch, additive modules first, screens last, each step test-first: (1) walking skeleton — factory-identity fix plus the Static stream-observability proof; (2) `tui-tokens` + color mode; (3) `tui-panels` with the two direct deps; (4) `tui-width`; (5) `tui-chrome`; (6) apply to screens in attention order — gate, running, session, ack (framing only on ack: `?` acks, no overlay); (7) `tui-history` Static split on the running screen; (8) docs (`docs/architecture/sdd-pipeline.md` Live rendering / Gate decisions / the `## Commands` session-screen paragraphs) plus the full gate. Rollback is a single revert — no persisted state, config, or grammar changes; the pre-change screens return intact.

## Hook / TDD interactions

The Write/Edit TDD hooks over `sdd-runner/src/` are advisory, not blocking: writing a new `sdd-runner/src/tui-{tokens,panels,chrome,width,history}.ts` without a covering test allows the write and emits a once-per-file nudge naming the expected test path (`sdd-runner/src/foo.ts` → `tests/sdd-runner/foo.test.ts`, the `.hooks/tdd/test-resolver.mjs` mapping); the hard gate is CI (`test:mutate:changed` + coverage ratchet). Test-first sequencing is therefore migration-plan discipline rather than hook enforcement: each new module's `tests/sdd-runner/tui-*.test.ts` exists (failing) before the module lands, and edits to `run-view.ts`, `tui-gate.ts`, `tui-session-screen.ts`, `tui-session-picker.ts`, `tui-ack-screen.ts`, `tui-run-session.ts`, `tui-gate-session.ts`, and `watch-view.ts` extend their existing suites first (`run-view`, `tui-gate`, `tui-session-screen`, `tui-session-picker`, `tui-ack-screen`, `tui-run-session`, `tui-gate-session`, `watch-view`, `tui-running`, `tui-skeleton`, `tui-narrow`, `tui-exclusivity`). The direct deps land in `sdd-runner/package.json` with the first module that imports them. Final task runs the full `bun test`, typecheck, lint, format, and the docs update.

## Scope model / capability / DB impact

None. No tool surface — capability gating and `tool_prefs` untouched. No persisted state keyed by storage context, config context, platform instance, or user — presentation state is in-process view state; run artifacts (`events.ndjson`, `state.json`, gate files) keep their formats. No DB migration. sdd-runner is local developer tooling outside the papai runtime.

## Open Questions

- Exact palette per token (which named colors blocker/material/nitpick etc. map to) — cosmetic, decidable during implementation without touching spec, proposal, or tasks.
- Which specific panel pairs join at wide width per screen — the reflow requirement is fixed; the pairing choice is a layout detail each screen task can finalize.
