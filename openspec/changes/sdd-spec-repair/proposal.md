# sdd-spec-repair

## Why

Three main specs under `openspec/specs/` still describe surfaces the subcommand cutover removed: `sdd-runner-autonomy` specs autonomy levels, a `rules` map, `costCeilingUsd`, `--auto-deadline`, and `audit`/`gate reopen` subcommands; `sdd-runner-cli` specs decision flags (`--confirm-all`/`--extend`/`--veto`/`--abort`) that today fail with "removed" errors; `sdd-runner-output` specs `--verbosity quiet` and a `watch` subcommand, both removed. Five changes now pending (including four that delta into these very specs) will merge into specs that misdescribe reality — every archive compounds the drift. A corpus forensics pass also showed the audit surface shifted (policy-debt ledger and reopen survive as the overturn path under new vocabulary), so the repair is a rewrite-to-current-truth, not a deletion.

## What Changes

- `sdd-runner-autonomy`: remove the autonomy-levels requirement and the level-scoped observe-mode requirement, replacing them with single-mode policy evaluation and unconditional policy previews (both current behavior); remove the audit-verb requirement, replaced by the reopen-flag overturn surface; rewrite the dead-man deadline requirement as the config-`deadline` waiter with claim-file and re-arm semantics; fix the report-gains invocation vocabulary. R1–R5 rule bodies, never-cut invariants, and the `auto_decision` event requirement are untouched (current truth); R4's key vocabulary is left to `sdd-policy-metered-budget`, which already rewrites that block.
- `sdd-runner-cli`: remove the non-interactive flag-path requirement (flags are gone; the hand-edited gate file — already specced — is the non-TTY path); update the gate-session and pending-gate-discovery requirements from `gate resume`/`gate` invocations to the single routing verb and session screen.
- `sdd-runner-output`: remove the quiet-verbosity requirement (`--verbosity` is a removed flag; `SDD_DEBUG` raises line-renderer altitude) and the watch-verb requirement (subcommand removed; its fold machinery lives inside the TUI running screen).
- No code changes: every delta describes behavior that already exists in `sdd-runner/src/` (verified against `cli.ts` `REMOVED_FLAGS`/`LEGACY_SUBCOMMANDS`, the five-key `RunnerConfigSchema`, and `report.ts`'s gains block).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `sdd-runner-autonomy`: requirements reconciled with post-cutover reality (levels/observe/audit/deadline rewritten; previews and reopen surfaced as first-class requirements). Without the repair, archiving `sdd-policy-metered-budget` merges a corrected R4 into a spec whose surrounding requirements still describe a config schema that cannot be loaded.
- `sdd-runner-cli`: dead flag-path requirement removed; surviving requirements' invocation vocabulary updated to the routing verb. Without it, the spec instructs operators to invoke flags the CLI rejects by design.
- `sdd-runner-output`: two dead-surface requirements removed. Without it, the spec promises `--verbosity` and `watch`, both of which fail with "removed" errors today.

## Impact

- Files: three delta specs under this change folder only — no `sdd-runner/src/` or test changes (the code already behaves as specced).
- Scope model: none affected — specs describe the offline runner workspace.
- Coordination: `sdd-policy-metered-budget` owns the R4 rewrite (applied after this repair, its MODIFIED block reads against a coherent parent); `sdd-run-artifact-analysis`'s era-contamination flag will treat pre-repair spec vocabulary as historical, not current.
- Docs: none — `docs/architecture/sdd-pipeline.md` already describes current truth; this change brings the specs up to it.

## Non-goals

- Any behavior change in `sdd-runner/` — this is spec-to-code reconciliation; a delta that would require code edits belongs in a functional change.
- Rewriting the autonomy spec's `## Purpose` paragraph (delta mechanics cannot amend Purpose; noted for the archive step, which owns main-spec prose).
- R4 vocabulary (owned by `sdd-policy-metered-budget`), loop-memory additions (owned by `sdd-review-loop-memory`), or the analyzer's surfaces.
- Auditing non-sdd specs (`review-loop-*`, `mutation-*`, `agent-*`, …) — different subsystems, no pending changes delta into them; a follow-up audit can copy this method.
