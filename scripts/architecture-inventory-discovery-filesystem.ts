import {
  benchmarkScriptSeed,
  candidateFromWorkspace,
  type CandidateSeed,
  type FilesystemDiscoveryInput,
  makeCandidate,
  matchRule,
  seed,
  uniqueCandidates,
} from './architecture-inventory-discovery-common.js'
import type { PieceCandidate } from './architecture-inventory-model.js'

const srcEntryRules: Readonly<Record<string, CandidateSeed>> = {
  'src/tools': seed(
    'tool registry and capability gating',
    'cross-cutting-concept',
    'active',
    'Tool assembly and gating.',
    ['src/tools'],
    [],
  ),
  'src/providers': seed(
    'task provider adapters',
    'integration-provider',
    'active',
    'Provider adapter layer.',
    ['src/providers'],
    [],
  ),
  'src/message-queue': seed(
    'message queue',
    'runtime-subsystem',
    'active',
    'Queued prompt subsystem.',
    ['src/message-queue'],
    [],
  ),
  'src/identity': seed(
    'identity mapping',
    'product-feature',
    'active',
    'Identity mapping subsystem.',
    ['src/identity'],
    [],
  ),
  'src/web': seed('web fetch', 'product-feature', 'active', 'Web fetch subsystem.', ['src/web'], []),
}

const scriptPathRules = [
  [
    'tool-surface-benchmark',
    seed(
      'tool-surface benchmark',
      'analysis-tool',
      'experimental',
      'Tool-surface benchmark script family.',
      ['scripts'],
      ['benchmark'],
    ),
  ],
  [
    'behavior-audit',
    seed(
      'behavior-audit scripts',
      'analysis-tool',
      'experimental',
      'Behavior-audit script family.',
      ['scripts/behavior-audit'],
      ['audit'],
    ),
  ],
] as const

const historicalDocRules = [
  [
    'provider-capability-architecture',
    seed(
      'provider capability architecture',
      'experimental-or-legacy-variant',
      'legacy',
      'Archived provider capability architecture design and plan.',
      ['docs/archive/provider-capability-architecture-design-2026-04-10.md'],
      ['legacy'],
    ),
  ],
  [
    'behavior-audit',
    seed(
      'archived behavior-audit variants',
      'experimental-or-legacy-variant',
      'legacy',
      'Archived or remaining behavior-audit design work.',
      ['docs/superpowers/remaining/2026-04-23-behavior-audit-legacy-cleanup.md'],
      ['legacy', 'audit'],
    ),
  ],
] as const

const debugClientSeed = seed(
  'debug server and dashboard client',
  'runtime-subsystem',
  'active',
  'Debug dashboard client.',
  ['client/debug'],
  ['debug'],
)

const behaviorAuditTestSeed = seed(
  'behavior-audit scripts',
  'analysis-tool',
  'experimental',
  'Behavior-audit scripts confirmed by tests.',
  ['scripts/behavior-audit'],
  ['audit'],
)

const candidateFromSrcPath = (entry: string): PieceCandidate | null => {
  if (entry === 'src/index.ts' || entry === 'src/bot.ts') {
    return makeCandidate(
      seed(
        'bot runtime and startup',
        'runtime-subsystem',
        'active',
        'Runtime entrypoint and bot orchestration.',
        [entry],
        [],
      ),
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  const candidateSeed = srcEntryRules[entry]
  return candidateSeed === undefined ? null : makeCandidate(candidateSeed, { kind: 'filesystem', location: entry })
}

const candidateFromFilesystemScript = (entry: string): PieceCandidate | null => {
  if (entry === 'scripts/plan-adr-workflow.ts') {
    return makeCandidate(
      seed('ADR planning workflow', 'developer-workflow', 'active', 'Plan to ADR archiving workflow.', [entry], []),
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'scripts/build-client.ts') {
    return makeCandidate(
      seed('client build workflow', 'developer-workflow', 'active', 'Debug dashboard build workflow.', [entry], []),
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry.includes('benchmark')) {
    return makeCandidate(benchmarkScriptSeed, { kind: 'filesystem', location: entry })
  }

  return matchRule(entry, scriptPathRules, 'filesystem')
}

const clientCandidatesFrom = (entries: readonly string[]): readonly PieceCandidate[] =>
  entries.flatMap((entry) =>
    entry === 'client/debug' ? [makeCandidate(debugClientSeed, { kind: 'filesystem', location: entry })] : [],
  )

const testCandidatesFrom = (entries: readonly string[]): readonly PieceCandidate[] =>
  entries.flatMap((entry) =>
    entry.includes('behavior-audit') ? [makeCandidate(behaviorAuditTestSeed, { kind: 'tests', location: entry })] : [],
  )

const topLevelWorkspaceCandidatesFrom = (entries: readonly string[]): readonly PieceCandidate[] =>
  entries.flatMap((entry) =>
    entry === 'codeindex'
      ? [candidateFromWorkspace('codeindex')]
      : entry === 'review-loop'
        ? [candidateFromWorkspace('review-loop')]
        : [],
  )

const historicalCandidatesFrom = (entries: readonly string[]): readonly PieceCandidate[] =>
  entries.flatMap((entry) => {
    const candidate = matchRule(entry, historicalDocRules, 'archive-doc')
    return candidate === null ? [] : [candidate]
  })

export const discoverFilesystemPieceCandidates = (
  input: Readonly<FilesystemDiscoveryInput>,
): readonly PieceCandidate[] =>
  uniqueCandidates([
    ...input.srcEntries.flatMap((entry) => {
      const candidate = candidateFromSrcPath(entry)
      return candidate === null ? [] : [candidate]
    }),
    ...clientCandidatesFrom(input.clientEntries),
    ...input.scriptEntries.flatMap((entry) => {
      const candidate = candidateFromFilesystemScript(entry)
      return candidate === null ? [] : [candidate]
    }),
    ...testCandidatesFrom(input.testEntries),
    ...topLevelWorkspaceCandidatesFrom(input.topLevelEntries),
    ...historicalCandidatesFrom(input.historicalDocEntries),
  ])
