<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { Notification, DashboardState, ScopeFilter } from '../dashboard-types.js'
  import Panel from '../../shared/ui/Panel.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import JsonCell from '../../shared/ui/JsonCell.svelte'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  function matchesScope(scope: Notification['scope'], filter: ScopeFilter): boolean {
    if (filter === 'all') return true
    if (filter === 'dm') return scope.kind === 'user'
    return scope.kind === 'group'
  }

  function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '...'
  }

  function replyText(n: Notification): string {
    const data = n.data
    if (n.type === 'reply:sent' && typeof data['text'] === 'string') return truncate(data['text'], 120)
    return ''
  }

  function hasData(n: Notification): boolean {
    if (n.type === 'typing:start' || n.type === 'typing:stop') return false
    return Object.keys(n.data).length > 0 && replyText(n) === ''
  }

  const filtered = $derived(dashboard.notifications.filter((n) => matchesScope(n.scope, dashboard.scopeFilter)))
</script>

<Panel title="notifications" count={dashboard.notifications.length}>
  {#snippet body()}
    {#if filtered.length === 0}
      <EmptyState title="No notifications" />
    {:else}
      {#each filtered as n, i (i)}
        <div class="notification-row">
          <span class="notification-time">{formatTime(n.timestamp)}</span>
          <span class="notification-type">{n.type}</span>
          {#if replyText(n) !== ''}
            <span class="notification-text">{replyText(n)}</span>
          {:else if hasData(n)}
            <JsonCell value={n.data} />
          {/if}
        </div>
      {/each}
    {/if}
  {/snippet}
</Panel>
