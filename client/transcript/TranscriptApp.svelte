<script lang="ts">
  import { onMount } from 'svelte'

  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { createTranscriptState } from './transcript.svelte.js'

  let { token }: { token: string } = $props()
  const state = createTranscriptState(token)

  onMount(() => {
    void state.load()
  })
</script>

<main class="tx-wrap">
  <header>
    <h1>Coding session</h1>
    <StatusBanner status={state.status} />
  </header>
  <div class="tx-timeline">
    {#each state.events as event (event.seq)}
      <TimelineEvent {event} />
    {/each}
  </div>
</main>
