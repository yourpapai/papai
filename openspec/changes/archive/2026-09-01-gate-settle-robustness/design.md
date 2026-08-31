<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

The C4 settle seam (`gate-settle.ts` / `gate-model.ts` / `gate-waiter.ts`) parses whole-file markdown: the presentation itself renders `- [ ]` boxes in place, and `## Gate response` sections are the machine/steer shape. Four links break at item-less (0/0/0) final gates — hand-edit expressibility, steer grammar, the render⇄parse roundtrip (a zero-item veto render re-parses as *approve*), and the revision consumer's re-parse no-op (`runVetoRevision` returns silently when `vetoes.length === 0`). Parse throws escape the waiter unhandled (`run.ts` awaits inside the drive continuation, process dies, poisoned file crash-loops on resume). Claim lifecycle: the deadline path's `expiry-claim` is a permanent, unstealable timestamp file that `claimGateSettle` honors unconditionally, and no settle claim passes self-reclaim. A crash after `presented` orphans the presenting stage's bracket — no resume rule heals it and the completed guard (`gate done && no active stages`) then wedges the run while the waiter re-settles the answered gate in a duplicate-event storm. Constraints: the frozen parity oracle folds *events*, not gate files, so grammar changes carry zero parity impact; event schemas stay unchanged; the write-hook TDD pipeline covers all of `afk-runner/src/**`.

## Goals / Non-Goals

**Goals:**

- Every gate shape can express every decision; silence never settles as approve.
- Operator-input settle failures are contained feedback; producer bugs stay loud (refusal alarm) and land in a window that resume heals.
- Claims serialize one attempt, not a gate's lifetime; the deadline path un-wedges.
- The exploration's digs (T1–T4′, T9 fold) land as implementable decisions, not just findings.

**Non-Goals:**

- F-A1/F-A2 log-fidelity fixes (U9's R2), cross-run accounting (R3), TUI re-host (U8), ladder policy changes — R1 still auto-approves item-less gates when autonomy is configured.
- Fail-loud sidecar reads: `readReviewResultFromSidecars` stays fail-empty; the rejection *message* gains the empty-expected hint only.
- Event schema changes: no veto payload in events, no new event types.

## Decisions

### D1 — Gate-level decision grammar (over synthesized items)

Extend the response grammar with decision-level directives symmetric with `ABORT` / `→ RUN 1 MORE`: `APPROVE` and `VETO[: <redirect>]` on their own line. Parse precedence: `ABORT` → `VETO` (mode-gated: rejected at escalation; precedes required-ack — a wholesale rejection owes no trajectory ack) → extend → ack/box/answer computation. Zero-signal responses (no directive, no box for a declared id, no answer, no override, no checked ack) reject with guidance — unreachable at item-carrying gates by construction (presentation boxes guarantee signal), firing exactly at the item-less trap. `APPROVE` + unchecked declared items rejects naming the items; boxes stay authoritative for hand edits at item-carrying gates (back-compat with the taught habit). *Rejected alternative:* synthesizing an `A0 "the change as a whole"` item — spreads the hack across render, settle-time expected content, and the updater prompt, and leaves the vacuous-approve trap open. The grammar fix is one root change; `looksAnswered` and the rendered `### Decisions`/instructions blocks learn the new lines so the file self-documents its answer surface.

### D2 — Pre-flighted roundtrip (the render seam becomes machine-checked)

`renderGateAnswers` gains its missing veto-decision branch (zero-item veto renders the `VETO` directive; item veto keeps unchecked boxes) and emits `APPROVE` on approve decisions — `renderAutoApproveAnswers` inherits via `decision: 'approve'`. `settleGateWithAnswers` parses the rendered text **in memory before writing the gate file**; a mismatch or parse failure overwrites nothing and appends nothing. This kills the steer-clobber poison (a failed producer settle no longer destroys the presentation) and makes D5's "rendered text parses back as the same decision" (C4 D5) an enforced invariant rather than an event-stream hope. Directive regexes live beside `ABORT`'s as shared constants so render and parse cannot drift.

### D3 — Two containment lanes

The seam goes total over operator input: `settleGateFile` returns a rejected-shape `{kind: 'rejected', reason}` for parse, integrity, and unreadable-sidecar failures instead of throwing; the waiter turns a rejection into feedback — a sibling `gate-<v>.response-error.md` (parse-inert by construction: nothing reads it as gate input) refreshed idempotently per failure, plus a stdout line — and keeps waiting. A digest guard records the failing gate-file digest and re-attempts only after the digest changes (no 1s-tick hot loop; the sibling file never touches the gate file's digest bookkeeping — the reason the in-file banner alternative was rejected). Machine-producer failures stay crash-shaped and unclassified: they must never enter the C6 declared-failure lane, because the bracket catch presenting an escalation gate over a pending final-gate version stacks two unanswered versions.

### D4 — Attempt-scoped claims (folds the deadline wedge, W1–W3)

One claim name (`gate-<v>.settle-claim`, pid-carried so dead-pid stealing already applies), held for one settle attempt: claim → parse/integrity → append-or-reject → release. Self-reclaim passes (holder identity equals claimant). The deadline expiry path takes the same claim around its ladder settle instead of its permanent timestamp `expiry-claim`; the legacy honored-as-held check in `claimGateSettle` retires. After the first expiry attempt releases, hand settles during a re-arm window work, and a second deadline re-runs the ladder instead of reporting an already-held claim. Races between releasing and re-claiming are edge IPC — appended events remain the only truth. Claims are never truth, so no migration: stale `expiry-claim` files from in-flight runs simply stop blocking (that is the heal).

### D5 — Mid-presentation window: heal the bracket, check the answer

Resume gains one recovery rule beside the owed-presentation/escalation/mover family: position awaiting + presented-unanswered + an orphaned active non-gate stage (the presenting `atomicity`, or `decompose` on depth-S) → append the owed `stage_exit` for that stage before parking. This heals both kill -9 and producer-crash shapes, unblocks the completed guard, and — with D4 — means a producer-lane throw is loud *and safe*: crash → resume heals → human gate. Belt-and-suspenders: the waiter's tick exits as external when the gate record is already answered, killing the duplicate-settle storm class outright.

### D6 — The veto payload stays file-borne

The settle event carries the outcome only (unchanged schema); the gate-level redirect lives in the gate file from settle to revision. Verified durable: only presentation (new version) and settle (the same version) ever write `gate-<v>.md`, and D2 guarantees the render preserves the directive. `runVetoRevision` no-ops only on vetoes-empty *and* null gate-redirect; `runVetoUpdater` receives the whole-gate redirect as a first-class input field rendered as its own prompt section (its `^A\d+$`/`^F\d+$` filters would silently drop any synthetic-id hack).

### D7 — Steer grammar mapping and hygiene

`veto <id>=<redirect>` stays an item veto; `veto` alone or `veto <text>` (no `=`) maps to the gate-level veto; first lines matching no directive grammar are consumed with a warning instead of lingering unexamined forever. Extend-at-final and veto-at-escalation keep their warn-and-skip behavior.

## Risks / Trade-offs

- [Render/parse grammar drift reintroduces silent flips] → shared directive constants (D2) + the pre-flight roundtrip as a hard gate + roundtrip tests over every producer shape.
- [Zero-signal rejection changes hand-edit habits at 0/0/0 gates] → the rendered instructions and `### Decisions` block teach the new directives in the file itself; item-carrying gates are unaffected (boxes remain authoritative).
- [Claim churn under repeated rejections] → bounded by the digest guard (one claim cycle per human edit); claims are edge IPC, appended events are truth.
- [Owed-exit recovery misfires on a legitimately-open stage] → the rule fires only at awaiting + presented-unanswered + non-gate active stage, the exact orphan shape; review's early-gate park closes its bracket before parking, so it cannot collide.
- [Test surface grows across five suites plus new harnesses] → ordered test-first (tasks); the natural-sequence deadline harness also pins the W1 heal the old tests missed.

## Migration Plan

No log or event migration. Claim artifacts are per-run scratch; stale `expiry-claim` files stop being honored by D4's removal (the intended heal). Rollback is revert — no persistent state outlives the change.

## Open Questions

None — the exploration closed T1–T4′; T5–T8/T10 are pinned above (D3 surface choice, D3 message hint, D7 grammar, no waiter backoff beyond claim scoping).
