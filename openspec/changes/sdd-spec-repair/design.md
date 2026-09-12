# Design — sdd-spec-repair

## Context

See proposal.md. This change is spec-to-code reconciliation with no code edits: every delta describes behavior verified present in `sdd-runner/src/` (`cli.ts` `REMOVED_FLAGS`/`LEGACY_SUBCOMMANDS`, the five-key `RunnerConfigSchema`, unconditional previews in `gate-prelude.ts`, reopen in the routing table, the waiter in `deadline-waiter.ts`, gains in `report.ts`). The corpus forensics that exposed the drift (N6/N8) also established which stale requirements have living substance (previews, policy-debt, reopen, gains) versus dead surface only (levels, flags, watch).

## Goals / Non-Goals

**Goals:** every requirement in the three specs describes invocable current behavior; REMOVED entries carry Reason + Migration; MODIFIED entries preserve existing scenario names (the R4 validator lesson); no code changes.

**Non-Goals:** code edits of any kind; the autonomy `## Purpose` paragraph (delta mechanics cannot amend it — flagged for the archive step); R4's key vocabulary (owned by `sdd-policy-metered-budget`); audits of non-sdd specs.

## Decisions

### D1 — REMOVED+ADDED pairs for premise-dead requirements, MODIFIED for vocabulary drift

Requirements whose *premise* died (levels, observe, audit verb, dead-man deadline) become REMOVED+ADDED pairs: MODIFIED would force preserving scenario bodies ("at level observe…") that describe nothing invocable. Requirements whose substance survives under stale invocation words (gate session, discovery, gains, steering) are MODIFIED with scenario names preserved verbatim — even where a name mentions dead vocabulary ("Blocking gates unchanged at observe and assist"), the name is an identifier, not prose; rewriting bodies only keeps the diff honest.

### D2 — Substance-forward migrations, not tombstones

Each REMOVED migration names the current surface that inherited the behavior (previews → unconditional; audit's overturn → reopen flag; watch → TUI re-attach). A spec that merely deletes invites re-introduction proposals; a spec that names the heir does not.

### D3 — R4 explicitly left to the sibling change

`sdd-policy-metered-budget` MODIFIES R4 against the current (stale) parent text and already uses `budget` vocabulary. This repair touching R4 too would create two pending MODIFIED blocks over one requirement — an archive-order hazard. Ordering note: apply this repair first; metered-budget then rewrites R4 against a coherent parent. Recorded in both proposals.

### D4 — The deadline-waiter ADDED requirement states current semantics only

It specifies today's claim-file/conservative-ladder/re-arm-once behavior and deliberately omits the audit-event and parity behaviors that `sdd-policy-metered-budget` ADDS — specs compose additively on archive, and duplicating them here would double-state them.

## Risks / Trade-offs

- [Two pending changes touch `sdd-runner-autonomy` (this and metered-budget)] → D3's ordering note: repair archives first; no shared requirement is modified by both (R4 excluded here; waiter requirements are ADDED there vs REMOVED/ADDED here — the ADDED "Deadline waiter" here and "Waiter settles emit auto_decision events"/"Expiry ladder parity" there compose).
- [Scenario-name preservation keeps a dead-vocabulary name] → accepted deliberately (D1): names are identifiers; the validator's scenario-conservation rule is the controlling constraint.
- [Repair drifts again after the next cutover] → the analyzer's era-contamination flag (in `sdd-run-artifact-analysis`) watches the artifact side; spec-side recurrence is caught by `openspec validate --strict` only if deltas keep flowing — accepted residual risk.

## Migration Plan

Pure spec change: archive merges the deltas into the three main specs; nothing to deploy or roll back beyond the archive commit. Apply/archive before `sdd-policy-metered-budget` and `sdd-review-loop-memory` (both delta into repaired specs).
