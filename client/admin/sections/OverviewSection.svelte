<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fmtBytes, fmtNum, formatTokens, hasSeriesData } from '../../shared/helpers.js'
  import Bars from '../../shared/ui/Bars.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Meter from '../../shared/ui/Meter.svelte'
  import MetricCard from '../../shared/ui/MetricCard.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Spark from '../../shared/ui/Spark.svelte'

  import { adminGlobals, toolTotalsFrom } from '../global-stats.svelte.js'

  const subjectsTotal = $derived(
    adminGlobals.data?.subjects === undefined
      ? '—'
      : String(adminGlobals.data.subjects.dmTotal + adminGlobals.data.subjects.groupTotal),
  )
  const subjectsSub = $derived.by(() => {
    const subjects = adminGlobals.data?.subjects
    if (subjects === undefined) return undefined
    const base = `${subjects.dmTotal} dm · ${subjects.groupTotal} group`
    const active = adminGlobals.data?.active?.activeIn30d
    return active === undefined ? base : `${base} · ${active} active 30d`
  })

  const llmTotal = $derived(
    adminGlobals.data?.llmUsage === undefined
      ? '—'
      : adminGlobals.data.llmUsage.totalCalls.toLocaleString(),
  )
  const llmSub = $derived(
    adminGlobals.data?.llmUsage === undefined
      ? undefined
      : `${adminGlobals.data.llmUsage.mainCalls} main · ${adminGlobals.data.llmUsage.smallCalls} small`,
  )

  const toolTotals = $derived(toolTotalsFrom(adminGlobals.data))
  const toolTotal = $derived(toolTotals === null ? '—' : toolTotals.total.toLocaleString())
  const toolSub = $derived(toolTotals === null ? undefined : `${toolTotals.ok} ok · ${toolTotals.fail} fail`)

  const storageTotal = $derived(
    adminGlobals.data?.storage === undefined
      ? '—'
      : fmtBytes(
          adminGlobals.data.storage.sqliteBytes + adminGlobals.data.storage.s3AttachmentBytes,
        ),
  )
  const storageSub = $derived(
    adminGlobals.data?.storage === undefined
      ? undefined
      : `${fmtBytes(adminGlobals.data.storage.sqliteBytes)} sqlite · ${fmtBytes(adminGlobals.data.storage.s3AttachmentBytes)} s3`,
  )

  // Total tokens (input + output) over the loaded stats window.
  const tokenTotal = $derived(
    adminGlobals.data?.llmUsage === undefined
      ? '—'
      : formatTokens(adminGlobals.data.llmUsage.inputTokensTotal + adminGlobals.data.llmUsage.outputTokensTotal),
  )
  const tokenSub = $derived<string | undefined>(
    adminGlobals.data?.llmUsage === undefined
      ? undefined
      : `${fmtNum(adminGlobals.data.llmUsage.inputTokensTotal, 0)} in · ${fmtNum(adminGlobals.data.llmUsage.outputTokensTotal, 0)} out`,
  )

  const sparkData = $derived(
    adminGlobals.data?.subjects?.growthLast30d?.map((p) => p.dmAdded + p.groupAdded) ?? [],
  )

  const barsData = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return []
    return tools.slice(0, 8).map((t) => Math.round(t.count * t.successRate))
  })

  interface SurfaceMixRow {
    label: string
    n: number
    total: number
  }

  const surfaceMix = $derived.by<SurfaceMixRow[]>(() => {
    const sm = adminGlobals.data?.surfaceMix
    const subj = adminGlobals.data?.subjects
    if (sm === undefined || subj === undefined) return []
    const total = subj.dmTotal + subj.groupTotal
    return [
      { label: 'memos', n: sm.subjectsWithMemos, total },
      { label: 'recurring', n: sm.subjectsWithRecurring, total },
      { label: 'reminders', n: sm.subjectsWithDeferred, total },
      { label: 'instructions', n: sm.subjectsWithInstructions, total },
    ]
  })

  const hasSurfaceMix = $derived(surfaceMix.some((row) => row.n > 0))
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    {#snippet body()}
      <div class="overview__kpis" data-testid="admin-overview-kpis">
        <MetricCard label="subjects" value={subjectsTotal} sub={subjectsSub} />
        <MetricCard label="llm calls" value={llmTotal} sub={llmSub} accent="var(--accent)" />
        <MetricCard label="tools" value={toolTotal} sub={toolSub} />
        <MetricCard label="tokens" value={tokenTotal} sub={tokenSub} />
        <MetricCard label="storage" value={storageTotal} sub={storageSub} />
      </div>
      <div class="overview__charts">
        <Panel title="activity · 30d">
          {#snippet body()}
            <div class="overview__chart-body">
              {#if hasSeriesData(sparkData) || hasSeriesData(barsData)}
                <figure class="admin-overview__spark">
                  <Spark data={sparkData} />
                  <figcaption class="overview__caption">new subjects per day (dm + group) · last 30d</figcaption>
                </figure>
                <figure class="overview__bars-wrap">
                  <Bars data={barsData} height={56} />
                  <figcaption class="overview__caption">top tools by successful calls · all time</figcaption>
                </figure>
              {:else}
                <EmptyState title="No activity yet" />
              {/if}
            </div>
          {/snippet}
        </Panel>
        <Panel title="surface mix">
          {#snippet body()}
            {#if hasSurfaceMix}
              <div class="overview__mix">
                {#each surfaceMix as row (row.label)}
                  <Meter label={row.label} value={row.n} total={row.total} />
                {/each}
              </div>
            {:else}
              <EmptyState title="No subjects yet" />
            {/if}
          {/snippet}
        </Panel>
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  /* 160px fits the widest realistic value (`27.6k` at the tile's headline size) inside
     the 128px left after MetricCard's `padding: 14px 16px`, so tiles wrap to a second
     row rather than ellipsing a headline number. */
  .overview__kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--s2);
    padding: var(--s3);
  }
  .overview__charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 8px;
    padding: 0 12px 12px;
  }
  .overview__chart-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .admin-overview__spark {
    width: 100%;
    margin: 0;
  }
  .overview__bars-wrap {
    width: 100%;
    margin: 0;
  }
  .overview__caption {
    margin-top: 4px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .overview__mix {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
