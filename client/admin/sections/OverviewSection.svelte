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

  const sparkData = $derived(adminGlobals.data?.growthLast30d?.map((p) => p.count) ?? [])
  const barsData = $derived(adminGlobals.data?.surfaceMix?.map((p) => p.value) ?? [])
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    {#snippet body()}
      <div class="admin-overview__kpis">
        <KV k="subjects" v={adminGlobals.data?.subjects ?? '—'} />
        <KV k="llm calls" v={adminGlobals.data?.llmCalls ?? '—'} />
        <KV k="tool calls" v={adminGlobals.data?.toolCalls ?? '—'} />
        <KV k="tokens" v={adminGlobals.data?.tokens ?? '—'} />
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
