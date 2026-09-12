# afk-runner-spec-home — Design

## Context

afk-runner is the sole runner since R5 but inherits its spec coverage from
four `sdd-runner-*` main specs that `sdd-runner-retirement` will delete. This
change births the four umbrella capabilities the queued mirror changes
(`afk-runner-metered-budget`, `-open-vs-raised`, `-run-analysis`,
`-loop-memory`, `-operator-paper-cuts`) delta into. Spec-only; no code.

## Goals / Non-goals

**Goals:** carry forward every still-true requirement rewritten to afk truth;
absorb master's `sdd-spec-repair`; add requirements for afk-grown surfaces;
record the mirror-wave declines so they survive archive.

**Non-goals:** any behavior change; specifying engine internals (kernel,
fold, drive mechanics — those belong to the mechanism capabilities below);
specifying the plan branch, oversize routing, or a TUI.

## Decisions

### D1 — Umbrella layer, not the only layer

Nine delivered changes already delta into fine-grained mechanism capabilities
(`afk-runner-kernel`, `-think-half`, `-gate`, `-tail`, `-recovery`,
`-log-fidelity`, `-gate-settle-robustness`, `-runs`, `-live-proof`). The four
umbrella specs here sit at the **operator/pipeline altitude** (stages,
convergence, ladder, verbs, output contract) and deliberately do not
duplicate mechanism detail (one settle seam internals, claim mechanics,
recovery windows). Altitude split, not overlap: an umbrella requirement names
the observable contract; the mechanism capability owns the internals.

### D2 — Archive ordering (the proposal's ordering hazard, resolved)

1. **Done (2026-08-31):** the nine stale `sdd-runner-*` changes
   (`stop-dead-runs`, `sdd-create-prompt-stdin-fix`, `sdd-runner-session-*`,
   `sdd-runner-simplify`, `sdd-runner-tui-wiring`, `sdd-runner-decomposition`,
   `-decomposition-2nd`) archived **without spec sync** — their delta targets
   (`sdd-runner-cli` et al.) are the specs retirement deletes, and syncing
   would orphan requirements outside retirement's REMOVED coverage (built
   against the current 14/9/5/4 = 32 requirements, verified unsynced before
   the move). Their still-true behavior is carried by these four specs.
2. `afk-runner-spec-home` archives — the four umbrellas become main specs.
3. The nine delivered mechanism changes archive in any order except
   `sdd-runner-cutover`, which deltas into `afk-runner-gate` and archives
   after `gate-as-state`.
4. `sdd-runner-retirement` archives last — its REMOVED deltas still match the
   untouched old specs, and afk coverage exists before sdd coverage ends.
5. The five mirror changes archive afterwards, deltaing into the umbrellas.

`shared-tui-renderer` (proposal-only, no deltas, TUI-scoped) was left
unarchived — not in the hazard set; retire it when the TUI decline is next
revisited.

### D3 — `sdd-spec-repair` absorption map

| Repair's rewrite | afk umbrella disposition |
| --- | --- |
| Single-mode policy evaluation, unconditional previews | carried — `afk-runner-autonomy` (levels/observe never existed in afk) |
| Config-`deadline` waiter, claim-file, re-arm, conservative ladder | carried — `afk-runner-autonomy` Deadline waiter |
| Reopen-flag overturn replaces audit verb | **not carried** — afk has neither verb; the pre-settle steer override (queued veto/abort beats a pending auto-decision) is specced instead; the policy-debt ledger never existed in afk. Proposal amended accordingly |
| Decision flags, `--verbosity quiet`, `watch` | not carried (never existed in afk) |

### D4 — Written at current truth, owned forward

R4 is specced at its current cost-unknown-fails-closed shape;
`afk-runner-metered-budget` owns the unmetered rewrite. R1/R2 read the
current single count set; `afk-runner-open-vs-raised` owns the raised/open
split. Convergence is severity-based today; `afk-runner-loop-memory` and
`-open-vs-raised` own their deltas. Each delta MODIFIES a coherent parent
rather than this change pre-empting them.

### D5 — Declines recorded with evidence

The plan branch + children loop (master issues #346/#368), oversize signals,
and the TUI re-host are declined: **0 `plan` and 0 `child_spawned` events
across the 14 retained ancestor runs; `oversize` absent from all 11 depth
sidecars** (measured on the shared ancestor; recorded in each mirror
proposal's Non-goals). U2 (child-actor execution) stays parked pending afk's
own evidence; U8 (TUI re-host) holds.

## Risks / Trade-offs

- [Umbrella/mechanism drift] — two layers describe one runner → the umbrella
  requirements stay at contract altitude (D1) and the mechanism changes'
  archives re-read both; a future drift audit can copy `sdd-spec-repair`'s
  method.
- [Specs drift from code] — this change is spec-to-code reconciliation against
  `docs/architecture/afk-runner.md` (current truth); every carried requirement
  was verified against afk source before writing (verb surface `cli.ts`,
  ladder `work/auto-policy.ts` shape via doc, steer `work/steer.ts`,
  memo `memo-project.ts` behavior via doc).
- [Ordering regression] — archiving out of order orphans requirements → D2's
  sequence is the contract; retirement's REMOVED coverage was verified against
  the untouched main specs.

## Migration Plan

None — no code, no runtime. Rollback is `git revert` of the artifact commits.
