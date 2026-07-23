<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    count?: number | null
    children: Snippet
  }

  let { title, count = null, children }: Props = $props()
</script>

<section class="panel">
  <h2>
    {title}
    {#if count !== null}
      <span class="count-badge">{count}</span>
    {/if}
  </h2>
  {@render children()}
</section>
