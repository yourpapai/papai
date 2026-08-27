// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Gate-file decision recognition: which markdown forms carry a human
 * decision. Shared by the deadline waiter and the direct resume paths so
 * the two never disagree on what counts as answered.
 */

/**
 * Whether a gate file parses as human-answered: at least one box checked
 * (assumption/finding/ack rows at early/final gates, `C<n>` child rows at
 * plan gates) or an answer section present.
 */
export function looksAnswered(md: string): boolean {
  return /-\s\[x\]\s*[AFTC]\d+/u.test(md) || md.includes('## Gate response')
}

const ABORT_LINE_RE = /^\s*ABORT\s*$/mu
const DIRECTIVE_LINE_RE = /^\s*→/mu

/**
 * Whether a gate file carries a human decision at all at plan mode: a checked
 * box or a response section (`looksAnswered`), an `ABORT` line, or a `→`
 * directive — the blessed hand-edit forms of a full plan veto. A freshly
 * presented digest has none of these — every C-box unchecked — and parsing it
 * as-is would veto every child and spend a replan, so a flagless resume of
 * such a file must abandon instead (mirroring the early/final TUI's
 * write-nothing abandon).
 */
export function planGateCarriesDecision(md: string): boolean {
  return looksAnswered(md) || ABORT_LINE_RE.test(md) || DIRECTIVE_LINE_RE.test(md)
}

/**
 * Mode-aware form of the same question for the waiter: the extra `→`/ABORT
 * forms count only at plan mode, because a fresh early-gate render already
 * carries `→ <answer or OVERRIDE>` placeholder lines beneath cap-hit blockers.
 */
export function carriesDecision(md: string, gateMode: 'early' | 'final' | 'plan'): boolean {
  return gateMode === 'plan' ? planGateCarriesDecision(md) : looksAnswered(md)
}
