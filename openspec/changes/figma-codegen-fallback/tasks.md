# figma-codegen-fallback — tasks

## 1. Registry core (TDD)

- [x] 1.1 Write failing tests for registry loading + schema validation (zod v4): required base-kit entries (`ui/Btn`, `ui/Input`, `ui/Field`, `ui/PageHeader`, `ui/SidebarLink`, `ui/TopBar`), each entry has node id / source / props / values, section entries reference a registered screen. Verify: `bun test tests/scripts/figma-connect.test.ts` fails
- [x] 1.2 Create `scripts/figma/registry.json` with the six base-kit component entries and the current node ids (19:35, 22:45, 22:47, 22:52, 22:62, 22:65). Verify: step 1.1 tests pass
- [x] 1.3 Implement registry loading/validation module (`scripts/figma-connect-lib.ts`): load, zod-parse, check every source path exists on disk; export `canonicalDescription(entry)` producing the `CODE:` format. Failing test first for each (missing source → named error; canonical format snapshot). Verify: `bun test tests/scripts/figma-connect.test.ts`

## 2. figma:connect CLI

- [x] 2.1 Write failing tests for the CLI core: `validate` (headless: registry vs repo) returns named failures; `plan` emits the per-node description payloads without touching Figma. Verify: tests fail
- [x] 2.2 Implement `scripts/figma-connect.ts` with `validate` and `plan` subcommands (headless) plus a documented agent-run push path (skill references `plan` output via `use_figma`); add `figma:connect` to package.json. Verify: step 2.1 tests pass, `bun run figma:connect validate` exits 0 on the current registry
- [x] 2.3 Wire `figma:connect` into `docs/architecture/commands.md` next to the `figma:sync` bullet. Verify: manual read

## 3. figma-codegen skill

- [x] 3.1 Write `.claude/skills/figma-codegen/SKILL.md`: mandatory-before-use declaration, `CODE:` description parsing protocol, live-source resolution, prop/value translation via registry, screen section composition, drift surfacing rule, and the instruction to run `bun run figma:connect plan` + push when descriptions are missing or stale. Verify: manual read against specs/figma-codegen-skill requirements
- [x] 3.2 Add the routing-table row to CLAUDE.md (and the skills list it participates in). Verify: manual read

## 4. Verification loop (TDD)

- [x] 4.1 Add `pixelmatch` + `pngjs` devDependencies to package.json and justify in the PR description (design Decision 5). Verify: `bun install` clean, `bun run knip` reports no unused deps
- [x] 4.2 Write failing tests for the compare core in `scripts/figma-connect-lib.ts`: diff of identical PNGs → pass with measured 0; diff beyond threshold → failure with artifact path; missing render → explicit skip result. Verify: tests fail
- [x] 4.3 Implement the compare core (decode both PNGs, normalize scale, pixelmatch, write diff artifact under `reports/figma-verify/`). Verify: step 4.2 tests pass
- [x] 4.4 Write failing tests for the `figma:verify` CLI arg parsing (`--story`, `--figma` PNG path or node id, `--threshold`), then implement `verify` subcommand producing the report. Verify: `bun test tests/scripts/figma-connect.test.ts`, then a manual smoke: `bun run figma:verify --story <existing baseline> --figma <same PNG>` passes with 0 diff
- [x] 4.5 Document the loop in `docs/architecture/storybook-screenshots.md` ("Verifying generated code against designs"). Verify: manual read

## 5. Screen-section registry entries

- [x] 5.1 Extend `scripts/figma/registry.json` with section entries for the five editable screens (22:198, 23:58, 23:103, 25:133, 25:221) mapping registered sections to their Svelte regions; extend zod schema + validation tests first (section entries require a `section` name and screen reference). Verify: `bun test tests/scripts/figma-connect.test.ts`
- [x] 5.2 Run the agent push: `bun run figma:connect plan`, apply descriptions to all mapped Figma nodes via `use_figma`, re-run plan to confirm idempotence (no changes). Verify: `bun run figma:connect plan` reports zero pending; spot-check one description in Figma

## 6. Full verification

- [x] 6.1 Run full `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run format:check`. Verify: all green
- [x] 6.2 Update `docs/architecture/commands.md` and `docs/architecture/storybook-screenshots.md` for any drift that emerged during implementation; confirm CLAUDE.md routing row is accurate. Verify: manual read
