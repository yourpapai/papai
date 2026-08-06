<script lang="ts">
  import EmptyState from '../shared/ui/EmptyState.svelte'
  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { emptyStateFor } from './empty-state.js'
  import type { TranscriptEvent } from './fetcher-schemas.js'
  import type { ViewerStatus } from './transcript.svelte.js'

  let { events, status }: { events: TranscriptEvent[]; status: ViewerStatus } = $props()

  const empty = $derived(emptyStateFor(status))
</script>

<main class="tx-wrap">
  <header>
    <h1>Coding session</h1>
    <StatusBanner {status} />
  </header>
  {#if events.length > 0}
    <div class="tx-timeline">
      {#each events as event (event.seq)}
        <TimelineEvent {event} />
      {/each}
    </div>
  {:else}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
</main>
