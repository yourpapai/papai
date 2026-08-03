<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0239: Storybook Settings — Full Coverage

## Status

Implemented (with divergence)

## Date

2026-06-30

## Context

ADR-0238 shipped the `strybk`/Playwright capture pipeline and proved the
generate → shoot → read loop with a single settings story (`ToolsSection`),
then deferred the remaining settings sections to follow-up plans. The
`2026-06-30-storybook-settings-story-backfill` plan (cited as prior art here)
landed the first five (`ReposSection`, `ByokSection`, `KaneoAccessSection`,
`AdminUsersSection`, and the personal `SettingsApp` shell), but the bulk of the
settings surface still had **no stories at all** — so the screenshot pipeline
could not render most of `/settings`.

This plan was a pure **scale-out**: extend the proven per-section recipe (one
MSW **handler family** of `populated/empty/error/loading` variants per endpoint,
named **scenarios**, one `*.stories.svelte` per section mirroring the committed
`ByokSection.stories.svelte`) to the remaining **26 settings section
components** (10 personal/advanced, 4 group, 12 admin), and add the
**group-context and admin-zone variants** of the `SettingsApp` shell so the
pipeline can render every settings surface across `Loading · Empty · Populated ·
Error`. No new infrastructure — everything flows through the existing
`bun shoot:gen` → `bun shoot` loop unchanged.

The two facts that shaped the design carried over from ADR-0238: (1)
channel-driven `switchStory` re-runs each story's loaders, so the existing
`fixturesLoader` + MSW scenarios work under the Playwright driver without a
Storybook config change; (2) each section loads over a documented `GET`
endpoint whose body must satisfy its Zod schema **exactly** (a parse failure
renders the section's error state, masking the intended one), so handler bodies
had to be researched against `client/settings/fetcher-schemas*.ts`.

## Decision Drivers

- **Full visual coverage** — every settings section must be screenshot-able in
  all four states so the agent (and the downstream UX-review workflow) can read
  any settings surface in-session.
- **Scale-out, not re-architecture** — reuse the MSW-handler-family recipe proven
  on `ByokSection`/`ToolsSection`; no new capture or mock infrastructure.
- **Shell variants, not just sections** — a group shell mounts group-only
  sections (Members, Group provider, Guest mode, Coding identity) and an admin
  shell mounts the whole Admin zone; without mocking _every_ mounted endpoint an
  unmocked section renders a red error banner, so the shell needs aggregate
  ready-scenarios.
- **Schema-exact fixtures** — handler bodies must parse against the section's Zod
  schema or the wrong state renders; schemas are read from
  `client/settings/fetcher-schemas*.ts` before writing bodies.
- **`max-lines` compliance** — handler families are split across files
  (`settings-handlers{,-personal,-group,-admin}.ts`) rather than compressing
  formatting; split further by sub-area if a single file still trips the limit.
- **One commit per section** — each section's story + generated spec is a
  separately reviewable/revertable commit (driver may batch dispatch).

## Considered Options

### Option 1: Scale out the MSW-handler-family recipe, one story per section (chosen)

Each section gets a `HandlerFamily` (`populated/empty/error/loading`), named
scenarios, and a `*.stories.svelte` with one `<Story>` per state; shell variants
extend `applyReadySettingsSession()` with a mode and add aggregate scenarios.

- **Pros:** reuses the exact pattern proven on the backfill sections; MSW
  resolves via the existing `fixturesLoader` unchanged; every state is
  independently addressable; the group/admin shells render banner-free because
  every mounted endpoint is mocked in the aggregate scenario.
- **Cons:** many handler bodies to research against schemas (mechanical but
  error-prone); the aggregate admin scenario must mock ~13 endpoints, so a new
  admin endpoint silently produces a red banner until the scenario is updated;
  handler files proliferate.

### Option 2: DI-driven stories per section (no MSW)

Like the original `ToolsSection` (which exposes `fetchToolsFn?`), drive each
section through injected fetch functions instead of MSW.

- **Pros:** no MSW settle-timing risk; no schema-body research.
- **Cons:** most settings sections do **not** expose a DI seam for their loader,
  so this would require refactoring every section's data path; loses parity with
  the MSW-based backfill stories; far larger blast radius than a coverage pass.

### Option 3: Shell-level aggregate stories only

Shoot only the `SettingsApp` shell variants (personal/group/admin ready) and
skip per-section stories.

- **Pros:** fewest stories; aggregate scenarios already mock every section.
- **Cons:** defeats the per-state coverage goal — a section's error/empty/loading
  state is not isolated, only its populated-within-the-shell render; the agent
  cannot read a single section's `Empty`/`Error` state cleanly; loses the
  reusable per-section spec foundation.

## Decision

Option 1 shipped. Every settings section component now has a story, and the
group/admin shell variants are wired:

1. **Per-section handler families + scenarios.** Handler families live across
   `client/stories/msw/settings-handlers{,-personal,-personal-2,-group,-admin,-admin-2}.ts`
   (32 `HandlerFamily` exports total), each with the four state variants.
   Scenarios are registered as `settings-<x>-{populated,empty,error,loading}` in
   `client/stories/msw/scenarios.ts`.
2. **Per-section stories.** `client/settings/sections/**/*.stories.svelte` (one
   per section, mirroring `ByokSection.stories.svelte`) with one `<Story>` per
   available state; personal/group stories pass `args={{ contextId }}`, admin
   stories take none.
3. **Shell modes.** `applyReadySettingsSession(mode: 'personal' | 'group' |
   'admin')` in `client/stories/decorators/withFixtures.ts` sets the context
   kind and admin flags; `fixturesLoader` reads the `settingsReady` parameter.
4. **Aggregate shell scenarios.** `settings-shell-group-ready` and
   `settings-shell-admin-ready` spread `shellReadyHandlers` plus every mounted
   section's `populated` handlers so no section renders an error banner.
5. **Three shell stories.** `client/settings/SettingsApp.stories.svelte` renders
   `Personal ready`, `Group ready`, and `Admin ready`.

## Consequences

### Positive

- Every settings section is screenshot-able across all four states; the
  Definition-of-Done coverage check (`comm -23` of section components vs.
  stories) returns only `AdminMcpCatalogEntryRow` — a row helper, not a
  data-loading section.
- The group and admin shell variants render banner-free (every mounted endpoint
  is mocked in the aggregate scenario), giving the agent whole-surface views.
- The handler split respected `max-lines` by sub-area (the `-2` files), exactly
  the plan's documented escape hatch — no formatting was compressed to dodge the
  limit.
- The per-section spec foundation is reusable: every later settings change flows
  through the same `shoot:gen` → `shoot` loop, and the downstream per-app-CSS
  fidelity and structured UX-review workflows build on these stories.

### Negative

- Handler files proliferated to six (`settings-handlers{,-personal,-personal-2,
  -group,-admin,-admin-2}.ts`); discovering a given section's fixture now
  requires knowing which sub-file holds it.
- The aggregate admin scenario (`settings-shell-admin-ready`) spans ~13
  endpoints; a newly added admin section renders a red banner in the shell story
  until its `populated` handler is spread in.
- Schema-exact fixture bodies are a maintenance surface: a fetcher-schema field
  change can flip a section's populated story to render its error state with no
  test failure (the screenshot just regenerates).

### Risks

- **Stale fixture bodies vs. evolved schemas.** A Zod mismatch silently renders
  the error state instead of the intended one. Mitigated by reading each schema
  at write time and re-shooting after schema changes; no automated guard.
- **MSW settle timing** (carried from ADR-0238) — a channel-switched MSW-backed
  story can capture blank/loading if the loader has not settled; the documented
  remedy is `waitForLoadState('networkidle')` before the assertion.
- **Aggregate-scenario fragility.** The admin shell story depends on every admin
  endpoint being mocked; an unmocked new admin section degrades silently to a
  red banner rather than failing the spec.

## Related Decisions

- **ADR-0238: Storybook → Agent Screenshot Pipeline** — the capture pipeline
  (`strybk`/Playwright, `bun shoot:gen`/`shoot`) this coverage pass drives; this
  ADR is the settings scale-out on top of that pipeline.
- **ADR-0166: Storybook Harness — PR 1** — the `client/stories/` mock layer and
  `fixturesLoader` reset decorator every story here relies on.
- **ADR-0226: Backstage Phase 3.3 — Settings/Admin Sections Cleanup** — the kit
  adoption across the settings/admin sections these stories render.
- **ADR-0176: Backstage Phase 3.2 — Settings User Sections** — the user-section
  components whose stories landed here.
- **ADR-0225: Hermetic Story Execution — Docker-Only OS Sandbox** — a separate
  (Tier 0) story lane; part of the same broader testing surface.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`/`comm`. The
headline deliverables — full per-section story coverage and the group/admin
shell variants — all shipped; the divergences are an evolved admin section
inventory, a collapsed super-admin mode, and handler splits the plan explicitly
anticipated.

| File | Role | Evidence |
| --- | --- | --- |
| `client/stories/msw/settings-handlers-personal.ts:90,140,215,248,281` | Personal families: `codingCredentialsHandlers`, `memoryHandlers`, `mcpHandlers`, `pluginsHandlers`, `identityHandlers`. | `grep '^export const \w+Handlers: HandlerFamily'` confirms 5 families. |
| `client/stories/msw/settings-handlers-personal-2.ts:53,70,175` | `configHandlers`, `releaseSubscriptionHandlers`, `codingMcpHandlers` — split out for `max-lines`. | `grep` confirms (the `-2` split the plan permitted). |
| `client/stories/msw/settings-handlers-group.ts:41,66,98,124,147` | Group families: `groupMembersHandlers`, `guestModeHandlers`, `groupProviderHandlers`, `codingIdentityHandlers`, `groupReleaseHandlers`. | `grep` confirms 5 families. |
| `client/stories/msw/settings-handlers-admin.ts:35,76,116,139,161,188,216` and `settings-handlers-admin-2.ts:23,47,89,122,171` | Admin families split across two files: `adminByok`/`adminProviders`/`adminLlmRoles`/`adminGroups`/`adminAdmins`/`adminPluginConfig`/`adminToolDefaults` and `adminReleaseNotes`/`adminCodingGuardrails`/`adminMcpCatalog`/`adminMcpPluginServers`/`adminInstances`. | `grep` confirms (12 families across `-admin`/`-admin-2`). |
| `client/stories/msw/scenarios.ts:167-183,184-192` | Aggregate shell scenarios `settings-shell-admin-ready` (spreads 13 admin `populated` handlers) and `settings-shell-group-ready` (spreads group families). | `read` confirms. |
| `client/stories/msw/scenarios.ts:193-204` | Per-section `settings-config-*`/`settings-coding-credentials-*`/`settings-coding-mcp-*` state scenarios. | `read` confirms the 4-state naming. |
| `client/stories/decorators/withFixtures.ts:35-46` | `applyReadySettingsSession(mode: 'personal'\|'group'\|'admin')` sets context kind + admin flags. | `read` confirms (see notes — super-admin mode collapsed). |
| `client/stories/decorators/withFixtures.ts:79-82` | `fixturesLoader` reads `settingsReady` parameter → mode branch. | `read` confirms. |
| `client/settings/SettingsApp.stories.svelte:18-24` | Three shell stories: `Personal ready`, `Group ready`, `Admin ready` (fixtures + `settingsReady` param each). | `read` confirms; byte-close to plan Tasks 4/6. |
| `client/settings/sections/**/*.stories.svelte` (19 non-admin + 15 admin) | One story per section component; admin stories under `sections/admin/`. | `glob` confirms. |
| `tests/visual/settings/**/*.spec.ts` (35 specs) | Generated `@crvy/strybk` specs mirroring the story tree — the reusable test foundation. | `glob` confirms (see notes — 2 newest admin stories lack a generated spec). |
| `CHANGELOG.md:1020-1024` | Commit sequence: "settings MSW handler families", "register settings scenarios and session reset", "personal/group/admin settings handler families + scenarios". | `grep` confirms; matches plan Tasks 1/3/5. |

Plan-vs-implementation notes:

- **Admin section inventory diverged.** The plan's inventory listed 12 admin
  sections including `AdminSystemSection` and `AdminFeatureFlagsSection`. Neither
  exists as a component (`ls client/settings/sections/admin/AdminSystemSection.svelte`
  / `AdminFeatureFlagsSection.svelte` → "No such file"). Instead the admin zone
  evolved: `AdminModelsSection`, `AdminProvidersSection`,
  `AdminMcpPluginServersSection`, `AdminMcpCatalogSection` now exist (plus
  `AdminUsersSection` from the prior backfill), and all of them carry stories and
  handler families. The "full coverage" goal is therefore met against the
  _shipped_ section set rather than the plan's stale list — coverage is complete
  for what exists.
- **Super-admin mode collapsed.** The plan specified distinct `'admin'` and
  `'super-admin'` modes (the latter also setting `isSuperAdmin`). The shipped
  `applyReadySettingsSession` collapses both into a single `'admin'` mode that
  sets `isBotAdmin` and `isSuperAdmin` together (`withFixtures.ts:38-39`); no
  `'super-admin'` literal appears in `client/stories/`. The single admin shell
  story renders the full Admin zone, which is the practical goal.
- **Handler split went further than the plan's triple.** The plan anticipated
  `settings-handlers{,-personal,-group,-admin}.ts`; the tree adds
  `-personal-2.ts` and `-admin-2.ts`. This is exactly the plan's documented
  escape hatch ("if any single file still trips `max-lines`, split further by
  sub-area — do not compress formatting to dodge the limit").
- **`CodingMcpSection` is net-new.** A separate coding-MCP servers section (with
  its own `codingMcpHandlers` family and `settings-coding-mcp-*` scenarios) is
  present and covered, though it was not in the plan's personal inventory.
- **Two newest admin stories lack a generated spec.** `AdminProvidersSection` and
  `AdminModelsSection` have `.stories.svelte` but no entry under
  `tests/visual/settings/sections/admin/` — i.e. `bun shoot:gen` has not been
  re-run since those stories were added. The stories (the foundation) are
  present; their visual specs will regenerate on the next `shoot:gen`.
- **Coverage check passes.** The plan's Definition-of-Done `comm -23` of section
  components vs. stories returns only `AdminMcpCatalogEntryRow`, a row helper
  rendered inside `AdminMcpCatalogSection` (not itself a data-loading section),
  so it is correctly excluded.

The source plan `docs/superpowers/plans/2026-06-30-storybook-settings-full-coverage.md` is archived alongside this ADR to `docs/archive/`. The plan named no distinct spec of its own (it cites a prior plan as prior art), so only the plan was archived.
