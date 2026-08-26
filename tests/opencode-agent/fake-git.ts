// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommitOutcome, Salvage } from '../../opencode-agent/src/git-commit.js'
import type { MergeOutcome } from '../../opencode-agent/src/git-merge.js'
import type { Git } from '../../opencode-agent/src/git.js'

/**
 * One scripted answer for a git method.
 *
 * - a plain value resolves every call with it;
 * - an `Error` rejects every call with it;
 * - a function is evaluated per call, so a test can move the outcome after
 *   construction (the harness fields a later test mutates);
 * - an array is a queue: one entry per call, and once exhausted the method
 *   falls back to its clean-success default.
 */
type Outcome<T> = T | Error | (() => T | Error) | Array<T | Error | (() => T | Error)>

/** Per-method scripted outcomes; anything absent answers its default. */
export interface GitScript {
  ensureBranch?: Outcome<void>
  resetBranchToBase?: Outcome<void>
  deleteRemoteBranch?: Outcome<void>
  commitAll?: Outcome<CommitOutcome>
  salvageAll?: Outcome<Salvage>
  reconcile?: Outcome<void>
  push?: Outcome<void>
  defaultBranch?: Outcome<string | null>
  headSha?: Outcome<string>
  changedSince?: Outcome<string[]>
  revertPaths?: Outcome<void>
  mergeBase?: Outcome<MergeOutcome>
  completeMerge?: Outcome<void>
  abortMerge?: Outcome<void>
}

export interface FakeGit {
  /** Pass where production code takes a `Git`. */
  readonly git: Git
  /**
   * Every recorded call as `method:arg` lines — the `io.gitCalls` idiom, so an
   * adopting suite keeps its assertion style. Read-only value probes
   * (`defaultBranch`, `headSha`) are deliberately unlogged: a flow's call list
   * reads as the operations it performed, not the values it polled.
   */
  readonly calls: string[]
  /** The live script — mutate or extend it after construction. */
  readonly script: GitScript
}

const DEFAULTS: { [K in keyof Git]: () => Awaited<ReturnType<Git[K]>> } = {
  ensureBranch: () => undefined,
  resetBranchToBase: () => undefined,
  deleteRemoteBranch: () => undefined,
  // `clean` — the tree that was already clean — is the outcome no caller has to
  // branch on; tests that want a commit script `commitAll`.
  commitAll: () => ({ kind: 'clean' }),
  salvageAll: () => ({ kind: 'clean' }),
  reconcile: () => undefined,
  push: () => undefined,
  defaultBranch: () => null,
  headSha: () => 'head-sha',
  changedSince: () => [],
  revertPaths: () => undefined,
  mergeBase: () => ({ kind: 'up-to-date' }),
  completeMerge: () => undefined,
  abortMerge: () => undefined,
}

const evaluate = <T>(outcome: T | Error | (() => T | Error)): T | Error =>
  outcome instanceof Function ? outcome() : outcome

const settle = <T>(value: T | Error): Promise<T> =>
  value instanceof Error ? Promise.reject(value) : Promise.resolve(value)

/**
 * The shared `Git` test double: scriptable per-call outcomes, a `method:arg`
 * call log, clean-success defaults for anything unscripted.
 *
 * For code whose behaviour is *around* git (orchestration, retry, ledger
 * effects). Tests asserting git's own semantics (merge outcomes, conflict
 * lists, argv shapes) keep real repositories or the runner-seam captures —
 * this double must not become the semantics oracle.
 */
export const fakeGit = (script: GitScript = {}): FakeGit => {
  const calls: string[] = []

  // `fallback` first: inference off the default has exactly one candidate. The
  // one array-valued member names its type explicitly — `string[]` would also
  // match the queue arm of `Outcome<T>` and infer `T` as the element type.
  const answer = <T>(fallback: () => T, entry: Outcome<T> | undefined): Promise<T> => {
    if (entry === undefined) return settle(fallback())
    const outcome: T | Error | (() => T | Error) = Array.isArray(entry) ? (entry.shift() ?? fallback()) : entry
    return settle(evaluate(outcome))
  }

  // The compile-time fidelity anchor (design D2): this binding is what makes a
  // `Git` member the double misses a type error here rather than an undefined
  // call at runtime. Keep it — do not `as` your way past it.
  const git: Git = {
    ensureBranch: (branch, base) => {
      calls.push(`ensureBranch:${branch}:${base}`)
      return answer(DEFAULTS.ensureBranch, script.ensureBranch)
    },
    resetBranchToBase: (branch, base) => {
      calls.push(`resetBranchToBase:${branch}:${base}`)
      return answer(DEFAULTS.resetBranchToBase, script.resetBranchToBase)
    },
    deleteRemoteBranch: (branch) => {
      calls.push(`deleteRemoteBranch:${branch}`)
      return answer(DEFAULTS.deleteRemoteBranch, script.deleteRemoteBranch)
    },
    commitAll: (message) => {
      calls.push(`commit:${message.split('\n')[0]}`)
      return answer(DEFAULTS.commitAll, script.commitAll)
    },
    salvageAll: (message) => {
      calls.push(`salvage:${message.split('\n')[0]}`)
      return answer(DEFAULTS.salvageAll, script.salvageAll)
    },
    reconcile: (branch) => {
      calls.push(`reconcile:${branch}`)
      return answer(DEFAULTS.reconcile, script.reconcile)
    },
    push: (branch, options) => {
      calls.push(`push:${branch}${options?.noVerify === true ? ':no-verify' : ''}`)
      return answer(DEFAULTS.push, script.push)
    },
    defaultBranch: () => answer(DEFAULTS.defaultBranch, script.defaultBranch),
    headSha: () => answer(DEFAULTS.headSha, script.headSha),
    changedSince: (sha) => {
      calls.push(`changedSince:${sha}`)
      return answer<string[]>(DEFAULTS.changedSince, script.changedSince)
    },
    revertPaths: (sha, paths) => {
      calls.push(`revertPaths:${sha}:${paths.join(',')}`)
      return answer(DEFAULTS.revertPaths, script.revertPaths)
    },
    mergeBase: (base) => {
      calls.push(`mergeBase:${base}`)
      return answer(DEFAULTS.mergeBase, script.mergeBase)
    },
    completeMerge: (message) => {
      calls.push(`completeMerge:${message.split('\n')[0]}`)
      return answer(DEFAULTS.completeMerge, script.completeMerge)
    },
    abortMerge: () => {
      calls.push('abortMerge')
      return answer(DEFAULTS.abortMerge, script.abortMerge)
    },
  }

  return { git, calls, script }
}
