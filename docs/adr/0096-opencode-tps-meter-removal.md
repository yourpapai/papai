# ADR-0096: Remove Local OpenCode TPS Meter Plugin Integration

## Status

Accepted

## Date

2026-04-29

## Context

The project included a local checkout of the `opencode-tps-meter` plugin under `.opencode/plugins/opencode-tps-meter/` and referenced it from `opencode.json` so that OpenCode would load it on startup. The plugin added TPS (tokens per second) meter UI and hooks to the OpenCode runtime.

Two pieces of local state were involved:

1. `opencode.json` listed `"./.opencode/plugins/opencode-tps-meter"` in its `plugin` array.
2. `.opencode/plugins/opencode-tps-meter/` existed as a nested git repository (a local fork of the upstream plugin).

The GitHub fork `wKich/opencode-tps-meter` (parent: `ChiR24/opencode-tps-meter`) was maintained independently and should remain intact for future standalone work.

This change is local workspace cleanup, not a product feature change. No application runtime code under `src/` or `client/` was affected.

## Decision Drivers

1. **Unused plugin**: The TPS meter was no longer providing value in the papai workspace.
2. **Clean workspace**: Removing the plugin eliminates confusion about whether the plugin is still part of the project.
3. **Preserve remote fork**: The user explicitly requested keeping the GitHub fork intact for potential future standalone work.

## Considered Options

### Option 1: Remove config entry only, keep local directory (rejected)

- **Pros**: Minimal change; plugin would stop loading.
- **Cons**: Leaves an unused nested repository in the workspace, creating confusion about whether the plugin is still part of the project.
- **Verdict**: Rejected — incomplete cleanup.

### Option 2: Remove both config entry and local directory, preserve remote fork (accepted)

- **Pros**: Complete local removal; workspace is clean; fork remains available for future work.
- **Cons**: None significant — the plugin can be re-added later if needed.
- **Verdict**: Accepted.

### Option 3: Delete the GitHub fork as well (rejected)

- **Pros**: Truest form of "removal."
- **Cons**: Destroys standalone project that may still be useful; contradicts explicit user request to keep the fork.
- **Verdict**: Rejected.

## Decision

Remove the local OpenCode TPS meter plugin integration by:

1. Editing `opencode.json` to remove `"./.opencode/plugins/opencode-tps-meter"` from the `plugin` array.
2. Deleting the `.opencode/plugins/opencode-tps-meter/` directory from the workspace.
3. Leaving the GitHub fork `wKich/opencode-tps-meter` untouched.

## Rationale

- The change is **purely local** — only affects the papai workspace, not the upstream code.
- The remote fork is **preserved** for potential future standalone development or reference.
- The removal is **conservative** — only touches the specific config entry and directory; all other plugin entries remain unchanged.
- **No runtime code changes** under `src/` or `client/` mean there is no application behavior impact.

## Consequences

### Positive

- Workspace is cleaner — no unused nested repository.
- OpenCode startup no longer attempts to resolve the TPS meter plugin.
- No dormant local copy left behind to confuse future maintainers.
- GitHub fork remains available for future standalone work.

### Negative

- TPS meter UI and hooks are no longer available in this workspace (intentional).

### Risks

- If the plugin is needed again, it must be re-added manually.
- **Mitigation**: The GitHub fork is preserved, so the source is readily available for re-integration.

## Implementation Notes

### Files modified

- `opencode.json` — removed `"./.opencode/plugins/opencode-tps-meter"` from the `plugin` array.

### Files deleted

- `.opencode/plugins/opencode-tps-meter/` — entire local plugin directory.

### Verification

1. Read `opencode.json` and confirm the TPS meter plugin entry is gone.
2. Confirm `.opencode/plugins/opencode-tps-meter/` no longer exists.
3. Confirm the GitHub fork `wKich/opencode-tps-meter` still exists remotely (`isFork: true`, parent `ChiR24/opencode-tps-meter`).

## Related Decisions

- None directly related.

## References

- Implementation plan: `docs/archive/2026-04-29-opencode-tps-meter-removal.md` (archived)
- Design spec: `docs/archive/2026-04-29-opencode-tps-meter-removal-design.md` (archived)
- Remote fork: `https://github.com/wKich/opencode-tps-meter`
