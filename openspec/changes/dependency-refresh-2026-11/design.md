# Design

## Context

See `proposal.md` — Why. The refresh crosses four surfaces with different blast radii:

- **Runtime/LLM**: `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/provider`, `zod`, MCP SDK, memory/embedding code.
- **Chat/platforms**: `grammy` types, `@gramio/format`, `discord.js`, Markdown rendering.
- **Client/visual**: Svelte, Vite, Storybook, MSW, happy-dom, Playwright, pixelmatch, `@crvy/*`.
- **Developer tooling**: oxlint/oxfmt/tsgolint, knip, jscpd, Stryker, mutation runner.

Constraints that shape the plan:

- Bun is the package manager and runtime; `bun.lock` is the only lockfile. CI and Docker pin Bun 1.4.0, local is 1.4.4.
- `typescript@7.0.2` is both the typechecker and the project's dev dependency. `@hughescr/stryker-bun-runner` 1.4+ declares `typescript < 7`; the current 1.3.8 install carries a local patch that widens its Stryker peer range to `^10`.
- `oxc-parser` is pinned exactly (`0.147.0`), not with a caret, because its AST surface moves on 0.x.
- `@opencode-ai/plugin` is pinned exactly (`1.18.25`) while `@opencode-ai/sdk` floats on `^1.18.25`; the two must move together.
- `@types/bun` is intentionally held at the runtime pin, not npm `latest`.
- The write/Edit TDD hook gates `src/`, `client/`, `plugins/`, `review-loop/src/`, and `opencode-agent/src/`; dependency-only manifests and lockfile changes are not gated by it, but any config edit under `.storybook/` or `playwright.config.ts` is.
- `typescript` is already at `^7.0.2` (npm `latest`), as are `grammy`, `ipaddr.js`, and `date-fns-tz`; they are not in the bump set.

## Goals / Non-Goals

**Goals:**

- Move every dependency that can safely move to its latest compatible version, with the required source migrations understood before the first bump.
- Keep each wave independently revertible; never land a major with unrelated minors in the same commit.
- Preserve all observable behavior: chat rendering, tool gating, scope model, analytics, and mutation scores.
- Capture release-note feature candidates with enough specificity that follow-up proposals do not re-research them.

**Non-Goals:**

- No new runtime or dev dependency. The existing stack covers every need in this change; feature adoption is deferred.
- No change to platform/task instance handling, config-context scope, tool_prefs, guest mode, or conversation state.
- No TypeScript, MCP SDK 2.x, drizzle 1.0, Storybook 11, or Bun runtime bump in this change.
- No spec delta; `.openspec.yaml` sets `skip_specs: true`.

## Decisions

### D1 — Four waves, ordered by blast radius

| Wave | Contents | Why this order |
| --- | --- | --- |
| 1. Safe minors | Runtime minors and dev minors whose release notes contain no migration (marked, pino, p-limit, linkedom, defuddle, rrule-temporal, svelte, vite, drizzle-orm/kit, discord.js, Storybook 10.6, knip, jscpd, oxfmt) | Establishes a green baseline with low rollback cost |
| 2. AI SDK family | `ai` 7.0.87 → 7.0.179, `@ai-sdk/openai-compatible` 3.0.41 → 3.0.94, `@ai-sdk/provider` 4.0.9 → 4.0.39, `ai-tokenizer` 1.0.7 | The three packages share a provider spec; updating one alone leaves peer/type skew |
| 3. Tooling/UI majors | `msw` 3, `msw-storybook-addon` 3, `unpdf` 2, `happy-dom` 21, `pixelmatch` 8, `oxc-parser` 0.159, `oxlint` 1.94 + `oxlint-tsgolint` 7.0.2008, Playwright 1.65 | Each needs a source or config migration and its own verification |
| 4. Visual/developer extras | `@crvy/rprtr` 0.4.6, `@crvy/strybk` 0.0.10, `@opencode-ai/*` 1.19.6, `@stryker-mutator/core` 10.1.1, `@grammyjs/types` 5.1.0 | Low-coupling tools; verify after the runtime and visual stack settle |

Alternative considered: one all-at-once bump. Rejected because an AI SDK or MSW regression would be indistinguishable from a Storybook or lint regression, and a single revert would discard the safe work.

### D2 — AI SDK family is atomic

`ai` 7.0.179, `@ai-sdk/openai-compatible` 3.0.94, and `@ai-sdk/provider` 4.0.39 are updated in one commit. The AI SDK's patch releases add provider-spec fields (notably the portable `max` reasoning level, citation parts, `interrupted` finish reason, and extraction model support), and the provider packages must implement the same spec. Tests to run first: `tests/llm-orchestrator*`, `tests/tools/disclosure*`, `tests/run-control*`, `tests/long-term-memory*`, `tests/web/distill*`, and provider/model-builder suites. The codebase uses no `experimental_` AI SDK APIs, so no compatibility shim is required.

Deprecations checked and not used: `Experimental_LanguageModelStreamPart`, `experimental_filterActiveTools`, `system` in `prepareStep`, `rawInput` in output-error parts, the `experimental_lowMemory` flag, and `evaluate`/`decide`.

The one behavioral fix worth pinning in tests: `prepareStep`-returned message arrays are now copied per step (7.0.178). Papai's steering prepare-step already returns a fresh array (`src/run-control/steering-prepare-step.ts`), so the expected behavior is unchanged, but the steering tests should assert no queue duplication.

### D3 — MSW 3 migration is a source change, not a version bump

MSW 3 is ESM-only, requires Node 22+/TypeScript 5.9+, removes `handleRequest()` and `msw/native`, and renames the unhandled-network option to `onUnhandledFrame`. The addon v3 uses a new architecture and ships a migration guide plus codemods.

Concrete edit: `.storybook/preview.ts` uses `worker.start({ onUnhandledRequest: 'bypass' })`; it becomes `worker.start({ onUnhandledFrame: 'bypass' })`. The `mswLoader`/`context.msw` composition in the same file and `client/stories/decorators/withFixtures.ts` are re-checked against the addon v3 `MswApi` type. Story handlers (`http`, `HttpResponse`, `delay`) are unchanged. `worker.stop()` now returns a promise; no current call site ignores it.

Alternative considered: stay on MSW 2. Rejected because the addon v3 and MSW 3 are coupled, and the refresh would otherwise leave the story harness two majors behind.

### D4 — unpdf 2 is accepted, call sites stay

`src/web/pdf.ts` uses only `getDocumentProxy` and `extractText(document, { mergePages: true })`, both present in unpdf 2 with the same overloads. The removed APIs (`configureUnPDF`, `resolvePDFJSImport`, `createIsomorphicCanvasFactory`) are not used. unpdf 2 is ESM-only and declares Node ≥ 24; Bun 1.4 is the runtime, so the engine declaration is informational. The bundled serverless PDF.js build remains the default, so no `pdfjs-dist` peer install is required. `tests/web/pdf.test.ts` already mocks the two functions through DI and validates the merged-text path.

Alternative considered: pin unpdf 1.9. Rejected because the 2.x line carries the PDF.js 6 security and correctness fixes and the call sites are compatible.

### D5 — pixelmatch 8 affects figma:verify only

pixelmatch 8 replaces YIQ with OKLab/HyAB, so identical thresholds produce different diff counts. In this repository the package is imported only by `scripts/figma-connect-lib.ts` (`DEFAULT_COMPARE_THRESHOLD = 0.1`); Playwright's `toHaveScreenshot` comparator is bundled inside Playwright and does not resolve the project's dev dependency. Therefore:

- Recalibrate only the Figma threshold, from a known-good and a known-bad render pair, and record the measured ratio change.
- The new `windowSize` option can suppress scattered anti-aliasing noise without hiding compact changes; `ignoreMask` is not needed by the current story/Figma pair.
- Do not change `playwright.config.ts`'s 0.2/0.02 thresholds for this bump; they belong to Playwright's own comparator. If Playwright 1.65 changes screenshots, treat that as a separate visual-baseline review under D1's Playwright task.

Measured on 2026-11-22 against a 1280x720 story baseline: identical renders diff 0 under both metrics; a real change covering 12.8% of the image measured 128000/921600 = 0.138889 under both; a 10% global tint measured 0 pixels under v7 and 122 pixels under v8 (ratio 0.000132); a 15% tint measured 0.978 under both. The default 0.1 keeps the known-good pass and the known-bad fail, so the threshold and `windowSize` stay unchanged.

Alternative considered: keep pixelmatch 7. Rejected because the Figma verification loop benefits from the corrected metric, and the recalibration is a one-time cost.



### D6 — oxc-parser moves as an exact pin

`package.json` pins `"oxc-parser": "0.147.0"`; it becomes `"0.159.0"` (still exact). The 0.159 release includes a breaking AST change (`LabelId` on `LabelIdentifier`). `src/ts-ast/source-parser.ts` walks with the package's `visitorKeys` and does not inspect label identifiers, so the expected change is type-only. Verification: `tests/plugins/discovery-import-scan*`, `tests/story/*`, and the story-manifest smoke tests, which exercise every `walkNodes` path.

Alternative considered: caret range. Rejected: oxc 0.x minors break the AST and the seam is a frozen story-enforcement input.

### D7 — zod 4.6 is verified through the JSON-Schema tests

Zod 4.6 narrows `z.toJSONSchema()` output (chained checks no longer overwrite each other; email/base64 patterns change), drops numeric enum reverse mappings, and adds `.validate()`, `z.properties()`, `z.iban()`, and `z.withParser()`. Papai has no numeric enums or base64 schema usage; `toJSONSchema` is used in tool-schema tests. Those tests are the acceptance gate. `.validate()` is a follow-up optimization, not part of the bump.

### D8 — Stryker runner stays pinned

`@hughescr/stryker-bun-runner` 1.4.0+ supports Stryker 10 natively, which makes the local patch obsolete in principle, but 1.5/1.6 declare `typescript < 7` and their README states that Stryker's config reader fails against TypeScript 7 (`ts.parseConfigFileTextToJson`). The project must keep TypeScript 7.

Decision: keep `@hughescr/stryker-bun-runner@1.3.8` and `patches/@hughescr%2Fstryker-bun-runner@1.3.8.patch`, update `@stryker-mutator/core` to 10.1.1 (the patch's peer range already admits it), and run `bun run test:mutate:changed` as the gate. Revisit when the runner supports TypeScript 7 or when the project adopts the README's `@typescript/native` alias with TypeScript 6 for Stryker.

Alternative considered: downgrade TypeScript to 6. Rejected: the project's typecheck, lint tsgolint pass, and CI are built around TypeScript 7.

### D9 — oxlint and oxlint-tsgolint move together

`oxlint-tsgolint` jumps 0.22.1 → 7.0.2008 (the 7.x line is declared stable and aligned with the TypeScript 7 native checker). `.oxlintrc.json` enables `options.typeAware` and `options.typeCheck`, so the two binaries are a pair. Bump `oxlint` to 1.94.0 and `oxlint-tsgolint` to 7.0.2008 in one commit, then run `bun run lint` and the standalone `bun run typecheck` to compare diagnostics. Do not add disable comments; fix findings or record a rule-level decision.

New rule options worth enabling only if they surface real issues: `typescript/no-misused-promises` `flagUnions`, `eslint/no-redeclare` `ignoreDeclarationMerge`, and `promise/prefer-catch` suggestions.

### D10 — Low-risk feature adoptions only

These are safe, opt-in, and do not change runtime behavior:

- `@crvy/rprtr` 0.4.6 `reportOnlyFailedTests: true` for CI artifacts (reporter config in `playwright.config.ts`).
- `@crvy/strybk` 0.0.10 waits for Storybook preview readiness — adopt by bumping; no config change expected.

Playwright 1.65's `onlyFailures` is recorded as a candidate because the project currently uses only the `list` and rprtr reporters; adopting it would mean adding an HTML/JSON/JUnit artifact path first.

Everything else in the release notes is recorded as a follow-up candidate below.

### D11 — Hold @types/bun and unused-dependency removal

`@types/bun` 1.4.5 would type APIs that CI/Docker (Bun 1.4.0) may not have. Hold at 1.4.0 until the runtime pin moves. `ink`, `ink-testing-library`, and `dependency-cruiser` have no static consumer in the repository (`bun pm why` shows only the direct dev entry), but knip currently does not flag them; removal is deferred to a cleanup change with its own evidence so this refresh stays scoped to version movement.

### D12 — Scope model and tool_prefs impact: none

No persisted state shape, config key, tool name, or scope id changes. `tool_prefs` resolution and capability gating are untouched. The only source-adjacent edits are the Storybook loader option and Playwright reporter config; neither is in the papai runtime.

### Deprecation audit

| Deprecated / removed API | Target package | Papai usage | Action |
| --- | --- | --- | --- |
| `onUnhandledRequest` → `onUnhandledFrame` | `msw` 3 | `.storybook/preview.ts:68` | **Migrate** the option name |
| Old addon architecture (`initialize` flow) | `msw-storybook-addon` 3 | `.storybook/preview.ts` `mswLoader` composition | **Migrate** per addon v3 guide |
| `configureUnPDF`, `resolvePDFJSImport`, `createIsomorphicCanvasFactory` | `unpdf` 2 | Not used; `src/web/pdf.ts` uses only `getDocumentProxy`/`extractText` | None |
| `disableCSSFileLoading` | `happy-dom` 21 | Not used | None |
| `markdownTable` rename in the rich API | `@gramio/format` 0.12 | Not used; only `markdownToFormattable` | None |
| `fontSize` render option; experimental CT packages | Playwright 1.64/1.63 | Not used | None |
| `formatters.level` with multi-target transports | `pino` 10.4 | Not used (`pino.multistream` without formatters) | None |
| Numeric enum reverse mappings in `z.enum` | `zod` 4.6 | No numeric enums; `toJSONSchema` tests use object/string schemas | Verify tests |
| `Experimental_LanguageModelStreamPart`, `experimental_filterActiveTools`, `system` in `prepareStep`, `rawInput`, `experimental_lowMemory` flag, `evaluate` → `decide` | `ai` 7.0.x | None used | None |
| `LabelId` AST shape on `LabelIdentifier` | `oxc-parser` 0.159 | `src/ts-ast/source-parser.ts` walks generically, no label inspection | Verify scanner tests |
| Exact `@opencode-ai/plugin` pin against floating SDK | `@opencode-ai/*` | Root and `opencode-agent` manifests | **Sync** both to 1.19.6 |
| `typescript < 7` peer of the Stryker runner | `@hughescr/stryker-bun-runner` 1.4+ | Project pins TypeScript 7.0.2 | **Hold** 1.3.8 + patch |

## Release-note findings

### Runtime dependencies

| Package | Target | Findings relevant to papai |
| --- | --- | --- |
| `ai` | 7.0.179 | Native steering (`experimental_createSteering`, `steer`, `queue`, `interrupt`), native tool search, tool approvals, `onStepError`, `filterActiveTools` graduation, configurable tool concurrency, `streamRetries`, `interrupted` finish reason, portable `max` reasoning. Deprecations: `Experimental_LanguageModelStreamPart`, `experimental_filterActiveTools`, `system` in `prepareStep`, `rawInput`, `experimental_lowMemory` flag, `evaluate` → `decide` — none used. |
| `@ai-sdk/openai-compatible` | 3.0.94 | Per-request credential callbacks, `prepareRequest`/`convertResponse`, model capability catalog, portable `max` reasoning, embedding dimensions, streamed tool-call ID fixes, empty-choice errors, reasoning-stream contiguity. No deprecations in use. |
| `@ai-sdk/provider` | 4.0.39 | Extraction model spec, provider-owned realtime transports, citation parts, `interrupted` finish reason, `max` reasoning, file metadata/download/delete extensions. No deprecations in use. |
| `@modelcontextprotocol/sdk` | 1.32.2 | v1.x fixes only: registration after connect when the capability was declared, explicit `undefined` on transport optionals. v2 exists as split packages (`client`, `server`, `core`) but `latest` is still 1.32.2. |
| `@gramio/format` | 0.12.1 | Adds native rich tables, `rawRich`, and the rich-message DSL; `markdownTable` renamed in the rich API. `markdownToFormattable` (papai's only import) is unchanged. |
| `ai-tokenizer` | 1.0.7 | No published changelog; patch release. Verify token-count tests. |
| `defuddle` | 0.19.13 | YouTube caption/transcript fixes, X redesign extraction, largest `srcset` selection, unsafe-link sanitization, large-page performance. Directly improves `web_fetch`/`distill`. |
| `discord.js` | 14.28.1 | Invite target users/roles, file types, `BaseChannel.permissions`/`appPermissions`; 14.28.1 fixes interaction permission scoping. No breaking changes. |
| `drizzle-orm` | 0.45.4 | postgres-js prepared-query fix; 0.45.3 adds the Netlify DB driver (not used). Safe for SQLite. |
| `linkedom` | 0.18.15 | No published release notes; patch releases. Covered by web-fetch tests. |
| `marked` | 18.2.1 | Parser correctness and performance fixes (HTML blocks, emphasis delimiters, list/blockquote boundaries, quadratic scans). No API changes. |
| `p-limit` | 7.3.3 | Fixes unhandled rejections in `limit.map()` when the iterable throws. Matches the project's bounded-concurrency rule. |
| `pino` | 10.4.0 | Adds a warning for incompatible `formatters.level` with multi-target transports. Papai uses `pino.multistream` without `formatters.level`, so no change. |
| `rrule-temporal` | 2.3.0 | Adds `allDay`; 2.2.3–2.2.9 fix DST, BYWEEKNO, dense-rule heap use, and make unbounded `next()`/`previous()` 30–120× faster. Correctness fixes mean stored occurrences from affected sub-daily rules may need regeneration. |
| `svelte` | 5.59.1 | 5.59 adds a custom renderer API; 5.58 adds devtools metadata; patch fixes cover hydration, forks, async deriveds. Settings SPA needs no migration. |
| `unpdf` | 2.2.1 | **Breaking**: ESM-only, Node ≥ 24; removes `configureUnPDF`, `resolvePDFJSImport`, `createIsomorphicCanvasFactory`; page-grouped `extractLinks`; Uint8Array rendering; RGBA image extraction; `inspectPages`. Papai's two call sites are compatible. |
| `vite` | 8.3.8 | Rolldown 1.2.18, plugin-container and CSS/dynamic-import fixes. No config migration. |
| `zod` | 4.6.7 | `.validate()` (up to 35× faster invalid path), `z.properties()`, `z.iban()`, `z.withParser()`, stricter `fromJSONSchema`, recursive-schema memory fix. Behavioral: numeric enum options lose reverse mappings, base64/email patterns change, chained checks no longer overwrite JSON Schema bounds. |

### Dev dependencies

| Package | Target | Findings relevant to papai |
| --- | --- | --- |
| `@crvy/rprtr` | 0.4.6 | Adds `reportOnlyFailedTests` for CI artifacts, offline report metadata, debug-mode launch evidence. Adopt the option in `playwright.config.ts`. |
| `@crvy/strybk` | 0.0.10 | Waits for Storybook preview readiness before extracting stories; vitest browser-mode improvements. Adopt via bump. |
| `drizzle-kit` | 0.31.11 | Warns about silent migration skips in `drizzle-kit check`; verify the migration check output is clean. |
| `@grammyjs/types` | 5.1.0 | Type-only release; no runtime change. Verify chat rendering tests after the `@gramio/format` bump. |
| `@happy-dom/global-registrator` / `happy-dom` | 21.0.4 | **Breaking**: CSS/iframe loading off by default (SSRF), `disableCSSFileLoading` deprecated in favor of `enableCSSFileLoading`/`enableIframePageLoading`. Papai registers a plain window and does not load CSS/iframes in tests. |
| `@hughescr/stryker-bun-runner` | hold 1.3.8 | 1.4+ supports Stryker 10 but declares `typescript < 7`; Stryker's config reader fails on TypeScript 7. Keep the local peer-range patch. |
| `@opencode-ai/plugin` / `@opencode-ai/sdk` | 1.19.6 both | Same peer/dependency shape as 1.18.25 (Effect 4 beta, OpenTUI peers, zod 4.1.8); plugin pins its SDK exactly, so both move together. |
| `@playwright/test` | 1.65.1 | Visible-only `locator.visible()`, `onlyFailures` reporters, WebMCP, trace aria/screen snapshots, `test.step` subtitle/params. Node 20 dropped; Bun caveats: no watch mode, `--tsconfig` and JSX options ignored. Papai's config does not rely on those. |
| `@storybook/*` / `storybook` | 10.6.8 / 5.1.6 | Manager preloading performance, telemetry/community fixes, code-snippet crash fixes. Stay on 10.x (11 is beta). |
| `@stryker-mutator/core` | 10.1.1 | Shared-cache startup race fix, Babel 8 non-null instrumentation fix. Compatible with the patched runner. |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | `dynamicCompileOptions` receives the Vite environment; inspector fixes. |
| `@types/bun` | hold 1.4.0 | Align with CI/Docker Bun 1.4.0, not npm 1.4.5. |
| `@types/react` / `react` | 19.3.0 / 19.3.1 | React 19.3 is required by ink 8 (unused); Storybook icons peer allows 19. Safe to update. |
| `dependency-cruiser` | 18.8.0 | No configured consumer in this repo; treat as cleanup candidate, not an update target. |
| `ink` / `ink-testing-library` | 8.0.0 / 4.0.0 | Ink 8 requires React 19.3, drops TTY-only stream types, removes unrecognized control sequences from `useInput`. No importer exists; removal candidate. |
| `jscpd` | 5.4.3 | New similarity kinds (`exact`/`renamed`/`similar`/`semantic`), `--ignore-identifiers` semantics changed, health/dashboard reporters, no second process in API mode. Duplicate gate may need re-baselining. |
| `knip` | 6.47.0 | Duplicate default-export reporting, new plugins, config-file precedence. `duplicates: error` is already on. |
| `msw` / `msw-storybook-addon` | 3.0.7 / 3.0.3 | **Breaking**: ESM-only, Node 22+/TS 5.9+, `onUnhandledFrame`, `msw/utils`, Vite plugin, path-to-regexp → `@msw/url`; addon v3 new architecture with codemods. |
| `oxfmt` | 0.79.0 | HTML/Vue formatting became oxc-parser-based (0.76/0.77 breaking for those languages). Repo has HTML (settings/admin/debug/transcript, Storybook head) but no Vue; run `bun run format` and review the diff. |
| `oxlint` | 1.94.0 | `no-misused-promises` `flagUnions`, recommended flag in `--rules` JSON, `prefer-catch` suggestion, `no-redeclare` `ignoreDeclarationMerge`; starts tsgolint before the regular pass. |
| `oxlint-tsgolint` | 7.0.2008 | 7.x is the declared-stable, TypeScript 7-era line; improved `no-floating-promises`/`no-unnecessary-*` diagnostics. Must move with oxlint. |
| `pixelmatch` | 8.0.0 | **Breaking metric**: OKLab/HyAB replaces YIQ; adds `windowSize` and `ignoreMask`; exact diff counts change. Re-baseline the `figma:verify` threshold only; Playwright's comparator is bundled. |
| `vite` (client) | 8.3.8 | See runtime row; no config migration. |

## Feature candidates (declined for this change)

Each needs its own proposal because it changes observable behavior or the spec surface:

| Candidate | Source | Papai fit | Why deferred |
| --- | --- | --- | --- |
| Native AI SDK steering | `ai` 7.0.154–7.0.177 | Replaces `src/run-control/steering-prepare-step.ts`; adds `interrupt: true` cancellation before output and `queue()` after-task delivery | Changes mid-run-steering semantics; needs a spec delta and tests for delivery outcomes |
| SDK tool approvals | `ai` 7.0.x | Could replace the `_permission_reason` ask wrapper in `src/tools/permission-gate.ts` | Approval replay and `tool_prefs` interaction need design |
| Native tool search | `ai` 7.0.104/7.0.127 | Could replace `search_tools`/`load_tool` disclosure; custom embedding retriever is richer | Must prove parity with the embedding retriever and fallback latch |
| `filterActiveTools` | `ai` 7.0.157 | Simplify disclosure's manual active-tool intersection | Small follow-up after the SDK bump |
| Step-error/stream-retry hooks | `ai` 7.0.91/7.0.154 | `onStepError`, `streamRetries`, `interrupted` finish reason | Resilience behavior needs deltas and failure-injection tests |
| Tool execution concurrency | `ai` 7.0.140 | Speed up independent read tools | Tool-side-effect ordering must stay deterministic |
| Portable `max` reasoning | `ai` 7.0.129 / provider 4.0.23 | Expose in the LLM config | Settings-UI + per-context config change |
| Typed AI SDK errors | `ai` 7.0.100 | Map to structured tool failures | Error taxonomy change |
| `prepareRequest`/`convertResponse` | openai-compatible 3.0.88 | Contract tests and diagnostics without network | Tooling-only; no behavior change |
| Gramio rich DSL | `@gramio/format` 0.12 | Telegram rich outbound | Already owned by `telegram-rich-outbound-rollout` |
| Zod `.validate()` | zod 4.6 | Hot-path validation without result allocation | Performance-only optimization |
| rrule `allDay` | rrule-temporal 2.3 | Date-only recurrence | Recurrence spec/UI change |
| unpdf `inspectPages`/`extractImages` | unpdf 2.2 | Scanned-PDF detection and image extraction | Web-fetch feature expansion |
| discord.js channel permissions | discord.js 14.28 | Simpler permission checks | Adapter refactor |
| Playwright `locator.visible()` / `onlyFailures` | Playwright 1.63/1.65 | Less brittle visual locators; failure-only CI artifacts | Test-only cleanup; no HTML/JSON reporter path exists today |

## Risks / Trade-offs

- **AI SDK 7.0.178 copies `prepareStep` messages** → Steering tests assert queue drain and no duplicate injection; if behavior shifts, adjust `composePrepareSteps` rather than patching the SDK.
- **MSW 3 addon migration breaks story fixtures** → Use the addon codemods, then run `bun run test:stories` and capture one screenshot per app area before/after.
- **unpdf 2's Node 24 engine on Bun 1.4** → `bun test tests/web/pdf.test.ts` and one real PDF fixture in the smoke lane; if Bun's PDF.js path differs, pin unpdf 1.9.1 as the rollback.
- **pixelmatch 8 changes `figma:verify` counts** → Recalibrate the 0.1 default from known-good/known-bad pairs, inspect the recorded ratio, and leave Playwright's bundled comparator thresholds alone.
- **oxfmt HTML/Vue reformat churn** → Run `bun run format` in its own commit; reject any semantic change hidden in whitespace.
- **jscpd 5.4 changes duplicate counts** → Run `bun run duplicates` before/after, record the new baseline, and keep the 10% threshold unless the new metric proves it wrong.
- **oxlint/tsgolint major surfaces new type-aware findings** → Fix findings; if a rule is genuinely wrong, change the rule level with a recorded reason, never an inline disable.
- **`@gramio/format` rich API break** → Papai imports only `markdownToFormattable`; verify `src/chat/telegram/format.ts` tests and do not adopt the rich DSL here.
- **`@opencode-ai/plugin` 1.19.6 dependency churn** → Run `bun run opencode-agent:test`, `opencode-agent:typecheck`, and the hook tests after the sync.
- **Stryker runner patch stays** → `bun run test:mutate:changed` remains the gate; the patch is unchanged, so mutation behavior should not move.

## Migration Plan

1. **Baseline.** On a clean checkout: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run check:full`, `bun run test:stories`, and `bun run duplicates`. Persist the reports for comparison.
2. **Wave 1.** Bump safe minors; run `bun run check:full` plus affected tests. Commit.
3. **Wave 2.** Bump the AI SDK family; run the LLM, disclosure, steering, memory, distill, and model-builder suites, then `bun run typecheck`. Commit.
4. **Wave 3.** One commit per major:
   - MSW/addon + `.storybook/preview.ts` option rename → story tests.
   - unpdf 2 → PDF tests + smoke.
   - happy-dom 21 + registrator → client tests.
   - pixelmatch 8 → `figma:verify` threshold evidence; Playwright screenshots are checked separately under the Playwright 1.65 task.
   - oxc-parser 0.159 → plugin/story scanner tests.
   - oxlint/tsgolint → lint/typecheck diff.
   - Playwright 1.65 → visual test run.
5. **Wave 4.** `@crvy/*`, `@opencode-ai/*`, Stryker core, grammy types; run the corresponding workspace checks.
6. **Cleanup.** `bun pm why`/knip audit, remove only proven-dead deps (separate commit), update `docs/architecture/storybook-screenshots.md` if reporter behavior changed.
7. **Rollback.** Revert the wave commit and run `bun install --frozen-lockfile`; each wave is independent, so no cross-wave revert is required.

## Open Questions

- Whether to raise the CI/Docker Bun pin to 1.4.5 in a follow-up, which would let `@types/bun` move too.
- Whether `ink`/`ink-testing-library`/`dependency-cruiser` should be removed or are reserved for an in-flight TUI/architecture change.
- Which feature candidate should be the first follow-up proposal; native steering has the clearest user-visible payoff.
