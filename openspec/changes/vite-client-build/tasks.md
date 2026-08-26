# Tasks — vite-client-build

## 1. Vite config foundation

- [x] 1.1 Add root `vite.config.ts`: `svelte({ preprocess: vitePreprocess() })`, aliases `@client`/`@src` (mirror `.storybook/main.ts`), `build.minify: false`, `build.emptyOutDir: false`, `outDir` from `CLIENT_BUILD_OUTDIR` defaulting to `public/`. Verify: `bun run typecheck && bun run lint`

## 2. Build script rewrite (test-first)

- [x] 2.1 Extend `tests/scripts/build-client.test.ts` first with CSS-layering assertions (tokens before base before local css before component-scoped block) alongside the existing IIFE/artifact/override assertions — red against the current build or green-by-contract before the rewrite. Verify: `bun test tests/scripts/build-client.test.ts`
- [x] 2.2 Rewrite `scripts/build-client.ts` to drive Vite's programmatic `build()` once per `BUNDLES` row (inline overrides: single input, IIFE output, `entryFileNames`, `inlineDynamicImports: true`, `cssCodeSplit: false`, `minify: false`, `write: false`); write the JS from the in-memory chunk with the non-empty guard; keep HTML copies and the CSS assembly (component CSS from the Vite CSS chunk); drop the `sveltePlugin` import. Verify: `bun build:client && bun run check:bundle-isolation && bun test tests/scripts/build-client.test.ts`
- [x] 2.3 Confirm `public/` retains no stray Vite-named assets (only the 12 contract artifacts plus pre-existing msw/storybook files). Verify: `git status --porcelain public` after a clean `bun build:client`

## 3. Loader rescope

- [x] 3.1 Relocate `scripts/svelte-plugin.ts` to `tests/utils/svelte-plugin.ts`, drop the now-unused `collectCss` option, and update imports in `tests/client-setup.ts` and `tests/setup.ts`. Verify: `bun run test:client && bun run knip`

## 4. Dev server

- [ ] 4.1 Add the dev-only HTML-rewrite middleware (`apply: 'serve'`) to `vite.config.ts` — rewrite the script tag to a module script pointing at `/client/<app>/index.ts` and the css link to the three source stylesheets for the four pages. Verify: start `bun dev:client`, load each page, confirm HMR on a component edit (manual check; tear down after)
- [ ] 4.2 Add the `dev:client` script (`vite`) to `package.json`. Verify: `bun run dev:client` boots and serves the four pages

## 5. Storybook interaction (conditional)

- [ ] 5.1 With the root config present, test dropping the `svelte()` splice/dynamic-import workaround from `.storybook/main.ts` (keep alias/`fs.allow` merge); if the plugin double-registers or the build breaks, fall back to filtering the incoming svelte plugins and leave a comment. Verify: `bun run build:storybook`

## 6. Docs and full gates

- [ ] 6.1 Update `docs/architecture/commands.md` (`build:client` internals now Vite-driven, new `dev:client`, loader relocation); update `docs/architecture/storybook-screenshots.md` only if task 5.1 changed `.storybook/main.ts`. Verify: read-back of the edited pages
- [ ] 6.2 Run the full gates: `bun run test` (full suite, not `test:affected`), `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run format:check`; fix any fallout. Verify: all green in `reports/checks/` and `reports/test/`
