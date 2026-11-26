# Design — vite-client-build

## Context

Production client bundles come from `scripts/build-client.ts` driving `Bun.build` per bundle (IIFE, fixed filenames) with `scripts/svelte-plugin.ts` compiling `.svelte`/`.svelte.ts` (`css: 'external'` + `collectCss`). CSS is hand-assembled (`tokens.css` → `base.css` → per-app css → component-scoped), HTML is copied verbatim, `CLIENT_BUILD_OUTDIR` overrides `public/`, and a non-empty-output guard exits non-zero. Artifact-contract consumers: `ci.yml`/`story-stress.yml` (`bun build:client` + `public/` upload), `scripts/ensure-client-built.ts` (`REQUIRED_BUNDLES`), the debug/settings server suites, and `scripts/check-bundle-isolation.ts`, which greps **unminified** marker identifiers. `.storybook/main.ts` already builds through Vite 8 + `@sveltejs/vite-plugin-svelte` 7 (both devDependencies) and carries a workaround for the absence of a root `vite.config.ts`. `bun test` cannot use Vite: the `.svelte` loader must be a Bun runtime plugin, registered by `tests/client-setup.ts` (client suites) and `tests/setup.ts` (Stryker path, `PAPAI_SVELTE_TEST_PLUGIN=1`). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- One Svelte compilation pipeline (Vite's) shared by production build, Storybook, and dev; the hand-written loader survives only as the `bun test` runtime shim.
- Contract-identical artifacts: same names (`{debug,admin,settings,transcript}.{js,html,css}`), IIFE JS, same CSS layering, same `CLIENT_BUILD_OUTDIR` semantics, same non-empty guard.
- Minimal orchestration diff: `scripts/build-client.ts` remains the single entry — CI, `ensure-client-built.ts`, and the script test keep invoking `bun scripts/build-client.ts` unchanged.

**Non-Goals** (design-level; scope boundaries live in the proposal):

- No Vite HTML-entry/MPA build: the hand-written HTML files (CSP meta, `defer` script, absolute `/x.css` link) are copied verbatim, never run through Vite's HTML pipeline.
- No hashed or split asset naming, no minification, no sourcemaps — `check-bundle-isolation.ts` depends on unminified identifier markers.
- No changes to how the servers serve `public/`, and no CI workflow edits (none needed — CI calls the `bun build:client` package script, whose command line does not change).

## Decisions

### D1 — Drive Vite's JS API from the existing script, once per bundle

`buildBundle()` calls Vite's programmatic `build()` per `BUNDLES` row (not the `vite` CLI, not one multi-entry pass) with inline overrides over the root config: single `rollupOptions.input`, `output: { format: 'iife', entryFileNames: jsName, inlineDynamicImports: true }`, `cssCodeSplit: false`, `minify: false`, `write: false`.

- *Why per-bundle:* Rollup emits one IIFE per single-entry output; keeping the 4-row `BUNDLES` table as the single source of truth preserves the per-bundle non-empty guard and HTML copy.
- *Why the JS API with `write: false`:* the in-memory `OutputBundle` yields the JS chunk bytes and the CSS chunk text with no intermediate files — the script writes `{jsName}` itself, applies the empty-output guard to the actual output string, and no stray Vite-named asset (`style.css`) can land in `public/` beside msw's `mockServiceWorker.js` and the `storybook-*.css` artifacts. `emptyOutDir: false` is still set in the shared config as belt-and-braces: Vite's default empties an in-root outDir, so per-bundle passes would delete each other plus the msw/storybook files.
- *Why not the CLI:* the four bundles need different entry/output names — four config variants or a generated config per spawn. The JS API keeps `CLIENT_BUILD_OUTDIR` resolution, guards, and HTML copies in one place.
- *Alternatives rejected:* one multi-entry build (Rollup cannot emit multiple IIFEs from one output; code-splitting/shared-chunk semantics would change the artifact shape); staying on `Bun.build` (no dev server/HMR — the motivation, per proposal.md).

### D2 — CSS assembly stays in the script; component CSS comes from Vite's CSS chunk

With `cssCodeSplit: false` and no plain-CSS imports anywhere in the client module graph (verified — plain CSS reaches pages only via the script's concatenation), Vite's single CSS chunk contains exactly the component-scoped styles — the same content class `collectCss` gathers today. The script keeps assembling `tokens.css` → `base.css` → per-app css → `/* component-scoped styles */ …` and writing `{cssName}`. This keeps the layering contract in explicitly ordered code the script test asserts around, instead of outsourcing order to Vite's asset graph.

### D3 — Root `vite.config.ts`, shared by build and dev

A new root config is required and no existing module covers the need — the repo has no Vite config; `.storybook/main.ts` configures only Storybook's builder. Contents: `svelte({ preprocess: vitePreprocess() })`, aliases `@client`/`@src` mirroring `.storybook/main.ts`, `build.minify: false`, `build.emptyOutDir: false`, `outDir` from `CLIENT_BUILD_OUTDIR` defaulting to `public/`. The build script layers per-bundle inline overrides on top; `dev:client` uses it as-is. One compilation setup, three consumers.

**Storybook interaction:** with a root config present, `@storybook/svelte-vite` feeds it into `viteFinal`, so the existing splice of `svelte()` would register the plugin twice. Plan: drop the splice/dynamic-import workaround, keep the alias/`fs.allow` merge, verify with `bun run build:storybook`; if double registration breaks, filter the incoming svelte plugins instead of reverting to the workaround. The proposal already gates this as verify-don't-assume.

### D4 — `dev:client` serves rewritten existing HTML; no file changes

The production HTML cannot drive HMR (`<script src="/x.js" defer>` points at built files). A dev-only plugin (`apply: 'serve'`) in `vite.config.ts` serves the four pages by rewriting the existing HTML in flight: the script tag becomes `<script type="module" src="/client/<app>/index.ts">`, the `/x.css` link becomes the three source stylesheets. Production HTML and `client/` sources stay byte-identical; drift is confined to two tag shapes on a dev-only path. *Alternatives rejected:* dedicated `*.dev.html` files (drift plus knip surface); converting production HTML to module scripts (changes the served artifact contract).

### D5 — Loader rescoped to `tests/`, production role deleted

`scripts/svelte-plugin.ts` moves to `tests/utils/svelte-plugin.ts` (relocation, not a rewrite); `tests/client-setup.ts` and `tests/setup.ts` update their imports; the `collectCss` option is dropped (its only consumer was the production build). Relocation over keeping the path with a comment: a `scripts/` module imported only by tests is ambiguous under `knip --strict`, and the path should carry the test-only contract structurally.

### Cross-cutting rules check

- **Capability/tool-prefs gating:** no new tool surface — no chat tools, no capability catalog or `tool_prefs` changes; `dev:client` is local developer tooling, never shipped or served in production.
- **Scope model:** no persisted state introduced; nothing is keyed by storage context, config context, platform instance, or user. The only run-scoped input remains `CLIENT_BUILD_OUTDIR`, semantics unchanged.
- **DB:** no schema changes, no migrations, no backfill.
- **Dependencies:** none added — `vite` and `@sveltejs/vite-plugin-svelte` are already devDependencies pinned by the Storybook toolchain; `Bun.build`/Grammy/Zod/drizzle cannot provide a Vite-plugin-compatible compilation pipeline or a dev server, which is the need.

## Risks / Trade-offs

- [Vite orders the component-CSS block differently than Bun's post-order `collectCss`] → the contract only requires component styles as the final layer; `tests/scripts/build-client.test.ts` gains a layering assertion (tokens before base before local) to pin what matters; intra-block order is not observable by the pages.
- [Storybook double-registers `svelte()` once the workaround is dropped] → D3's verification gate with a named fallback (filter incoming plugins); `bun run build:storybook` is in the proposal's verification list.
- [Mutation ratchet re-measures the rewritten `scripts/build-client.ts`; orchestration-heavy code can score below the per-file floor] → keep pure logic (`resolveOutDir`, CSS assembly, `BUNDLES`) small and asserted by the script test; if the measured score dips on the PR, follow the `scripts/mutation/README.md` baseline process rather than adding cosmetic tests.
- [`tests/setup.ts` is byte-frozen by story-refactor qualification snapshots] → editing it is normal development; the change lands on master and the freeze is re-recorded at the next qualification, same as any edit to that file.
- [Vite's Node-flavored JS API under the Bun runtime] → Storybook build/dev already run Vite under Bun in this repo, so the combination is proven; fallback is spawning `vite build` per bundle with an inline config — same D1 shape, worse ergonomics.

## Migration Plan

1. Land order, each step keeping `bun build:client` green: root `vite.config.ts` → update `tests/scripts/build-client.test.ts` first (new layering assertions red) → rewrite `scripts/build-client.ts` onto the Vite JS API (green) → relocate the loader and update the two test preloads → `dev:client` script + dev middleware → Storybook workaround removal only if `build:storybook` verifies clean → docs (`docs/architecture/commands.md`; `docs/architecture/storybook-screenshots.md` only if `.storybook/main.ts` changed).
2. Deploy: nothing — build tooling only. CI needs no workflow edit: `ci.yml` and `story-stress.yml` call the `bun build:client` package script, not the pipeline internals.
3. Rollback: single-commit revert restores the `Bun.build` pipeline; no data, config, or persisted state to unwind.

**Hook/TDD interactions:** the Write/Edit TDD hook pipeline gates implementation files under `src/` and `client/` — this change edits neither, so no test-first nudge fires; the once-per-session stop hooks do track `scripts/` edits. `tests/scripts/build-client.test.ts` is the covering test for `scripts/build-client.ts` and is written/extended before the rewrite. The relocated loader has no direct unit test by design — it is proven through `tests/client-setup.ts` by `bun run test:client`, and being under `tests/` it is not a hook-gateable implementation file.
