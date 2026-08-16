// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { stripBlocks } from './blocks.js'
import type { IssueComment } from './blocks.js'
import type { UntrustedEnvelope } from './prompts.js'
import { STATUS_MARKER } from './reply-comment.js'

/**
 * How much text a prompt is allowed to carry, and which text loses when it does
 * not all fit.
 *
 * Split out of `prompts.ts` when the check-output cap was added: that file says
 * *what* to ask the model, this one says *how much*, and the two were already
 * changing for different reasons. Every cap here is on the finished prompt
 * rather than on any one input, because the prompt is the thing being paid for
 * — a per-input cap bounds one log and nothing else.
 */

/** Characters of thread context handed to the model; the newest are kept. */
const THREAD_BUDGET = 12_000

/** Comments handed to the model, newest last. */
const THREAD_LIMIT = 20

/**
 * GitHub logins are `[A-Za-z0-9-]`, but this value is interpolated into a
 * delimiter attribute, so it is filtered rather than trusted to stay that way.
 */
const authorAttribute = (login: string): string => {
  const safe = login.replace(/[^\w-]/gu, '')
  return `comment by ${safe.length > 0 ? safe : 'unknown'}`
}

/**
 * Cuts a body where it stops speaking to a human.
 *
 * This used to **drop** the whole comment, which was right while the agent
 * posted a progress table and its reports separately: one status comment per run
 * would otherwise have spent a quarter of the twenty slots on tables the model
 * has no use for. The two are now one comment, so dropping it would hide the
 * answer, the design digest and the plan — precisely the artefacts this renderer
 * exists to show the model.
 *
 * So the marker changed jobs rather than the filter changing targets: it means
 * *the bookkeeping starts here*, `renderReply` puts the marker directly below
 * the last section, and everything from it down is cut — the run detail
 * included, since a progress table is bookkeeping. By **marker**, never by author —
 * the agent writes the artefacts too, so filtering on the login would blind the
 * model to its own work, which is the much quieter version of the same bug.
 *
 * The **first** occurrence, not the last: a section is model-written and could
 * type the marker verbatim, and cutting at the first makes that a report which
 * ends early rather than bookkeeping that leaks into the window.
 */
const untilBookkeeping = (body: string): string => {
  const marker = body.indexOf(`<!-- ${STATUS_MARKER}:`)
  return marker === -1 ? body : body.slice(0, marker)
}

/**
 * Renders the issue thread for prompt context, newest last.
 *
 * **Each comment gets its own envelope**, with its author in the `source`
 * attribute. A single envelope around a plain-text transcript protected the
 * boundary and said nothing about the structure inside it: every comment was
 * prefixed `[comment by <login>]` as in-band text, so a body containing that
 * same line fabricated a turn. Anyone can comment on a public issue — the
 * guardrails stop a non-maintainer *triggering* the agent, not their text
 * reaching the prompt — so a drive-by commenter could forge a maintainer's
 * approval. Moving the attribution into the delimiter puts it where a nonce
 * the commenter cannot guess protects it.
 *
 * Hidden blocks are stripped: they are the pipeline's own bookkeeping, they are
 * large, and showing the model its own state schema invites it to write one.
 * Each body is cut at its bookkeeping marker first — see {@link untilBookkeeping}
 * — which is what keeps every previous run's progress table out of the twenty
 * slots the phases that read this depend on: triage, answering and the
 * classifier, which is to say the ones whose whole job is understanding what
 * the humans said.
 */
export const renderThread = (
  envelope: UntrustedEnvelope,
  thread: readonly IssueComment[],
  limit = THREAD_LIMIT,
  budget = THREAD_BUDGET,
): string => {
  const rendered = thread
    .slice(-limit)
    .map((comment) =>
      wrapWithin(envelope, authorAttribute(comment.authorLogin), stripBlocks(untilBookkeeping(comment.body)), budget),
    )
  if (rendered.length === 0) return '(no comments yet)'

  const kept = withinBudget(rendered, budget)
  const trimmed = kept.length < rendered.length ? '…(earlier comments trimmed)…\n\n' : ''
  return `${trimmed}${kept.join('\n\n')}`
}

const TRUNCATION_NOTE = '…(truncated)…\n'

/**
 * Wraps one comment, clipping its **body** so the finished envelope fits.
 *
 * The body, never the envelope. The old renderer sliced the tail off a
 * concatenated transcript, which with per-comment delimiters would cut through
 * one and hand the model a block with no terminator — the exact confusion the
 * envelope exists to prevent.
 */
const wrapWithin = (envelope: UntrustedEnvelope, source: string, body: string, budget: number): string => {
  const wrapped = envelope.wrap(source, body)
  if (wrapped.length <= budget) return wrapped

  const room = budget - (wrapped.length - body.length) - TRUNCATION_NOTE.length
  return envelope.wrap(source, `${TRUNCATION_NOTE}${body.slice(-Math.max(room, 0))}`)
}

/**
 * Keeps the newest comments that fit, whole. At least one is always kept — an
 * empty thread reads as "nothing was said", which is a different claim.
 */
const withinBudget = (rendered: readonly string[], budget: number): string[] => {
  const kept: string[] = []
  let used = 0

  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const entry = rendered[index]
    if (entry === undefined) continue
    if (kept.length > 0 && used + entry.length > budget) break
    kept.unshift(entry)
    used += entry.length
  }

  return kept
}

/**
 * Characters of check output handed to the repair agent, across **all** failures.
 *
 * `check-loop.ts` caps each failure at 8k on the way in, which bounds one log
 * and nothing else: three red checks put 24k into every repair round, and the
 * round budget means that prompt is sent again on each one. An aggregate cap is
 * the only one that bounds the prompt.
 */
export const CHECK_OUTPUT_BUDGET = 12_000

/**
 * Splits a budget across items, then hands back what the small ones did not need.
 *
 * A flat `budget / count` would spend a third of the room on a 200-character
 * lint error while cutting the 20k test log that is the actual failure. Repeated
 * passes give every item an equal share, settle the ones that fit inside it, and
 * re-divide the remainder among the rest — so the large outputs end up with
 * everything the small ones left behind.
 */
export const shareBudget = (sizes: readonly number[], budget: number): number[] => {
  const shares = sizes.map(() => 0)
  let open = sizes.map((_, index) => index)
  let remaining = budget

  while (open.length > 0) {
    const share = Math.floor(remaining / open.length)
    const fitting = open.filter((index) => (sizes[index] ?? 0) <= share)
    if (fitting.length === 0) {
      for (const index of open) shares[index] = share
      break
    }
    for (const index of fitting) {
      const size = sizes[index] ?? 0
      shares[index] = size
      remaining -= size
    }
    open = open.filter((index) => (sizes[index] ?? 0) > share)
  }

  return shares
}
