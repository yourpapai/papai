# ADR-0089: Codeindex Portability and Test Isolation

## Status

Accepted

## Context

`papai` depends on the external `codeindex` project for codebase indexing and MCP tooling. After `papai` moved to `~/Projects/yourpapai/papai`, the integration still relied on two fragile assumptions:

1. Machine-specific absolute paths such as `/Users/ki/Projects/papai/codeindex/src/cli.ts`.
2. Hidden Bun global link state through `"codeindex": "link:codeindex"`.

These assumptions broke reproducibility for clean clones, CI, and other developers.

Separately, `tests/index.test.ts` used `mock.module('../src/message-queue/index.js', ...)`, but the global preload in `tests/mock-reset.ts` did not restore that module before later suites. Bun documents that `mock.restore()` does not undo `mock.module()` overrides, so this omission leaked a stubbed module across test files.

## Decision Drivers

- **Clean clone reproducibility** — a fresh clone with a sibling `../codeindex` checkout must work without hidden Bun link state.
- **CI compatibility** — CI cannot rely on machine-specific absolute paths or pre-registered Bun links.
- **Developer onboarding simplicity** — the sibling layout should be the default; only nonstandard layouts need env configuration.
- **Test isolation** — Bun module mocks must not leak across test suites.

## Considered Options

### Option 1: Keep `bun link` and document setup

- **Pros**: Zero code changes.
- **Cons**: Preserves hidden global state and violates clean clone / CI goals.

**Rejected.**

### Option 2: Env-var-only external resolution

- **Pros**: Flexible for any local layout.
- **Cons**: Makes the default developer path worse and pushes configuration burden onto every clone and CI environment.

**Rejected.**

### Option 3: Sibling default plus `CODEINDEX_DIR` override, with repo-owned wrappers

- **Pros**: Matches intended layout, supports clean clones, centralizes failure handling, keeps runtime and docs simple, and still allows nonstandard local setups.
- **Cons**: Adds small repo-owned wrappers.

**Chosen.**

### Option 4: Declare `codeindex` as a local file dependency (`"codeindex": "file:../codeindex"`)

- **Pros**: Normal package resolution for any code that imports `codeindex/src/...`.
- **Cons**: Requires the sibling repo to exist during `bun install`, which breaks CI or clean installs where `codeindex` is optional or missing. It also couples the runtime to `node_modules` resolution, which is unnecessary for process-based CLI entrypoints.

**Rejected in favor of Option 3.**

## Decision

Adopt **Option 3**: repo-owned wrappers with sibling-default resolution and `CODEINDEX_DIR` override.

Additionally, extend the global preload to restore `../src/message-queue/index.js`.

## Rationale

The `codeindex` integration has two distinct surfaces:

1. **CLI / MCP process entrypoints** (`index`, `reindex`, `stats`, `mcp`): these only need to know where `../codeindex/src/cli.ts` lives and be able to spawn `bun run <path> <subcommand>`.
2. **Behavior audit imports** (`scripts/behavior-audit/extract-evidence.ts`): these need typed imports from `codeindex/src/search.js`, `codeindex/src/storage/db.js`, `codeindex/src/config.js`, and `codeindex/src/types.js`.

Option 4 solves surface 1 through `node_modules` resolution, but it forces a `bun install` failure when the sibling repo is absent. It also does not help surface 2 meaningfully, since the behavior audit already dynamically imports from resolved file URLs.

Option 3 solves surface 1 with a small pure resolution helper (`scripts/codeindex-cli-support.ts`) and a thin spawn wrapper (`scripts/codeindex-cli.ts`). For surface 2, `resolveCodeindexModulePaths()` returns the same absolute module paths that a `file:../codeindex` dependency would resolve to, so the behavior audit can `import()` them via `pathToFileURL()` without any `node_modules` coupling.

This gives us:

- **No install-time dependency** on the sibling repo.
- **No hidden Bun link state**.
- **No absolute paths** in config, scripts, or docs.
- **One shared resolution contract** for every surface.

## Consequences

### Positive

- Clean clone with sibling `../codeindex` works immediately.
- CI can clone both repos side by side and run `codeindex:*` scripts without any Bun link setup.
- All machine-specific paths removed from `.mcp.json`, `opencode.json`, plugins, and docs.
- The cross-suite `message-queue` mock leak is fixed.

### Negative

- Repo-owned wrapper code must be maintained.
- `codeindex` is not listed in `package.json` dependencies, so IDE "go to definition" across projects requires both repos open.

### Risks

- Sibling default may still surprise developers who cloned `codeindex` elsewhere; mitigated by the actionable resolver error and `CODEINDEX_DIR` override.

## Implementation Notes

- `scripts/codeindex-cli-support.ts` — centralizes path resolution, validates existence of `package.json` + `src/cli.ts`, and also exposes `resolveCodeindexModulePaths()` for the behavior audit.
- `scripts/codeindex-cli.ts` — thin `bun` entrypoint that delegates to the external CLI with inherited stdio.
- `tests/mock-reset.ts` — added `../src/message-queue/index.js` to the global preload restoration list.

## Related Decisions

- ADR-0083: Enrich codeindex search ergonomics for agents — preceded this portability work.

## References

- Spec: `docs/archive/2026-05-14-codeindex-portability-and-test-isolation-design.md`
- Implementation plan: `docs/archive/2026-05-14-codeindex-portability-and-test-isolation-implementation.md`
