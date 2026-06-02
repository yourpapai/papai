<script lang="ts">
  import { fmtNum, formatTime, formatTokens } from '../../shared/helpers.js'
  import type { LlmTrace, DashboardState } from '../dashboard-types.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Panel from '../../shared/ui/Panel.svelte'

  interface Props {
    dashboard: DashboardState
    onSelect: (trace: LlmTrace) => void
  }

  let { dashboard, onSelect }: Props = $props()
</script>

<section id="llm-trace">
  <Panel title="llm trace" count={dashboard.llmTraces.length}>
    {#snippet body()}
      {#if dashboard.llmTraces.length === 0}
        <EmptyState title="No traces" />
      {:else}
        {#each dashboard.llmTraces as trace, i (i)}
          {@const isError = trace.error !== undefined && trace.error !== ''}
          <div
            class="trace-row"
            class:error={isError}
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
              <span class="trace-duration">{fmtNum(trace.duration / 1000, 1)}s</span>
              <span>{trace.steps} steps · {formatTokens(trace.totalTokens.inputTokens)}↓</span>
            </div>
          </div>
        {/each}
      {/if}
    {/snippet}
  </Panel>
</section>
