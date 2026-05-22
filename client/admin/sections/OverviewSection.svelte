<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Bars from '../../shared/ui/Bars.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Spark from '../../shared/ui/Spark.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  const subjectsTotal = $derived(
    adminGlobals.data?.subjects === undefined
      ? '—'
      : adminGlobals.data.subjects.dmTotal + adminGlobals.data.subjects.groupTotal,
  )
  const subjectsSub = $derived(
    adminGlobals.data?.subjects === undefined
      ? undefined
      : `${adminGlobals.data.subjects.dmTotal} dm · ${adminGlobals.data.subjects.groupTotal} group`,
  )

  const activeTotal = $derived(adminGlobals.data?.active?.activeIn30d ?? '—')
  const activeSub = $derived(
    adminGlobals.data?.active === undefined
      ? undefined
      : `${adminGlobals.data.active.activeIn1d} 1d · ${adminGlobals.data.active.activeIn7d} 7d`,
  )

  const toolTotals = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return null
    let total = 0
    let ok = 0
    for (const t of tools) {
      total += t.count
      ok += Math.round(t.count * t.successRate)
    }
    return { total, ok, fail: total - ok }
  })
  const toolTotal = $derived(toolTotals === null ? '—' : toolTotals.total)
  const toolSub = $derived(toolTotals === null ? undefined : `${toolTotals.ok} ok · ${toolTotals.fail} fail`)

  function formatBytes(n: number): string {
    if (n < 1_000) return `${n} B`
    if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} KB`
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
    return `${(n / 1_000_000_000).toFixed(1)} GB`
  }

  const storageTotal = $derived(
    adminGlobals.data?.storage === undefined
      ? '—'
      : formatBytes(
          adminGlobals.data.storage.sqliteBytes + adminGlobals.data.storage.s3AttachmentBytes,
        ),
  )
  const storageSub = $derived(
    adminGlobals.data?.storage === undefined
      ? undefined
      : `${formatBytes(adminGlobals.data.storage.sqliteBytes)} sqlite · ${formatBytes(adminGlobals.data.storage.s3AttachmentBytes)} s3`,
  )

  const sparkData = $derived(
    adminGlobals.data?.subjects?.growthLast30d?.map((p) => p.dmAdded + p.groupAdded) ?? [],
  )

  const barsData = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return []
    return tools.slice(0, 8).map((t) => Math.round(t.count * t.successRate))
  })
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    {#snippet body()}
      <div class="admin-overview__kpis">
        <KV k="subjects" v={subjectsTotal} sub={subjectsSub} />
        <KV k="active 30d" v={activeTotal} sub={activeSub} />
        <KV k="tool calls" v={toolTotal} sub={toolSub} />
        <KV k="storage" v={storageTotal} sub={storageSub} />
      </div>
      <div class="admin-overview__charts">
        <div class="admin-overview__spark">
          <Spark data={sparkData} />
        </div>
        <div class="admin-overview__bars">
          <Bars data={barsData} />
        </div>
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .admin-overview__kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .admin-overview__charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
    padding: 12px;
    border-top: 1px solid var(--hair);
  }
</style>
