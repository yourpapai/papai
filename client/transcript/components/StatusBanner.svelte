<script lang="ts">
  import type { ViewerStatus } from '../transcript.svelte.js'

  let { status }: { status: ViewerStatus } = $props()

  const TEXT: Record<ViewerStatus, string> = {
    connecting: 'Connecting…',
    live: '● Live',
    finished: 'Session finished',
    'recording-disabled': 'Transcript not retained — live only',
    'invalid-token': 'This link is invalid or has expired',
    error: 'Temporarily unavailable — retrying',
  }
</script>

<div class="tx-banner tx-banner--{status}">{TEXT[status]}</div>

<style>
  .tx-banner {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    background: var(--surface-1);
    color: var(--fg);
    display: inline-block;
  }
  .tx-banner--live {
    color: var(--accent);
  }
  .tx-banner--invalid-token,
  .tx-banner--error {
    color: var(--danger);
  }
</style>
