<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Memo } from '../../shared/api-types.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import { fetchMemos } from '../fetchers.js'

  let userId = $state('')
  let state = $state<'active' | 'archived'>('active')
  let memos: Memo[] = $state([])
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)
  let rootEl: HTMLElement | undefined = $state()
  let loaded = $state(false)

  async function loadMemos(): Promise<void> {
    if (userId.trim() === '') return
    loading = true
    error = null
    try {
      memos = await fetchMemos(userId.trim(), state)
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      error = err instanceof Error ? err.message : String(err)
      memos = []
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (rootEl === undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loaded = true
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '0px' },
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  })

  interface MemoRow {
    id: string
    status: string
    content: string
    tags: string
  }

  const rows = $derived<MemoRow[]>(
    memos.map((m) => ({
      id: m.id,
      status: m.status,
      content: m.content,
      tags: m.tags.join(', ') || '—',
    })) as MemoRow[],
  )

  const columns = [
    { key: 'id' as const, label: 'ID' },
    { key: 'status' as const, label: 'Status' },
    { key: 'content' as const, label: 'Content' },
    { key: 'tags' as const, label: 'Tags' },
  ]
</script>

<section id="memos" class="admin-data-section admin-section" bind:this={rootEl}>
  <Panel title="memos">
    {#snippet action()}
      <form
        class="memos__filter"
        onsubmit={(e) => {
          e.preventDefault()
          void loadMemos()
        }}>
        <input
          class="memos__user-id-input"
          data-testid="memos-user-id"
          type="text"
          bind:value={userId}
          placeholder="user id" />
        <Seg
          options={['active', 'archived']}
          value={state}
          onChange={(v) => {
            state = v as 'active' | 'archived'
          }} />
        <button
          class="memos__load-btn"
          data-testid="memos-load"
          type="submit"
          disabled={userId.trim() === '' || loading}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </form>
    {/snippet}
    {#snippet body()}
      <div class="memos__body">
        {#if error !== null}
          <p class="status-error" data-testid="memos-error">{error}</p>
        {:else if !hasLoaded}
          <p class="placeholder">Enter a user ID and click Load.</p>
        {:else if memos.length === 0}
          <p class="placeholder">No memos found</p>
        {:else}
          <DataTable {columns} {rows} rowKey="id" />
        {/if}
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .memos__filter {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .memos__user-id-input {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: 0;
    padding: 4px 10px;
  }
  .memos__load-btn {
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 2px;
    color: var(--bg);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    height: 22px;
    padding: 3px 8px;
  }
  .memos__load-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .memos__body {
    padding: 0;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    margin: 0;
    padding: 12px;
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
