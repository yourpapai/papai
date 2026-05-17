<script lang="ts">
  import { tick } from 'svelte'

  import { formatTime, levelClass, levelName } from '../helpers.js'
  import { filterLogs, updateFuseIndex } from '../log-filter.js'
  import type { LogEntry, DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
    onSelectLog: (entry: LogEntry, index: number) => void
  }

  let { dashboard, onSelectLog }: Props = $props()

  let levelFilter = $state('0')
  let scopeFilter = $state('')
  let searchQuery = $state('')

  let autoScroll = $state(true)
  let entriesEl: HTMLDivElement | null = $state(null)

  const sortedScopes = $derived([...dashboard.logScopes].sort())

  const fuseInstance = $derived(updateFuseIndex(dashboard.logs))
  const filtered = $derived(
    filterLogs(dashboard.logs, Number(levelFilter), scopeFilter, searchQuery.trim(), fuseInstance, dashboard.activeLogFilter.turnId),
  )

  // Auto-scroll when new entries arrive
  $effect(() => {
    void filtered.length
    if (!autoScroll) return
    void tick().then(() => {
      if (entriesEl !== null) entriesEl.scrollTop = entriesEl.scrollHeight
    })
  })

  function onScroll(): void {
    if (entriesEl === null) return
    const { scrollTop, scrollHeight, clientHeight } = entriesEl
    autoScroll = scrollHeight - scrollTop - clientHeight < 50
  }

  function clearLogs(): void {
    dashboard.logs.length = 0
    dashboard.logScopes.clear()
  }

  function clearTurnFilter(): void {
    dashboard.activeLogFilter.turnId = undefined
  }

  function jumpToBottom(): void {
    autoScroll = true
    if (entriesEl !== null) entriesEl.scrollTop = entriesEl.scrollHeight
  }
</script>

<section id="log-explorer">
  <div class="log-toolbar">
    <h2>Log Explorer <span class="count-badge">{filtered.length}</span></h2>
    <div class="log-filters">
      <select bind:value={levelFilter}>
        <option value="0">all levels</option>
        <option value="10">trace</option>
        <option value="20">debug</option>
        <option value="30">info</option>
        <option value="40">warn</option>
        <option value="50">error</option>
      </select>
      <select bind:value={scopeFilter}>
        <option value="">all scopes</option>
        {#each sortedScopes as s (s)}
          <option value={s}>{s}</option>
        {/each}
      </select>
      <input type="text" placeholder="search..." bind:value={searchQuery} />
      {#if dashboard.activeLogFilter.turnId !== undefined}
        <div class="log-turnid-badge">
          <span>turn:{dashboard.activeLogFilter.turnId.slice(0, 8)}</span>
          <button type="button" aria-label="Clear turn filter" onclick={clearTurnFilter}>×</button>
        </div>
      {/if}
      <button type="button" onclick={clearLogs}>clear</button>
    </div>
  </div>
  <div id="log-entries" bind:this={entriesEl} onscroll={onScroll}>
    {#each filtered as entry, i (i)}
      {@const idx = dashboard.logs.indexOf(entry)}
      <div
        class="log-entry {levelClass(entry.level)}"
        role="button"
        tabindex="0"
        onclick={() => onSelectLog(entry, idx)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelectLog(entry, idx)
          }
        }}>
        <span class="log-meta">{formatTime(entry.time)} {levelName(entry.level)}{entry.scope === undefined ? '' : ` ${entry.scope}`}</span>
        <span class="log-msg">{entry.msg}</span>
      </div>
    {/each}
  </div>
  {#if !autoScroll}
    <button type="button" id="log-autoscroll" onclick={jumpToBottom}>▼ auto-scroll</button>
  {/if}
</section>
