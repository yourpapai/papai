<script lang="ts">
  import { formatDuration, formatTime, formatTokens } from '../../shared/helpers.js'
  import type { LlmTrace, DashboardState } from '../dashboard-types.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Panel from '../../shared/ui/Panel.svelte'

  interface Props {
    dashboard: DashboardState
    onSelect: (trace: LlmTrace) => void
  }

  let { dashboard, onSelect }: Props = $props()

  function traceKey(t: LlmTrace): string {
    return `${t.timestamp}|${t.userId}|${t.model}`
  }

  const selectedTraceKey = $derived(
    dashboard.selectedDetail?.kind === 'trace' ? traceKey(dashboard.selectedDetail.payload) : '',
  )
</script>

<section id="llm-trace">
  <Panel title="llm trace" count={dashboard.llmTraces.length}>
    {#snippet body()}
      {#if dashboard.llmTraces.length === 0}
        <EmptyState title="No traces" hint="LLM traces appear here after the next model call" />
      {:else}
        {#each dashboard.llmTraces as trace, i (i)}
          {@const isError = trace.error !== undefined && trace.error !== ''}
          <div
            class="trace-row"
            class:error={isError}
            class:selected={selectedTraceKey === traceKey(trace)}
            role="button"
            tabindex="0"
            onclick={() => onSelect(trace)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(trace)
              }
            }}>
            <div class="trace-summary">
              <span class="trace-time">{formatTime(trace.timestamp)}</span>
              <span class="trace-user">{trace.userId}</span>
              <span class="trace-model">{trace.model}</span>
              <span class="trace-duration">{formatDuration(trace.duration)}</span>
              <span>{trace.steps} steps · {formatTokens(trace.totalTokens.inputTokens)}↓</span>
            </div>
          </div>
        {/each}
      {/if}
    {/snippet}
  </Panel>
</section>

<style>
  .trace-row {
    border-left: 2px solid var(--border);
    padding: 6px 8px;
    margin-bottom: 4px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
  }

  .trace-row:hover {
    background: var(--raised);
  }

  .trace-row.error {
    border-left-color: var(--danger);
  }

  .trace-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--fg2);
  }

  .trace-summary .trace-time {
    color: var(--fg3);
  }

  .trace-summary .trace-user {
    color: var(--fg);
  }

  .trace-summary .trace-model {
    color: var(--accent);
  }

  .trace-summary .trace-duration {
    color: var(--warn);
  }
</style>
