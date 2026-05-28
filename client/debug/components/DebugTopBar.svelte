<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { formatUptime } from '../../shared/helpers.js'
  import { logout } from '../auth.js'
  import type { DashboardState, ScopeFilter } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  let uptimeTick = $state(0)
  $effect(() => {
    const id = setInterval(() => {
      uptimeTick += 1
    }, 10000)
    return () => clearInterval(id)
  })

  const uptime = $derived.by(() => {
    void uptimeTick
    return formatUptime(dashboard.stats.startedAt)
  })

  const schedulerLabel = $derived.by(() => {
    const sched = dashboard.scheduler
    const running = sched.running ?? false
    const tickPart = sched.tickCount === undefined ? '' : ` · tick #${sched.tickCount}`
    return `${running ? 'running' : 'stopped'}${tickPart}`
  })
</script>

<TopBar page="debug">
  {#snippet statusRow()}
    <div class="debug-topbar__status">
      {#if dashboard.connected}
        <Pill tone="accent" dot>{#snippet children()}connected{/snippet}</Pill>
      {:else}
        <Pill tone="danger" dot>{#snippet children()}disconnected{/snippet}</Pill>
      {/if}
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">uptime</span> {uptime}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">msgs</span> {dashboard.stats.totalMessages}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">llm</span> {dashboard.stats.totalLlmCalls}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">tools</span> {dashboard.stats.totalToolCalls}</span>
      <span class="debug-topbar__sep"></span>
      <Btn variant="ghost" size="sm" onClick={() => (window.location.href = '/admin')}>
        {#snippet children()}/admin →{/snippet}
      </Btn>
      <Btn variant="ghost" size="sm" onClick={() => void logout()}>
        {#snippet children()}sign out{/snippet}
      </Btn>
    </div>
  {/snippet}
  {#snippet secondaryRow()}
    <div class="debug-topbar__secondary">
      <span class="debug-topbar__lbl">scheduler</span>
      <Pill tone={dashboard.scheduler.running ? 'accent' : 'mute'} dot>{#snippet children()}{schedulerLabel}{/snippet}</Pill>
      <span class="debug-topbar__lbl">pollers</span>
      <Pill tone={dashboard.pollers.scheduledRunning ? 'accent' : 'mute'} dot>{#snippet children()}scheduled{/snippet}</Pill>
      <Pill tone={dashboard.pollers.alertsRunning ? 'accent' : 'mute'} dot>{#snippet children()}alerts{/snippet}</Pill>
      <span class="debug-topbar__lbl">msg-cache</span>
      <span class="debug-topbar__stat">{dashboard.messageCache.size ?? 0} entries · {dashboard.messageCache.pendingWrites ?? 0} pending</span>
      <span class="debug-topbar__spacer"></span>
      <Seg
        options={['all', 'dm', 'group']}
        value={dashboard.scopeFilter}
        onChange={(v) => (dashboard.scopeFilter = v as ScopeFilter)} />
    </div>
  {/snippet}
</TopBar>

<style>
  .debug-topbar__status,
  .debug-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .debug-topbar__stat {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
  }
  .debug-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .debug-topbar__sep {
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .debug-topbar__spacer {
    flex: 1;
  }
</style>
