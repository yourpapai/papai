<script lang="ts">
  import Pill from '../../shared/ui/Pill.svelte'
  import { bannerFor } from '../banner.js'
  import type { ViewerStatus } from '../transcript.svelte.js'

  let { status }: { status: ViewerStatus } = $props()

  const banner = $derived(bannerFor(status))
</script>

<div class="tx-banner" role="status">
  <Pill tone={banner.tone} dot={banner.dot}>{banner.label}</Pill>
</div>

<style>
  /* Layout only. Every visual property now comes from Pill. */
  .tx-banner {
    display: inline-block;
  }
</style>
