# ADR-0084: Consolidate Behavior-Audit Scripts

## Status

Accepted

## Context

The `scripts/` and `tests/scripts/` directories contained multiple `behavior-audit` related files at the top level (e.g., `scripts/behavior-audit.ts`, `scripts/behavior-audit-reset.ts`, and various barrel files). This resulted in:

- **Directory Clutter**: The top-level directories were becoming crowded with specialized scripts.
- **Redundant Barrel Files**: Many files were "thin barrels" that merely re-exported logic from a subdirectory, adding unnecessary complexity to the module resolution and increasing the risk of unused exports.
- **Import Ambiguity**: Developers had to distinguish between the main orchestrator and various sub-modules through inconsistent naming conventions in the top-level directory.

## Decision Drivers

- **Project Cleanliness**: Maintain a minimal and focused top-level `scripts/` and `tests/scripts/` directory.
- **Simplicity**: Eliminate thin re-export (barrel) files to simplify the module graph.
- **Maintainability**: Group related functionality into logical subdirectories for easier discovery and management.
- **Tooling Compatibility**: Ensure that consolidation does not break linting (`oxlint`), type-checking (`tsgo`), or unused dependency detection (`knip`).

## Considered Options

### Option 1: Maintain current structure

- **Pros**: No refactoring effort required; zero risk of breaking existing scripts or tests.
- **Cons**: Continued directory clutter; maintenance of redundant barrel files; increased complexity in module resolution.

### Option 2: Consolidate into dedicated subdirectories

- **Pros**: Cleaner top-level directory structure; elimination of redundant barrel files; improved module organization and discoverability; cleaner import paths.
- **Cons**: Requires a one-time refactoring effort to update import paths in scripts, tests, and configuration files (`package.json`, `knip.jsonc`).

## Decision

We will adopt **Option 2**: Consolidate all `behavior-audit` source and test files into dedicated subdirectories: `scripts/behavior-audit/` and `tests/scripts/behavior-audit/`.

## Rationale

The benefits of a cleaner, more organized project structure and the elimination of redundant intermediate files outweigh the one-time effort of updating import paths. This aligns with the project's goal of maintaining a well-structured and easy-to-navigate codebase.

## Consequences

### Positive

- **Improved Organization**: Related files are grouped logically, making the codebase easier to navigate.
- **Reduced Complexity**: Removing barrel files simplifies the module tree and reduces the number of files.
- **Cleaner Top-Level**: Reduces noise in the primary `scripts/` and `tests/scripts/` directories.

### Negative

- **Refactoring Effort**: Requires updating import statements across multiple files and updating configuration files for `package.json` and `knip`.

### Risks

- **Broken Imports/Scripts**: There is a risk of breaking existing automation or developer workflows if an import or script path is missed.
- **Mitigation**: Comprehensive testing (running the full `behavior-audit` test suite) and type-checking after the move to ensure all paths are correctly resolved.

## Implementation Notes

- Source files `behavior-audit.ts` and `behavior-audit-reset.ts` were moved to `scripts/behavior-audit/`.
- All barrel files were deleted after their functionality was integrated or their tests were updated to point directly to the implementation modules.
- Test files were moved to `tests/scripts/behavior-audit/`.
- `package.json` was updated to point the `audit:behavior` script to the new location.
- `knip.jsonc` was updated to account for the new directory structure and avoid flagging moved files as unused.

## Related Decisions

- ADR-0011: Knip dead code detection - relates to ensuring the new structure is correctly recognized by knip.
- ADR-0058: Provider capability architecture - similar principles of grouping related capabilities.

## References

- Plan: `docs/superpowers/plans/2026-04-27-consolidate-behavior-audit-scripts.md`
