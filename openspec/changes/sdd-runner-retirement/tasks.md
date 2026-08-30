<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## 1. Pricing re-home (D1)

- [x] 1.1 Move `sdd-runner/src/pricing.ts` → `opencode-agent/src/pricing.ts` and `tests/sdd-runner/pricing.test.ts` → `tests/opencode-agent/pricing.test.ts` (verbatim; suite path updates only), repoint the three importers (`opencode-agent/src/model-metadata.ts`, `tests/opencode-agent/model-metadata.test.ts`, `tests/opencode-agent/test-helpers.ts`). Verify: `bun run opencode-agent:test && bun run opencode-agent:typecheck`
- [x] 1.2 Rewrite the documented boundary in `opencode-agent/CLAUDE.md` (the "reader is `sdd-runner/src/pricing.ts`" bullets) and the README/ROADMAP mentions to the in-workspace module. Verify: `rg -n "sdd-runner" opencode-agent/ | grep -v CHANGELOG` returns only historical/provenance mentions or nothing

## 2. Deletion sweep (D2)

- [x] 2.1 Pre-flight gate — re-run the repo-wide reader search and confirm the inventory: `rg -ln "sdd-runner" --glob '!sdd-runner/**' --glob '!tests/sdd-runner/**' --glob '!reports/**'` shows no code reader outside the files this change edits (the one known reader closed by 1.1). Verify: the command's output matches the change's inventory
- [x] 2.2 Drop the `sdd-runner` workspaces entry and all five `sdd-runner:*` aliases from `package.json`; regenerate the lockfile. Verify: `bun install && bun install --frozen-lockfile`
- [x] 2.3 `git rm -r sdd-runner tests/sdd-runner`. Verify: `bun run typecheck && bun run lint`
- [x] 2.4 Remove the two `COPY sdd-runner/package.json` lines from `Dockerfile` (deps + prod-deps stages). Verify: `rg -n "sdd-runner" Dockerfile` returns nothing
- [x] 2.5 Sweep the script/config surfaces: `knip.config.ts` ignore entry, the `sdd-runner/src` mapping branch in `scripts/mutation/coverage-map.ts` (test-first: update `tests/scripts/mutation/coverage-map.test.ts` expectations to red before the branch goes), the `sdd-runner/src/session-create-form.ts` key in `scripts/mutation/baseline.json`, the workspace list comment in `scripts/check.sh` (and `tests/scripts/check.test.ts` if it pins it). Verify: `bun run knip && bun test tests/scripts/`

## 3. Re-tighten (D3)

- [ ] 3.1 Delete the afk-runner ignore block and its justification comment from `scripts/detect-duplicates.ts`, leaving the pre-afk ignore list. Verify: `bun run duplicates` runs (result adjudicated in 3.2)
- [ ] 3.2 Adjudicate every duplication pair the un-ignored run surfaces: deduplicate tests honestly, or re-ignore the specific pair with its own frozen-corpus justification (never the old block's authority). Iterate until green. Verify: `bun run duplicates` exits 0

## 4. Naming honesty (D4)

- [ ] 4.1 Test-first: update the two header pins in `tests/afk-runner/work/materialize.test.ts` to the new producer string (red), then reword the two header constants in `afk-runner/src/work/materialize.ts` and the four "sdd-runner materializes"/GENERATED strings in `openspec/schemas/auto-sdd/schema.yaml` + `templates/{review,assumptions}.md`. Frozen fixtures stay byte-identical. Verify: `bun test tests/afk-runner/work/materialize.test.ts`

## 5. Docs + ledger

- [ ] 5.1 Update the CLAUDE.md doc-index rows (`sdd-pipeline.md` row: workspace deleted, process sections canonical; `afk-runner.md` row: fallback retired), the `sdd-pipeline.md` historical banner (workspace deleted at R5), and the TDD-hook scope line in `docs/architecture/commands.md` (drop `sdd-runner/src/`). Verify: `rg -n "sdd-runner" CLAUDE.md docs/architecture/commands.md` matches only historical/canonical mentions
- [ ] 5.2 Update `docs/architecture/afk-runner.md`: U9 ledger row → delivered (retirement half), the retirement-sequence paragraph → past tense with the revert-is-rollback note, the relaxation-window section → the jscpd re-tighten performed, and the R4 "one-line-revert fallback" claim retired. Verify: read-through of the four sections
- [ ] 5.3 Add the CHANGELOG entry. Verify: `bun run format:check`

## 6. Full verification

- [ ] 6.1 Full suite with the parity and memo oracles inside the sweep, then the standard gates and change validation: `bun run test && bun run typecheck && bun run lint && bun run format:check && openspec validate sdd-runner-retirement --strict`. Confirm `afk-runner:start` remains the operator entry (`bun run afk-runner:start -- --help` or equivalent smoke)
