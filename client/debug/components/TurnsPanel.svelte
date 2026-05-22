<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { Turn, DashboardState, ScopeFilter } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
    onShowTurn: (turn: Turn) => void
    onShowLogsForTurn: (turnId: string) => void
  }

  let { dashboard, onShowTurn, onShowLogsForTurn }: Props = $props()

  function scopeClass(kind: string): string {
    if (kind === 'user') return 'scope-user'
    if (kind === 'group') return 'scope-group'
    return 'scope-global'
  }

  function scopeIcon(kind: string): string {
    if (kind === 'user') return '☺'
    if (kind === 'group') return '☻'
    return '●'
  }

  function durationMs(startedAt: number, endedAt?: number): string {
    const end = endedAt ?? Date.now()
    const ms = end - startedAt
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
  }

  function matchesScope(turn: Turn, scope: ScopeFilter): boolean {
    if (scope === 'all') return true
    if (scope === 'dm') return turn.scope.kind === 'user'
    return turn.scope.kind === 'group'
  }

  const filtered = $derived(dashboard.turns.filter((t) => matchesScope(t, dashboard.scopeFilter)))
</script>

<section class="panel">
  <h2>Turns <span class="count-badge">{dashboard.turns.length}</span></h2>
  {#if filtered.length === 0}
    <span class="placeholder">No turns</span>
  {:else}
    {#each filtered as turn (turn.turnId)}
      {@const toolCount = turn.toolCalls.length}
      <div
        class="turn-row status-{turn.status}"
        role="button"
        tabindex="0"
        onclick={() => onShowTurn(turn)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onShowTurn(turn)
          }
        }}>
        <div class="turn-summary">
          <span class="turn-time">{formatTime(turn.startedAt)}</span>
          <span class="turn-scope {scopeClass(turn.scope.kind)}">{scopeIcon(turn.scope.kind)}</span>
          <span class="turn-status status-{turn.status}">{turn.status}</span>
          <span class="turn-duration">{durationMs(turn.startedAt, turn.endedAt)}</span>
          <span class="turn-tools">{toolCount} tool{toolCount === 1 ? '' : 's'}</span>
          <button
            type="button"
            class="turn-log-link"
            title="Filter logs by this turn"
            onclick={(e) => {
              e.stopPropagation()
              onShowLogsForTurn(turn.turnId)
            }}>logs</button>
        </div>
      </div>
    {/each}
  {/if}
</section>
