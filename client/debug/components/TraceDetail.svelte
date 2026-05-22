<script lang="ts">
  import { formatTime, formatTokens } from '../../shared/helpers.js'
  import type { LlmTrace } from '../dashboard-types.js'

  interface Props {
    trace: LlmTrace
  }

  let { trace }: Props = $props()

  const hasError = $derived(trace.error !== undefined && trace.error !== '')
</script>

<div class="trace-detail-section">
  <h4>Basic Info</h4>
  <div class="trace-detail-grid">
    <div class="trace-detail-item"><div class="label">User ID</div><div class="value">{trace.userId}</div></div>
    <div class="trace-detail-item"><div class="label">Timestamp</div><div class="value">{formatTime(trace.timestamp)}</div></div>
    <div class="trace-detail-item"><div class="label">Model</div><div class="value">{trace.model}</div></div>
    {#if trace.actualModel !== undefined && trace.actualModel !== ''}
      <div class="trace-detail-item"><div class="label">Actual Model</div><div class="value">{trace.actualModel}</div></div>
    {/if}
    <div class="trace-detail-item"><div class="label">Duration</div><div class="value">{(trace.duration / 1000).toFixed(2)}s</div></div>
    <div class="trace-detail-item"><div class="label">Steps</div><div class="value">{trace.steps}</div></div>
    {#if trace.finishReason !== undefined && trace.finishReason !== ''}
      <div class="trace-detail-item"><div class="label">Finish Reason</div><div class="value">{trace.finishReason}</div></div>
    {/if}
    {#if trace.responseId !== undefined && trace.responseId !== ''}
      <div class="trace-detail-item"><div class="label">Response ID</div><div class="value">{trace.responseId}</div></div>
    {/if}
    {#if trace.messageCount !== undefined}
      <div class="trace-detail-item"><div class="label">Messages</div><div class="value">{trace.messageCount}</div></div>
    {/if}
    {#if trace.toolCount !== undefined}
      <div class="trace-detail-item"><div class="label">Tools Available</div><div class="value">{trace.toolCount}</div></div>
    {/if}
    {#if hasError}
      <div class="trace-detail-item"><div class="label">Error</div><div class="value error">{trace.error}</div></div>
    {/if}
  </div>
</div>

<div class="trace-detail-section">
  <h4>Token Usage</h4>
  <div class="trace-detail-grid">
    <div class="trace-detail-item"><div class="label">Input</div><div class="value">{formatTokens(trace.totalTokens.inputTokens)}</div></div>
    <div class="trace-detail-item"><div class="label">Output</div><div class="value">{formatTokens(trace.totalTokens.outputTokens)}</div></div>
    <div class="trace-detail-item"><div class="label">Total</div><div class="value">{formatTokens(trace.totalTokens.inputTokens + trace.totalTokens.outputTokens)}</div></div>
  </div>
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
        {@const statusClass = tc.success ? 'success' : 'error'}
        {@const status = tc.success ? '✓ success' : '✗ failed'}
        <div class="tool-call-item" class:error={!tc.success}>
          <div class="tool-call-summary">
            <span class="tool-name">{tc.toolName}</span>
            <span class="tool-duration">{tc.durationMs}ms</span>
            <span class="tool-status {statusClass}">{status}</span>
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
