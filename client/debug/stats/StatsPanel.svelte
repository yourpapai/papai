<script lang="ts">
  import { untrack } from 'svelte'

  import type { DashboardState, StatsWindow } from '../dashboard-types.js'
  import { fetchStatsGlobal } from './fetchers.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  const WINDOWS: readonly StatsWindow[] = ['1d', '7d', '30d', 'all']

  let loading = $state(false)
  let error: string | null = $state(null)

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  async function loadStats(): Promise<void> {
    loading = true
    error = null
    try {
      dashboard.globalStats = await fetchStatsGlobal(dashboard.statsWindow)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function onWindowChange(event: Event): void {
    const target = event.currentTarget
    if (!(target instanceof HTMLSelectElement)) return
    const next = target.value
    if (next === '1d' || next === '7d' || next === '30d' || next === 'all') {
      dashboard.statsWindow = next
      void loadStats()
    }
  }

  $effect(() => {
    untrack(() => {
      void loadStats()
    })
  })
</script>

<section class="panel stats-panel">
  <header class="stats-header">
    <h2>Stats</h2>
    <label>
      Window:
      <select
        data-testid="stats-window-select"
        value={dashboard.statsWindow}
        onchange={onWindowChange}>
        {#each WINDOWS as w (w)}
          <option value={w}>{w}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      data-testid="stats-refresh"
      onclick={() => {
        void loadStats()
      }}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    {#if error !== null}
      <span class="status-error">{error}</span>
    {/if}
  </header>

  {#if dashboard.globalStats !== null}
    {@const g = dashboard.globalStats}
    <section class="stats-summary">
      <h3>Subjects</h3>
      <dl class="stats-list">
        <dt>DM total</dt><dd data-testid="stats-dm-total">{g.subjects.dmTotal}</dd>
        <dt>Group total</dt><dd data-testid="stats-group-total">{g.subjects.groupTotal}</dd>
        <dt>Active 1d / 7d / 30d</dt>
        <dd>{g.active.activeIn1d} / {g.active.activeIn7d} / {g.active.activeIn30d}</dd>
      </dl>
      <h3>Storage</h3>
      <dl class="stats-list">
        <dt>SQLite</dt><dd>{formatBytes(g.storage.sqliteBytes)}</dd>
        <dt>S3 attachments (active)</dt><dd>{formatBytes(g.storage.s3AttachmentBytes)}</dd>
      </dl>
      <h3>Identity mix</h3>
      <dl class="stats-list">
        {#each Object.entries(g.identityMix.byProvider) as [provider, count] (provider)}
          <dt>{provider}</dt><dd>{count}</dd>
        {/each}
        <dt>Kaneo workspaces</dt><dd>{g.identityMix.kaneoWorkspaces}</dd>
      </dl>
      <h3>Surface mix</h3>
      <dl class="stats-list">
        <dt>w/ recurring</dt><dd>{g.surfaceMix.subjectsWithRecurring}</dd>
        <dt>w/ deferred</dt><dd>{g.surfaceMix.subjectsWithDeferred}</dd>
        <dt>w/ memos</dt><dd>{g.surfaceMix.subjectsWithMemos}</dd>
        <dt>w/ instructions</dt><dd>{g.surfaceMix.subjectsWithInstructions}</dd>
      </dl>
      <h3>Distributions (memos/subject)</h3>
      <dl class="stats-list">
        <dt>count / mean</dt><dd>{g.distributions.memosPerSubject.count} / {g.distributions.memosPerSubject.mean.toFixed(2)}</dd>
        <dt>p50 / p90 / p99 / max</dt>
        <dd>{g.distributions.memosPerSubject.p50} / {g.distributions.memosPerSubject.p90} / {g.distributions.memosPerSubject.p99} / {g.distributions.memosPerSubject.max}</dd>
      </dl>
      <h3>Top hosts (keyed-hashed)</h3>
      {#if g.webFetches.topHosts.length === 0}
        <span class="placeholder">No web fetches</span>
      {:else}
        <ul class="stats-list">
          {#each g.webFetches.topHosts as h (h.hostHash)}
            <li><code>{h.hostHash.slice(0, 12)}</code>: {h.count}</li>
          {/each}
        </ul>
      {/if}
      <h3>Top tools</h3>
      {#if g.toolMix.topTools.length === 0}
        <span class="placeholder">No tool calls</span>
      {:else}
        <ul class="stats-list">
          {#each g.toolMix.topTools as t (t.toolName)}
            <li>{t.toolName}: {t.count} (success {(t.successRate * 100).toFixed(0)}%)</li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if !loading && error === null}
    <span class="placeholder">No stats loaded yet</span>
  {/if}
</section>
