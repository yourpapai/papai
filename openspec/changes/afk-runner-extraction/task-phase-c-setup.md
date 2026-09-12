<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner-extract-c-setup

Execute the new-repo setup of the afk-runner extraction, capability name
`afk-runner-extract-c-setup`, in the freshly split standalone repo
(`yourpapai/afk-runner`, produced by the operator's Phase B filter-repo).
Per the umbrella change `openspec/changes/afk-runner-extraction/`
(tasks.md 2.2–2.3, 3.1–3.3; design.md D2/D3/D7). Read those artifacts
first; this run is the new repo's first live-proof.

## Scope

- Task 2.2 — post-split validation, before any setup edit: tree diff
  against the source paths (nothing missing/extra), full suite green at
  tip, `openspec validate` passes, the U-ledger doc present under `docs/`.
- Task 2.3 — add `PROVENANCE.md` (extraction source SHA, severance
  boundary note) and a fresh minimal `openspec/config.yaml`
  (runner-scoped, not chat-bot-scoped).
- Task 3.1 — Apache-2.0 `LICENSE` + re-header sweep of all copied files
  (FSL-1.1-MIT only if the operator reverses before first public push —
  default Apache-2.0 per design D3).
- Task 3.2 — self-contained toolchain: own `.oxlintrc.json` +
  `.oxfmtignore` (copied from papai, pruned to the runner tree),
  package.json scripts without `cd ..`, README covering clone-and-run
  install, `bun run src/cli.ts`, and the `.afk-runner/config.json` ladder.
- Task 3.3 — CI workflows: test / typecheck / lint on push and PR.

## Inherited as decided (do not re-litigate)

- License is Apache-2.0 with the patent grant (design D3); the choice is
  final before any public push; visibility of the repo stays private until
  then.
- The mutation ratchet and write-hook TDD pipeline are deliberately not
  carried (proposal Non-goals) — explicit quality debt, revisit after the
  first standalone cycle. CI is test/typecheck/lint only.
- Clone-and-run shape: no npm publishing, no `bin` packaging, no semver.
- `p-limit` is declared in the runner's own package.json (landed in Phase
  A); `cd ..` scripts are gone.

## Non-goals

- Phase C papai retirement (drain-gated, separate run).
- Any behavioral change to the runner — setup only; the tip the split
  produced is live-proven and stays byte-identical until CI is green.
- Re-baselining a mutation floor, porting write hooks.

## Walk grammar

Validation tasks (2.2) are read-only checks recorded as findings; setup
tasks (2.3, 3.1–3.3) are each one complete cycle ending in its verification
command green. The tree is green after every task.

## Verify

`bun test` + `openspec list --json` + `openspec validate` in this repo;
`grep -rL "Apache-2.0" src/ | wc -l` = 0 after the sweep;
`bun run lint && bun run format:check` after the toolchain task; first CI
run green on the tip after 3.3.
