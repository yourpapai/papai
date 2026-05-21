<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { ToolFailure, DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
    onShowFailure: (failure: ToolFailure) => void
  }

  let { dashboard, onShowFailure }: Props = $props()

  function matchesContext(scope: ToolFailure['scope'], activeContext: string): boolean {
    if (activeContext === 'all') return true
    if (activeContext === 'dm') return scope.kind === 'user'
    if (activeContext.startsWith('group:')) {
      const groupId = activeContext.slice('group:'.length)
      return scope.kind === 'group' && scope.groupId === groupId
    }
    return true
  }

  function retriableLabel(data: Record<string, unknown>): string {
    if (data['retriable'] === true) return 'retriable'
    if (data['retriable'] === false) return 'non-retriable'
    return ''
  }

  const filtered = $derived(dashboard.toolFailures.filter((f) => matchesContext(f.scope, dashboard.activeContext)))
</script>

<section class="panel">
  <h2>Tool Failures <span class="count-badge">{dashboard.toolFailures.length}</span></h2>
  {#if filtered.length === 0}
    <span class="placeholder">No failures</span>
  {:else}
    {#each filtered as f, i (i)}
      {@const toolName = typeof f.data['toolName'] === 'string' ? f.data['toolName'] : 'unknown'}
      {@const error = typeof f.data['error'] === 'string' ? f.data['error'] : ''}
      {@const retriable = retriableLabel(f.data)}
      <div
        class="failure-row"
        role="button"
        tabindex="0"
        onclick={() => onShowFailure(f)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onShowFailure(f)
          }
        }}>
        <div class="failure-summary">
          <span class="failure-time">{formatTime(f.timestamp)}</span>
          <span class="failure-tool">{toolName}</span>
          <span class="failure-error">{error}</span>
          {#if retriable !== ''}
            <span class="failure-retriable {retriable}">{retriable}</span>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</section>
