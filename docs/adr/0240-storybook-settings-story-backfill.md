<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0240: Storybook Settings Story Backfill

## Status

Implemented (with divergence)

## Date

2026-06-30

## Context

ADR-0238 shipped the `strybk`/Playwright capture pipeline and proved the
generate → shoot → read loop with a single settings story (`ToolsSection`), but
deliberately deferred the bulk of the settings surface. This plan was the first
**targeted backfill**: give the screenshot pipeline **representative** coverage
of the five settings surfaces that most exercised the mock layer's seams —
`ReposSection`, `ByokSection`, `KaneoAccessSection`, `AdminUsersSection`, and
the full personal `SettingsApp` shell — across the `Loading · Empty · Populated ·
Error` state set, so the agent had meaningful settings targets before the wider
scale-out (ADR-0239) committed to covering the remaining ~26 sections.

The deciding factor was the **MSW-over-DI** question. `ToolsSection` was the one
settings section that exposed a DI seam (`fetchToolsFn?`), so its story injected
loaders directly. The five backfill targets do **not** expose such a seam — they
fetch through module-level fetchers hitting `/settings/api/…`. So this plan had
to establish the **MSW-handler-family recipe** that ADR-0239 later scaled out: a
`HandlerFamily` (`populated/empty/error/loading`, or BYOK/Kaneo's tailored
variants) per endpoint, named **scenarios** in `client/stories/msw/scenarios.ts`,
and one `*.stories.svelte` per section whose `<Story>` entries pick a scenario via
`parameters={{ fixtures: '…' }}`. It also had to extend the `fixturesLoader`
decorator to reset the `settingsSession` rune between stories (so the shell
story, which reads `settingsSession` directly rather than self-bootstrapping,
could be driven into a "ready" state).

Two facts carried over from ADR-0238: (1) channel-driven `switchStory` re-runs
each story's loaders, so the existing `fixturesLoader` works under the Playwright
driver without a Storybook config change; (2) `requireOk` in the fetchers throws
on any non-2xx (rendered as an error message), so each state maps to a concrete
MSW response — `200` + schema-valid body, `500`, or a never-resolving `delay` —
and handler bodies had to match their Zod schema **exactly** or the section would
silently render its error state.

## Decision Drivers

- **Representative, not exhaustive, coverage** — five well-chosen sections across
  personal/advanced/admin plus the shell proved the recipe across enough surface
  (a repo list, a masked-secret form, a 404/not-provisioned state, an admin
  table, and a multi-section shell) to de-risk the full scale-out.
- **Establish the MSW-handler-family recipe** — codify the per-endpoint
  `HandlerFamily` + named-scenario + `parameters={{ fixtures }}` pattern here, so
  ADR-0239 is pure repetition; no new mock infrastructure later.
- **Schema-exact fixtures** — handler bodies must parse against the section's Zod
  schema or the wrong state renders; field names/casing had to be exact
  (`taskInstanceId`, `hasStoredDefaults`, `canProvision`, …).
- **Shell driven via the rune, not bootstrapping** — `SettingsApp` does not
  self-bootstrap (the real entry is `index.ts#start`), so the shell story needed
  a `settingsReady` loader parameter that pushes `settingsSession` into a
  personal ready state before the always-on sections mount and fetch.
- **No pipeline changes** — every new story flows through the existing
  `bun shoot:gen` → `bun shoot` loop; generated `tests/visual/**` specs are
  committed, PNGs are gitignored.
- **Repo-norm compliance** — `client/stories/**` is knip-ignored and `.stories.svelte`
  files are excluded from the production bundle, so these additions do not affect
  `bun knip` or `bun check:bundle-isolation`.

## Considered Options

### Option 1: MSW handler families + named scenarios, one story per section (chosen)

A new `client/stories/msw/settings-handlers.ts` exports a `HandlerFamily` for each
backfill endpoint (repos, byok, kaneo, admin-users) plus a `shellReadyHandlers`
array mocking the shell's four always-on `GET`s; scenarios are registered as
`settings-<x>-{populated,empty,error,loading}`; each `*.stories.svelte` picks a
scenario via `parameters`; the `fixturesLoader` gains a `resetSettingsSession()`
plus a `settingsReady` branch.

- **Pros:** mirrors the established admin/debug MSW pattern; one handler serves
  repeated/`?contextId=`-suffixed calls (MSW ignores query strings); every state
  is independently addressable; the shell reads the session rune so no
  self-bootstrap refactor is needed; scales verbatim to the remaining sections.
- **Cons:** MSW settle-timing risk (a channel-switched story can capture blank/
  loading before the loader resolves); handler bodies are a schema-exactness
  maintenance surface; schema drift after the fact silently renders the error
  state rather than failing a test.

### Option 2: DI-driven stories per section (no MSW)

Like the original `ToolsSection`, drive each section through an injected fetch
function.

- **Pros:** no MSW settle-timing risk; no schema-body research.
- **Cons:** the backfill targets do not expose a DI seam, so this would require
  refactoring every section's data path; loses parity with the MSW-based
  admin/debug harness; far larger blast radius than a coverage pass.

### Option 3: Shell-only aggregate story

Shoot only the `SettingsApp` shell and skip per-section stories.

- **Pros:** fewest stories; the `settings-shell-ready` scenario already mocks
  every always-on section.
- **Cons:** defeats per-state coverage — a section's isolated `Empty`/`Error`
  state is not capturable, only its populated-within-the-shell render; loses the
  reusable per-section spec foundation ADR-0239 builds on.

## Decision

Option 1 shipped. The MSW-handler-family recipe is now the canonical settings
story pattern:

1. **`settings-handlers.ts`** exports `reposHandlers`, `byokHandlers`,
   `kaneoHandlers`, `adminUsersHandlers` (each a four-variant family, or BYOK/
   Kaneo's tailored variant set), plus `shellReadyHandlers` mocking the shell's
   config / task-instance / tools / release-subscription `GET`s. MSW handlers are
   persistent (not `.once`) and match regardless of query string.
2. **Scenarios registered.** `client/stories/msw/scenarios.ts` adds
   `settings-repos-*` / `settings-byok-*` / `settings-kaneo-*` /
   `settings-admin-users-*` / `settings-shell-ready`.
3. **`fixturesLoader` extension.** `client/stories/decorators/withFixtures.ts`
   gains `resetSettingsSession()` (called from `resetAllSingletons()`), an
   `applyReadySettingsSession()` helper, and a `settingsReady` parameter branch
   so the shell story mounts against a personal ready session.
4. **Five stories.** `ReposSection`, `ByokSection`, `KaneoAccessSection`,
   `AdminUsersSection`, and the `SettingsApp` shell, each with one `<Story>` per
   available state; admin stories take no props (the fetchers are no-arg), the
   rest pass `args={{ contextId }}`.
5. **Generated specs.** `tests/visual/settings/sections/{Repos,Byok,
   KaneoAccess}Section.spec.ts`, `…/admin/AdminUsersSection.spec.ts`, and
   `tests/visual/settings/SettingsApp.spec.ts` — the reusable test foundation,
   regenerated by `bun shoot:gen` with no pipeline change.

## Consequences

### Positive

- The MSW-handler-family recipe proven here became the template ADR-0239 scaled
  out to ~26 more sections verbatim — every later settings story repeats this
  handler-family → scenario → story shape, so no further mock design was needed.
- Five representative settings surfaces are screenshot-able in isolation across
  their full state set, closing the edit → shoot → read → iterate loop for the
  sections that most stress the mock layer (masked secrets, 404 states, admin
  tables, multi-section shells).
- The `settingsReady` loader seam (first introduced here) is the hook ADR-0239
  extended into the `'personal' | 'group' | 'admin'` shell modes — the backfill's
  personal-ready branch is preserved unchanged within that evolution.
- `resetSettingsSession()` fixed a latent cross-story bleed: without it the shell
  story inherited the previous story's `settingsSession` rune state.

### Negative

- Fixture bodies are a maintenance surface: a fetcher-schema field change can
  flip a populated story to render its error state with no test failure (the
  screenshot just regenerates). The shipped byok/repo/task-instance bodies have
  already drifted from the plan's bodies as their schemas evolved (multi-provider
  BYOK, repo egress domains, named task instances).
- MSW settle timing (carried from ADR-0238) — a channel-switched story can
  capture blank/loading if the loader has not settled; the documented remedy is a
  `waitForLoadState('networkidle')` step before the assertion.
- The shell's always-on endpoints are mocked in `settings-handlers.ts` rather
  than a shell-specific module, so a new always-on section silently renders a red
  banner in the shell story until its `populated` handler is added.

### Risks

- **Stale fixture bodies vs. evolved schemas.** A Zod mismatch silently renders
  the error state instead of the intended one. Mitigated by reading each schema
  at write time and re-shooting after schema changes; no automated guard. (The
  shipped byok bodies already reflect this drift.)
- **MSW settle timing.** Each backfill story was verified populated at shoot
  time; the risk is regression if a loader path slows down.
- **Recipe dependency.** ADR-0239's scale-out assumes this handler-family shape
  holds; a later harness change that breaks it affects every settings story.

## Related Decisions

- **ADR-0238: Storybook → Agent Screenshot Pipeline** — the capture pipeline
  (`strybk`/Playwright, `bun shoot:gen`/`shoot`) these stories drive; this ADR is
  the first targeted settings backfill on top of that pipeline.
- **ADR-0239: Storybook Settings — Full Coverage** — the scale-out that repeated
  this recipe across the remaining ~26 settings sections and extended the
  `settingsReady` seam into group/admin shell modes.
- **ADR-0166: Storybook Harness — PR 1** — the `client/stories/` mock layer,
  `HandlerFamily` interface, and `fixturesLoader` reset decorator every story
  here relies on.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. All seven
plan tasks shipped — the handler module, the scenario registrations, the loader
extension, the five stories, and the five generated specs. The divergences are
downstream evolution by the sibling ADR-0239 (which extended the shell story and
the ready helper) and schema-driven fixture/label drift, not missing work.

| File | Role | Evidence |
| --- | --- | --- |
| `client/stories/msw/settings-handlers.ts:40,122,137,196,219` | `reposHandlers`, `byokHandlers`, `kaneoHandlers`, `adminUsersHandlers`, `shellReadyHandlers` — the backfill's five families. | `read` confirms; structure matches plan Task 1 (see notes — bodies drifted with schema). |
| `client/stories/msw/scenarios.ts:101-117,166` | `settings-repos-*`/`settings-byok-*`/`settings-kaneo-*`/`settings-admin-users-*` (17 scenarios) + `settings-shell-ready`. | `grep` confirms; byte-close to plan Task 2. |
| `client/stories/decorators/withFixtures.ts:24-31` | `resetSettingsSession()` zeroes the session rune; called as the last line of `resetAllSingletons()` (`:55`). | `read` confirms. |
| `client/stories/decorators/withFixtures.ts:35-46,79-82` | `applyReadySettingsSession()` + `settingsReady` parameter branch in `fixturesLoader`. | `read` confirms (see notes — evolved to a `mode` param by ADR-0239). |
| `client/settings/sections/ReposSection.stories.svelte:20-26` | ReposSection — Populated/Empty/Error/Loading. | `read` confirms; byte-identical to plan Task 3. |
| `client/settings/sections/ByokSection.stories.svelte:21-31` | BYOK — 5 states over `settings-byok-{secret-set,missing,disabled,error,loading}`. | `read` confirms (see notes — story labels renamed). |
| `client/settings/sections/KaneoAccessSection.stories.svelte:20-30` | Kaneo — Populated/Not provisioned/Error/Loading (404 via `settings-kaneo-not-provisioned`). | `read` confirms; byte-close to plan Task 5. |
| `client/settings/sections/admin/AdminUsersSection.stories.svelte:17-23` | Admin users — Populated/Empty/Error/Loading, no props (no-arg fetchers). | `read` confirms; byte-identical to plan Task 6. |
| `client/settings/SettingsApp.stories.svelte:18` | Shell — `Personal ready` (`settingsReady: true`, `settings-shell-ready`). | `read` confirms (see notes — two more shell stories added by ADR-0239). |
| `tests/visual/settings/sections/{Repos,Byok,KaneoAccess}Section.spec.ts`, `…/admin/AdminUsersSection.spec.ts`, `tests/visual/settings/SettingsApp.spec.ts` | Generated `@crvy/strybk` specs mirroring the backfill stories — the reusable test foundation. | `glob` confirms all five specs exist; `ReposSection.spec.ts:10-25` shows the four generated tests. |
| `CHANGELOG.md:1020-1021,774-778` | Commit sequence — "settings MSW handler families", "register settings scenarios and session reset", then the five section/shell stories. | `grep` confirms; matches plan Tasks 1, 2, 3–7. |

Plan-vs-implementation notes:

- **Shell story grew 1 → 3 (downstream ADR-0239).** This plan authored a single
  `Personal ready` shell story. The shipped `SettingsApp.stories.svelte` keeps
  that story byte-identically (`:18`) and adds `Group ready` (`:21`) and
  `Admin ready` (`:24`) — both added by the ADR-0239 scale-out, which also split
  the always-on handlers and added the group/admin aggregate scenarios. This
  ADR's contribution is the personal-ready story and the `settingsReady` seam it
  established.
- **`applyReadySettingsSession` gained a `mode` parameter (downstream ADR-0239).**
  The plan authored a no-arg `applyReadySettingsSession()` plus a
  `settingsReady: true` boolean branch. The shipped helper is
  `applyReadySettingsSession(mode: 'personal' | 'group' | 'admin')`
  (`withFixtures.ts:35`) and `fixturesLoader` accepts `true`/`'personal'`/
  `'group'`/`'admin'` (`:79-82`). The personal/`true` branch is the backfill's
  preserved contribution; the group/admin branches are ADR-0239's.
- **BYOK story labels renamed.** The plan's labels were `Secret set` /
  `Missing required`; the shipped story is `Enabled with provider` /
  `Enabled no providers` (`ByokSection.stories.svelte:21,24`). The underlying
  scenarios (`settings-byok-secret-set`/`-missing`) are unchanged; the relabeling
  reflects that BYOK evolved into multi-provider support (the `secret-set` body
  now carries a `providers` array + `roles` map, not just a single masked field).
- **Fixture bodies drifted with schema.** The shipped handler bodies differ from
  the plan's literals: byok bodies add `providers`/`roles` (multi-provider BYOK,
  `settings-handlers.ts:72-88,105-106,113-114`), the repo sample gained
  `additionalEgressDomains` (`:29`), and the task-instance `available` entry
  gained a `name` field (`:242`). These are schema-driven updates so the
  populated stories keep parsing; the error/loading/empty variants are unchanged.
- **Kaneo "Not provisioned" is present.** The plan's four-state Kaneo story
  (including the 404 `Not provisioned`) shipped intact
  (`KaneoAccessSection.stories.svelte:23-26`); its handler (`notProvisioned`,
  `settings-handlers.ts:151`) and scenario (`settings-kaneo-not-provisioned`,
  `scenarios.ts:111`) are both wired.

The source plan `docs/superpowers/plans/2026-06-30-storybook-settings-story-backfill.md` is archived alongside this ADR to `docs/archive/`. The plan named no distinct spec of its own: its "Prior plan / spec" header cites the pipeline design `2026-06-30-storybook-agent-screenshot-pipeline-design.md`, which belongs to ADR-0238 and was archived with it, so only the plan was archived.
