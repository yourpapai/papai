# ADR-0082: Extract review-loop into a Bun Workspace

## Status

Accepted

## Context

The `review-loop` functionality was previously implemented as a set of scripts located in `scripts/review-loop/` with a thin wrapper in `scripts/review-loop.ts`. This implementation had several drawbacks:

- **Lack of isolation**: Dependencies for the review-loop were mixed with the main project's dependencies.
- **Suboptimal workspace management**: It did not follow the established workspace pattern used by the `codeindex/` module.
- **Difficult tooling integration**: It was harder to run dedicated linting, typechecking, and testing workflows specifically for the review-loop without affecting the rest of the project.
- **Manual lifecycle management**: Testing and development required navigating a non-standard directory structure.

The goal was to transition `review-loop` into a first-class Bun workspace, mirroring the `codeindex/` pattern, to improve maintainability, isolation, and developer experience.

## Decision Drivers

- **Workspace parity**: Must follow the existing Bun workspace pattern used by `codeindex/`.
- **Dependency isolation**: Must allow `review-loop` to have its own specific dependencies (e.g., `@agentclientprotocol/sdk`).
- **TDD integration**: Must be fully integrated into the project's automated TDD (Test-Driven Development) hook pipeline.
- **Developer ergonomics**: Must provide clear, workspace-scoped commands for testing, linting, and running the CLI.

## Considered Options

### Option 1: Maintain current script-based structure

- **Pros**: No migration effort required; minimal changes to existing workflows.
- **Cons**: Poor dependency isolation; inconsistent with the rest of the codebase; harder to scale and tool.

### Option 2: Extract to a Bun Workspace (Chosen)

- **Pros**: Clean dependency isolation; follows existing project architecture; enables granular workspace-scoped commands; integrates seamlessly with the TDD hook pipeline.
- **Cons**: Requires a one-time migration effort (moving files, updating imports, and re-wiring scripts).

## Decision

We will extract the `review-loop` logic into a root-level Bun workspace package named `review-loop`.

The implementation includes:

1. Moving all source files from `scripts/review-loop/` to `review-loop/src/`.
2. Moving `config.example.json` to the workspace root.
3. Creating workspace-specific `package.json`, `tsconfig.json`, and `CLAUDE.md`.
4. Updating the root `package.json` to include `review-loop` in the `workspaces` array and delegating scripts via `bun run --filter`.
5. Updating the TDD resolver (`.hooks/tdd/test-resolver.mjs`) to recognize and gate `review-loop/src/**`.
6. Rewriting test imports in `tests/review-loop/` to point to the new source location.

## Rationale

Extracting to a workspace provides the best long-term architectural alignment. By mirroring the `codeindex/` pattern, we ensure a consistent developer experience and leverage the existing infrastructure for task management, linting, and testing. The integration with the TDD hook pipeline is critical for maintaining code quality through the Red $\rightarrow$ Green $\rightarrow$ Refactor workflow.

## Consequences

### Positive

- **Improved Isolation**: `review-loop` dependencies are explicitly managed within its own `package.json`.
- **Consistent Architecture**: Aligns with the project's modular workspace-based design.
- **Enhanced Tooling**: Enables targeted workspace commands (e.g., `bun review-loop:test`).
- **Robust Quality Control**: Full integration with the TDD hook pipeline ensures all changes are verified by tests.

### Negative

- **Migration Complexity**: Requires careful handling of file moves, import updates, and script re-wiring to avoid breaking existing functionality.
- **Slightly more boilerplate**: Requires maintaining additional configuration files (`package.json`, `tsconfig.json`, etc.) for the workspace.

### Risks

- **Broken Imports**: Moving files could break relative imports or string-literal file references in tests.
  - **Mitigation**: Comprehensive testing and manual verification of test fixtures.
- **Dependency Hoisting Issues**: Moving dependencies might affect the lockfile or resolution.
  - **Mitigation**: Running `bun install` and verifying the resulting layout.

## Implementation Notes

- The extraction was performed using `git mv` to preserve file history.
- The root `review:loop` script was replaced by a suite of `review-loop:*` delegation scripts for better granularity.
- The TDD resolver updates were applied atomically to prevent breaking the hook pipeline.

## Related Decisions

- ADR-0009: Multi-provider task tracker support (context for tool-calling architecture)
- ADR-0043: TDD hooks integration (basis for the automation used in this decision)

## References

- [Bun Workspaces Documentation](https://bun.sh/docs/install/workspaces)
- Implementation Plan: `docs/superpowers/plans/2026-04-23-review-loop-workspace-extraction.md`
