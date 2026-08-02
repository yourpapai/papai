<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Visual-gate trustworthiness

**Date:** 2026-08-02
**Status:** Design approved, pending spec review

## Problem

Sub-project G used the Storybook screenshot suite as an audit device: apply a token change,
run `bunx playwright test` strict, and read the pass/fail partition as evidence about which
components consume the changed token. Two independent defects made that reading unsound, and
each one alone is enough to make a green run mean nothing.

### The comparator is blind to dim-on-dark color changes

`playwright.config.ts` carries no `expect.toHaveScreenshot` block, so every comparator
setting sits at Playwright's default — in particular `threshold: 0.2`. Playwright compares
via pixelmatch, whose per-pixel cutoff in YIQ space is `35215 × threshold²`; at the default
that is **1408.6**.

The three color changes G actually made, measured against that cutoff:

| token | change | YIQ delta | detected |
| ---------- | ------------------- | ------ | ---- |
| `--fg3` / `--text-dim` | `#6b766e` → `#828d84` | 264.7 | **no** |
| `--fg4` | `#3a4248` → `#828d84` | 2655.9 | yes (~1.9× over) |
| `--fg-hint` | `#8b978c` → `#828d84` | 45.5 | **no** |

The 53 specs that failed were the `--fg4` sites. The `--fg3` change — 88 of the sweep's 110
call sites — could not have been detected anywhere in the suite. The plan's core audit
mechanism silently proved nothing for the majority of its own blast radius.

Working backwards, catching a change of 264.7 requires `threshold ≤ 0.0867`; catching 45.5
requires `≤ 0.0359`.

### A warm Storybook serves a frozen token snapshot

`storybook:prepare` concatenates `client/shared/base.css` + `client/shared/tokens.css` (plus
the per-SPA stylesheet) into `public/storybook-*.css`. It is wired to *server start*:

```
"storybook": "bun storybook:prepare && storybook dev -p 6006 --no-open"
```

But the thing depending on its output is *every run*. `webServer.reuseExistingServer: true`
is what separates the two: against an already-running Storybook, Playwright never executes
`webServer.command`, so `storybook:prepare` never fires and the run renders whatever token
snapshot was concatenated when the server first booted.

During G this went undetected. The suite reported its normal pass rate while the browser
rendered `#6b766e` — the bundles were stamped roughly four hours before the commit under
test. `public/` is gitignored, so nothing in the working tree hinted at the divergence.

### These are one problem

Both defects produce the same artifact: a green visual run that is not evidence. The
remaining UI backlog — alias deletion, disabled-control contrast, empty-state work — leans on
that run being meaningful, so the gate is fixed before the work that trusts it.

## Scope

This is sub-project **I** on branch `ui-ux-review-01`.

In scope: `playwright.config.ts`, a new Playwright `globalSetup`, one new package script, and
the corresponding section of `docs/architecture/storybook-screenshots.md`.

Explicitly **not** in scope:

- **Committing baselines or adding a CI visual gate.** `.storybook-shots/` stays gitignored.
  This builds a local audit device, not a pipeline stage.
- **Tightening the default threshold.** The warm loop keeps Playwright's defaults, byte for
  byte. Sensitivity is opt-in.
- **The `DebugApp` uptime flake.** A live counter produces a spurious diff on every run; it is
  a known false positive under both the current suite and audit mode, discounted rather than
  investigated.
- **Re-auditing sub-project G.** G is closed. Its token-value correctness rests on
  `tests/client/shared/token-contrast.test.ts`, and the two things that test cannot prove were
  covered by other means — a repo-wide grep confirming no call site hardcodes the old literals,
  and two independent human-eye hierarchy judgments.

## Design

### Regenerating the CSS bundles per run

A Playwright `globalSetup` at `tests/visual/global-setup.ts` shells out to
`bun run storybook:prepare`, invoking the existing script rather than re-implementing its
`cat` chain — duplicating that logic is precisely how the two copies would drift.

The fix is order-independent, which is why it is preferred over the alternatives. Playwright's
relative ordering of `webServer` and `globalSetup` does not matter, and neither does server
temperature:

- **Cold server** — `bun storybook` runs `storybook:prepare` itself; `globalSetup` runs it a
  second time, harmlessly and identically.
- **Warm server** — `webServer.command` is skipped, `globalSetup` regenerates the bundles, and
  Vite serves the new files straight off disk. Verified during G: the dev server picks up
  regenerated `public/*.css` over HTTP with no restart.

Measured cost is **112 ms**, and the script leaves the working tree clean (`public/` is
gitignored). At that price it runs on every `bun shoot -g <Section>` without perturbing the
warm loop.

The colocation is safe: Playwright's default `testMatch` collects only `*.spec.ts` /
`*.test.ts`, so `global-setup.ts` sitting inside `testDir` is not picked up as a test.

Two alternatives were rejected. **A divergence guard** — fetch the served bundle, diff it
against `client/shared/tokens.css`, fail the run on mismatch — reports a problem that
regeneration simply removes, and adds an HTTP round-trip plus a parser to maintain. **Setting
`reuseExistingServer: false`** would trade silent staleness for a permanent cold-start tax on
every re-shoot, gutting the loop the pipeline is built around.

### Opt-in audit mode

Comparator sensitivity becomes a runtime switch in `playwright.config.ts`:

```typescript
const AUDIT = process.env.VISUAL_AUDIT === '1'

expect: {
  toHaveScreenshot: {
    // pixelmatch cutoff = 35215 × threshold². Default 0.2 ⇒ 1408.6, which passes
    // any dim-on-dark color change under ~1400 YIQ delta (see sub-project G).
    threshold: AUDIT ? 0.02 : 0.2,
  },
},
```

paired with a new script, `"visual:audit": "VISUAL_AUDIT=1 playwright test"`.

The non-audit branch writes `0.2` explicitly even though it is Playwright's default. Part of
why this blind spot survived is that the config was *silent* about the comparator, giving no
reader a reason to ask what the number was.

`0.02` gives a cutoff of **14.09**. The smaller of the two changes G proved invisible was
45.5, whose detection needs `≤ 0.0359`; 0.02 sits roughly 3× below that, so the setting is not
tuned to one incident's specific numbers.

**Why an env var rather than a second Playwright project.** `snapshotPathTemplate` is
`.storybook-shots/{testFilePath}/{arg}{ext}` — it contains neither `{projectName}` nor
`{platform}`, so two projects would read and write the same baseline files. For *reading* that
is exactly what is wanted: audit mode compares against the very PNGs the warm loop produced,
with no duplicate baseline set and no separate re-baseline. But a bare `bunx playwright test`
runs all projects, so the default path would silently become 908 shots instead of 454, and
`bun shoot` would have two projects racing to write the same files. A single project switched
by environment keeps the default path byte-identical to today.

### Calibration

Whether font anti-aliasing produces cross-run pixel noise at `threshold: 0.02` cannot be
settled from the config. Renders should be deterministic — same Chromium, same fonts, same
machine — but that is an expectation, not evidence, so implementation opens by measuring it:
run `visual:audit` twice against unchanged code and count non-zero diffs.

If noise appears, the remedy is `maxDiffPixelRatio` raised just above the measured floor,
**not** a looser `threshold`. The asymmetry is the point: a pixel-count floor preserves full
per-pixel color sensitivity and merely tolerates a few scattered pixels, whereas loosening
`threshold` reinstates the exact blindness this design exists to remove. A token change covers
large text areas and lights up thousands of pixels, clearing any sane ratio floor.

## Verification

One experiment exercises both halves, because it can only pass if both fixes are broken:

1. Start Storybook and leave it warm.
2. **Then** edit `client/shared/tokens.css`, reverting `--text-dim` from `#828d84` to
   `#6b766e` — G's exact sub-threshold change, YIQ delta 264.7.
3. Run `bun run visual:audit`. It must fail on the `--fg3` sites.
4. Revert the edit.

The new color cannot render at all unless `globalSetup` regenerated the bundle against the
warm server, and once rendered, a 264.7 delta is invisible at the old threshold. The run is a
literal reproduction of G's failure.

Additionally: `bunx playwright test` (no `VISUAL_AUDIT`) must still land at the known 449 pass
+ 5 `DebugApp` flake floor, confirming the default path is unchanged, and `bun run check:full`
at 12/12 before the cycle closes.

### What verification cannot prove

A green audit proves the render matches the baseline. It does not prove the baseline was ever
right, and it means nothing unless the baselines predate the change under test. That ordering
is the workflow G's plan assumed and could not rely on; documenting it is part of the
deliverable.

**No automated test covers this work.** It is Playwright configuration with no meaningful unit
to assert against; a test that reads the config back and asserts `0.02 === 0.02` would be
test-shaped noise. The reproduction experiment above is the verification. One friction to
resolve during implementation: the repo's TDD write-hook may object to editing
`playwright.config.ts` with no accompanying test, and the resolution must not be a
lint-disable or type-ignore comment.

## Documentation

`docs/architecture/storybook-screenshots.md` currently states:

> Screenshot regression testing is intentionally out of scope; the baselines are just the
> latest render.

Audit mode makes that conditionally false, so the line is rewritten rather than left to
contradict the new script. A new section covers when to reach for audit mode — a deliberate
cross-cutting change such as a token sweep or a shared-component edit — how to run it, the
baselines-must-predate-the-change ordering, and what a green audit does and does not prove.

A one-line comment beside `globalSetup` records why it exists, so a later reader does not
optimize away a 112 ms call whose absence fails silently.

## Risks

**Calibration may not converge.** If anti-aliasing noise is high enough that no
`maxDiffPixelRatio` floor separates signal from noise, audit mode ships as a diff list to read
rather than a clean pass/fail gate. That is still a large improvement over a comparator that
cannot see the change at all, but the possibility is named up front rather than discovered
mid-plan.

**`globalSetup` adds a hard-failure path.** If `storybook:prepare` ever errors, every visual
run dies rather than only the next server start. The script already runs on every server
start and completes in 112 ms, so exposure is low — but the failure mode is new.
