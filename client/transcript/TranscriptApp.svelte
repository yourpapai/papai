<script lang="ts">
  import { onMount } from 'svelte'

  import TranscriptView from './TranscriptView.svelte'
  import { createTranscriptState } from './transcript.svelte.js'

  let { token }: { token: string } = $props()
  const state = createTranscriptState(token)

  onMount(() => {
    void state.load()
  })
</script>

<TranscriptView events={state.events} status={state.status} />
