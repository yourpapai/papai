// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LabelApi } from '../../opencode-agent/src/github-labels.js'
import { reconcileLabels, settleLabels } from '../../opencode-agent/src/labels.js'
import type { LabelDeps } from '../../opencode-agent/src/labels.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { initialState } from '../../opencode-agent/src/state-manager.js'
import type { AgentState, Phase, RunResult } from '../../opencode-agent/src/types.js'

const ISSUE = 42

const stateIn = (phase: Phase, patch: Partial<AgentState> = {}): AgentState => ({
  ...initialState(ISSUE),
  phase,
  ...patch,
})

interface LabelIo {
  /** What the issue carries, mutated by the writes the reconcile issues. */
  labels: string[]
  /**
   * Every call, in order and including the read.
   *
   * The whole claim being tested is about the calls, not the end state: a
   * clear-and-reapply reaches exactly the same set as a diff, and differs only
   * in how many timeline entries it left behind on the way.
   */
  calls: string[]
  warnings: string[]
  error: Error | null
}

const makeDeps = (labels: readonly string[] = [], labelPrefix: string | null = 'agent:'): [LabelDeps, LabelIo] => {
  const io: LabelIo = { labels: [...labels], calls: [], warnings: [], error: null }

  const record = (call: string, apply: () => void): Promise<void> => {
    io.calls.push(call)
    if (io.error !== null) return Promise.reject(io.error)
    apply()
    return Promise.resolve()
  }

  const github: LabelApi = {
    listLabels: (issueNumber): Promise<string[]> => {
      io.calls.push(`list:${issueNumber}`)
      return io.error === null ? Promise.resolve([...io.labels]) : Promise.reject(io.error)
    },
    addLabels: (_issueNumber, names): Promise<void> =>
      record(`+${names.join(',')}`, () => {
        io.labels.push(...names)
      }),
    removeLabel: (_issueNumber, name): Promise<void> =>
      record(`-${name}`, () => {
        io.labels = io.labels.filter((existing) => existing !== name)
      }),
    createLabel: (name, color): Promise<void> => record(`create:${name}:${color}`, () => undefined),
  }

  const log: Logger = {
    debug: (): void => {},
    info: (): void => {},
    warn: (_fields, message): void => void io.warnings.push(message),
    error: (): void => {},
  }

  return [{ github, log, config: { labelPrefix } }, io]
}

/** Just the writes: the read is not the thing a diff is judged on. */
const writes = (io: LabelIo): string[] => io.calls.filter((call) => !call.startsWith('list:'))

describe('reconcileLabels', () => {
  test('a state whose labels are already right writes nothing at all', async () => {
    // The point of computing a diff. A clear-and-reapply would issue a removal
    // and an add here — two timeline entries and a visible flicker — for a run
    // that changed nothing, which is most runs.
    const [deps, io] = makeDeps(['agent:plan-review', 'agent:needs-you'])

    await reconcileLabels(deps, stateIn('PLAN_REVIEW'), 'waiting')

    expect(writes(io)).toEqual([])
    expect(io.calls).toEqual([`list:${ISSUE}`])
  })

  test('a phase move is one add and one removal, nothing more', async () => {
    const [deps, io] = makeDeps(['agent:plan-review', 'agent:needs-you'])

    await reconcileLabels(deps, stateIn('REVIEW_AND_MUTATE'), 'working')

    expect(writes(io)).toEqual([
      'create:agent:implementing:1d76db',
      'create:agent:working:1d76db',
      '+agent:implementing,agent:working',
      '-agent:plan-review',
      '-agent:needs-you',
    ])
    expect(io.labels.sort()).toEqual(['agent:implementing', 'agent:working'])
  })

  test('an `agent:` label the state does not imply is removed', async () => {
    // The repair half, and the one easiest to leave out. It covers both a
    // hand-edited issue and the runner killed mid-flight that leaves
    // `agent:working` stranded on an issue nothing is working.
    const [deps, io] = makeDeps(['agent:done', 'agent:working', 'agent:plan-review', 'agent:needs-you'])

    await reconcileLabels(deps, stateIn('PLAN_REVIEW'), 'waiting')

    expect(writes(io)).toEqual(['-agent:done', '-agent:working'])
    expect(io.labels.sort()).toEqual(['agent:needs-you', 'agent:plan-review'])
  })

  test('a label the repository owns is left strictly alone', async () => {
    // The worst thing this module could do. `bug` and `agentic-workflows` are
    // somebody else's labels: this pipeline did not put them there, and
    // "remove what I do not recognise" would take them off every issue it runs
    // on. Note `agentic-workflows` — it shares a prefix with the *word*, and
    // only the configured `agent:` decides ownership.
    const [deps, io] = makeDeps(['bug', 'agentic-workflows', 'agent:done'])

    await reconcileLabels(deps, stateIn('PLAN_REVIEW'), 'waiting')

    expect(writes(io)).toEqual([
      'create:agent:plan-review:d4a72c',
      'create:agent:needs-you:d4a72c',
      '+agent:plan-review,agent:needs-you',
      '-agent:done',
    ])
    expect(io.labels).toContain('bug')
    expect(io.labels).toContain('agentic-workflows')
  })

  test('a custom prefix is what decides ownership, end to end', async () => {
    // The knob is not optional polish: this pipeline runs in repositories with
    // their own conventions. Under `bot/`, an `agent:` label is one of *theirs*
    // and must survive untouched.
    const [deps, io] = makeDeps(['bot/done', 'agent:done'], 'bot/')

    await reconcileLabels(deps, stateIn('DESIGN_SPEC'), 'waiting')

    expect(writes(io)).toEqual([
      'create:bot/spec-review:d4a72c',
      'create:bot/needs-you:d4a72c',
      '+bot/spec-review,bot/needs-you',
      '-bot/done',
    ])
    expect(io.labels).toContain('agent:done')
  })

  test('`none` issues no label call of any kind, not even the read', async () => {
    const [deps, io] = makeDeps(['agent:done'], null)

    await reconcileLabels(deps, stateIn('PLAN_REVIEW'), 'waiting')

    expect(io.calls).toEqual([])
    expect(io.labels).toEqual(['agent:done'])
  })

  test('a GitHub that refuses every label call resolves and warns', async () => {
    // Rule 1, at the level it is enforced: one function is the only door to the
    // label API, and it swallows everything. A token without `issues: write`, a
    // fork run and an org policy on label creation are all real.
    const [deps, io] = makeDeps(['agent:done'])
    io.error = new Error('Resource not accessible by integration')

    await reconcileLabels(deps, stateIn('PLAN_REVIEW'), 'waiting')

    expect(io.warnings).toEqual(['Could not reconcile the issue labels'])
  })

  test('a refusal partway through still leaves the run to carry on', async () => {
    // The read succeeds, the first write does not — the shape a token with
    // read-only issue access presents.
    const [deps, io] = makeDeps(['agent:done'])
    const failing: LabelDeps = {
      ...deps,
      github: { ...deps.github, createLabel: (): Promise<void> => Promise.reject(new Error('403')) },
    }

    await reconcileLabels(failing, stateIn('PLAN_REVIEW'), 'waiting')

    expect(io.warnings).toEqual(['Could not reconcile the issue labels'])
  })

  test('the issue it labels is the one the state names', async () => {
    const [deps, io] = makeDeps()

    await reconcileLabels(deps, { ...stateIn('FAILED'), issueId: 99 }, 'waiting')

    expect(io.calls[0]).toBe('list:99')
  })
})

describe('settleLabels', () => {
  const result = (state: AgentState | null): RunResult => ({
    status: 'skipped',
    reason: 'nothing to do',
    state,
    reported: false,
  })

  test('hands the result back untouched', async () => {
    // A label is not a report, and this is the function every exit goes through:
    // if it could alter a `RunResult`, it could suppress the workflow's fallback
    // comment.
    const [deps] = makeDeps()
    const original = result(stateIn('PLAN_REVIEW'))

    expect(await settleLabels(deps, original, stateIn('DESIGN_SPEC'))).toBe(original)
  })

  test('reconciles from the run’s own state when it has one', async () => {
    const [deps, io] = makeDeps(['agent:working'])

    await settleLabels(deps, result(stateIn('PLAN_REVIEW')), stateIn('DESIGN_SPEC'))

    expect(io.labels.sort()).toEqual(['agent:needs-you', 'agent:plan-review'])
  })

  test('falls back to the restored state for a run that carries none', async () => {
    // A guardrail-shaped skip reports `state: null`. Reconciling the restored
    // state is still the repair, which is what takes a stranded `agent:working`
    // off an issue whose only event this hour was somebody typing "thanks".
    const [deps, io] = makeDeps(['agent:working', 'agent:spec-review'])

    await settleLabels(deps, result(null), stateIn('DESIGN_SPEC'))

    expect(writes(io)).toEqual(['create:agent:needs-you:d4a72c', '+agent:needs-you', '-agent:working'])
  })
})
