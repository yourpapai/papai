<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0166: Storybook Harness — PR 1 (Vertical Slice)

## Status

Implemented

## Date

2026-05-23

## Context

papai's dashboard UI (`client/{shared,debug,admin}/`) has ~50 Svelte 5
components and two SPA shells, but no isolated visual development surface.
Every UI change required running the full bot (`bun start:debug`) and
navigating through real chat interactions to reach the affected component.
There was no way to render a component in isolation, toggle themes, check
a11y, or inspect loading/error states without live backend data.

The design spec (`docs/archive/2026-05-23-storybook-harness-design.md`)
defined a complete harness architecture. The implementation plan
(`docs/archive/2026-05-23-storybook-harness-pr1.md`) narrowed the first
PR to a vertical slice: scaffold the full mock layer and prove it with
five stories that exercise every mock tier from primitive props to the
full AdminApp shell.

## Decision Drivers

- **Isolated development**: Engineers and designers must render any
  component in isolation without the bot runtime.
- **No production regression**: Vite must never participate in production
  bundles; `public/debug.js` and `public/admin.js` byte sizes must not
  grow.
- **Deterministic multi-state stories**: Every non-primitive component
  must render default, empty, loading, error, and populated states from
  controlled fixtures — not live backend responses.
- **Svelte 5 rune compatibility**: Module-level `$state` singletons
  cannot be reassigned from outside their defining module; the decorator
  must reset them via per-field mutation.
- **Schema drift detection**: Fixture factories must validate against
  live zod schemas at module load, so a drifted fixture fails Storybook
  startup rather than silently producing a broken story.
- **Repo-norm compliance**: knip, oxlint, TDD hooks, and `bun test:client`
  must remain green.

## Considered Options

### Option A: Histoire

Svelte-focused component workbench with built-in Svelte support.

- **Pros**: Lighter weight; native Svelte story format.
- **Cons**: Smaller ecosystem; no MSW integration path; addon
  availability is limited compared to Storybook.

### Option B: Pure Vite dev server with manual story pages

Run each component on a custom Vite page with handwritten mock setup.

- **Pros**: No additional framework dependency; full control.
- **Cons**: No addon ecosystem (a11y, themes); no autodocs; every mock
  layer is ad-hoc; no standard story format for team review.

### Option C: Storybook 9 + Vite (chosen)

Official Storybook 9 with `@storybook/svelte-vite`, MSW for network
mocking, and custom stubs for browser APIs.

- **Pros**: Mature addon ecosystem (a11y, themes, autodocs); MSW
  integration via `msw-storybook-addon`; Svelte CSF story format;
  phased rollout possible; large community.
- **Cons**: Vite is a second dev-only toolchain alongside the
  Bun-native production build; Storybook + Bun command-form quirks
  require pinning.

### Option D: Deferred — no harness

Continue developing dashboard components without isolation tooling.

- **Pros**: No new deps; no toolchain complexity.
- **Cons**: UI velocity remains slow; no a11y or theme-check surface;
  no visual component reference for contributors.

## Decision

**Option C** with the following subsidiary decisions:

| Topic             | Decision                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Toolchain         | Storybook 9 + Vite, dev-only. Production builds stay on `scripts/build-client.ts` (Bun-native). Vite never reaches `public/` output.             |
| Story format      | Svelte CSF (`*.stories.svelte`) only. No `*.stories.ts` — avoids the TDD write-hook gate while keeping stories colocated next to components.     |
| Mock layer        | MSW 2.x handlers + `msw-storybook-addon` for HTTP; custom `StubEventSource` for SSE; `IntersectionObserver` no-op stub; fixture-reset decorator. |
| Fixture factories | Typed factories in `client/stories/fixtures/`, validated at module load against live zod schemas from `client/admin/fetcher-schemas.ts`.         |
| Scenario bundles  | Named MSW handler sets in `client/stories/msw/scenarios.ts` (e.g. `admin-populated`, `billing-error`).                                           |
| Decorator pattern | `withFixtures` resets `$state` singletons via per-field mutation, swaps MSW handlers per story `parameters.fixtures`, and seeds SSE events.      |
| Theme             | `@storybook/addon-themes` toggles `data-theme="dark                                                                                              | light"`via`client/shared/tokens.css`. |
| Rollout           | PR 1: scaffold + 5 vertical-slice stories. PRs 2–4: phased fan-out across all ~50 components.                                                    |
| Bundle guard      | Byte-size assertion on `bun build:client` output (±1%) catches any future story-to-production import leak.                                       |
| Story files       | `Btn` (primitive), `PanelShell` (composite), `SubjectsTable` (fixtures), `BillingSection` (MSW + rune reset), `AdminApp` (full stack).           |

## Consequences

### Positive

- Engineers can render any dashboard component in isolation via
  `bun storybook`, without the bot runtime.
- Multi-state stories (empty, loading, error, populated) give
  deterministic visual coverage that live backend data cannot provide.
- Fixture validation against live zod schemas catches fixture drift at
  Storybook startup, not silently inside a story.
- A11y addon runs axe checks on every story; theme addon toggles
  dark/light without code changes.
- Production bundle byte-size guard ensures Storybook deps never leak
  into `public/debug.js` or `public/admin.js`.

### Negative

- Vite is a second dev-only toolchain alongside the Bun-native build;
  two Svelte compilation paths must coexist.
- The `withFixtures` decorator must track every `$state` singleton field
  in `admin.svelte.ts` and `debug.svelte.ts`; a missed field causes
  cross-story state leakage.
- MSW only runs inside the Storybook preview iframe (real browser);
  `bun test:client` (happy-dom) does not share MSW state, so mock
  coverage is split across two environments.

### Risks

- `$state` rune singleton reset is fragile: module-level `$state`
  cannot be reassigned from outside, so the decorator mutates fields
  in place. If a new singleton field is added without updating the
  reset, stories leak state. Mitigation: PR 1 locks the pattern
  against `AdminApp` (the most singleton-heavy shell); a follow-up
  may extract `resetForTests()` helpers from the defining modules.
- Storybook 9 + Bun command-form compatibility may break on minor
  version bumps. Mitigation: pin Storybook versions in PR 1; document
  the exact `bun storybook` invocation.
- Production bundle leak is possible if a story module becomes
  transitively reachable from `client/{debug,admin}/index.ts`.
  Mitigation: `bun check:bundle-size` (±1%) catches any regression.

## Implementation Notes

Storybook config (`.storybook/`):

| File                | Role                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `main.ts`           | Framework, stories glob, addons, static dirs                         |
| `preview.ts`        | Global decorators (theme, withFixtures), MSW init, stub installation |
| `preview-head.html` | Injects concatenated shared CSS                                      |
| `vite.config.ts`    | Path aliases (`@client`, `@src`), Svelte plugin, fs allow list       |

Mock infrastructure (`client/stories/`):

| File                             | Role                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `fixtures/index.ts`              | Typed factories (`makeBillingSubject`, `makeGlobalStats`, etc.)       |
| `fixtures/schemas.ts`            | Validates factory output against live zod schemas at module load      |
| `msw/handlers.ts`                | Per-route-family handlers with populated/empty/error/loading variants |
| `msw/scenarios.ts`               | Named handler bundles composed from families                          |
| `stubs/sse.ts`                   | `StubEventSource` with imperative `emit`/`seed`/`reset`/`history` API |
| `stubs/intersection-observer.ts` | No-op `IntersectionObserver` stub                                     |
| `decorators/withFixtures.ts`     | Resets rune singletons, resolves scenario, seeds SSE                  |
| `decorators/withTheme.ts`        | Theme config for `@storybook/addon-themes`                            |

Vertical-slice stories (PR 1): `Btn.stories.svelte`, `PanelShell.stories.svelte`,
`SubjectsTable.stories.svelte`, `BillingSection.stories.svelte`,
`AdminApp.stories.svelte`.

New scripts: `storybook`, `build:storybook`, `check:bundle-size`.
New guard: `scripts/bundle-size-baseline.json` + `scripts/check-bundle-size.ts`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin architecture that
  Storybook stories for plugin UI contributions would build on.
- ADR-0166 (this record): Storybook harness vertical slice; PRs 2–4
  will fan out across all dashboard components.
