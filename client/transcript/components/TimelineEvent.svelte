<script lang="ts">
  import { describeEvent } from '../describe-event.js'
  import type { TranscriptEvent } from '../fetcher-schemas.js'
  import { formatEventTime } from '../format-ts.js'

  let { event }: { event: TranscriptEvent } = $props()

  const described = $derived(describeEvent(event))
  const at = $derived(formatEventTime(event.ts))
</script>

<div class="tx-ev tx-ev--{event.type}">
  <time class="tx-ev__time" datetime={event.ts}>{at}</time>
  <div class="tx-ev__body">
    {#if described.kind === 'prompt'}
      <div class="tx-prompt">
        <span class="tx-prompt__who">you</span>
        <span class="tx-prompt__body">{described.body}</span>
      </div>
    {:else if described.kind === 'message'}
      <div class="tx-msg">{described.body}</div>
    {:else if described.kind === 'thought'}
      <details class="tx-thought">
        <summary>thinking</summary>
        <pre>{described.body}</pre>
      </details>
    {:else if described.kind === 'tool'}
      <div class="tx-tool tx-tool--{described.tone}">
        <span class="tx-tool__glyph" aria-hidden="true">{described.glyph}</span>
        <span class="tx-tool__name">{described.title}</span>
        <span class="tx-tool__status">{described.status}</span>
      </div>
    {:else if described.kind === 'plan'}
      <ul class="tx-plan">
        {#each described.entries as entry, index (index)}
          <li class="tx-plan__item tx-plan__item--{entry.status}">
            <span class="tx-plan__mark" aria-hidden="true">{entry.mark}</span>
            <span class="tx-plan__text">{entry.content}</span>
          </li>
        {/each}
      </ul>
    {:else if described.kind === 'permission'}
      {#if described.decided}
        <div class="tx-perm tx-perm--decided">decision recorded in chat</div>
      {:else}
        <div class="tx-perm">🔒 asked for permission — approve or deny in chat</div>
      {/if}
    {:else if described.kind === 'result'}
      <div class="tx-result">✔ finished — {described.stopReason}</div>
    {:else}
      <pre class="tx-raw">{described.json}</pre>
    {/if}
  </div>
</div>

<style>
  .tx-ev {
    display: flex;
    /* New rule, so it takes a token immediately. The pre-existing literals below
       (padding, --border) are migrated in a later task, not here. */
    gap: var(--s3);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    border-left: 2px solid var(--border);
    padding: 0.3rem 0.7rem;
  }
  .tx-ev__time {
    flex: none;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .tx-ev__body {
    flex: 1;
    min-width: 0;
  }
  .tx-ev--prompt {
    border-left-color: var(--accent-dim);
  }
  .tx-msg {
    white-space: pre-wrap;
  }
  .tx-prompt {
    display: flex;
    gap: 0.5rem;
  }
  .tx-prompt__who {
    color: var(--text-dim);
    flex: none;
  }
  .tx-prompt__body {
    white-space: pre-wrap;
    color: var(--text);
  }
  .tx-tool {
    display: flex;
    gap: 0.5rem;
  }
  .tx-tool__glyph {
    flex: none;
  }
  .tx-tool--accent {
    color: var(--accent);
  }
  .tx-tool--warn {
    color: var(--warn);
  }
  .tx-tool--danger {
    color: var(--danger);
  }
  .tx-tool--info {
    color: var(--info);
  }
  .tx-tool--neutral {
    color: var(--text-muted);
  }
  .tx-tool--mute {
    color: var(--text-dim);
  }
  .tx-perm {
    color: var(--danger);
  }
  .tx-plan {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tx-plan__item {
    display: flex;
    gap: 0.5rem;
    color: var(--text-muted);
  }
  .tx-plan__mark {
    flex: none;
  }
  .tx-plan__item--completed {
    color: var(--accent);
  }
  .tx-plan__item--in_progress {
    color: var(--info);
  }
  .tx-thought pre,
  .tx-raw {
    white-space: pre-wrap;
    color: var(--text-dim);
  }
</style>
