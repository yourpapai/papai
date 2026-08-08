<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0360: Visual-Gate Trustworthiness — Per-Run CSS Regeneration and Opt-In High-Sensitivity Audit Mode

## Status

Accepted

## Date

2026-08-08

## Context

The Storybook screenshot suite could report green while rendering something other than the source tree, in two independent ways. First, `storybook:prepare` (which concatenates `client/shared/base.css` + `client/shared/tokens.css` into `public/storybook-*.css`) was wired to server start, and Playwright runs with `webServer.reuseExistingServer: true` — so against a warm Storybook, `webServer.command` never executes and the browser renders the token snapshot the server booted with. Sub-project G lost an entire audit to this: the suite reported its normal pass rate while the browser rendered four-hour-old colors. Second, the pixelmatch comparator ran at Playwright's default threshold `0.2` (per-pixel cutoff 35215 × threshold² = 1408.6 YIQ delta), which silently passes any dim-on-dark color change under roughly 1400 YIQ — the `--fg3` remediation measured 264.7 and was invisible to all 111 specs. The design is in `docs/superpowers/specs/2026-08-02-visual-gate-trustworthiness-design.md`; the implementation plan is `docs/superpowers/plans/2026-08-02-visual-gate-trustworthiness.md`.

## Decision Drivers

- **A green run must mean the render matched the current source.** Staleness must fail loudly (hard error at run start), never silently, by passing.
- **The everyday warm loop must stay behaviorally identical.** Default threshold `0.2`, one chromium project, `snapshotPathTemplate` untouched — audit sensitivity is opt-in only, so no flake risk is imposed on the default path.
- **Couple regeneration to the run, not the server.** Vite serves `public/` from disk per request, so regenerating the bundles at run start fixes a warm server without a restart; measured cost is ~112 ms, cheap enough for every run.
- **Sensitivity tuning must be pixel-count-based, not threshold-loosening.** If audit mode surfaces anti-aliasing noise, the remedy is a `maxDiffPixelRatio` floor — a higher per-pixel threshold would reinstate exactly the blindness being removed.
- **Verification is experimental, not mock-based.** Playwright config has no meaningful unit to assert against; each task carries a genuine red/green pair (break a token, watch the suite's verdict flip) rather than test-shaped noise.

## Considered Options

### Option 1 — Playwright `globalSetup` regenerating CSS per run + env-gated `expect.toHaveScreenshot` threshold (chosen)

Add `tests/visual/support/global-setup.ts` (default-exported zero-arg function shelling out to the existing `storybook:prepare` via `execFileSync`, throwing on failure) and wire it as `globalSetup` in `playwright.config.ts`. Add `const AUDIT = process.env.VISUAL_AUDIT === '1'` and an explicit `expect: { toHaveScreenshot: { threshold: AUDIT ? 0.02 : 0.2 } }` block, exposed through a `visual:audit` package script (`VISUAL_AUDIT=1 playwright test`).

- **Pros:** closes the staleness trap for warm servers with zero changes to the dev loop; the explicit `expect` block makes the comparator visible in source (the blind spot survived partly because the config was silent about it); the default branch states `0.2` explicitly even though it is Playwright's own default; failure of `storybook:prepare` aborts every run loudly; calibration (two full audit runs against unchanged code) confirmed the noise floor is exactly the 5 known `DebugApp` uptime-counter flakes, so no `maxDiffPixelRatio` was needed and none was documented.
- **Cons:** `globalSetup` adds a hard-failure path — if `storybook:prepare` ever errors, every visual run fails at start; the `support/` placement deviates from the spec's `tests/visual/global-setup.ts` (accepted deliberately, since `support/` is the established home for non-spec helpers and default `testMatch` never collects it as a test); the audit numbers (111 specs, 449+5 floor) are snapshot-in-time claims that drift as the suite grows.

### Option 2 — Regenerate CSS on file change (watcher) instead of per run

- **Pros:** zero per-run cost.
- **Cons:** reintroduces a stateful side channel between the source tree and what the server renders; a watcher that is down or wedged fails silently — the exact failure mode being removed. Rejected.

### Option 3 — Make the strict comparator the default

- **Pros:** maximal sensitivity everywhere, no opt-in to remember.
- **Cons:** a threshold of `0.02` (cutoff 14.09) sits close to anti-aliasing noise and would impose flake triage on the everyday loop; the `DebugApp` uptime counter fails on every run in both modes regardless. Rejected — sensitivity is opt-in per deliberate cross-cutting change.

## Decision

Option 1 shipped:

1. `tests/visual/support/global-setup.ts` runs `bun run storybook:prepare` before every Playwright run and throws `storybook:prepare failed, so visual runs would render stale CSS: <detail>` on error.
2. `playwright.config.ts:23` wires `globalSetup: './tests/visual/support/global-setup.ts'`; `playwright.config.ts:34-42` declares the env-gated `expect.toHaveScreenshot` block (`threshold: AUDIT ? 0.02 : 0.2`) with the cutoff math recorded in the comment.
3. `package.json` adds `"visual:audit": "VISUAL_AUDIT=1 playwright test"` beside `shoot`.
4. `docs/architecture/storybook-screenshots.md` replaced the now-false "regression testing is out of scope" claim, added an "Audit mode" section (usage, the 1408.6 → 14.09 cutoff move, the baselines-must-predate-the-change rule, and the change-detector-not-correctness-oracle framing), and documented per-run CSS regeneration in "The loop".
5. Verification was the plan's red/green pairs: the staleness bug reproduced (red `--text-dim` passed against a warm server), then failed after `globalSetup` (1 failed), then passed after revert; audit mode proven to catch what the default misses — the same spec passed at `0.2` and failed at `0.02` against a 264.7-YIQ token edit.
6. Calibration came back clean: 5 failed, all `DebugApp`, both runs — so no `maxDiffPixelRatio` was added and none was documented, per the plan's "do not document a setting that does not exist" rule.

## Consequences

### Positive

- Every visual run renders against current CSS regardless of server age; the warm loop (`bun storybook` left running) no longer invalidates results.
- A deliberate cross-cutting change (token sweep, shared-component edit) can now be audited with `bun run visual:audit`, turning the pass/fail partition into evidence about which components the change reached.
- The default path is provably undisturbed: post-change full suite landed at the known floor of 449 passed + 5 `DebugApp` flakes, unchanged.
- `visual:audit` became shared infrastructure: later plans (shared-settings-CSS fixes, UX open-findings fixes, PluginsSection close-out) use it as their non-mutating manifest-producing check before any re-baseline.

### Negative

- `DebugApp`'s live uptime counter fails on every run in both modes and must be discounted by hand — a known false positive that the docs now carry permanently.
- Audit mode is a change-detector, not a correctness oracle: a green audit proves only that the render matches the baseline, and running `bun shoot` after an edit destroys the evidence (documented, but still a workflow footgun).
- `globalSetup` couples every visual run to `bun` and the `storybook:prepare` script being healthy; an environment without them cannot run the suite at all, even for specs that do not care about tokens.

## References

- Plan: `docs/superpowers/plans/2026-08-02-visual-gate-trustworthiness.md`
- Design spec: `docs/superpowers/specs/2026-08-02-visual-gate-trustworthiness-design.md`
- Config: `playwright.config.ts`
- Global setup: `tests/visual/support/global-setup.ts`
- Docs: `docs/architecture/storybook-screenshots.md`
- Implementation commits: `6a25c89fe` ("fix(visual): regenerate storybook CSS bundles on every playwright run"), `560c869a1` ("feat(visual): add opt-in high-sensitivity screenshot audit mode")
- Related: ADR-0356 (dim text token contrast remediation — the change whose invisibility to the default comparator motivated audit mode)
