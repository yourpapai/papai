<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import StatsPanel from '../components/StatsPanel.svelte'

  const dashboard = $state({
    statsWindow: '30d' as const,
    globalStats: null,
  })
</script>

<StatsPanel {dashboard} />
