# Tasks

## 1. Baseline and evidence

- [x] 1.1 Capture the starting state: `bun outdated`, `bun pm ls`, and the `bun.lock` hash; verify `bun install --frozen-lockfile` exits 0 on the clean checkout.
- [x] 1.2 Run the pre-change gate (`bun run typecheck`, `bun run lint`, `bun test`, `bun run check:full`, `bun run test:stories`, `bun run duplicates`) and persist `reports/`; verify every command exits 0 so later failures are attributable.
- [x] 1.3 Capture visual evidence before the bump: `bun run visual:audit` and a known-good/known-bad `figma:verify` pair; verify the diff PNGs and report artifacts exist for comparison. Do not run `bun shoot`, which rewrites the baselines.

## 2. Wave 1 — safe runtime and dev minors

- [x] 2.1 Bump the safe runtime minors (`marked` 18.2.1, `pino` 10.4.0, `p-limit` 7.3.3, `linkedom` 0.18.15, `defuddle` 0.19.13, `rrule-temporal` 2.3.0, `svelte` 5.59.1, `vite` 8.3.8, `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `discord.js` 14.28.1, `@modelcontextprotocol/sdk` 1.32.2, `@gramio/format` 0.12.1, `zod` 4.6.7) in `package.json`; verify `bun install` updates `bun.lock` and `bun run typecheck` passes.
- [x] 2.2 Bump the safe dev minors (`storybook`/`@storybook/*` 10.6.8 and 5.1.6, `@sveltejs/vite-plugin-svelte` 7.3.1, `knip` 6.47.0, `jscpd` 5.4.3, `oxfmt` 0.79.0, `@grammyjs/types` 5.1.0, `react` 19.3.1, `@types/react` 19.3.0) in `package.json`; verify `bun install`, `bun run lint`, and `bun run format:check` pass.
- [x] 2.3 Run the release-note-affected suites: `bun test tests/web`, `bun test tests/recurrence tests/scheduler-recurring`, `bun test tests/chat/telegram`, `bun test tests/chat/discord`, and `bun test tests/tools` (Zod `toJSONSchema` coverage); verify all pass.
- [x] 2.4 Run `bun run format` and `bun run duplicates`, then review the diff for oxfmt HTML churn and jscpd count changes; verify the diff is formatting-only (no source semantics changed) and record the new duplicate baseline.
- [x] 2.5 Commit Wave 1; verify `git diff --stat` contains only `package.json`, `bun.lock`, and intentional formatting changes.

## 3. Wave 2 — AI SDK family

- [x] 3.1 Add or confirm a steering regression test that drains the queue exactly once across `prepareStep` calls (`tests/run-control/steering-prepare-step.test.ts` or the orchestrator suite); verify the test passes on the pre-bump code.
- [x] 3.2 Bump `ai` to 7.0.179, `@ai-sdk/openai-compatible` to 3.0.94, `@ai-sdk/provider` to 4.0.39, and `ai-tokenizer` to 1.0.7; verify `bun install` and `bun run typecheck` pass.
- [x] 3.3 Run the LLM suites (`bun test tests/llm-orchestrator* tests/run-control tests/tools/disclosure tests/long-term-memory tests/web/distill tests/llm-model-builder*`); verify all pass, especially steering queue drain and disclosure `activeTools`.
- [x] 3.4 Run the LLM suite with the SDK's deprecation warnings enabled (or inspect the captured test output) and grep for `AI_SDK_` deprecation codes; verify no deprecated API in use is reported.
- [x] 3.5 Commit Wave 2; verify the diff is limited to the four manifests, lockfile, and the steering test.

## 4. Wave 3 — tooling/UI majors

- [x] 4.1 Bump `msw` 3.0.7 and `msw-storybook-addon` 3.0.3; migrate `.storybook/preview.ts` from `onUnhandledRequest: 'bypass'` to `onUnhandledFrame: 'bypass'` and reconcile `MswApi`/`mswLoader` with addon v3; verify `bun run test:stories` and one screenshot per app area pass.
- [x] 4.2 Bump `unpdf` 2.2.1; keep `src/web/pdf.ts` on `getDocumentProxy`/`extractText`; verify `bun test tests/web/pdf.test.ts` and the PDF smoke case pass.
- [x] 4.3 Bump `happy-dom` 21.0.4 and `@happy-dom/global-registrator` 21.0.4; verify `bun run test:client` passes without enabling CSS/iframe loading.
- [x] 4.4 Bump `pixelmatch` 8.0.0; recalibrate only the `figma:verify` threshold (`DEFAULT_COMPARE_THRESHOLD = 0.1`) from a known-good/known-bad pair, using `windowSize` only if it preserves real-change detection; verify the pair produces the expected pass/fail and record the measured ratio change. Do not change `playwright.config.ts` thresholds for this bump.
- [x] 4.5 Bump `oxc-parser` to exactly `0.159.0`; verify `bun test tests/plugins tests/story tests/smoke` passes, including the `walkNodes` paths.
- [x] 4.6 Bump `oxlint` 1.94.0 and `oxlint-tsgolint` 7.0.2008 together; run `bun run lint` and `bun run typecheck`, fix new findings without disable comments, and verify both exit 0.
- [x] 4.7 Run `bun run format` after the oxfmt 0.79 bump; inspect the HTML/Svelte diff and verify `bun run format:check` exits 0.
- [x] 4.8 Bump `@playwright/test` 1.65.1; verify `bun run test:e2e` and `bun run shoot` pass under Bun. Do not add `onlyFailures` reporters: the project uses `list` + rprtr, and a failure-only artifact path is a separate change.
- [x] 4.9 Commit Wave 3 as one commit per major migration; verify each commit reverts independently with `git revert --no-commit` plus `bun install --frozen-lockfile`.

## 5. Wave 4 — visual and developer extras

- [x] 5.1 Bump `@crvy/rprtr` 0.4.6 and set `reportOnlyFailedTests: process.env['CI'] === 'true'` in its reporter options, so local runs keep the full report; verify `bun run shoot` produces the reduced CI report and the full local report still works.
- [x] 5.2 Bump `@crvy/strybk` 0.0.10; run `bun run shoot:gen` and verify story extraction waits for preview readiness without a timeout.
- [x] 5.3 Sync `@opencode-ai/plugin` and `@opencode-ai/sdk` to exactly 1.19.6 in root, and `@opencode-ai/sdk` to 1.19.6 in `opencode-agent/package.json`; verify `bun run opencode-agent:test`, `bun run opencode-agent:typecheck`, and `bun run test:hooks` pass.
- [x] 5.4 Bump `@stryker-mutator/core` to 10.1.1 while keeping `@hughescr/stryker-bun-runner@1.3.8` and its patch; verify `bun run test:mutate:changed --base=HEAD~1` passes and the patch still applies.
- [x] 5.5 Commit Wave 4; verify the diff contains only the expected manifests, lockfile, and reporter config.

## 6. Cleanup and integration

- [ ] 6.1 Audit `ink`, `ink-testing-library`, and `dependency-cruiser` with `bun pm why` and knip; remove only the packages with no static or dynamic consumer in a separate commit, and verify `bun run knip` passes.
- [ ] 6.2 Update `docs/architecture/storybook-screenshots.md` for the MSW 3 option name, rprtr `reportOnlyFailedTests`, and the pixelmatch 8 `figma:verify` recalibration; update the `README.md` dependency notes for the held Stryker runner; verify every documented command runs as written.
- [ ] 6.3 Run the full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run check:full`, `bun run test:stories`, and `bun run duplicates`; verify all exit 0 and compare against the baseline reports.
- [ ] 6.4 Write the follow-up proposal shortlist from design.md — native AI SDK steering first, then tool approvals and native tool search — with source version, papai fit, and required spec delta for each; verify each entry names a `file:line` starting point.

## Workflow follow-up

- Archive the change after review approval and a green full gate.
- Open follow-up changes for the feature candidates rather than extending this dependency refresh.
