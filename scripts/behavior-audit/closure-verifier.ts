// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EntryPointHint } from './consolidate-agent.js'
import type { ClosureResult, EntryPointEntry } from './scores-types.js'

export interface CodeindexCandidate {
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly symbolKey: string
  readonly qualifiedName: string
  readonly snippet: string
}

export interface CodeindexResolver {
  readonly search: {
    findSymbolCandidates: (query: string) => Promise<readonly CodeindexCandidate[]>
  }
}

export interface HintResolvers {
  readonly commands: ReadonlySet<string>
  readonly tools: ReadonlySet<string>
  readonly routes: ReadonlySet<string>
  readonly codeindex: CodeindexResolver | null
}

function resolveInSet(hint: EntryPointHint, set: ReadonlySet<string>, evidencePath: string): EntryPointEntry {
  if (set.has(hint.identifier)) {
    return { ...hint, resolved: true, evidence: { filePath: evidencePath } }
  }
  return { ...hint, resolved: false, evidence: null }
}

async function resolveHandler(hint: EntryPointHint, codeindex: CodeindexResolver | null): Promise<EntryPointEntry> {
  if (codeindex === null) {
    return { ...hint, resolved: false, evidence: null }
  }
  try {
    const candidates = await codeindex.search.findSymbolCandidates(hint.identifier)
    const hit = candidates[0]
    if (hit === undefined) {
      return { ...hint, resolved: false, evidence: null }
    }
    return {
      ...hint,
      resolved: true,
      evidence: { filePath: hit.filePath, symbol: hit.qualifiedName },
    }
  } catch {
    return { ...hint, resolved: false, evidence: null }
  }
}

export function resolveHint(hint: EntryPointHint, resolvers: HintResolvers): Promise<EntryPointEntry> {
  if (hint.kind === 'command') {
    return Promise.resolve(resolveInSet(hint, resolvers.commands, 'src/commands/'))
  }
  if (hint.kind === 'tool') {
    return Promise.resolve(resolveInSet(hint, resolvers.tools, 'src/tools/'))
  }
  if (hint.kind === 'route') {
    return Promise.resolve(resolveInSet(hint, resolvers.routes, 'src/debug/server.ts'))
  }
  return resolveHandler(hint, resolvers.codeindex)
}

export interface ClosureCheckBehavior {
  readonly id: string
  readonly entryPointHints: readonly EntryPointHint[]
  readonly userStory: string | null
}

export interface ClosureCheckInput {
  readonly behaviors: readonly ClosureCheckBehavior[]
  readonly resolvers: HintResolvers
}

export interface ClosureCheckResult {
  readonly entries: ReadonlyMap<string, ClosureResult>
}

function computeStatus(resolved: number, total: number, hintsProvided: boolean): ClosureResult['closureStatus'] {
  if (!hintsProvided) return 'unverified'
  if (total === 0) return 'unverified'
  if (resolved === total) return 'resolved'
  if (resolved === 0) return 'unresolved'
  return 'partial'
}

export async function runClosureCheck(input: ClosureCheckInput): Promise<ClosureCheckResult> {
  const pairs = await Promise.all(
    input.behaviors.map(async (behavior) => {
      const hints = behavior.entryPointHints
      const perHintResults = await Promise.all(hints.map((hint) => resolveHint(hint, input.resolvers)))
      const resolvedCount = perHintResults.filter((r) => r.resolved).length
      const status = computeStatus(resolvedCount, hints.length, hints.length > 0)
      const entry: ClosureResult = { closureStatus: status, entryPoints: perHintResults }
      return [behavior.id, entry] as const
    }),
  )
  return { entries: new Map<string, ClosureResult>(pairs) }
}
