<script lang="ts">
  import { formatTime, formatTokens } from '../../shared/helpers.js'
  import type { LlmTrace, DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
    onSelect: (trace: LlmTrace) => void
  }

  let { dashboard, onSelect }: Props = $props()
</script>

<section id="llm-trace">
  <h2>LLM Trace <span class="count-badge">{dashboard.llmTraces.length}</span></h2>
  <div>
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
          <span class="trace-duration">{(trace.duration / 1000).toFixed(1)}s</span>
          <span>{trace.steps} steps · {formatTokens(trace.totalTokens.inputTokens)}↓</span>
        </div>
      </div>
    {/each}
  </div>
</section>
