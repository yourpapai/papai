// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * How the persisted state block is **versioned**: the two constants that say
 * when a stored block still means what it says, and what it costs to decide it
 * does not.
 *
 * Split out of `agent-state.ts` when that file passed `max-lines`, along a seam
 * it had already grown: that file says what an issue remembers, this one says
 * how to change that shape without stranding an issue mid-flight. The two are
 * read at different moments — the schema on every restore, this doctrine once,
 * by whoever is about to add or redefine a field — and the arrangement is
 * `phase-names.ts`'s, split from a module and re-exported by it so callers keep
 * naming one module for the vocabulary.
 *
 * The pair is deliberately together. They are the two answers to one question,
 * and the whole point of the second is that it is the proportionate alternative
 * to the first; a reader reaching for a bump should meet the cheaper mechanism
 * in the same breath.
 */

/**
 * Bumped when the persisted shape changes in a way old blocks cannot satisfy.
 *
 * v3 is a **deliberate stranding** (design D12): the opencode-agent rework
 * retires `AGENT_SPEC`/`AGENT_PLAN` artefact blocks outright and moves planning
 * onto a real `openspec/changes/<name>/` folder, so an in-flight issue's legacy
 * state describes a pipeline that no longer exists. Rather than carry a dual
 * format, v2 blocks are rejected by the schema, the restore scan finds nothing
 * valid, and the issue restarts at `INIT_OR_CLARIFY` under the compliant
 * pipeline (with its `agent/issue-<n>` branch reset — D12). The migration
 * precedent avoided bumps because stranding was the cost; here stranding is the
 * chosen behaviour, and restart-with-reset is the recovery path.
 */
export const STATE_VERSION = 3

/**
 * Which definition of "a token" produced a block's `tokensSpent`.
 *
 * **1** — every bucket the backend reported, cache reads included. **2** — the
 * `countedTokens` definition: what entered the conversation once. See that
 * function for why the first was wrong; what matters here is that the two are
 * not comparable, and an issue's ceiling spans every job it has run. A total
 * that adds a scale-1 figure to a scale-2 one is enforceable against neither.
 *
 * A marker rather than a `STATE_VERSION` bump because a bump means *stranding*
 * (D12): the block is rejected, the restore scan finds nothing, and the issue
 * restarts at `INIT_OR_CLARIFY` with its branch reset. Correct for a pipeline
 * whose shape changed; wildly disproportionate for a counter. Issue #385 would
 * have lost an approved proposal and plan to it.
 *
 * An ordinal rather than a boolean, because "has the fix been applied" is a
 * fact about a patch while "which definition produced this figure" is the fact
 * that stays true. The next time the definition moves, bump this and the
 * one-shot correction in `orchestrator.ts` runs again for free.
 */
export const TOKEN_SCALE = 2
