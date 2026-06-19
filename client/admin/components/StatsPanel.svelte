<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { GlobalStats, StatsWindow } from '../../shared/api-types.js'
  import { fmtBytes, fmtNum, formatTokens } from '../../shared/helpers.js'
  import Bars from '../../shared/ui/Bars.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import MetricCard from '../../shared/ui/MetricCard.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import Stat from '../../shared/ui/Stat.svelte'
  import { fetchStatsGlobal } from '../fetchers.js'

  interface StatsState {
    statsWindow: StatsWindow
    globalStats: GlobalStats | null
  }

  interface Props {
    dashboard: StatsState
  }

  let { dashboard }: Props = $props()

  const WINDOWS: StatsWindow[] = ['1d', '7d', '30d', 'all']

  let loading = $state(false)
  let error: string | null = $state(null)

  async function loadStats(): Promise<void> {
    loading = true
    error = null
    try {
      dashboard.globalStats = await fetchStatsGlobal(dashboard.statsWindow)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function onWindowChange(next: string): void {
    if (next === '1d' || next === '7d' || next === '30d' || next === 'all') {
      dashboard.statsWindow = next
      void loadStats()
    }
  }

  $effect(() => {
    untrack(() => {
      void loadStats()
    })
  })

  interface DistRow {
    metric: string
    n: number
    min: number
    p50: number
    p90: number
    p99: number
    max: number
    mean: number
  }

  const distRows = $derived.by<DistRow[]>(() => {
    const g = dashboard.globalStats
    if (g === null) return []
    const d = g.distributions
    return [
      {
        metric: 'memos / subject',
        n: d.memosPerSubject.count,
        min: d.memosPerSubject.min,
        p50: d.memosPerSubject.p50,
        p90: d.memosPerSubject.p90,
        p99: d.memosPerSubject.p99,
        max: d.memosPerSubject.max,
        mean: Number(d.memosPerSubject.mean.toFixed(2)),
      },
      {
        metric: 'recurring / subject',
        n: d.recurringTasksPerSubject.count,
        min: d.recurringTasksPerSubject.min,
        p50: d.recurringTasksPerSubject.p50,
        p90: d.recurringTasksPerSubject.p90,
        p99: d.recurringTasksPerSubject.p99,
        max: d.recurringTasksPerSubject.max,
        mean: Number(d.recurringTasksPerSubject.mean.toFixed(2)),
      },
      {
        metric: 'messages / subject',
        n: d.messageMetadataPerSubject.count,
        min: d.messageMetadataPerSubject.min,
        p50: d.messageMetadataPerSubject.p50,
        p90: d.messageMetadataPerSubject.p90,
        p99: d.messageMetadataPerSubject.p99,
        max: d.messageMetadataPerSubject.max,
        mean: Number(d.messageMetadataPerSubject.mean.toFixed(2)),
      },
      {
        metric: 'attach bytes / subject',
        n: d.attachmentBytesPerSubject.count,
        min: d.attachmentBytesPerSubject.min,
        p50: d.attachmentBytesPerSubject.p50,
        p90: d.attachmentBytesPerSubject.p90,
        p99: d.attachmentBytesPerSubject.p99,
        max: d.attachmentBytesPerSubject.max,
        mean: Number(d.attachmentBytesPerSubject.mean.toFixed(2)),
      },
    ]
  })

  const distColumns = [
    { key: 'metric' as const, label: '' },
    { key: 'n' as const, label: 'N', align: 'right' as const },
    { key: 'min' as const, label: 'Min', align: 'right' as const },
    { key: 'p50' as const, label: 'P50', align: 'right' as const },
    { key: 'p90' as const, label: 'P90', align: 'right' as const },
    { key: 'p99' as const, label: 'P99', align: 'right' as const },
    { key: 'max' as const, label: 'Max', align: 'right' as const },
    { key: 'mean' as const, label: 'Mean', align: 'right' as const },
  ]

  interface TopToolRow {
    tool: string
    count: number
    success: string
  }

  const topToolRows = $derived.by<TopToolRow[]>(() => {
    const g = dashboard.globalStats
    if (g === null) return []
    return g.toolMix.topTools.slice(0, 8).map((t) => ({
      tool: t.toolName,
      count: t.count,
      success: `${Math.round(t.successRate * 100)}%`,
    }))
  })

  const topToolColumns = [
    { key: 'tool' as const, label: 'Tool' },
    { key: 'count' as const, label: 'Calls', align: 'right' as const },
    { key: 'success' as const, label: 'Success', align: 'right' as const },
  ]

  const growthData = $derived.by<number[]>(() => {
    const g = dashboard.globalStats
    if (g === null) return []
    return g.toolMix.toolCallGrowth30d.map((p) => p.count)
  })

  const totalSubjects = $derived.by<number>(() => {
    const g = dashboard.globalStats
    if (g === null) return 0
    return g.subjects.dmTotal + g.subjects.groupTotal
  })

  // Tokens per UTC day (input + output combined) over the selected window.
  const tokenDaily = $derived.by(() => {
    const g = dashboard.globalStats
    if (g === null) return []
    return g.tokenUsageByDay.map((p) => ({ date: p.date, total: p.inputTokens + p.outputTokens }))
  })
  const tokenDailyBars = $derived(tokenDaily.map((p) => p.total))
  const tokenPeak = $derived(tokenDaily.reduce((m, p) => (p.total > m ? p.total : m), 0))
  const tokenLast = $derived(tokenDaily.length > 0 ? tokenDaily[tokenDaily.length - 1] : null)
  const windowLabel = $derived(dashboard.statsWindow === 'all' ? 'all time' : `last ${dashboard.statsWindow}`)
</script>

<div class="stats-panel" data-testid="stats-panel">
  <PageHeader eyebrow="Anonymous analytics" title="Stats" titleTestId="admin-section-title">
    {#snippet action()}
      <Seg
        options={[...WINDOWS]}
        value={dashboard.statsWindow}
        onChange={onWindowChange} />
      <Btn variant="secondary" size="sm" onClick={() => { void loadStats() }} disabled={loading}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
      {#if error !== null}
        <span class="status-error" data-testid="stats-error">{error}</span>
      {/if}
    {/snippet}
  </PageHeader>

  {#if dashboard.globalStats !== null}
    {@const g = dashboard.globalStats}
    <div class="stats-panel__grid">
      <Panel title="active subjects">
        {#snippet body()}
          <div class="stats-panel__metrics">
            <Stat label="1d" value={g.active.activeIn1d} of={totalSubjects} />
            <Stat label="7d" value={g.active.activeIn7d} of={totalSubjects} />
            <Stat label="30d" value={g.active.activeIn30d} of={totalSubjects} />
          </div>
        {/snippet}
      </Panel>

      <Panel title="storage">
        {#snippet body()}
          <div class="stats-panel__metrics">
            <MetricCard label="sqlite" value={fmtBytes(g.storage.sqliteBytes)} />
            <MetricCard label="s3 attachments" value={fmtBytes(g.storage.s3AttachmentBytes)} />
          </div>
        {/snippet}
      </Panel>
    </div>

    <Panel title="token usage">
      {#snippet body()}
        <div class="stats-panel__metrics">
          <MetricCard
            label="input tokens"
            value={formatTokens(g.llmUsage.inputTokensTotal)}
            sub={`${fmtNum(g.llmUsage.inputTokensTotal, 0)} · ${windowLabel}`} />
          <MetricCard
            label="output tokens"
            value={formatTokens(g.llmUsage.outputTokensTotal)}
            sub={`${fmtNum(g.llmUsage.outputTokensTotal, 0)} · ${windowLabel}`} />
          <MetricCard label="llm calls" value={fmtNum(g.llmUsage.totalCalls, 0)} sub={windowLabel} />
        </div>
        {#if tokenDailyBars.length > 0}
          <figure class="stats-panel__chart">
            <Bars data={tokenDailyBars} color="var(--accent)" />
            <figcaption class="stats-panel__caption">
              input + output tokens per UTC day · {windowLabel} · peak {formatTokens(tokenPeak)}{#if tokenLast !== null}
                · {tokenLast.date}: {formatTokens(tokenLast.total)}{/if}
            </figcaption>
          </figure>
        {:else}
          <span class="placeholder">No token usage in this window</span>
        {/if}
      {/snippet}
    </Panel>

    <Panel title="distributions">
      {#snippet body()}
        <DataTable columns={distColumns} rows={distRows} rowKey="metric" />
      {/snippet}
    </Panel>

    <Panel title="tool calls">
      {#snippet body()}
        <div class="stats-panel__metrics">
          <MetricCard label="total calls" value={g.toolMix.totalCalls} />
          <MetricCard
            label="success rate"
            value={g.toolMix.totalCalls > 0 ? `${Math.round(g.toolMix.totalSuccessRate * 100)}%` : '—'} />
        </div>
        {#if growthData.length > 0}
          <figure class="stats-panel__chart">
            <Bars data={growthData} />
            <figcaption class="stats-panel__caption">tool calls per UTC day · last 30d</figcaption>
          </figure>
        {/if}
        {#if topToolRows.length > 0}
          <DataTable columns={topToolColumns} rows={topToolRows} rowKey="tool" />
        {:else}
          <span class="placeholder">No tool calls</span>
        {/if}
      {/snippet}
    </Panel>
  {:else if !loading && error === null}
    <span class="placeholder">No stats loaded yet</span>
  {/if}
</div>

<style>
  .stats-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stats-panel__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stats-panel__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .stats-panel__chart {
    margin: 0;
    padding: 8px 12px 4px;
  }
  .stats-panel__caption {
    margin-top: 4px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .placeholder {
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
