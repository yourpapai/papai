# Design: remove-redundant-workspace-checks

## Context

See proposal.md — Why. The redundancy was verified empirically, not assumed:

- `tsgo --noEmit --listFilesOnly` includes all 258 files across the four workspaces' `src/` trees (workspace tsconfigs extend the root one and cover a subset of the same program).
- `bunfig.toml` `pathIgnorePatterns` excludes only `tests/e2e|client|visual|stories`; every `tests/<workspace>/` file (195 across the four) runs in the default sweep. Each workspace's own `test` script is `cd .. && bun test tests/<w>` — the same sweep, re-scoped.
- `.oxlintignore` and `.oxfmtignore` exclude no workspace directory, so root `lint`/`format:check` walk them.

## Goals / Non-Goals

**Goals:** delete the redundant entries and their dead special-casing; pin the root-only contract in `tests/scripts/check.test.ts`; make the composition legible for the next workspace author.

**Non-Goals** (mirroring the proposal): the `is_license_header_file` / `is_oxlint_scoped_file` enumeration gaps (`mutation-improve/src`, `sdd-runner/src` missing), proxy-script removal, dynamic workspace-list derivation, staged-mode redesign.

## Decisions

### D1 — Delete, don't derive

No machinery reads `package.json` `workspaces` to compose check lists. The entries are removed; nothing replaces them. Derivation would re-introduce a per-workspace concept into the one place that just got rid of it, and the repo's minimality convention prefers the smaller diff. If a future workspace genuinely needs isolated gating, that is a new proposal with new evidence.

### D2 — All dead special-casing goes with the entries

Three places in `check.sh` reference `review-loop:test` beyond the checks array, and all three die with it:

- the `--skip-tests` filter `case` (line 337) — `test|test:client|review-loop:test` becomes `test|test:client`;
- the dedicated `elif` runner (lines 422–423, `bun test tests/review-loop --timeout 15000`);
- the failure-hint `case` arm (line 461) that pointed `review-loop:test` failures at `bun run test:failures`.

Leaving any behind would be a trap: a reader would infer the special case still exists for a reason.

### D3 — Failure attribution moves to root logs, accepted

A workspace failure previously got its own named check line (`✗ review-loop:lint`) and its own `reports/checks/review-loop_lint.log`. After removal it surfaces under the root check with `file:line` in `reports/checks/<root-check>.log` (e.g. the sdd-runner failures that motivated this session were already reported this way by root `lint`/`typecheck`/`format:check`). The root logs are the query surface the AGENTS.md "run once, then read" contract already points at; per-workspace granularity buys nothing the root log lacks.

### D4 — Test-first via composition assertions

`tests/scripts/check.test.ts` runs `check.sh` with a stubbed `bun` and asserts the invoked commands — fast and hermetic. The `--skip-tests` mode test (line ~300) currently asserts `bun run review-loop:lint` IS invoked; it flips to `not.toContain` for every `<workspace>:` prefix. The full-mode tests keep asserting the eight root checks. Red → green: assertions change first, then `check.sh` and `package.json`.

`check:verbose` has no dedicated test (it is a `package.json` one-liner); its verification is inspection plus `bun run --parse` of the script list — not worth a harness for a literal string.

### D5 — Staged mode untouched

`--staged` mode never ran workspace entries (its checks are `lint typecheck format:check license-headers` over staged files), so nothing changes there except the dead filter case's syntax shrinking. `is_license_header_file` / `is_oxlint_scoped_file` keep their existing enumerations, gaps included — see Non-Goals.

## Risks / Trade-offs

- **Lost serial-stability lane?** `review-loop:test` ran the 45 files in a second concurrent job — that was the destabilizer, not a stabilizer. CI's serial handling lives in the root `test` check (`CI=true` → serial + `--timeout 15000`), which is preserved.
- **CI wall-time belief.** Someone may believe per-workspace checks catch something root checks miss. The spec's "Root checks cover all workspace code" scenario is the recorded answer; this design's verification evidence section is the proof snapshot.
- **Docs.** AGENTS.md's check-cost table lists root-check costs; it names no workspace entries, so no doc updates are required beyond this change's artifacts.

## Open Questions

None blocking. The enumeration-gap fix (Non-goal) is the natural follow-up proposal.
