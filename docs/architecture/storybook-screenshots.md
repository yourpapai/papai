<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook screenshot pipeline (agent visual feedback)

A local Claude Code session can render any `client/` Storybook story, capture a
PNG, and read it back in-session to assess and iterate on the UI.

## One-time setup

    bunx playwright install chromium

## The loop

1.  Start Storybook once (kept warm for fast re-shoots):

    bun storybook

2.  (Re)generate visual specs after adding or renaming stories. This also
    auto-formats and license-stamps the generated specs, so the tree stays green:

        bun shoot:gen

3.  Capture screenshots for the stories you care about (`-g` is a regex over
    test titles / story names):

        bun shoot -g ToolsSection

4.  Read the baseline PNGs under `.storybook-shots/` (mirrors the story tree —
    one stable file per story, named `<story-id>-<n>.png`), e.g.:

        .storybook-shots/settings/sections/ToolsSection.spec.ts/settings-sections-ToolsSection-Populated-1.png

    (Ignore the sibling `.storybook-shots/test-results/` dir — those `…-actual.png`
    files are transient per-run artifacts, not the stable render.)

5.  Edit the component, then re-run `bun shoot -g <name>`. HMR + the
    `reuseExistingServer` Playwright `webServer` keep re-shoots fast.

Editing `client/shared/tokens.css` or any `client/**/*.css` needs no Storybook restart: those
files are concatenated into `public/storybook-*.css`, and a Playwright `globalSetup`
regenerates them at the start of every run (~112 ms). Before that existed, a warm Storybook
served the CSS snapshot it booted with, and runs silently rendered stale tokens.

## Capturing intermediate states

`strybk` regenerates the `@generated-begin auto-screenshots` region but
preserves the manual region below `// @generated-end auto-screenshots`. Add
interaction steps there and shoot:

    // manual region (below @generated-end)
    test('Tools — domain expanded', async ({ sharedPage }) => {
      await switchStory(sharedPage, 'settings-sections-toolssection--populated')
      await sharedPage.getByText('tasks').click()
      await expect(sharedPage).toHaveScreenshot()
    })

If an MSW-backed story captures blank/loading, add
`await sharedPage.waitForLoadState('networkidle')` before the assertion.

## What is and isn't committed

- Committed: generated specs under `tests/visual/**` (the reusable test foundation).
- Gitignored: `.storybook-shots/` (baselines + run artifacts), `playwright-report/`,
  `crvy-rprtr.*`. Baselines are local artifacts and are never compared across sessions or in
  CI — by default they are just the latest render. For a deliberate cross-cutting change they
  can be used as a within-session regression check; see "Audit mode" below.

## Audit mode

Reach for this when a single change is expected to affect many components at once — a design
token sweep, a shared-component edit — and you want the pass/fail partition to be evidence
about which components the change reached.

    bun run visual:audit            # whole suite
    bun run visual:audit tests/visual/admin/components/AdminTopBar.spec.ts   # one spec

It runs the normal suite with `VISUAL_AUDIT=1`, which drops the pixelmatch threshold from
Playwright's default `0.2` to `0.02`. The per-pixel cutoff is `35215 × threshold²`, so that is
a move from 1408.6 to 14.09. At the default, a dim-on-dark color change under roughly 1400 YIQ
delta passes silently: sub-project G's `--fg3` change measured 264.7 and was invisible to all
111 specs, which is why audit mode exists.

**The baselines must predate the change under test.** Audit mode compares against whatever is
in `.storybook-shots/`, so the workflow is: run the suite (or `bun shoot`) *before* editing,
make the change, then run `bun run visual:audit`. Running `bun shoot` after the edit
overwrites the evidence.

**What a green audit proves:** the render matches the baseline. **What it does not prove:**
that the baseline was ever right. Audit mode is a change-detector, not a correctness oracle.

`DebugApp` and `DebugTopBar` carry a live uptime counter and fail on every run in both modes.
Those five stories are a known false positive.

No `maxDiffPixelRatio` is configured, and none is needed: across three back-to-back audit-mode
runs following a forced full re-baseline, the only failures were the same five
`DebugApp`/`DebugTopBar` clock stories every time, so at `threshold: 0.02` the suite has no
measurable anti-aliasing noise floor once baselines match source.

### Why `bun shoot` passes `--update-snapshots=all`

Playwright's bare `--update-snapshots` flag presets to mode `"changed"`, and "changed" means
changed *as judged by the comparator*. At the default `threshold: 0.2` that makes the
re-baseline itself blind in exactly the way audit mode exists to fix: it rewrites only the
baselines already failing at 1408.6, and silently strands every baseline whose drift is below
that cutoff.

This is not hypothetical. Sub-project G's `--text-dim` change (`#6b766e` → `#828d84`) was
followed by a re-baseline that rewrote 53 baselines and left 392 encoding the old color — and
because the residue was sub-threshold, the default suite reported a clean 449-pass run over it.
`bun shoot` therefore passes `--update-snapshots=all`, which rewrites every baseline
unconditionally. Do not drop the `=all`.

## Optional review UI

`@crvy/rprtr` is wired in `playwright.config.ts`. Run `bunx crvy-rprtr` to open a
side-by-side review UI. Drop the reporter line from the config to remove it.

## Syncing stories to Figma

`bun figma:sync` mirrors the baselines into captioned Figma boards (one page per
area — e.g. "Admin UI — stories", "Settings UI — stories"). The MCP upload path
this automates is otherwise agent-only; a repo script cannot reach it, so the
script serves everything from localhost and a small development plugin does the
writes inside Figma:

1.  One-time: Figma desktop → Plugins → Development → Import plugin from
    manifest… → `scripts/figma-sync-plugin/manifest.json`. The plugin talks to
    `http://127.0.0.1:7781` only (declared in `networkAccess`).
2.  Run `bun figma:sync` (default areas: `admin,settings`; add `--no-shoot` to
    reuse existing `.storybook-shots/` baselines). It prints `status=ready` and
    waits.
3.  In the target Figma file run Plugins → Development → papai story sync. The
    plugin builds the boards, streams the PNGs into image fills, POSTs a report
    back, and the script exits `status=ok` / `status=error` with counters.

Idempotency: every story frame carries a `pluginData` key (the PNG's path under
`.storybook-shots/`), so re-syncs resize, reposition, and refill existing frames
in place instead of duplicating them; boards created before the plugin existed
are adopted by frame-name match. Frames whose key no longer exists are counted
as `stale` and left untouched. Geometry (0.5× scale, 3 columns for `admin`, 4
elsewhere, 40/60/72/20/8 spacing constants) lives in `scripts/figma-sync-lib.ts`
with tests in `tests/scripts/figma-sync.test.ts`.

## Verifying generated code against designs

After generating `client/` code from a papai Figma node (the `figma-codegen`
skill), compare the implemented render against the design render:

1.  Produce the implemented side with the normal shoot loop — a baseline PNG
    under `.storybook-shots/` for the touched component/section story.

2.  Produce the Figma side: export the corresponding frame via the Figma MCP
    (`download_assets` on the node id) and save it as a PNG.

3.  Compare (report-only — it never edits code, Figma nodes, or baselines):

        bun run figma:verify --story <baseline.png> --figma <figma.png> [--threshold 0.1]

    `--figma` also accepts a bare node id (`22:198`); the run then reports an
    explicit `status=skip` naming the missing side instead of a render, since
    repo scripts cannot reach Figma. Renders at different scales are
    bilinearly normalized to the smaller size before diffing (`pixelmatch` +
    `pngjs`, dev-only). Pass/fail is the mismatched-pixel ratio against
    `--threshold` (default 0.1); a failing run writes the diff image under
    `reports/figma-verify/` and names it in the report.

## Structured UX review

To turn a screenshot into a scored, severity-ranked findings document, use the
`ux-review` skill (`.claude/skills/ux-review/SKILL.md`). It captures the depth-B state set,
reads screenshots alongside component source, scores against `docs/ux-reviews/RUBRIC.md`, and
writes a report-only findings doc under `docs/ux-reviews/`. Trigger it with
"UX review `<Section>`".
