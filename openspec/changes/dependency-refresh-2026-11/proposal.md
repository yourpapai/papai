# Proposal

## Why

The runtime, chat adapters, AI layer, and developer tooling have drifted from npm `latest`: 18 runtime and 30 dev dependencies are behind, including five majors with required migrations (MSW 3, unpdf 2, happy-dom 21, pixelmatch 8, oxlint-tsgolint 7). AI SDK 7.0.88 → 7.0.179 also adds capabilities papai currently hand-rolls (native steering, tool search, step-error hooks). Updating one package at a time hides cross-package failures; one planned wave makes the breakage explicit and reviewable.

## What Changes

- Refresh the outdated runtime and dev dependencies in four reviewable waves: safe patch/minor, AI SDK family, UI/tooling majors, and Storybook/MSW/visual tooling.
- **BREAKING** `msw` 2 → 3 and `msw-storybook-addon` 3: ESM-only, `onUnhandledRequest` → `onUnhandledFrame`, new addon architecture; migrate `.storybook/preview.ts` and the story fixture loader.
- **BREAKING** `unpdf` 1 → 2: ESM-only, Node ≥ 24 engine, `configureUnPDF`/`resolvePDFJSImport` removed; papai's `getDocumentProxy`/`extractText` call sites stay compatible.
- **BREAKING** `happy-dom` 20 → 21: CSS/iframe loading is off by default (SSRF hardening); verify the client test setup needs no opt-in.
- **BREAKING** `pixelmatch` 7 → 8: the OKLab/HyAB metric changes `figma:verify` diff counts; re-baseline that threshold. Playwright's `toHaveScreenshot` comparator is bundled and unaffected by this dev dependency.
- `oxc-parser` 0.147 → 0.159 (pin stays exact): label AST IDs change; verify the `src/ts-ast` seam.
- `zod` 4.5 → 4.6: JSON Schema chaining and numeric-enum reverse mapping change; `toJSONSchema` tests cover the impact.
- `@hughescr/stryker-bun-runner` stays at 1.3.8 + patch: 1.4+ declares `typescript < 7`, and Stryker's config reader cannot run against TypeScript 7.
- Sync `@opencode-ai/plugin` and `@opencode-ai/sdk` to the same 1.19.6.
- Adopt only low-risk release features here: `@crvy/rprtr` `reportOnlyFailedTests` and the `@crvy/strybk` preview-readiness fix.
- Record the remaining release-note feature candidates for follow-up changes; do not adopt them in this wave.

## Capabilities

### New Capabilities

None — this is a dependency and tooling refresh with no new system behavior.

### Modified Capabilities

None — no requirement changes. `.openspec.yaml` sets `skip_specs: true`; every required migration preserves observable behavior.

## Non-goals

- Adopting AI SDK native steering/tool approvals/tool search, the gramio rich DSL, zod `.validate()`, rrule `allDay`, or unpdf image/page inspection — each changes behavior and needs its own proposal and spec delta.
- `@hughescr/stryker-bun-runner` 1.4+ while TypeScript 7 is pinned; upstream TypeScript 7 support is tracked separately.
- MCP SDK 2.x (`latest` remains 1.32.2), drizzle 1.0 RC, and Storybook 11 beta.
- Raising Bun from the 1.4.0 CI/Docker pin; `@types/bun` stays aligned with the runtime pin.
- Removing unused dev dependencies unless the post-refresh knip/`bun pm why` check proves no consumer.

## Impact

- Dependencies: `package.json`, `bun.lock`, all three workspace manifests; `patches/` unchanged.
- Code/config: `.storybook/preview.ts`, `playwright.config.ts`, and `.oxlintrc.json` only if lint defaults move.
- Docs: `docs/architecture/storybook-screenshots.md` (MSW, rprtr, pixelmatch notes) and `README.md` dependency notes.
- Scope: no platform-instance, task-instance, config-context, per-user/group, or thread-isolation behavior changes.
