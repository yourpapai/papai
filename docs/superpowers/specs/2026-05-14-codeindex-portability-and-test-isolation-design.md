# Codeindex Portability And Test Isolation Design

**Date:** 2026-05-14
**Scope:** Make the external `codeindex` project usable from a clean `papai` clone and remove a cross-suite Bun module-mock leak.
**Primary Goal:** Preserve the external `codeindex` split while eliminating hidden machine-specific state and absolute paths from `papai`.
**Non-Goal:** Move `codeindex` back into this repo, redesign `codeindex` itself, or broadly refactor the test harness beyond the specific leaking mock.

---

## Context

`papai` recently moved to `~/Projects/yourpapai/papai` while `codeindex` remains an external project. The current integration still depends on two fragile assumptions:

1. machine-specific absolute paths such as `/Users/ki/Projects/papai/codeindex/src/cli.ts`
2. hidden Bun global link state through `"codeindex": "link:codeindex"`

Those assumptions break reproducibility for clean clones, CI, and other developers.

Separately, `tests/index.test.ts` uses `mock.module('../src/message-queue/index.js', ...)`, but the global preload in `tests/mock-reset.ts` does not restore that module before later suites. Bun documents that `mock.restore()` does not undo `mock.module()` overrides, so this omission can leak a stubbed module across test files.

---

## Decision

Adopt a clean-clone-friendly external dependency model with a canonical sibling-repo default and a single shared process-entry resolver.

The chosen direction is:

1. treat `../codeindex` as the default external repo location relative to `papai/`
2. allow `CODEINDEX_DIR` to override that default when the external repo lives elsewhere
3. replace hardcoded absolute CLI paths with repo-owned wrappers or shared resolution logic
4. replace hidden `bun link` state with a declared local dependency source that works from repo configuration alone
5. extend the global test preload to restore `../src/message-queue/index.js`

---

## Goals

- make `papai` work from a clean clone when `codeindex` is checked out as sibling repo `../codeindex`
- keep the external `codeindex` repo split intact
- support alternate local layouts through `CODEINDEX_DIR`
- remove machine-specific absolute paths from scripts, MCP config, plugin configuration, and docs
- keep `scripts/behavior-audit/extract-evidence.ts` able to import `codeindex/src/...` deterministically
- fix the known cross-suite Bun module-mock leak with the smallest correct change

## Non-Goals

- support arbitrary repo discovery heuristics across the whole filesystem
- make `codeindex` optional for every workflow in this phase
- rewrite unrelated test suites away from `mock.module()`
- redesign the preload reset architecture

---

## Approaches Considered

### 1. Keep `bun link` and document setup

Rejected.

This preserves hidden global state and does not satisfy the clean-clone and CI goal.

### 2. Env-var-only external resolution

Rejected.

This is flexible but makes the default developer path worse and pushes configuration burden onto every clone and CI environment.

### 3. Sibling default plus env override, with repo-owned wrappers

Chosen.

This matches the intended layout, supports clean clones, and centralizes failure handling. It keeps the runtime and docs simple while still allowing non-standard local setups.

---

## Proposed Design

### Canonical Codeindex Location

`papai` will assume the external `codeindex` repo is checked out at `../codeindex` relative to the `papai` repo root.

Given `papai` at:

- `~/Projects/yourpapai/papai`

the default expected `codeindex` location becomes:

- `~/Projects/yourpapai/codeindex`

If that location is not used locally or in CI, `CODEINDEX_DIR` overrides it.

### Shared Resolution Contract

Add one repo-owned resolver for all process-based `codeindex` entrypoints.

The resolver should:

1. read `CODEINDEX_DIR` if present
2. otherwise resolve `../codeindex` from the `papai` repo root
3. validate that the resolved directory contains `package.json` and `src/cli.ts`
4. fail fast with a direct, actionable error if validation fails

Expected error shape:

```text
codeindex repo not found at <resolved-path>
Set CODEINDEX_DIR or clone the sibling repo at ../codeindex
```

### Dependency Model

Replace the hidden `link:codeindex` dependency with a declared local dependency source that works without pre-registered Bun global link state.

Preferred direction:

- use a repo-local dependency source such as `file:../codeindex`

This keeps `scripts/behavior-audit/extract-evidence.ts` imports like `codeindex/src/search.js` valid through normal dependency installation instead of a hidden global link registry.

### Process Entry Wrappers

All `codeindex` CLI process launches should go through repo-owned wrappers or the same shared resolution helper instead of embedding raw external paths.

Affected surfaces include:

- `package.json` scripts such as `codeindex:index`, `codeindex:reindex`, `codeindex:stats`
- MCP configuration in `.mcp.json`
- OpenCode configuration in `opencode.json`
- `.opencode/plugins/codeindex-reindex.ts`
- codeindex verification and troubleshooting docs

The important design rule is that path construction lives in one place, not repeated across JSON and script files.

### Behavior Audit Imports

`scripts/behavior-audit/extract-evidence.ts` may continue importing from `codeindex/src/...` as long as the dependency source is declared and reproducible from repo setup.

This is preferable to introducing custom dynamic imports there, because the current problem is dependency reproducibility, not a module API design flaw.

### Test Isolation Fix

Extend `tests/mock-reset.ts` so the global preload restores `../src/message-queue/index.js` before each test.

This change should remain centralized in the preload. `tests/index.test.ts` should not grow suite-local cleanup logic for a problem that the preload is designed to solve globally.

---

## Affected Files

Expected touched areas:

- `package.json`
- `bun.lock`
- `.mcp.json`
- `opencode.json`
- `.opencode/plugins/codeindex-reindex.ts`
- `scripts/behavior-audit/extract-evidence.ts`
- one or more new helper or wrapper scripts under `scripts/`
- `docs/guides/codeindex-verification.md`
- `tests/mock-reset.ts`

Potentially also:

- onboarding or README documentation if the sibling checkout requirement should be visible to contributors

---

## Verification

Verification should demonstrate both portability and isolation.

### Portability Checks

1. clean clone behavior with sibling layout `../codeindex`
2. `CODEINDEX_DIR` override behavior with a non-sibling checkout
3. successful resolution of `codeindex/src/...` imports from `extract-evidence.ts`
4. MCP startup without machine-specific absolute paths
5. background reindex plugin invocation without machine-specific absolute paths

### Failure Checks

1. missing `codeindex` repo produces a clear resolver error
2. invalid `CODEINDEX_DIR` produces the same clear resolver error

### Test Isolation Checks

1. `tests/index.test.ts` can still mock `../src/message-queue/index.js`
2. a later suite importing the same module sees the real implementation after preload reset

---

## Risks And Trade-Offs

- `file:../codeindex` assumes the sibling repo exists during install, which is acceptable for the chosen canonical layout but must be documented clearly
- wrapper scripts add a small amount of repo-owned plumbing, but that is preferable to scattering path logic and error handling
- keeping `extract-evidence.ts` importing `codeindex/src/...` retains source-level coupling to the external project, but that coupling is already intentional and acceptable for developer tooling

---

## Implementation Notes

Keep the implementation minimal:

1. centralize path resolution once
2. route all process launches through that resolver or wrappers
3. remove absolute paths and hidden Bun link dependence
4. add the missing `message-queue` preload restoration entry

No broader test harness redesign or `codeindex` API refactor is needed for this phase.
