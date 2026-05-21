<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Memo } from '../../shared/api-types.js'
  import { fetchMemos } from '../fetchers.js'

  let userId = $state('')
  let state = $state<'active' | 'archived' | 'all'>('active')
  let memos: Memo[] = $state([])
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)

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

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    void loadMemos()
  }
</script>

<section class="panel admin-data-section">
  <header class="admin-section-header">
    <div>
      <p class="eyebrow">Records</p>
      <h2 data-testid="admin-section-title">Memos</h2>
    </div>
  </header>

  <form class="admin-filter-form" onsubmit={submit}>
    <label>
      <span>User ID</span>
      <input data-testid="memos-user-id" bind:value={userId} placeholder="user id" type="text" />
    </label>
    <label>
      <span>State</span>
      <select
        data-testid="memos-state"
        value={state}
        onchange={(event) => {
          state = (event.currentTarget as HTMLSelectElement).value as 'active' | 'archived' | 'all'
        }}>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
        <option value="all">All</option>
      </select>
    </label>
    <button data-testid="memos-load" disabled={userId.trim() === '' || loading} type="submit">
      {loading ? 'Loading...' : 'Load'}
    </button>
  </form>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if hasLoaded && memos.length === 0}
    <p class="placeholder">No memos found</p>
  {:else if memos.length > 0}
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Content</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {#each memos as memo (memo.id)}
            <tr>
              <td>{memo.id}</td>
              <td>{memo.status}</td>
              <td>{memo.content}</td>
              <td>{memo.tags.join(', ') || 'None'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
