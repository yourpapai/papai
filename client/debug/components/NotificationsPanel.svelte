<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { Notification, DashboardState, ScopeFilter } from '../dashboard-types.js'

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

  function notificationText(n: Notification): string {
    const data = n.data
    if (n.type === 'reply:sent' && typeof data['text'] === 'string') {
      return truncate(data['text'], 120)
    }
    if (n.type === 'typing:start' || n.type === 'typing:stop') return ''
    if (Object.keys(data).length > 0) return truncate(JSON.stringify(data), 100)
    return ''
  }

  const filtered = $derived(dashboard.notifications.filter((n) => matchesScope(n.scope, dashboard.scopeFilter)))
</script>

<section class="panel">
  <h2>Notifications <span class="count-badge">{dashboard.notifications.length}</span></h2>
  {#if filtered.length === 0}
    <span class="placeholder">No notifications</span>
  {:else}
    {#each filtered as n, i (i)}
      <div class="notification-row">
        <span class="notification-time">{formatTime(n.timestamp)}</span>
        <span class="notification-type">{n.type}</span>
        {#if notificationText(n) !== ''}
          <span class="notification-text">{notificationText(n)}</span>
        {/if}
      </div>
    {/each}
  {/if}
</section>
