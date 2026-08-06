<script lang="ts">
  import EmptyState from '../shared/ui/EmptyState.svelte'
  import { shouldFollow } from './autoscroll.js'
  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { emptyStateFor } from './empty-state.js'
  import type { TranscriptEvent } from './fetcher-schemas.js'
  import type { ViewerStatus } from './transcript.svelte.js'

  let { events, status }: { events: TranscriptEvent[]; status: ViewerStatus } = $props()

  const empty = $derived(emptyStateFor(status))

  let follow = $state(true)

  // Measure BEFORE the DOM updates. After the new events render, a reader who was pinned to the
  // bottom is suddenly one event-height away from it, and a post-update measurement would read
  // that as "scrolled up" and refuse to follow.
  $effect.pre(() => {
    void events.length
    follow = shouldFollow(window.scrollY, window.innerHeight, document.body.scrollHeight)
  })

  // Instant, never smooth: that sidesteps prefers-reduced-motion rather than special-casing it.
  $effect(() => {
    void events.length
    if (status === 'live' && follow) window.scrollTo({ top: document.body.scrollHeight })
  })
</script>

<main class="tx-wrap">
  <header>
    <h1>Coding session</h1>
    <StatusBanner {status} />
  </header>
  {#if events.length > 0}
    <div class="tx-timeline" role="log" aria-live={status === 'live' ? 'polite' : 'off'}>
      {#each events as event (event.seq)}
        <TimelineEvent {event} />
      {/each}
    </div>
  {:else}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
</main>
