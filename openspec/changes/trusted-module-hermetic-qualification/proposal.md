<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Trusted-module hermetic qualification (residual)

## Why

The runtime-extension seam, its `given.runtimeExtension()` API, the frozen
contribution stories, and the module-qualification story suites are shipped
and registered in the story catalog (as `SCN-coding-acp-*`). Three gaps
remain before the qualification arc is complete: two planned frozen story
files were never written, and the branch-side qualification (Task 5) —
rebasing `plugin-core-separation` onto the baseline and proving the frozen
tree passes unchanged — has not run.

## What Changes

- New frozen story
  `tests/stories/integrations/runtime-extensions/lifecycle.story.test.ts`:
  extension start/stop isolation — cleanups run once in reverse order,
  failed extension start does not leak into the next scenario.
- New frozen story
  `tests/stories/settings/runtime-extension-settings.story.test.ts`:
  authorization (denied actor), persistence, and next-turn contract for
  runtime-extension settings writes.
- Task 5 execution on the `plugin-core-separation` branch: after the
  sibling `hermetic-e2e-core-separation-proof` baseline lands, prove
  `git diff --exit-code $BASELINE_SHA -- tests/stories` (byte-identical
  frozen tree) and iterate `bun test:stories:compat` until green,
  repairing only `src/` plugin composition — never the frozen inputs.
- Full qualification suite afterward: `bun test:stories`,
  `bun test:stories:stress`, architecture guard, `bun run typecheck`.

## Capabilities

### New Capabilities

- `trusted-module-hermetic-qualification` — hermetic story corpus that
  qualifies trusted-module runtime extensions and proves the separation
  branch against the frozen baseline.

### Modified Capabilities

None. `openspec/specs/` has no entries for the story harness.

## Non-goals

- No modification of frozen inputs (`tests/stories/**` baseline harness)
  during branch qualification.
- No baseline/rebase mechanics ownership — that is the sibling
  `hermetic-e2e-core-separation-proof` change (design.md D3).
- No new module features; qualification stories only assert existing
  contracts.
- No plan-checkbox bookkeeping backfill (stale legacy plan checkboxes are
  historical).

## Impact

- **Code:** two new frozen story files on master; branch-side fixes
  confined to `src/` composition/plugins during Task 5.
- **CI:** qualification suite runs in the existing story lanes.
- **Scope model / DB / deps:** none.
- **Docs:** none beyond the proof records owned by the sibling change.
- **Legacy:** adopts `docs/superpowers/plans/2026-07-13-trusted-module-hermetic-qualification.md`,
  `docs/superpowers/specs/2026-07-13-trusted-module-hermetic-qualification-design.md`,
  and the `remaining/` brief (delete-on-adopt, same commit).
