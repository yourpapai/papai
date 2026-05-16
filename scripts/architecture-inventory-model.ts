// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const PIECE_TYPES = [
  'runtime-subsystem',
  'product-feature',
  'integration-provider',
  'developer-workflow',
  'analysis-tool',
  'experimental-or-legacy-variant',
  'cross-cutting-concept',
] as const

export const PIECE_STATUSES = ['active', 'experimental', 'legacy', 'unclear'] as const

export const SIGNAL_NAMES = [
  'no-current-runtime-entrypoint',
  'no-current-script-entrypoint',
  'no-tests-found',
  'no-current-docs-found',
  'docs-code-mismatch',
  'historical-docs-only',
  'overlapping-implementation-detected',
  'provider-capability-not-surfaced',
  'script-only-existence',
  'benchmark-only-existence',
  'audit-only-existence',
  'declared-but-not-wired',
  'wired-but-lightly-referenced',
  'variant-with-same-purpose',
  'status-unclear',
] as const

export type PieceType = (typeof PIECE_TYPES)[number]
export type PieceStatus = (typeof PIECE_STATUSES)[number]
export type SignalName = (typeof SIGNAL_NAMES)[number]

export type PieceSourceKind =
  | 'readme'
  | 'claude'
  | 'roadmap'
  | 'package-workspace'
  | 'package-script'
  | 'filesystem'
  | 'tests'
  | 'archive-doc'

export interface PieceSource {
  readonly kind: PieceSourceKind
  readonly location: string
}

export interface PieceCandidate {
  readonly name: string
  readonly type: PieceType
  readonly status: PieceStatus
  readonly summary: string
  readonly declaredPaths: readonly string[]
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
  readonly sources: readonly PieceSource[]
}

export interface PieceSignal {
  readonly name: SignalName
  readonly evidence: readonly string[]
}

export interface PieceRecord extends PieceCandidate {
  readonly pieceId: string
  readonly primaryPaths: readonly string[]
  readonly secondaryPaths: readonly string[]
  readonly entrypoints: readonly string[]
  readonly relatedTests: readonly string[]
  readonly relatedDocs: readonly string[]
  readonly relatedScripts: readonly string[]
  readonly configOrEnvDependencies: readonly string[]
  readonly runtimeDependencies: readonly string[]
  readonly dependents: readonly string[]
  readonly signals: readonly PieceSignal[]
  readonly manualReviewQuestions: readonly string[]
}

export const MANDATORY_SCOPE_FAMILIES: readonly PieceCandidate[] = [
  {
    name: 'bot runtime and startup',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Entry-point runtime and bot orchestration.',
    declaredPaths: ['src/index.ts', 'src/bot.ts'],
    aliases: ['runtime', 'bot'],
    tags: ['runtime'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'chat provider adapters',
    type: 'integration-provider',
    status: 'active',
    summary: 'Telegram, Mattermost, and Discord adapter layer.',
    declaredPaths: ['src/chat'],
    aliases: ['chat providers'],
    tags: ['chat'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'task provider adapters',
    type: 'integration-provider',
    status: 'active',
    summary: 'Kaneo and YouTrack normalized provider layer.',
    declaredPaths: ['src/providers'],
    aliases: ['task providers'],
    tags: ['provider'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'tool registry and capability gating',
    type: 'cross-cutting-concept',
    status: 'active',
    summary: 'Tool assembly and capability-based exposure rules.',
    declaredPaths: ['src/tools'],
    aliases: ['tool registry'],
    tags: ['tools'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'conversation history, memory, and context storage',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Conversation state, memory, and storage-context logic.',
    declaredPaths: ['src/conversation.ts', 'src/history.ts', 'src/memory.ts'],
    aliases: ['conversation memory'],
    tags: ['memory'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'identity mapping',
    type: 'product-feature',
    status: 'active',
    summary: 'Chat identity to provider identity resolution.',
    declaredPaths: ['src/identity'],
    aliases: ['identity'],
    tags: ['identity'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'group settings and configuration flows',
    type: 'product-feature',
    status: 'active',
    summary: 'Setup, config, and group-target selection flows.',
    declaredPaths: ['src/group-settings', 'src/commands'],
    aliases: ['group settings'],
    tags: ['config'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'message queue',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Queued prompt handling and orderly dispatch.',
    declaredPaths: ['src/message-queue'],
    aliases: ['message queueing'],
    tags: ['queue'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'file relay',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Turn-scoped file relay for attachments.',
    declaredPaths: ['src/file-relay.ts'],
    aliases: ['attachments relay'],
    tags: ['files'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'web fetch',
    type: 'product-feature',
    status: 'active',
    summary: 'Public web fetch, extraction, and caching behavior.',
    declaredPaths: ['src/web'],
    aliases: ['web_fetch'],
    tags: ['web'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'recurring tasks',
    type: 'product-feature',
    status: 'active',
    summary: 'Recurring work automation feature family.',
    declaredPaths: [],
    aliases: ['recurrence'],
    tags: ['recurring'],
    sources: [{ kind: 'roadmap', location: 'mandatory-scope-family' }],
  },
  {
    name: 'deferred prompts',
    type: 'product-feature',
    status: 'active',
    summary: 'Scheduled prompt and delayed proactive assistance feature family.',
    declaredPaths: [],
    aliases: ['scheduled prompts'],
    tags: ['deferred'],
    sources: [{ kind: 'roadmap', location: 'mandatory-scope-family' }],
  },
  {
    name: 'debug server and dashboard client',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Optional debug server and local dashboard UI.',
    declaredPaths: ['src/debug', 'client/debug'],
    aliases: ['debug dashboard'],
    tags: ['debug'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'codeindex workspace',
    type: 'analysis-tool',
    status: 'active',
    summary: 'Symbol-first code indexing workspace.',
    declaredPaths: ['codeindex'],
    aliases: ['codeindex'],
    tags: ['workspace'],
    sources: [{ kind: 'package-workspace', location: 'mandatory-scope-family' }],
  },
  {
    name: 'review-loop workspace',
    type: 'analysis-tool',
    status: 'active',
    summary: 'Review-loop workflow workspace.',
    declaredPaths: ['review-loop'],
    aliases: ['review-loop'],
    tags: ['workspace'],
    sources: [{ kind: 'package-workspace', location: 'mandatory-scope-family' }],
  },
  {
    name: 'benchmark scripts',
    type: 'analysis-tool',
    status: 'experimental',
    summary: 'Advisory benchmark scripts and supporting scenarios.',
    declaredPaths: ['scripts'],
    aliases: ['benchmarks'],
    tags: ['benchmark'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'behavior-audit scripts',
    type: 'analysis-tool',
    status: 'experimental',
    summary: 'Behavior-audit extraction, classification, and reporting workflow.',
    declaredPaths: ['scripts/behavior-audit'],
    aliases: ['behavior audit'],
    tags: ['audit'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'release, deploy, and verification workflows',
    type: 'developer-workflow',
    status: 'active',
    summary: 'Release, deployment, verification, and repo-maintenance workflows.',
    declaredPaths: ['scripts', '.github'],
    aliases: ['release workflow'],
    tags: ['workflow'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'archived or alternate behavior implementations',
    type: 'experimental-or-legacy-variant',
    status: 'legacy',
    summary: 'Historical or alternate implementations retained for reference.',
    declaredPaths: ['docs/archive', 'docs/superpowers/remaining'],
    aliases: ['legacy variants'],
    tags: ['legacy'],
    sources: [{ kind: 'archive-doc', location: 'mandatory-scope-family' }],
  },
  {
    name: 'provider capabilities not surfaced at tool level',
    type: 'cross-cutting-concept',
    status: 'unclear',
    summary: 'Provider capabilities available in the provider layer but not exposed as tools.',
    declaredPaths: ['src/providers/types.ts', 'src/tools'],
    aliases: ['provider capability surface'],
    tags: ['capabilities'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
] as const

export const slugifyPieceName = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+/g, '')
    .replaceAll(/-+$/g, '')
