<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { formatDateTime, formatTime, levelClass, levelName } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import Toolbar from '../../shared/ui/Toolbar.svelte'
  import { collectScopes, fetchLogStats, fetchOlderLogs, parseLogsArray, type LogBufferStats } from '../log-bootstrap.js'
  import type { LogEntry, DashboardState } from '../dashboard-types.js'
  import ScopeFilter from './ScopeFilter.svelte'

  interface Props {
    dashboard: DashboardState
    onSelectLog: (entry: LogEntry, index: number) => void
  }

  let { dashboard, onSelectLog }: Props = $props()

  let levelFilter = $derived(String(dashboard.activeLogFilter.level))
  let searchQuery = $derived(dashboard.activeLogFilter.q ?? '')

  const filtered = $derived(dashboard.logs.map((entry, originalIndex) => ({ entry, originalIndex })))

  let autoScroll = $state(true)
  let entriesEl: HTMLDivElement | null = $state(null)

  let loadingOlder = $state(false)
  let reachedStart = $state(false)
  let bufferStats = $state<LogBufferStats | null>(null)

  // Surface how bounded the in-memory buffer is, and whether older records exist.
  $effect(() => {
    void untrack(async () => {
      bufferStats = await fetchLogStats(dashboard.activeLogFilter)
    })
  })

  const moreOlderAvailable = $derived(
    !reachedStart && bufferStats !== null && dashboard.logs.length < bufferStats.count,
  )

  // Page backward through the in-memory buffer: the browser only bootstraps the
  // newest page, so older records must be fetched explicitly via the `before` cursor.
  async function loadOlder(): Promise<void> {
    if (loadingOlder || reachedStart) return
    const before = dashboard.logs[0]?.time
    if (before === undefined) return
    loadingOlder = true
    autoScroll = false
    const prevHeight = entriesEl?.scrollHeight ?? 0
    try {
      const parsed = parseLogsArray(await fetchOlderLogs(before, dashboard.activeLogFilter))
      if (parsed.length === 0) {
        reachedStart = true
        return
      }
      dashboard.logs.unshift(...parsed)
      for (const scope of collectScopes(parsed)) dashboard.logScopes.add(scope)
      bufferStats = await fetchLogStats(dashboard.activeLogFilter)
      await tick()
      // Keep the viewport anchored on the same entry after prepending older rows.
      if (entriesEl !== null) entriesEl.scrollTop += entriesEl.scrollHeight - prevHeight
    } finally {
      loadingOlder = false
    }
  }

  function setLevel(v: string): void {
    dashboard.activeLogFilter = { ...dashboard.activeLogFilter, level: Number(v) }
  }

  function setQuery(v: string): void {
    dashboard.activeLogFilter = { ...dashboard.activeLogFilter, q: v === '' ? undefined : v }
  }

  function setScopes(include: string[], exclude: string[]): void {
    dashboard.activeLogFilter = { ...dashboard.activeLogFilter, include, exclude }
  }

  function clearTurnFilter(): void {
    dashboard.activeLogFilter = { ...dashboard.activeLogFilter, turnId: undefined }
  }

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
    dashboard.logScopeCounts = []
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
          onChange={setLevel} />
        <Input value={searchQuery} placeholder="search..." onInput={setQuery} />
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
      <ScopeFilter
        scopes={dashboard.logScopeCounts}
        include={dashboard.activeLogFilter.include}
        exclude={dashboard.activeLogFilter.exclude}
        onChange={setScopes} />
      <div id="log-entries" bind:this={entriesEl} onscroll={onScroll}>
        <div class="log-history">
          {#if reachedStart}
            <span class="log-history__note">— oldest buffered record —</span>
          {:else if moreOlderAvailable}
            <Btn variant="secondary" size="sm" onClick={() => { void loadOlder() }} disabled={loadingOlder}>
              {#snippet children()}{loadingOlder ? 'loading…' : '↑ load older'}{/snippet}
            </Btn>
          {/if}
        </div>
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
            <span class="log-meta" title={formatDateTime(fl.entry.time)}>{formatTime(fl.entry.time)} {levelName(fl.entry.level)}{fl.entry.scope === undefined ? '' : ` ${fl.entry.scope}`}</span>
            <span class="log-msg">{fl.entry.msg}</span>
          </div>
        {/each}
      </div>
      {#if bufferStats !== null}
        <span class="log-bufferstat">
          showing {filtered.length} · {bufferStats.matchingCount ?? dashboard.logs.length} match filter of {bufferStats.count} buffered (cap {bufferStats.capacity})
        </span>
      {/if}
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

  .log-history {
    display: flex;
    justify-content: center;
    padding: 4px;
  }

  .log-history__note {
    color: var(--fg4);
    font-size: 11px;
    padding: 4px;
  }

  .log-bufferstat {
    display: block;
    padding: 4px 8px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    border-top: 1px solid var(--border);
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
