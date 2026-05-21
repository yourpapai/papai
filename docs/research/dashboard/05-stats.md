<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Anonymous stats

Server source: `src/stats/types.ts` and `src/stats/index.ts`
(`getGlobalStats`, `getSubjectStats`). Routes in `src/debug/stats-routes.ts`.
Client schema mirror: `client/debug/stats/fetchers.ts`.

All payloads obey the project anonymity contract — see the project root
`CLAUDE.md` "Anonymity contract for `/stats/*`" section. Free-form
high-cardinality strings are SHA-256 keyed using the `stats_anonymity_salt`
row in `system_config`.

## Common types

```ts
type StatsWindow = '1d' | '7d' | '30d' | 'all' // default '30d'
type StatsContextType = 'dm' | 'group' | 'unknown'

type Percentiles = {
  count: number
  min: number
  p50: number
  p90: number
  p99: number
  max: number
  mean: number
}
```

## SubjectStats

`GET /stats/subject/:storageContextIdEncoded` → `SubjectStats | 404`.

```ts
type SubjectStats = {
  storageContextId: string
  chatUserId: string | null
  contextType: StatsContextType
  displayName: string | null

  memos: {
    total: number
    byStatus: Record<string, number>
    tagCardinality: { distinct: number; meanPerMemo: number }
    contentBytesTotal: number
    embeddingBytesTotal: number
    withEmbedding: number
    oldestCreatedAt: number | null
    newestCreatedAt: number | null
  }

  scheduledPrompts: {
    total: number
    byStatus: Record<string, number>
    distinctDeliveryTargets: number
  }

  alertPrompts: {
    total: number
    byStatus: Record<string, number>
  }

  recurringTasks: {
    total: number
    enabled: number
    disabled: number
    distinctProjects: number
    nextRunWithin7d: number
    distinctRrulePatterns: number
  }

  userInstructions: {
    total: number
    textBytesTotal: number
  }

  attachments: {
    total: number
    byStatus: Record<string, number>
    bySourceProvider: Record<string, number>
    storedBytesTotal: number
    active: number
    byExtension: Record<string, number>
  }

  messageMetadata: {
    total: number
    authoredBySubject: number
    oldestTimestamp: number | null
    newestTimestamp: number | null
    textBytesTotal: number
  }

  conversationHistory: {
    turnCount: number
    summaryPresent: boolean
  }

  userIdentityMappings: Record<string, number> // keyed by provider

  stagedFiles: {
    total: number
    byStatus: Record<string, number>
    bytesTotal: number
  }

  userBlock: {
    addedAt: string | null
    addedByPresent: boolean
    kaneoWorkspacePresent: boolean
  } | null

  groupBlock: {
    memberCount: number
    distinctAddedBy: number
    observationCount: number
  } | null

  webFetches: { totalRequests: number }

  llmUsage: {
    rowCount: number
    inputTokensTotal: number
    outputTokensTotal: number
  }

  toolCalls: {
    total: number
    success: number
    failure: number
    topTools: Array<{ toolName: string; count: number }>
    errorTypeCounts: Record<string, number>
  }
}
```

## GlobalStats

`GET /stats/global?window=...` → `GlobalStats`.

The orchestrator caches the global view for 60 s
(`src/stats/index.ts`).

```ts
type GlobalStats = {
  generatedAt: number
  window: StatsWindow

  subjects: {
    dmTotal: number
    groupTotal: number
    growthLast30d: Array<{
      date: string // YYYY-MM-DD
      dmAdded: number
      groupAdded: number
    }>
  }

  active: {
    activeIn1d: number
    activeIn7d: number
    activeIn30d: number
  }

  distributions: {
    memosPerSubject: Percentiles
    recurringTasksPerSubject: Percentiles
    messageMetadataPerSubject: Percentiles
    attachmentBytesPerSubject: Percentiles
  }

  storage: {
    sqliteBytes: number
    s3AttachmentBytes: number
  }

  identityMix: {
    byProvider: Record<string, number>
    kaneoWorkspaces: number
  }

  surfaceMix: {
    subjectsWithRecurring: number
    subjectsWithDeferred: number
    subjectsWithMemos: number
    subjectsWithInstructions: number
  }

  webFetches: {
    topHosts: Array<{ hostHash: string; count: number }>
  }

  toolMix: {
    topTools: Array<{ toolName: string; count: number; successRate: number }>
    errorTypeCounts: Record<string, number>
  }
}
```
