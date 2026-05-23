# Storybook harness for the dashboard UI

- **Status:** Draft — awaiting review
- **Date:** 2026-05-23
- **Branch:** `claude/wonderful-brown-Iq7wL`

## Goal

Stand up a `bun storybook` developer surface that renders every dashboard
component (~50) and both SPA shells in isolation, with multi-state stories
driven by deterministic fixtures, theme switching, and a11y checks. The harness
is for engineer and designer-style review of the debug and admin surfaces,
catches visual regressions during local development, and gives new contributors
a browseable component reference.

## Non-goals

- Interaction tests via `play()` functions and `@storybook/test-runner`.
- Visual regression snapshots (Chromatic, Playwright, image diffing).
- Public hosting / external deploy of the static Storybook build.
- Replacing `bun test:client`. Storybook is a visual and authoring layer;
  unit tests remain in `tests/client/` and continue to run under Bun + happy-dom.
- Storybook coverage for the chat-platform-side runtime (`src/`); only
  `client/{shared,debug,admin}/` is in scope.

These four items may be picked up in follow-up specs; the current design must
not block them, but does not implement them.

## Constraints

- **Runtime is Bun.** No `npm`, `yarn`, or `pnpm` scripts. Storybook's CLI is
  invoked through `bun storybook` / `bun build:storybook`.
- **Build is Bun-native.** Production builds for the SPA continue to run through
  `scripts/build-client.ts` using `scripts/svelte-plugin.ts` and `Bun.build`.
  Storybook introduces Vite as a *second*, dev-only toolchain. Vite never
  participates in production bundles.
- **Svelte 5 with runes.** Components use `$props`, `$state`, `$derived`.
  Story files use Svelte CSF (`<Story>` blocks inside a `.stories.svelte` file).
- **Strict TypeScript** with `.js` import extensions.
- **TDD hook pipeline** runs on writes to files under `src/` or `client/` whose
  extension is `.ts`, `.js`, `.tsx`, or `.jsx` and that aren't `*.test.*` /
  `*.spec.*`. `.stories.svelte` is *not* in this set, so colocated stories do
  not trip the test-first gate. `.stories.ts` files would — see "Story format".
- **knip strictness** flags unused exports and deps. Storybook deps and the
  stories glob must be declared as entrypoints.
- **oxlint** blocks inline suppressions; the existing rules must keep passing
  on the new story files.
- **No `.oxlintrc.json` edits** unless coordinated separately — that file is
  hook-protected. The harness must not need to modify it.

## Locked decisions (from brainstorming)

| Axis | Decision |
| --- | --- |
| Tool | Official Storybook 9.x + Vite, run by Bun |
| Scope | Everything under `client/` including both SPA shells (~50 components) |
| Mocking | MSW handlers + custom SSE stub + fixture decorator |
| Coverage shape | Multi-state per component: default, empty, loading, error, populated, edge |
| Story location | Colocated next to each component |
| Story format | Svelte CSF (`*.stories.svelte`) only; no `*.stories.ts` |
| Addons (baseline) | Essentials, `addon-svelte-csf`, `addon-a11y`, `addon-themes` |
| Rollout | Vertical slice (PR 1, 5 stories proving every mock layer) → phased fan-out (PRs 2–4) |

## Architecture

```
.storybook/
  main.ts                ← framework: '@storybook/svelte-vite', stories glob, addons
  preview.ts             ← decorators (theme, withFixtures); global stubs
  preview-head.html      ← injects client/shared/{base,tokens}.css
  vite.config.ts         ← path aliases mirroring tsconfig; allow ../src/ imports

client/<tier>/Foo.svelte
client/<tier>/Foo.stories.svelte    ← colocated; multi-state <Story> blocks

client/stories/
  fixtures/
    index.ts             ← typed factories (makeBillingSubject, makeGlobalStats, …)
    schemas.ts           ← reuses client/admin/fetcher-schemas.ts to validate fixtures
  msw/
    handlers.ts          ← composable handlers, one bundle per route family
    scenarios.ts         ← named bundles ('admin-empty', 'admin-populated', …)
  stubs/
    sse.ts               ← controllable EventSource: stub.emit('llm:full', payload)
    intersection-observer.ts
  decorators/
    withFixtures.ts      ← resets rune singletons, swaps MSW handlers, replays SSE seed
    withTheme.ts         ← wires @storybook/addon-themes to client/shared/tokens.css
```

Stories live next to the component they exercise. Anything that requires a
fixture or mock pulls from `client/stories/` via the `withFixtures` decorator,
keeping per-story files small.

## Data flow per story

1. **Storybook boot.** `preview.ts` initialises the MSW worker, installs the
   `EventSource` and `IntersectionObserver` stubs onto the preview iframe's
   window, and registers global decorators.
2. **Story parameter declaration.** Each story names the fixture/scenario it
   wants via `parameters: { fixtures: 'admin-populated' }`.
3. **Decorator runs before mount.** `withFixtures` resets the rune singletons
   (`dashboard` in `debug.svelte.ts`, `adminGlobals` in `global-stats.svelte.ts`),
   swaps in the MSW handler bundle for that scenario, and, for SSE-driven
   stories, replays seed events into the SSE stub.
4. **Component mounts.** The component behaves exactly as it does in
   production — fetches resolve against MSW, SSE events fire from the stub.
5. **Teardown.** The decorator restores MSW to its default handlers and resets
   the rune state again, so adjacent stories cannot leak.

## Story tiers and coverage requirements

The dashboard breaks naturally into five tiers; the harness applies different
mock requirements to each.

| Tier | Examples | Mocks needed | Min states per component |
| --- | --- | --- | --- |
| Primitives | `client/shared/ui/{Btn,Pill,Dot,Bars,Spark}` | None — props only | default, edge |
| Composites | `client/shared/{PanelShell,PropertiesTable,Modal,Confirm,TreeView}` | None — props only | default, empty, populated, edge |
| Components | `client/{debug,admin}/components/*` | Fixture decorator (rune-state injection); MSW only if the component fetches directly | default, empty, loading, error, populated, edge |
| Sections | `client/admin/sections/*` | Full decorator (MSW + rune reset) | default, empty, loading, error, populated |
| Shells | `DebugApp.svelte`, `AdminApp.svelte` | Full decorator + SSE pre-feed + IntersectionObserver stub | default, populated |

"Required states" are an authoring convention enforced in code review, not via
a write-time hook (initially). A follow-up may add a lint rule that fails when
a non-primitive `.stories.svelte` declares fewer than the required number of
`<Story>` blocks.

## Mock layer design

### MSW

- One module per route family in `client/stories/msw/handlers.ts`
  (`adminHandlers`, `statsHandlers`, `billingHandlers`, …).
- `scenarios.ts` exports named handler bundles assembled from those families
  (`'admin-empty'`, `'admin-populated'`, `'admin-error'`, `'billing-loading'`,
  `'stats-mixed'`, …).
- Handler response bodies are constructed via the typed factories in
  `client/stories/fixtures/` and validated at module load against the live
  schemas in `client/admin/fetcher-schemas.ts`. A drifted fixture fails
  Storybook startup, not silently inside a story.

### SSE stub

- Re-uses the `StubEventSource` pattern from `tests/client-setup.ts` (the same
  shape the unit tests already depend on), but adds an imperative `emit(event,
  payload)` API for stories to drive.
- Installed onto `window.EventSource` in `preview.ts` *before* any story
  module loads, so `client/debug/sse.ts` picks up the stub when first imported.
- The decorator exposes an `sse.seed([{event, payload}, …])` helper for stories
  that need a pre-populated dashboard before mount.

### Fixture decorator (`withFixtures`)

- Receives a `scenario` name from `parameters.fixtures`.
- Imperatively resets the module-level `$state` singletons. `$state` proxies
  cannot be *reassigned* from outside the module, so the reset uses the same
  per-field mutation pattern used in `tests/client/`. The contract is locked in
  PR 1 against the hardest target (`AdminApp.svelte`).
- Swaps MSW handlers to the named bundle, then restores the default bundle on
  teardown.
- For SSE-tagged scenarios, calls `sseStub.seed(scenario.events)` after the
  rune reset and before mount.

### Theme decorator (`withTheme`)

- Drives `@storybook/addon-themes` to toggle a `data-theme="dark|light"`
  attribute on the preview root.
- `client/shared/tokens.css` already defines theme variables; no token
  changes are required.

## Repo-norm interactions

- **`scripts/build-client.ts`.** The production bundler enumerates exactly two
  entry points (`client/debug/index.ts`, `client/admin/index.ts`).
  `.stories.svelte` files are never imported transitively from those entries, so
  Storybook adds nothing to `public/debug.js` or `public/admin.js`. PR 1 adds a
  byte-size assertion (`bun build:client` output ±1%) to make a future leak
  immediately visible.
- **TDD hook pipeline.** Story files use `.svelte`, which falls outside the
  hook's extension filter. Fixture/MSW/decorator helpers live under
  `client/stories/` with `.ts` extensions and *will* trigger the hook —
  resolved by the same test-first discipline as any other `client/` code: each
  helper module ships with a sibling unit test under
  `tests/client/stories/<name>.test.ts` that exercises its public surface.
- **knip.** `knip.json` (or `knip` config in `package.json`) needs:
  - `client/**/*.stories.svelte` added to `entry`.
  - New deps added to its known-binaries / project entries as required by knip's
    rules. PR 1 must leave `bun knip` green.
- **oxlint.** No config changes. `.stories.svelte` is linted by the existing
  Svelte plugin pass.
- **`bun test:client`.** Unaffected — its glob is `tests/client/`, which never
  matches `*.stories.svelte`.
- **`scripts/svelte-plugin.ts`.** Storybook uses `@sveltejs/vite-plugin-svelte`
  inside Vite, not the Bun plugin. The two coexist; the Bun plugin remains the
  source of truth for production and unit tests, and `vite-plugin-svelte` is
  scoped to Storybook only.
- **CI.** `bun check:full` and the parallel `bun check:verbose` do not need to
  run Storybook. A follow-up may add `bun build:storybook` to CI as a smoke
  check that the harness still builds.

## Tooling additions

### Dependencies (PR 1)

Added to `devDependencies`:

- `storybook` (^9)
- `@storybook/svelte-vite` (^9)
- `@storybook/addon-svelte-csf` (^5)
- `@storybook/addon-a11y` (^9)
- `@storybook/addon-themes` (^9)
- `vite` (peer)
- `@sveltejs/vite-plugin-svelte` (peer)
- `msw` (^2)
- `msw-storybook-addon`

No production dependencies are added.

### Scripts (PR 1)

Added to `package.json` `scripts`:

- `storybook` — `storybook dev -p 6006`
- `build:storybook` — `storybook build -o public/storybook`

`public/storybook/` is added to `.gitignore`.

### New files (PR 1, scaffold)

- `.storybook/main.ts`
- `.storybook/preview.ts`
- `.storybook/preview-head.html`
- `.storybook/vite.config.ts`
- `client/stories/fixtures/index.ts`
- `client/stories/fixtures/schemas.ts`
- `client/stories/msw/handlers.ts`
- `client/stories/msw/scenarios.ts`
- `client/stories/stubs/sse.ts`
- `client/stories/stubs/intersection-observer.ts`
- `client/stories/decorators/withFixtures.ts`
- `client/stories/decorators/withTheme.ts`

### Vertical slice stories (PR 1)

- `client/shared/ui/Btn.stories.svelte` — primitive, props only
- `client/shared/PanelShell.stories.svelte` — composite, props only
- `client/admin/components/SubjectsTable.stories.svelte` — fixture decorator
- `client/admin/sections/BillingSection.stories.svelte` — MSW + rune reset
- `client/admin/AdminApp.stories.svelte` — full decorator + SSE + IntersectionObserver

Each non-primitive story exercises every required state for its tier. The
slice deliberately picks `AdminApp` over `DebugApp` because `AdminApp` has the
worst mix of fetchers + rune singletons + scrollspy in the codebase; if the
decorator survives `AdminApp`, every later story is easier.

## Rollout plan

Branch: `claude/wonderful-brown-Iq7wL`. All work pushes to this branch only.

| PR | Contents | Stories added | Mock layers exercised |
| --- | --- | --- | --- |
| 1 (slice) | Harness scaffold, mocks, decorators, byte-size guard | 5 | All |
| 2 | `client/shared/ui/` primitives | ~13 | None (props only) |
| 3 | `client/shared/` composites + `client/{debug,admin}/components/` | ~28 | Fixture decorator, fetcher MSW |
| 4 | `client/admin/sections/` + `DebugApp` | ~9 | Full decorator (MSW + SSE + rune reset) |

Each PR must leave `bun check:full`, `bun knip`, and `bun test:client` green.
PRs 2–4 are independent; if review on one stalls, the others are not blocked.

## Risks and mitigations

- **Storybook 9 + Bun command-form quirks.** *Mitigation:* pin the exact
  Storybook version installed in PR 1, document the `bun storybook` invocation
  in `CLAUDE.md`, and leave a note in the PR description for any required Bun
  flags.
- **`$state` rune singleton reset.** Module-level `$state` cannot be
  reassigned from outside the defining module. *Mitigation:* the decorator
  mutates fields in place; the slice PR locks the pattern against `AdminApp`
  (the most singleton-heavy shell). If a reset cannot be made airtight, the
  fallback is to refactor the offending module to export a `resetForTests()`
  helper — also useful for `tests/client/`.
- **Fixture / schema drift.** *Mitigation:* fixtures are validated against the
  live zod schemas at module load. A schema-incompatible fixture fails
  Storybook startup, not silently in a story render.
- **MSW + Bun-native unit tests.** MSW only runs inside the Storybook preview
  iframe (real browser); `tests/client/` continues to run under happy-dom
  without MSW. The two environments do not share global state.
- **Production bundle leak.** *Mitigation:* PR 1 adds a byte-size assertion on
  `bun build:client` output. Any future change that causes story modules to
  reach `debug.js` / `admin.js` trips the check.
- **knip false positives.** Storybook adds binaries and entrypoints that knip
  may flag. *Mitigation:* PR 1 lands the knip config update in the same commit
  as the deps; `bun knip` must be green at the end of PR 1.

## Open questions

None at the design stage. Items deferred to follow-up specs:

- Adding `@storybook/test` and `play()` interaction tests with a CI test-runner.
- Visual regression (Playwright snapshots locally or hosted Chromatic).
- Static export hosting for design review (e.g., served from `public/storybook/`
  behind `DEBUG_TOKEN`, or pushed to a separate static host).
- A lint rule that enforces the minimum-states-per-tier authoring convention.

## Spec self-review checklist

- [x] No placeholders or TODOs in the design body.
- [x] No internal contradictions between sections (tool, scope, mocking,
      location, rollout are all consistent with the brainstorming decisions).
- [x] Each "locked decision" row maps to a section that operationalises it.
- [x] Out-of-scope items are listed and do not bleed into the implementation.
- [x] Repo-norm interactions (TDD hook, knip, oxlint, Bun build, CI) are
      explicitly addressed.
- [x] Risks have named mitigations.
- [x] Rollout PRs each have a clear definition of "green".
