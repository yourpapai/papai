<script lang="ts">
  import { formatTime } from '../helpers.js'
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '...'
  }

  const totalCount = $derived(dashboard.recurringTasks.length + dashboard.deferredPrompts.length)
  const recurring = $derived(dashboard.recurringTasks)
  const deferred = $derived(dashboard.deferredPrompts)
</script>

<section class="panel">
  <h2>Reminders <span class="count-badge">{totalCount}</span></h2>
  {#if recurring.length === 0 && deferred.length === 0}
    <span class="placeholder">No reminders</span>
  {:else}
    {#each recurring as task (task.id)}
      {@const statusClass = task.enabled ? 'status-active' : 'status-paused'}
      {@const statusLabel = task.enabled ? 'active' : 'paused'}
      {@const schedule = task.rrule ?? 'one-shot'}
      {@const nextFire = task.nextRun === null ? '---' : formatTime(task.nextRun)}
      <div class="reminder-row">
        <div class="reminder-summary">
          <span class="reminder-name">{task.title}</span>
          <span class="reminder-schedule">{schedule}</span>
          <span class="reminder-next">{nextFire}</span>
          <span class="reminder-status {statusClass}">{statusLabel}</span>
        </div>
      </div>
    {/each}
    {#each deferred as prompt (prompt.id)}
      <div class="reminder-row deferred">
        <div class="reminder-summary">
          <span class="reminder-type">deferred</span>
          <span class="reminder-prompt">{truncate(prompt.prompt, 80)}</span>
          <span class="reminder-next">{formatTime(prompt.fireAt)}</span>
        </div>
      </div>
    {/each}
  {/if}
</section>
