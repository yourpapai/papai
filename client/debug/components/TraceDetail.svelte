<script lang="ts">
  import { fmtNum, formatTime, formatTokens } from '../../shared/helpers.js'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import type { LlmTrace } from '../dashboard-types.js'

  interface Props {
    trace: LlmTrace
  }

  let { trace }: Props = $props()

  const hasError = $derived(trace.error !== undefined && trace.error !== '')

  const basicInfo = $derived.by(() => {
    const items: { k: string; v: string; vColor?: string }[] = [
      { k: 'User ID', v: trace.userId },
      { k: 'Timestamp', v: formatTime(trace.timestamp) },
      { k: 'Model', v: trace.model },
    ]
    if (trace.actualModel !== undefined && trace.actualModel !== '')
      items.push({ k: 'Actual Model', v: trace.actualModel })
    items.push({ k: 'Duration', v: `${fmtNum(trace.duration / 1000, 2)}s` })
    items.push({ k: 'Steps', v: String(trace.steps) })
    if (trace.finishReason !== undefined && trace.finishReason !== '')
      items.push({ k: 'Finish Reason', v: trace.finishReason })
    if (trace.responseId !== undefined && trace.responseId !== '') items.push({ k: 'Response ID', v: trace.responseId })
    if (trace.messageCount !== undefined) items.push({ k: 'Messages', v: String(trace.messageCount) })
    if (trace.toolCount !== undefined) items.push({ k: 'Tools Available', v: String(trace.toolCount) })
    if (hasError) items.push({ k: 'Error', v: trace.error ?? '', vColor: 'var(--danger)' })
    return items
  })

  const tokenUsage = $derived([
    { k: 'Input', v: formatTokens(trace.totalTokens.inputTokens) },
    { k: 'Output', v: formatTokens(trace.totalTokens.outputTokens) },
    { k: 'Total', v: formatTokens(trace.totalTokens.inputTokens + trace.totalTokens.outputTokens) },
  ])
</script>

<div class="trace-detail-section">
  <h4>Basic Info</h4>
  <SummaryList items={basicInfo} />
</div>

<div class="trace-detail-section">
  <h4>Token Usage</h4>
  <SummaryList cols={3} items={tokenUsage} />
</div>

{#if trace.generatedText !== undefined && trace.generatedText !== ''}
  <div class="trace-detail-section">
    <h4>Generated Response</h4>
    <pre class="generated-text">{trace.generatedText}</pre>
  </div>
{/if}

{#if trace.stepsDetail !== undefined && trace.stepsDetail.length > 0}
  <div class="trace-detail-section">
    <h4>Steps Detail ({trace.stepsDetail.length})</h4>
    <div class="steps-list">
      {#each trace.stepsDetail as step (step.stepNumber)}
        <div class="step-item">
          <div class="step-header">
            Step {step.stepNumber}{#if step.finishReason !== undefined && step.finishReason !== ''}<span class="step-finish-reason">({step.finishReason})</span>{/if}
          </div>
          {#if step.text !== undefined && step.text !== ''}
            <div class="step-section">
              <div class="label">Generated Text</div>
              <pre class="step-text">{step.text}</pre>
            </div>
          {/if}
          {#if step.toolCalls !== undefined && step.toolCalls.length > 0}
            <div class="step-tool-calls">
              {#each step.toolCalls as tc (tc.toolCallId)}
                {@const tcError = tc.error !== undefined && tc.error !== ''}
                <div class="step-tool-call" class:step-tool-error={tcError}>
                  <div class="step-tool-call-header">
                    <span class="tool-name">{tc.toolName}</span>
                    <span class="tool-id">{tc.toolCallId}</span>
                  </div>
                  {#if tc.args !== undefined}
                    <div class="tool-section">
                      <div class="label">Arguments</div>
                      <pre class="tool-json">{JSON.stringify(tc.args, null, 2)}</pre>
                    </div>
                  {/if}
                  {#if tc.result !== undefined}
                    <div class="tool-section">
                      <div class="label">Result</div>
                      <pre class="tool-json">{JSON.stringify(tc.result, null, 2)}</pre>
                    </div>
                  {/if}
                  {#if tcError}
                    <div class="tool-section">
                      <div class="label">Error</div>
                      <pre class="tool-json error">{tc.error}</pre>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if step.usage !== undefined}
            <div class="step-usage">
              Tokens: {formatTokens(step.usage.inputTokens)} in / {formatTokens(step.usage.outputTokens)} out
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if trace.toolCalls !== undefined && trace.toolCalls.length > 0}
  <div class="trace-detail-section">
    <h4>Tool Calls ({trace.toolCalls.length})</h4>
    <div class="tool-calls-list">
      {#each trace.toolCalls as tc, i (i)}
        <div class="tool-call-item" class:error={!tc.success}>
          <div class="tool-call-summary">
            <span class="tool-name">{tc.toolName}</span>
            <span class="tool-duration">{tc.durationMs}ms</span>
            <StatusPill status={tc.success ? 'ok' : 'failed'} />
          </div>
          {#if tc.toolCallId !== undefined}
            <div class="tool-call-id">ID: {tc.toolCallId}</div>
          {/if}
          {#if tc.args !== undefined}
            <div class="tool-section">
              <div class="label">Arguments</div>
              <pre class="tool-json">{JSON.stringify(tc.args, null, 2)}</pre>
            </div>
          {/if}
          {#if tc.result !== undefined}
            <div class="tool-section">
              <div class="label">Result</div>
              <pre class="tool-json">{JSON.stringify(tc.result, null, 2)}</pre>
            </div>
          {/if}
          {#if tc.error !== undefined && tc.error !== ''}
            <div class="tool-section">
              <div class="label">Error</div>
              <pre class="tool-json error">{tc.error}</pre>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
