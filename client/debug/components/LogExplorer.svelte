<script lang="ts">
  import { tick } from 'svelte'

  import { formatTime, levelClass, levelName } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import Toolbar from '../../shared/ui/Toolbar.svelte'
  import { filterLogsWithIndex, updateFuseIndex } from '../log-filter.js'
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
    filterLogsWithIndex(dashboard.logs, Number(levelFilter), scopeFilter, searchQuery.trim(), fuseInstance, dashboard.activeLogFilter.turnId),
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
  <Panel title="log explorer" count={filtered.length}>
    {#snippet action()}
      <Toolbar>
        <Select
          value={levelFilter}
          options={[
            { value: '0', label: 'all levels' },
            { value: '10', label: 'trace' },
            { value: '20', label: 'debug' },
            { value: '30', label: 'info' },
            { value: '40', label: 'warn' },
            { value: '50', label: 'error' },
          ]}
          onChange={(v) => (levelFilter = v)} />
        <Select
          value={scopeFilter}
          options={[{ value: '', label: 'all scopes' }, ...sortedScopes.map((s) => ({ value: s, label: s }))]}
          onChange={(v) => (scopeFilter = v)} />
        <Input value={searchQuery} placeholder="search..." onInput={(v) => (searchQuery = v)} />
        {#if dashboard.activeLogFilter.turnId !== undefined}
          <div class="log-turnid-badge">
            <span>turn:{dashboard.activeLogFilter.turnId.slice(0, 8)}</span>
            <Btn variant="ghost" size="sm" onClick={clearTurnFilter}>{#snippet children()}×{/snippet}</Btn>
          </div>
        {/if}
        <Btn variant="ghost" size="sm" onClick={clearLogs}>{#snippet children()}clear{/snippet}</Btn>
      </Toolbar>
    {/snippet}
    {#snippet body()}
      <div id="log-entries" bind:this={entriesEl} onscroll={onScroll}>
        {#each filtered as fl, i (i)}
          <div
            class="log-entry {levelClass(fl.entry.level)}"
            role="button"
            tabindex="0"
            onclick={() => onSelectLog(fl.entry, fl.originalIndex)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectLog(fl.entry, fl.originalIndex)
              }
            }}>
            <span class="log-meta">{formatTime(fl.entry.time)} {levelName(fl.entry.level)}{fl.entry.scope === undefined ? '' : ` ${fl.entry.scope}`}</span>
            <span class="log-msg">{fl.entry.msg}</span>
          </div>
        {/each}
      </div>
      {#if !autoScroll}
        <Btn variant="secondary" size="sm" onClick={jumpToBottom}>{#snippet children()}▼ auto-scroll{/snippet}</Btn>
      {/if}
    {/snippet}
  </Panel>
</section>

<style>
  #log-entries {
    flex: 1;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .log-entry {
    display: flex;
    gap: 8px;
    padding: 2px 8px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }

  .log-entry:hover {
    background: var(--raised);
  }

  .log-meta {
    color: var(--fg3);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .log-msg {
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-turnid-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }
</style>
