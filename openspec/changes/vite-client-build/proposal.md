# vite-client-build — consolidate the client build on Vite

## Goal

Replace the hand-written `Bun.build` Svelte pipeline (`scripts/build-client.ts` + `scripts/svelte-plugin.ts`) for production client bundles with Vite 8 + `@sveltejs/vite-plugin-svelte` — both already devDependencies, already proven by `.storybook/main.ts`. This deletes the duplicate production Svelte compilation path and gives `client/` a dev server with HMR.

## Stated assumptions

- `scripts/svelte-plugin.ts` cannot be deleted outright: `bun test` needs a **Bun runtime** loader for `.svelte` / `.svelte.ts` (client unit tests via the `tests/client-setup.ts` preload, and the Stryker path in `tests/setup.ts` gated by `PAPAI_SVELTE_TEST_PLUGIN=1`); Vite cannot fill that role inside `bun test`. Its **production** role is deleted; it is rescoped as a test-runtime-only loader (relocated under `tests/` or kept with a test-only contract — follow knip/lint outcome).
- Output artifacts keep their exact current contract so downstream consumers (CI `public/` artifact upload in `ci.yml`/`story-stress.yml`, `scripts/ensure-client-built.ts`, debug/settings server suites, `scripts/check-bundle-isolation.ts`) are untouched.

## Files to touch

- **Add `vite.config.ts`** (root): `svelte({ preprocess: vitePreprocess() })`, aliases `@client`/`@src` (mirror `.storybook/main.ts`), `build.minify: false` — `check-bundle-isolation.ts` greps unminified identifier markers and its own comment demands marker changes if minification ever lands — `outDir` from `CLIENT_BUILD_OUTDIR` defaulting to `public/`.
- **Rewrite `scripts/build-client.ts`** to drive `vite build` once per bundle (rollup IIFE with the existing 4-entry `BUNDLES` table: debug/admin/settings/transcript), keeping `PUBLIC_DIR`, HTML copies, CSS assembly order (tokens.css → base.css → local css → component-scoped), and the non-empty-output guard. Component CSS arrives via Vite's CSS pipeline instead of `collectCss`.
- **Rescope the loader**: remove its production import from `build-client.ts`; update `tests/client-setup.ts` and `tests/setup.ts` to the relocated test-only loader.
- **Update `tests/scripts/build-client.test.ts`**: same assertions (IIFE shape — starts with `(`/`!`, no ESM syntax; artifacts present; `CLIENT_BUILD_OUTDIR` override; `PUBLIC_DIR` default) against the Vite build.
- **`package.json`**: keep `build:client`; add `dev:client` (`vite`) for HMR.
- **`.storybook/main.ts`**: drop the "no root vite.config" workaround (splice/comments) if Storybook's vite config loading picks up the root config cleanly — verify, don't assume; otherwise leave untouched.
- **Docs**: `docs/architecture/commands.md` (`build:client` internals, new `dev:client`); `docs/architecture/storybook-screenshots.md` only if the Storybook config change lands.

## Intended behavior change

- `bun build:client` emits contract-identical artifacts: `public/{debug,admin,settings,transcript}.{js,html,css}`, JS in IIFE format, CSS layering unchanged, `CLIENT_BUILD_OUTDIR` override unchanged.
- New: `bun dev:client` runs the Vite dev server over `client/` with Svelte HMR.
- One Svelte compilation pipeline (Vite's) for production build, Storybook, and dev; the hand-written loader survives only as the `bun test` runtime shim.

## Non-goals

- Migrating client unit tests off `bun test` (e.g. to vitest); the Bun test-runtime Svelte loader stays.
- Enabling minification, changing bundle naming/serving, or any `src/` static-serving behavior.
- Replacing Storybook's builder or addons.

## Capabilities

None — skip_specs proposed because this is build-tooling consolidation: the served artifacts' contract (files, format, runtime behavior) is unchanged, no downstream-observable requirement is added, changed, or removed, and the only new surface (the Vite dev server) is developer tooling.

## Verification

- `bun build:client && bun run check:bundle-isolation`
- `bun test tests/scripts/build-client.test.ts`
- `bun run test:client` (loader rescope holds)
- `bun run build:storybook` if `.storybook/main.ts` is touched
- `bun run typecheck && bun run lint && bun run knip`
- Final task: full `bun run test` + update affected `docs/architecture/*.md`
