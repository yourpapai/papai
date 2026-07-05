<script lang="ts">
  import type { TranscriptEvent } from '../fetcher-schemas.js'

  let { event }: { event: TranscriptEvent } = $props()

  // Narrow the untyped payload just enough to render; unknown shapes fall back to JSON.
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const updateKind = typeof payload['sessionUpdate'] === 'string' ? (payload['sessionUpdate'] as string) : ''

  function text(v: unknown): string {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }
</script>

<div class="tx-ev tx-ev--{event.type}">
  {#if event.type === 'update' && updateKind === 'agent_message_chunk'}
    <div class="tx-msg">{text(payload['content'] ?? payload['text'])}</div>
  {:else if event.type === 'update' && updateKind === 'agent_thought_chunk'}
    <details class="tx-thought">
      <summary>thinking</summary>
      <pre>{text(payload['content'] ?? payload['text'])}</pre>
    </details>
  {:else if event.type === 'update' && (updateKind === 'tool_call' || updateKind === 'tool_call_update')}
    <div class="tx-tool">
      <span class="tx-tool__name">{text(payload['title'] ?? payload['toolCallId'] ?? 'tool')}</span>
      <span class="tx-tool__status">{text(payload['status'] ?? '')}</span>
    </div>
  {:else if event.type === 'update' && updateKind === 'plan'}
    <pre class="tx-plan">{text(payload['entries'] ?? payload)}</pre>
  {:else if event.type === 'permission_request'}
    <div class="tx-perm">🔒 asked for permission — approve or deny in chat</div>
  {:else if event.type === 'permission_decision'}
    <div class="tx-perm tx-perm--decided">decision recorded in chat</div>
  {:else if event.type === 'result'}
    <div class="tx-result">✔ finished — {text(payload['stopReason'] ?? '')}</div>
  {:else}
    <pre class="tx-raw">{text(payload)}</pre>
  {/if}
</div>

<style>
  .tx-ev {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    border-left: 2px solid var(--border);
    padding: 0.3rem 0.7rem;
  }
  .tx-msg {
    white-space: pre-wrap;
  }
  .tx-tool {
    display: flex;
    gap: 0.5rem;
    color: var(--accent);
  }
  .tx-perm {
    color: var(--danger);
  }
  .tx-thought pre,
  .tx-plan,
  .tx-raw {
    white-space: pre-wrap;
    color: var(--muted, #888);
  }
</style>
