<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` — Why for the three C8 findings and their red evidence. What shapes the approach, from the code as it stands:

- **The settle seam already has two registers, but only the file path contains both.** `settleGateFile` wraps everything in a total catch — parse, integrity, even boundary refusals — and returns `{kind: 'rejected'}`. `settleGateWithAnswers` (the steer, ladder, and expiry path) throws its pre-write failures (`preflightRoundtrip` — the F-C1 crash) and rethrows post-write rejections as the refusal alarm. The waiter's steer branch handles rejections only, so a preflight throw kills the attending process.
- **`verifyGateIntegrity` is response-independent** (reads the presentation-time `gate-hashes-<v>.json` sidecar, re-hashes the change folder — never the response content), but runs post-write inside `settleGateFileChecked`.
- **The ladder and the operator surface read different results.** `signalsOf` guards through `guardedReviewResult` (gate-prelude.ts:92); the presenters render from the raw `readReviewResultFromSidecars` (present-final.ts:126, early-gate.ts:75), and settle-time expected content comes from `expectedContentFor` (gate-settle.ts:274) — also raw. On a corrupt sidecar all three degrade to empty, so the substituted `POLICY-INTEGRITY` blocker exists only for the ladder.
- **The grammar already accommodates a substituted row.** `parseGateResponse` validates boxes and answers by membership in the expected lists (`expectedBlockerIds`) — there is no id-pattern wall; blockers are acknowledged by `→ <answer>` / `→ OVERRIDE` lines, which the rendered gate already instructs (gate-render.ts:82); `findingsOf` maps a resolution's `outcome` to the row's `evidence` field — exactly where `integrityBlocked` writes the failure reason.
- **The production waiter omits the expiry ports.** `waitSettledGates` (run-resume.ts:44) passes neither `repoRoot`/`autonomy` nor `now`, so `processExpiry` (gate-expiry.ts:58) returns null forever — deadlines arm and never claim. Behavior itself is already pinned by `gate-deadline.test.ts` with injected ports.

Scope-model / tool-prefs / DB / dependency impact: none — this is an offline runner change; no chat tool surface is touched (no capability or `tool_prefs` consequence), no new persisted state is keyed by any storage/config-context/platform/user id (all state stays run-dir artifacts and the event log), no drizzle migration, no new dependency. Every need lands in an existing module: steer containment in `work/gate-waiter.ts` + `work/gate-settle.ts`, the guarded render/expected seam across `work/gate-integrity.ts` + `work/gate-settle.ts` + `work/present-final.ts` + `work/early-gate.ts`, the expiry wiring in `run-resume.ts`. No new module is introduced.

## Goals / Non-Goals

**Goals:**

- Operator input can never kill the attending waiter **by construction** — input-shaped settle failures return data, engine bugs crash loud, and the two registers never mix.
- The rendered gate, the settle grammar, and the ladder see **literally the same** review result — an integrity-substituted gate renders its blocker and is acknowledgeable through the standard response grammar.
- Armed deadlines claim in production, with a repeatable in-process proof (the C8 drill (c) shape).

**Non-Goals:**

- No seam re-ordering: `verifyGateIntegrity` stays post-write (the declined hoist — see D1's residual).
- No policy changes to the ladder, deadline rules, or integrity thresholds; no new event types; the log grammar is untouched.
- No `looksAnswered` widening (see D4) and no response-grammar changes — the substituted row rides the existing blocker acknowledgment form.

## Decisions

### D1 — F-C1: preflight returns rejection; the containment line is structural

`settleGateWithAnswers`' pre-write phase (render + parse-back roundtrip) returns `{kind: 'rejected', reason}` instead of throwing — nothing is written and nothing is appended either way (the D2 preflight invariant of gate-settle-robustness is unchanged). Each producer then chooses its rejection policy:

- **Machine producers rethrow.** `runGatePrelude` and `gate-expiry`'s `settleExpiryDecision` convert rejections back into throws (the refusal alarm). Their `auto_decision` event is already appended when the settle runs — a settle that cannot land must stay loud, exactly as today.
- **The waiter's steer branch feeds rejections to the existing feedback path** (`feedbackAndKeepWaiting`): sibling artifact + stdout + keep waiting, steer file already consumed. Post-write throws (engine bugs) still crash.

After D1, everything that can throw on the steer path is an engine bug, and engine bugs crash everywhere. This is deliberately **stricter than the file path** (whose total catch converts even boundary refusals into feedback): an engine bug rendered as feedback produces a response-error the operator can only helplessly re-trigger.

*Alternatives rejected:* a total catch at the steer site — literal symmetry with the file path, but it converts engine bugs into helpless feedback and inherits the file path's theoretical answered-no-mover livelock (waiter exits external → re-drive parks → waiter exits external → …; owed-mover healing runs on resume, not the live re-drive). A catch-plus-fold-check (contain iff the re-fold shows no `answered` event) — honest, but adds machinery for a never-observed shape and races at the claim-release seam.

**Named residual (operator decision, 2026-09-02: do not hoist).** A steer veto at a gate whose `gate-hashes-<v>.json` is corrupt or missing still crashes: `verifyGateIntegrity` runs post-write, its rejection rethrows. Hoisting it into the preflight phase is safe in principle (response-independent), but the `human_edits`/`driftCheck` emission would have to move with it rather than duplicate, and emission-order pins would need revisiting — real surgery for a never-observed shape. The crash is rare and stack-named; if it is ever observed live, hoisting is the pre-agreed follow-up.

### D2 — F-C1: steer rejections record their feedback unconditionally

`feedbackAndKeepWaiting` writes the response-error artifact only when the gate-file digest chain has an entry (`state.digests.at(-1)` defined) — a steer often lands before any stable file read, so the steer branch would degrade to a stdout-only rejection. The steer path instead writes `gate-<v>.response-error.md` directly:

- **One artifact surface**, heading marked `(steer)` — parse-inert by construction, same as the file path's.
- **The reason embeds the consumed directive** (`steer "veto F99=…" rejected: unknown finding F99`) — the operator no longer has the file to correlate against.
- **The digest is `sha256` of the steer directive line.** It can never equal a gate-file content digest, so `readFailedDigest`'s resume seeding stays inert for the file-path digest guard — no hand-edit is ever blocked by a steer rejection.

The file path's conditional write is untouched.

### D3 — F-C2: one guarded helper, applied at exactly three sites

The counts-integrity substitution enters operator-facing surfaces through one helper — `guardedReviewResult` applied where the fold is in hand — at:

1. **The final presenter's render** (present-final.ts:126): guard the review result before `findingsOf`, so the substituted blocker renders as a row (its `outcome` — "sidecar unparseable" / "count mismatch" — becomes the row's evidence via `findingsOf`'s existing mapping).
2. **The early presenter's render** (early-gate.ts:75): same wrap (see D4).
3. **The waiter's settle-time expected** (`attemptSettleOf`, gate-waiter.ts:157): `expectedContentFor`'s result guarded with the gate round's `DigestRecord` (the `step` fold already carries `perRound`; `WaiterContext` grows the record). Without this site, the rendered row is acknowledgeable only to be rejected — "unknown blocker POLICY-INTEGRITY" over an empty expected set — a booby trap worse than invisibility.

Render and settle therefore see **literally the same substituted blocker object**, and double-guarding (presenter result → prelude's internal guard) is idempotent — the requirement "the same guarded result the ladder decides on SHALL feed the operator surface" holds by construction. Concretely: either a `guardedExpectedContent(sidecarDir, round, mode, perRound)` wrapper or an optional `perRound` parameter on `expectedContentFor`, whichever reads cleaner at the three sites.

`readReviewResultFromSidecars` itself stays raw — guarding the shared reader would change resume routing (the deliberate contract recorded at gate-settle.ts:233); `review.ts`'s cap-hit routing and the escalation presenter (fixed content, no findings) are untouched. A substituted blocker displaces the early gate's `requiredAck: 'T1'` (`blockerIds.size ≥ 1`) — the row itself becomes the acknowledgment vehicle.

*Grammar facts this rides (verified, no changes needed):* boxes and answers validate by membership in the expected lists — no id-pattern wall; blockers are acknowledged by `→ <answer>`/`→ OVERRIDE`, the form the rendered gate already instructs.

### D4 — F-C2 scope: the early gate is included

The final gate's corruption window is real (round-close → tail = minutes of agent work — Run B pass 4); the early gate's live window is milliseconds (presentation follows round-close in-process, no re-render on resume). The fix includes the early gate anyway: the invariant "the operator surface shows what the ladder saw" is mode-agnostic, the helper from D3 makes the marginal cost one wrapped call, and a final-only fix would owe a permanent "why is early different" answer whose only defense is a window measurement a future refactor could invalidate. Invariant-completion, not evidence-chasing.

One interplay pinned rather than changed: an answer-only response (`→ acknowledged` with no directive) never trips `looksAnswered` — **pre-existing** for every blocker, not introduced here. The acknowledged form is answer + decision directive (`APPROVE` trips the heuristic; the parse then computes approve from the answered blocker). An end-to-end test pins render → answer + directive → waiter settle → `gate answered` approve. No `looksAnswered` widening.

### D5 — F-C3: wire the expiry ports in `waitSettledGates`; prove it at integration level

`waitSettledGates` grows three spread lines: `repoRoot: deps.config.repoRoot`, `autonomy: autonomyOf(deps.config)`, `now: deps.now ?? () => new Date()` — the same clock the append boundary uses. Everything else already exists: `processExpiry` claims under the standard pid-carried settle claim, re-runs the ladder with expiry semantics through the same `signalsOf` guard (D3 consistency for free), settles through the seam, and emits its `auto_decision` after the write — the emission order `analyze` already attributes as waiter-settled, so corpus attribution needs no change.

The wiring is **inert unless deadlines are configured** (`processExpiry` no-ops on `deadlineAt === null`; per-tick cost pre-deadline is nil — the early return precedes any fold). But it flips production semantics the design says out loud: for the first time a production waiter can auto-settle — an unattended gate whose ladder refuses (integrity-blocked, spend-gated) now resolves at expiry instead of parking forever. That is precisely what the spec already demands and what C8 drill (c) was blocked on; the audit events are what lets an operator answer "who settled my gate?".

The red test is integration-level (`awaitGateSettle` is a direct import, not a DI seam — asserting spread ports via `mock.module` fights the repo's DI preference for less confidence): a fake-pipeline run parks `gate-pending` under an autonomy config with a short `deadlineMinutes`; the injected `deps.now` advances past the deadline across `deps.gateWait.tick`s; assert the auto-settle, the `auto_decision{rule, decision}` appended after the write, and the single re-arm on the refuse-and-rearm branch. This converts drill (c) from a blocked live drill into a repeatable in-process proof.

## Risks / Trade-offs

- [A machine-producer caller forgets to rethrow D1's rejections — the settle silently no-ops after its `auto_decision` was appended] → The rethrow is explicit at both call sites (prelude, expiry) and pinned by tests: producer settle failure stays crash-shaped, with the decision event's presence making the loud path auditable.
- [The 2a residual: steer veto × corrupt hashes sidecar still kills the waiter] → Named deliberately (D1); rare, stack-named, and the pre-agreed follow-up (hoist `verifyGateIntegrity` pre-write, moving `human_edits` emission with it) if ever observed live.
- [Miss one of D3's three sites and the substituted row renders but cannot be acknowledged] → The sites are enumerated in D3 and covered by one end-to-end pin (render → acknowledge → settle through the waiter); the empty-expected hint already names the missing-sidecar cause if a site regresses.
- [Answer-only responses never trip the waiter's heuristic at substituted gates] → Pre-existing grammar for all blockers; pinned, not widened — the acknowledged form is answer + directive.
- [Production auto-settle surprises an operator who relied on inert deadlines] → Config-gated (`deadlineMinutes`), audited (`auto_decision` with the deciding rule), and attributed (`analyze`'s waiter fingerprint); the next live cycle re-opens drill (c) on the surface.

## Hook / TDD interactions

All implementation files are under `afk-runner/src/**` — the TDD write hooks gate every edit (red test first, no bypasses). Test-first order, matching the decision structure:

1. `tests/afk-runner/work/gate-settle.test.ts` — red: preflight failure returns `{kind: 'rejected'}` (D1 shape) and producer callers rethrow; then implement the seam change.
2. `tests/afk-runner/work/gate-waiter.test.ts` — red: a steer item-veto with a foreign id becomes the contained artifact (steer-marked, directive embedded, steer-line digest) and the waiter stays waiting; then implement D1's steer branch + D2.
3. `tests/afk-runner/work/gate-integrity.test.ts` + `present-final.test.ts` (+ the early-gate suite) — red: an unparseable sidecar renders the substituted blocker row with the failure reason as evidence; then D3's sites 1–2.
4. `tests/afk-runner/work/gate-settle.test.ts` — red: `expected` at a substituted gate declares `POLICY-INTEGRITY`, an answer + `APPROVE` settles approve, and the end-to-end pin (render → acknowledge → settle) holds; then D3's site 3.
5. Integration red (fake-pipeline harness): the armed deadline claims through `waitSettledGates`, emits `auto_decision` after the write, re-arms once; then D5's wiring.
