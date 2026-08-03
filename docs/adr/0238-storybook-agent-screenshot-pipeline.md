<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0238: Storybook → Agent Screenshot Pipeline

## Status

Implemented

## Date

2026-06-30

## Context

ADR-0166 shipped a mature Storybook 9 + Vite harness (`client/stories/`: MSW
handler groups + scenarios, the `fixturesLoader` reset decorator, stubs for SSE
and `IntersectionObserver`, schema-drift-guarded fixture factories) covering the
`shared/`, `admin/`, and `debug/` surfaces — but **`settings/` had zero stories**
despite `CLAUDE.md` calling the settings SPA "where ALL configuration happens."
A larger problem cut across every surface: the agent editing `client/` components
was **blind to the rendered result**. It could read code and run unit/DOM tests,
but it could not see layout, spacing, overflow, contrast, or visual regressions —
and there was no command that produced an image it could ingest in-session.

The goal was a low-friction **visual-feedback loop**: edit a component → run one
command → read the resulting PNG(s) via the Read tool → assess → iterate. The
consumer is a local Claude Code session (terminal/IDE), not a remote ACP/magi
session, so no transport layer is involved. Screenshot _regression testing_
(committed baselines + diff gating) was explicitly out of scope; the intent was
to view the _current_ render, not police it against a baseline.

Two facts shaped the design: (1) Storybook already exposes a story index at
`/index.json` and channel-driven story switching re-runs each story's loaders —
so the existing `fixturesLoader` + MSW scenarios would work unchanged under a
Playwright driver; (2) the repo's Bun test runner matches `*.spec.*` files, so
Playwright specs had to be excluded from `bun test` discovery or the two runners
would collide.

## Decision Drivers

- **Agent-visible UI** — the agent must be able to read a PNG of any `client/`
  story in-session to assess layout/spacing/contrast it cannot infer from code.
- **Generator-first, not hand-rolled** — own the configuration + repo integration
  around an existing capture engine rather than reinvent Storybook-index parsing,
  channel switching, and deterministic-shot CSS injection.
- **Baselines as "the current render," not a regression gate** — PNGs are
  gitignored and always (re)written under `--update-snapshots`, so there is never
  a diff failure to fight; the agent reads the freshest PNG.
- **Committed specs, ignored artifacts** — the generated `tests/visual/**` specs
  are the reusable test foundation (version-controlled); `.storybook-shots/` and
  run artifacts are gitignored.
- **Warm loop** — reuse a Storybook already running (`reuseExistingServer`) so
  re-shoots are near-instant via HMR.
- **MSW-compatibility for free** — channel-driven `switchStory` re-runs loaders,
  so the existing MSW `fixturesLoader` keeps working without a Storybook config
  change.
- **Repo-norm compliance** — knip, oxlint, Bun-test isolation, and the bundle-
  isolation gate must stay green with the new files present.

## Considered Options

### Option 1: `@crvy/strybk` generator + Playwright `toHaveScreenshot()` (chosen)

`@crvy/strybk` reads Storybook `/index.json`, generates one `.spec.ts` per story
file under `tests/visual/` (each test does `switchStory` → `toHaveScreenshot()`),
auto-injects animation-disabling CSS, and preserves a manual region below the
`@generated` block for interaction steps. `@crvy/rprtr` is wired as an optional,
trivially-removable reporter for later review DX.

- **Pros:** solves the hard parts (index parsing, channel switching on a shared
  per-worker page, deterministic-shot CSS, manual-region preservation) without
  hand-rolling; re-runs loaders so MSW works unchanged; generated specs are the
  reusable foundation; `strybk`/`rprtr` are by the repo's own toolchain author.
- **Cons:** depends on two small, recent third-party packages; their maturity is
  a risk (mitigated by pinning and a single end-to-end smoke test before scale-out).

### Option 2: Hand-rolled Playwright script

Walk `/index.json` ourselves and capture each story with bespoke Playwright code.

- **Pros:** no third-party generator dependency.
- **Cons:** reimplements index parsing, channel switching, animation/scroll reset,
  and the generated/manual spec seam; no standard story format; more to maintain.

### Option 3: Chromatic / hosted visual-regression service

Use a hosted service for capture + diff + approval.

- **Pros:** managed diffing and review UI; cross-browser matrices.
- **Cons:** out of scope (regression diffing was explicitly deferred); a hosted
  dependency and network round-trip the agent does not need; the agent wants the
  _current_ render locally, not a baseline diff in a browser.

## Decision

Option 1 shipped. The capture pipeline:

1. **`strybk.config.ts`** points `strybk` at `http://localhost:6006`, scans
   `client/**/*.stories.svelte`, and mirrors each story's path under
   `tests/visual/` as a committed `.spec.ts`.
2. **`playwright.config.ts`** sets `testDir: 'tests/visual'`, a gitignored
   `snapshotPathTemplate: '.storybook-shots/{testFilePath}/{arg}{ext}'`, a single
   chromium project, the `@crvy/rprtr` reporter, and a `webServer` that boots
   `bun storybook` (or reuses one already running) and waits on `/index.json`.
3. **Two scripts.** `shoot:gen` regenerates the committed specs; `shoot` runs
   Playwright with `--update-snapshots` (accepts `-g <grep>` over test titles).
4. **Bun-test isolation + knip + gitignore** keep the two runners from colliding
   and keep tooling green: `tests/visual/**` is excluded from `bun test`, the two
   root config files are registered as knip entries, and `.storybook-shots/` +
   run artifacts are gitignored.
5. **First settings story (`ToolsSection`).** A DI-driven story (it exposes
   `fetchToolsFn?`) proves the generate → shoot loop for new settings stories
   without needing MSW scenarios.
6. **Agent workflow doc** (`docs/architecture/storybook-screenshots.md`) describes
   the loop, the grep syntax, where PNGs land, and the manual-region seam.

## Consequences

### Positive

- The agent can now _see_ any `client/` story: one command captures a PNG it
  reads in-session, closing the edit → shoot → read → iterate loop that was the
  headline goal.
- The pipeline reuses the existing `fixturesLoader` + MSW scenarios unchanged
  (channel-driven `switchStory` re-runs loaders), so MSW-backed admin/debug
  stories capture in their populated state without a Storybook config change.
- Generated `tests/visual/**` specs are the reusable foundation; every later
  settings-backfill story flowed through the same `shoot:gen` → `shoot` loop.
- The pipeline became the substrate for a downstream **structured UX-review
  workflow** (`.claude/skills/ux-review/SKILL.md` + `docs/ux-reviews/`): the
  review skill captures a depth-B state set, reads the PNGs, and scores against
  a rubric — built entirely on this capture loop.
- Baselines-as-current-render (gitignored, always rewritten) means there is never
  a diff-failure tax; the agent just reads the freshest PNG.

### Negative

- Two new dev-only third-party packages (`@crvy/strybk`, `@crvy/rprtr`) are small
  and recent; their stability is an ongoing dependency risk.
- The pipeline is **chromium-only** by design; cross-browser/theme/viewport
  matrices are out of scope (the mechanism supports them later at zero design
  cost via Playwright projects + `project.metadata.storybookGlobals`).
- `bun shoot` needs a one-time `bunx playwright install chromium` and either a
  running Storybook or a ~warm-up boot; it is not a pure-unit-test gate.
- Screenshot _regression testing_ remains explicitly out of scope; the baselines
  are "the latest render," not a policed contract.

### Risks

- **strybk/rprtr maturity.** Both are small, recent packages; a breaking change
  affects every `shoot:gen`/`shoot`. Mitigated by version pinning; the generated
  spec shape is stable across the many backfill stories that now exist.
- **MSW settle timing.** A channel-switched MSW-backed story can capture blank/
  loading if the loader has not settled; the documented remedy is a
  `waitForLoadState('networkidle')` step before the assertion. Each MSW-backed
  settings story added later was verified populated at shoot time.
- **knip strictness.** The generated specs + their `@crvy/*` imports must not be
  flagged unused; resolved via knip entry/ignore config (not lint-disables).

## Related Decisions

- **ADR-0166: Storybook Harness — PR 1** — built the Storybook 9 + Vite harness,
  the `client/stories/` mock layer, and the `fixturesLoader` reset decorator this
  pipeline drives; this ADR is the visual-feedback layer on top of that harness.
- **ADR-0225: Hermetic Story Execution — Docker-Only OS Sandbox** — a separate
  (Tier 0) story lane; unrelated to the Playwright visual pipeline but part of
  the same broader testing surface.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The two
capture configs are byte-identical to the plan; the headline deliverables all
shipped, and the explicitly-deferred settings backfill landed via the follow-up
plan `2026-06-30-storybook-settings-story-backfill`.

| File | Role | Evidence |
| --- | --- | --- |
| `strybk.config.ts:12-21` | `defineConfig` — `storybookUrl`, `storyGlobs: ['client/**/*.stories.svelte']`, `resolveSpecPath` mirrors story paths under `tests/visual/`. | `read` confirms; byte-identical to plan Task 2. |
| `playwright.config.ts:10-33` | `testDir: 'tests/visual'`, `snapshotPathTemplate: '.storybook-shots/{testFilePath}/{arg}{ext}'`, chromium project, `@crvy/rprtr` reporter, `webServer` boots/reuses `bun storybook` waiting on `/index.json`. | `read` confirms; byte-identical to plan Task 3. |
| `package.json:22` | `shoot:gen` + `shoot` scripts. | `grep` confirms (see notes — `shoot:gen` was enriched post-plan). |
| `bunfig.toml:8` | `pathIgnorePatterns` excludes `tests/visual/**` from Bun test discovery. | `grep` confirms (also excludes `tests/stories/**` — added later by the hermetic-story work). |
| `knip.config.ts:49-50,138` | `playwright.config.ts!`/`strybk.config.ts!` registered as entries; `tests/visual/**` in `ignore`. | `read` confirms (see notes — was `knip.jsonc` in the plan). |
| `.gitignore:56-59` | Ignores `.storybook-shots/`, `playwright-report/`, `crvy-rprtr.html`, `crvy-rprtr-*.json`. | `grep` confirms; matches plan Task 1. |
| `tests/visual/settings/sections/ToolsSection.spec.ts:6-40` | Generated spec: `@generated-begin auto-screenshots` region with `switchStory` → `expect(sharedPage).toHaveScreenshot()` per story; manual region below `@generated-end`. | `read` confirms the documented generated/manual seam. |
| `client/settings/sections/ToolsSection.stories.svelte:86-103` | First settings story — DI-driven Loading/Empty/Populated/Error/Preset states. | `read` confirms (see notes — a 6th `Grouped` story was added later). |
| `docs/architecture/storybook-screenshots.md` | Agent workflow doc: one-time setup, the loop, manual-region seam, commit policy, optional rprtr UI. | `read` confirms (see notes — evolved beyond plan). |
| `CLAUDE.md:18` | Documentation-index row pointing at the workflow doc. | `grep` confirms. |
| `CHANGELOG.md:770-773` | Commit sequence — strybk config, playwright config, generate visual specs, ToolsSection stories — matches plan Tasks 2, 3, 5, 7. | `grep` confirms. |

Plan-vs-implementation notes:

- **Deferred backfill landed.** The plan deliberately scoped out the remaining
  five settings sections (`ReposSection`, `ByokSection`, `KaneoAccessSection`,
  `AdminUsersSection`, `SettingsApp` shell), their MSW handler groups/scenarios,
  and the `fixturesLoader` `settingsSession`/`activeContext` reset extension,
  deferring them to `2026-06-30-storybook-settings-story-backfill`. That backfill
  shipped: the `tests/visual/` tree now mirrors the full story set (settings,
  admin, debug, transcript, shared-ui), and `CHANGELOG.md:774-802` records the
  section-by-section additions. The Definition of Done is therefore fully met.
- **`knip.jsonc` → `knip.config.ts` (post-plan migration).** The plan's Task 4
  edits `knip.jsonc`. The shipped knip config is `knip.config.ts` (a `.ts`
  migration carried out by a later knip-ignore-cleanup plan). The net effect is
  preserved: `playwright.config.ts!`/`strybk.config.ts!` are entries
  (`knip.config.ts:49-50`), `tests/visual/**` is ignored (`knip.config.ts:138`),
  plus evolved `strybk.config.ts`-specific handling (`ignoreDependencies` for
  `@crvy/strybk` at `:96`, an `exports` ignoreIssue at `:114`) that the later
  knip cleanup added to keep strict knip green.
- **`shoot:gen` enriched (post-plan).** The plan's script was the bare
  `crvy-strybk generate --config ./strybk.config.ts`. The shipped `shoot:gen`
  appends `&& bun run format >/dev/null && bun run license:headers >/dev/null`
  (`package.json:22`) so regenerated specs are auto-formatted and license-stamped
  in one step; the workflow doc calls this out ("This also auto-formats and
  license-stamps the generated specs, so the tree stays green").
- **`ToolsSection` gained a 6th story.** The plan authored five states
  (Loading/Empty/Populated/Error/Preset). The shipped story adds a `Grouped`
  state (`ToolsSection.stories.svelte:46-77,99`) exercising plugin/MCP grouped
  domains, added by a later tool-permissions change; its generated test case is
  present (`ToolsSection.spec.ts:25-28`) alongside a manual narrow-viewport
  interaction test (`:42-47`).
- **Workflow doc evolved.** `docs/architecture/storybook-screenshots.md` gained a
  "Structured UX review" section referencing the `ux-review` skill, and the PNG
  naming note describes the stable `<story-id>-<n>.png` layout (the downstream
  UX-review workflow depends on predictable paths).
- **Per-app CSS fidelity (downstream).** A later plan
  (`2026-07-07-storybook-per-app-css-fidelity`) made each story render with its
  own app's global CSS so screenshots match the real app; that is an evolution of
  the Storybook preview layer this pipeline consumes, not a change to the
  pipeline itself.

The source plan `docs/superpowers/plans/2026-06-30-storybook-agent-screenshot-pipeline.md` and design `docs/superpowers/specs/2026-06-30-storybook-agent-screenshot-pipeline-design.md` are archived alongside this ADR to `docs/archive/`.
