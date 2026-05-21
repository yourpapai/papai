<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { Notification, DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  function matchesContext(scope: Notification['scope'], activeContext: string): boolean {
    if (activeContext === 'all') return true
    if (activeContext === 'dm') return scope.kind === 'user'
    if (activeContext.startsWith('group:')) {
      const groupId = activeContext.slice('group:'.length)
      return scope.kind === 'group' && scope.groupId === groupId
    }
    return true
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

  const filtered = $derived(dashboard.notifications.filter((n) => matchesContext(n.scope, dashboard.activeContext)))
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
