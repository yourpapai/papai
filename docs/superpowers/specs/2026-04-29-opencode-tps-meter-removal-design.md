# OpenCode TPS Meter Local Removal

**Date:** 2026-04-29
**Scope:** Remove local `opencode-tps-meter` integration from this project only
**Non-Goal:** Do not delete the GitHub fork `wKich/opencode-tps-meter`
**Approach:** Remove the explicit OpenCode config entry and delete the local plugin directory

---

## Context

The project currently loads the TPS meter plugin through `opencode.json`:

- `./.opencode/plugins/opencode-tps-meter`

The local plugin source also exists at `.opencode/plugins/opencode-tps-meter/` as a nested git repository. The user wants the plugin removed from the local project and from the OpenCode project config, while keeping the GitHub fork intact.

---

## Design

### Configuration change

Remove `./.opencode/plugins/opencode-tps-meter` from the `plugin` array in `opencode.json`.

Result: OpenCode will stop loading the TPS meter plugin through project configuration.

### Local file removal

Delete the `.opencode/plugins/opencode-tps-meter/` directory from the project workspace.

Result: the local plugin checkout no longer ships with this repository checkout, and there is no dormant local copy left behind.

### Remote preservation

Do not modify or delete the GitHub fork `wKich/opencode-tps-meter`.

Result: the fork remains available for future standalone work, but it is no longer connected to this local project.

---

## Alternatives Considered

### Keep the directory, remove only config

This would disable the plugin in practice, but it would leave an unused nested repository in the workspace. That creates avoidable confusion about whether the plugin is still part of the project.

### Delete the fork as well

Rejected because the user explicitly asked to keep the fork.

---

## Data Flow And Behavior Impact

After the change:

1. OpenCode startup will no longer resolve the TPS meter plugin from `opencode.json`.
2. The project plugin directory will contain only the remaining local plugins.
3. No runtime TPS meter UI or hooks from this plugin will be available in this workspace.

No application runtime code under `src/` or `client/` changes.

---

## Error Handling

The removal should be performed conservatively:

1. Edit only `opencode.json` for configuration changes.
2. Delete only `.opencode/plugins/opencode-tps-meter/`.
3. Do not touch any other plugin entries or remotes.

If the local directory has unrelated uncommitted work, the removal still follows the approved scope because the user requested local project integration removal rather than preservation of the nested checkout.

---

## Verification

Verification is intentionally simple:

1. Read `opencode.json` and confirm the TPS meter plugin entry is gone.
2. Confirm `.opencode/plugins/opencode-tps-meter/` no longer exists.
3. Confirm the GitHub fork still exists remotely.

---

## Implementation Notes

This is a local workspace cleanup, not a product feature change. No tests are required beyond direct file and remote verification.
