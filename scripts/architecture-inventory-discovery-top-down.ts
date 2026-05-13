import {
  extractBacktickedPaths,
  makeCandidate,
  matchRule,
  packageScriptCandidatesFrom,
  seed,
  type TopDownDiscoveryInput,
  uniqueCandidates,
  workspaceCandidatesFrom,
} from './architecture-inventory-discovery-common.js'
import type { PieceCandidate } from './architecture-inventory-model.js'
import { MANDATORY_SCOPE_FAMILIES } from './architecture-inventory-model.js'

const docRules = [
  [
    'src/tools',
    seed(
      'tool registry and capability gating',
      'cross-cutting-concept',
      'active',
      'Tool assembly and capability gating.',
      ['src/tools'],
      ['tools'],
    ),
  ],
  [
    'src/providers',
    seed(
      'task provider adapters',
      'integration-provider',
      'active',
      'Task provider adapter layer.',
      ['src/providers'],
      ['provider'],
    ),
  ],
  [
    'src/debug',
    seed(
      'debug server and dashboard client',
      'runtime-subsystem',
      'active',
      'Optional local debug server and dashboard client.',
      ['src/debug', 'client/debug'],
      ['debug'],
    ),
  ],
  [
    'client/debug',
    seed(
      'debug server and dashboard client',
      'runtime-subsystem',
      'active',
      'Optional local debug server and dashboard client.',
      ['src/debug', 'client/debug'],
      ['debug'],
    ),
  ],
  [
    'src/message-queue',
    seed('message queue', 'runtime-subsystem', 'active', 'Queued prompt handling.', ['src/message-queue'], []),
  ],
  ['src/web', seed('web fetch', 'product-feature', 'active', 'Web fetch and extraction pipeline.', ['src/web'], [])],
  [
    'src/group-settings',
    seed(
      'group settings and configuration flows',
      'product-feature',
      'active',
      'Setup and group-target configuration flows.',
      ['src/group-settings'],
      ['config'],
    ),
  ],
] as const

const extractRoadmapFamilies = (roadmap: string): readonly PieceCandidate[] =>
  roadmap.split('\n').flatMap((line): readonly PieceCandidate[] => {
    if (line.includes('Deferred Prompt') || line.includes('deferred prompt')) {
      return [
        makeCandidate(
          seed('deferred prompts', 'product-feature', 'active', 'Deferred prompt feature family.', [], ['deferred']),
          {
            kind: 'roadmap',
            location: line,
          },
        ),
      ]
    }

    if (line.includes('Recurring Work') || line.includes('recurring')) {
      return [
        makeCandidate(
          seed('recurring tasks', 'product-feature', 'active', 'Recurring task feature family.', [], ['recurring']),
          {
            kind: 'roadmap',
            location: line,
          },
        ),
      ]
    }

    return []
  })

export const extractTopDownPieceCandidates = (input: Readonly<TopDownDiscoveryInput>): readonly PieceCandidate[] => {
  const docCandidates = [
    ...extractBacktickedPaths(input.readme).flatMap((rawPath) => {
      const candidate = matchRule(rawPath, docRules, 'readme')
      return candidate === null ? [] : [candidate]
    }),
    ...extractBacktickedPaths(input.claude).flatMap((rawPath) => {
      const candidate = matchRule(rawPath, docRules, 'claude')
      return candidate === null ? [] : [candidate]
    }),
  ]

  return uniqueCandidates([
    ...MANDATORY_SCOPE_FAMILIES,
    ...docCandidates,
    ...extractRoadmapFamilies(input.roadmap),
    ...workspaceCandidatesFrom(input.packageJson.workspaces),
    ...packageScriptCandidatesFrom(input.packageJson.scripts),
  ])
}
