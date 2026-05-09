# ADR-0081: Review Loop Config Fix + Progress Logging Implementation

## Status

Accepted

## Context

The review loop (an autonomous code-review loop runner) functioned as a "black box" during execution, making it difficult for developers to understand its progress or debug issues in real-time. Furthermore, the configuration files contained incorrect agent commands and model IDs, which caused failures when attempting to initiate the review process.

## Decision Drivers

- **Observability**: Developers need to see the current stage of the loop (review, verify, fix, re-review) and the results of each step.
- **Testability**: Logging mechanisms must be easily mockable to support high-quality unit and integration tests without polluting test output.
- **Reliability**: The tool must be usable out-of-the-box with valid configuration for agent commands and model IDs.
- **Flexibility**: The logging implementation should be decoupled from the loop logic to allow different outputs (e.g., terminal, file, or silent).

## Considered Options

### Option 1: Direct `console.log` calls

- **Pros**: Extremely simple to implement.
- **Cons**: Hard to test; pollutes test output; difficult to redirect to different outputs (like a file or a structured logger) without global monkey-patching.

### Option 2: Injectable `ProgressLog` Interface (Selected)

- **Pros**: Decouples logging logic from the loop controller; allows for easy dependency injection; supports different implementations (CLI vs. Silent/Mock for tests).
- **Cons**: Requires minor architectural changes to the dependency injection pattern (`ReviewLoopDeps`).

### Option 3: Full Observability Framework (e.g., OpenTelemetry)

- **Pros**: Standardized, highly detailed, and powerful.
- **Cons**: Excessive complexity and overhead for a local-only developer tool.

## Decision

We will implement an injectable `ProgressLog` interface that is passed into the loop via the `ReviewLoopDeps` dependency injection pattern.

1. **Interface**: Define a `ProgressLog` interface with a `log(message: string): void` method.
2. **CLI Implementation**: The CLI will inject a logger that uses `console.log`.
3. **Test Implementation**: Tests will inject a "silent" logger that collects messages for verification without printing them.
4. **Configuration**: Update `config.example.json` with the correct `opencode acp` commands and validated model IDs.

## Rationale

The `ProgressLog` interface provides the best balance of observability and testability. By using dependency injection, we adhere to the project's existing architectural patterns while gaining the ability to provide rich, real-time feedback to developers during CLI usage and controlled, verifiable logs during testing. Correcting the configuration ensures that the tool is reliable and reduces friction for new users.

## Consequences

### Positive

- **Enhanced Developer Experience**: Real-time, structured progress updates in the terminal.
- **Improved Testability**: Easy to assert that specific log messages were emitted during a loop cycle.
- **Increased Reliability**: Corrected configuration prevents common setup errors.

### Negative

- **Slightly more boilerplate**: Every call to the loop and its sub-functions requires passing the `deps` object containing the logger.

### Risks

- **Log Verbosity**: If too much detail is logged, it could overwhelm the user.
- **Mitigation**: Log messages are prefixed with stage identifiers (e.g., `[verify]`, `[fix]`, `[round]`) to allow for easy scanning and potential future filtering.

## Implementation Notes

- The `ReviewLoopDeps` interface in `review-loop/src/loop-controller.ts` was updated to include the `log` field.
- Detailed logging was added to key stages: `processIssueVerifyFix`, `runRound`, and the loop completion logic in `runReviewLoop`.
- A `truncate` helper was added to ensure long issue titles do not break the log formatting.

## Related Decisions

- ADR-0064: ACP Review Automation (background context)

## References

- Plan: `docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md`
