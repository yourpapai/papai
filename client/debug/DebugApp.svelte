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

  import type { DashboardState } from './dashboard-types.js'
  import { fetchInitialLogs, parseLogsArray, collectScopes } from './log-bootstrap.js'
  import { setupEventSource } from './sse.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  $effect(() => {
    void (async () => {
      try {
        const rawLogs = await fetchInitialLogs()
        const parsed = parseLogsArray(rawLogs)
        dashboard.logs = parsed
        const scopes = collectScopes(parsed)
        for (const scope of scopes) dashboard.logScopes.add(scope)
      } catch {
        // SSE will populate from live events.
      }
    })()

    const conn = setupEventSource(dashboard, (connected) => {
      dashboard.connected = connected
    })
    return () => conn.close()
  })

  function showLogsForTurn(turnId: string): void {
    dashboard.activeLogFilter.turnId = turnId
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
