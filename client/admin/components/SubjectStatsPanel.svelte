<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { SubjectStats } from '../../../src/stats/types.js'
  import { fetchStatsSubject } from '../fetchers.js'

  interface Props {
    storageContextId: string
  }

  let { storageContextId }: Props = $props()

  let data: SubjectStats | null = $state(null)
  let loading = $state(true)
  let error: string | null = $state(null)

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  async function load(): Promise<void> {
    loading = true
    error = null
    try {
      data = await fetchStatsSubject(storageContextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })
</script>

<section class="subject-stats-panel">
  <h4>Anonymous stats</h4>
  {#if loading && data === null && error === null}
    <span class="placeholder">Loading...</span>
  {:else if error !== null}
    <span class="status-error">Stats error: {error}</span>
  {:else if data !== null}
    <dl class="stats-list">
      <dt>memos</dt><dd>{data.memos.total}</dd>
      <dt>recurring</dt><dd>{data.recurringTasks.total}</dd>
      <dt>scheduled prompts</dt><dd>{data.scheduledPrompts.total}</dd>
      <dt>alert prompts</dt><dd>{data.alertPrompts.total}</dd>
      <dt>instructions</dt><dd>{data.userInstructions.total}</dd>
      <dt>attachments bytes</dt><dd>{formatBytes(data.attachments.storedBytesTotal)}</dd>
      <dt>messages</dt><dd>{data.messageMetadata.total}</dd>
      <dt>turns</dt><dd>{data.conversationHistory.turnCount}</dd>
      <dt>llm rows</dt><dd>{data.llmUsage.rowCount}</dd>
      <dt>tool calls</dt><dd>{data.toolCalls.total} ({data.toolCalls.success} / {data.toolCalls.failure})</dd>
      <dt>web fetches</dt><dd>{data.webFetches.totalRequests}</dd>
    </dl>
  {/if}
</section>
