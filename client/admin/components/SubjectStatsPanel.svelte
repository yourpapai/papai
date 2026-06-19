<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { SubjectStats } from '../../../src/stats/types.js'
  import { fmtBytes, fmtNum } from '../../shared/helpers.js'
  import MetricCard from '../../shared/ui/MetricCard.svelte'
  import { fetchStatsSubject } from '../fetchers.js'

  interface Props {
    storageContextId: string
  }

  let { storageContextId }: Props = $props()

  let data: SubjectStats | null = $state(null)
  let loading = $state(true)
  let error: string | null = $state(null)

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

  interface Cell {
    label: string
    value: string
    sub?: string
  }

  const cells = $derived.by<Cell[]>(() => {
    const d = data
    if (d === null) return []
    return [
      { label: 'memos', value: fmtNum(d.memos.total, 0) },
      { label: 'recurring', value: fmtNum(d.recurringTasks.total, 0) },
      { label: 'scheduled prompts', value: fmtNum(d.scheduledPrompts.total, 0) },
      { label: 'alert prompts', value: fmtNum(d.alertPrompts.total, 0) },
      { label: 'instructions', value: fmtNum(d.userInstructions.total, 0) },
      { label: 'attachments bytes', value: fmtBytes(d.attachments.storedBytesTotal) },
      { label: 'messages', value: fmtNum(d.messageMetadata.total, 0) },
      { label: 'turns', value: fmtNum(d.conversationHistory.turnCount, 0) },
      { label: 'llm rows', value: fmtNum(d.llmUsage.rowCount, 0) },
      {
        label: 'tool calls',
        value: fmtNum(d.toolCalls.total, 0),
        sub: `${d.toolCalls.success} ok · ${d.toolCalls.failure} fail`,
      },
      { label: 'web fetches', value: fmtNum(d.webFetches.totalRequests, 0) },
    ]
  })
</script>

<section class="subject-stats-panel">
  <h4>Anonymous stats</h4>
  {#if loading && data === null && error === null}
    <span class="placeholder">Loading...</span>
  {:else if error !== null}
    <span class="status-error">Stats error: {error}</span>
  {:else if data !== null}
    <div class="stats-grid">
      {#each cells as cell (cell.label)}
        <MetricCard label={cell.label} value={cell.value} sub={cell.sub} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .subject-stats-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .subject-stats-panel h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }
  .placeholder,
  .status-error {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .status-error {
    color: var(--danger);
  }
  .placeholder {
    color: var(--fg3);
  }
</style>
