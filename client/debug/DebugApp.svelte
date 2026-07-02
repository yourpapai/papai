<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import DebugDetailRail from './components/DebugDetailRail.svelte'
  import DebugTopBar from './components/DebugTopBar.svelte'
  import LiveContextCard from './components/LiveContextCard.svelte'
  import LogExplorer from './components/LogExplorer.svelte'
  import NotificationsPanel from './components/NotificationsPanel.svelte'
  import SessionsList from './components/SessionsList.svelte'
  import ToolFailuresPanel from './components/ToolFailuresPanel.svelte'
  import TraceList from './components/TraceList.svelte'
  import TurnsPanel from './components/TurnsPanel.svelte'

  import { untrack } from 'svelte'

  import type { DashboardState } from './dashboard-types.js'
  import { fetchInitialLogs, parseLogsArray, collectScopes, fetchScopes } from './log-bootstrap.js'
  import { filterFromParams, filterToQuery } from './log-filter-url.js'
  import { setupEventSource } from './sse.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  // Seed the filter from the page URL once on mount.
  $effect(() => {
    dashboard.activeLogFilter = filterFromParams(new URLSearchParams(window.location.search))
  })

  // Refetch logs + reconnect SSE whenever the filter changes; keep the page URL in sync.
  $effect(() => {
    const query = filterToQuery(dashboard.activeLogFilter)
    const next = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`
    window.history.replaceState(null, '', next)

    void untrack(async () => {
      try {
        const parsed = parseLogsArray(await fetchInitialLogs(dashboard.activeLogFilter))
        dashboard.logs = parsed
        dashboard.logScopeCounts = await fetchScopes()
        for (const scope of collectScopes(parsed)) dashboard.logScopes.add(scope)
      } catch {
        // SSE will populate from live events.
      }
    })

    const conn = setupEventSource(
      dashboard,
      (connected) => {
        dashboard.connected = connected
      },
      query,
    )
    return () => conn.close()
  })

  function showLogsForTurn(turnId: string): void {
    dashboard.activeLogFilter = { ...dashboard.activeLogFilter, turnId }
    document.getElementById('log-explorer')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<Shell>
  {#snippet topBar()}
    <DebugTopBar {dashboard} />
  {/snippet}
  {#snippet children()}
    <div class="debug-grid">
      <aside class="debug-grid__left">
        <SessionsList
          {dashboard}
          onSelect={(userId, session) => (dashboard.selectedDetail = { kind: 'session', payload: { userId, session } })} />
        <TraceList
          {dashboard}
          onSelect={(trace) => (dashboard.selectedDetail = { kind: 'trace', payload: trace })} />
      </aside>

      <section class="debug-grid__center">
        <TurnsPanel
          {dashboard}
          onShowTurn={(turn) => (dashboard.selectedDetail = { kind: 'turn', payload: turn })}
          onShowLogsForTurn={showLogsForTurn} />
        <div class="debug-grid__center-row">
          <NotificationsPanel {dashboard} />
          <ToolFailuresPanel
            {dashboard}
            onShowFailure={(failure) => (dashboard.selectedDetail = { kind: 'failure', payload: failure })} />
        </div>
        <LogExplorer
          {dashboard}
          onSelectLog={(entry, index) => (dashboard.selectedDetail = { kind: 'log', payload: { entry, index } })} />
      </section>

      <aside class="debug-grid__right">
        <DebugDetailRail
          selected={dashboard.selectedDetail}
          onClear={() => (dashboard.selectedDetail = null)} />
        <LiveContextCard {dashboard} />
      </aside>
    </div>
  {/snippet}
</Shell>
