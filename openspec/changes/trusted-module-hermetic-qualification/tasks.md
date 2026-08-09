<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Trusted-module hermetic qualification (residual)

## 1. Missing frozen stories

- [ ] 1.1 Write
      `tests/stories/integrations/runtime-extensions/lifecycle.story.test.ts`:
      extension cleanups run once in reverse order; a failing extension
      start leaves no residue for the next scenario. Register scenarios in
      the catalog ledger under the `SCN-coding-acp-*` convention.
      Verify: `bun test:stories -- tests/stories/integrations/runtime-extensions`
- [ ] 1.2 Write
      `tests/stories/settings/runtime-extension-settings.story.test.ts`:
      denied actor rejected, persisted write survives, next-turn contract
      holds. Register scenarios in the ledger.
      Verify: `bun test:stories -- tests/stories/settings`
- [ ] 1.3 Baseline green: `bun test:stories:contracts`,
      `bun test:stories:manifest`, `bun run typecheck`.
      Verify: all pass

## 2. Branch qualification (Task 5; after the sibling proof change's baseline)

- [ ] 2.1 On `plugin-core-separation`: prove the frozen tree byte-identical via `git diff --exit-code $BASELINE_SHA -- tests/stories`; then iterate `bun test:stories:compat` until green, fixing only `src/` composition/plugins.
      Verify: compat green on the branch
- [ ] 2.2 Full qualification suite on the branch: `bun test:stories`,
      `bun test:stories:stress`, architecture guard, `bun run typecheck`.
      Verify: all pass

## 3. Gate

- [ ] 3.1 Full `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check` on master after story additions.
      Verify: all pass
