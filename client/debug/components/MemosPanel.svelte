<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  let search = $state('')

  function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '...'
  }

  const filtered = $derived.by(() => {
    const q = search.toLowerCase().trim()
    if (q === '') return dashboard.memos
    return dashboard.memos.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        (m.summary !== null && m.summary.toLowerCase().includes(q)) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    )
  })
</script>

<section class="panel">
  <h2>Memos <span class="count-badge">{dashboard.memos.length}</span></h2>
  <div class="memo-toolbar">
    <input type="text" placeholder="search memos..." bind:value={search} />
  </div>
  {#if filtered.length === 0}
    <span class="placeholder">No memos</span>
  {:else}
    {#each filtered as memo (memo.id)}
      {@const preview = truncate(memo.content, 120)}
      <div class="memo-row">
        <div class="memo-summary">
          <span class="memo-time">{formatTime(memo.createdAt)}</span>
          <span class="memo-content">{preview}</span>
          {#if memo.tags.length > 0}
            <span class="memo-tags">{memo.tags.join(', ')}</span>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</section>
