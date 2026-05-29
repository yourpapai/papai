<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addRosterAdmin, fetchAdminRoster, removeRosterAdmin } from '../../fetchers.js'
  import type { AdminRosterRow } from '../../fetcher-schemas.js'

  let admins: AdminRosterRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let userId = $state('')
  let platformInstanceId = $state('')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      admins = (await fetchAdminRoster()).admins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const u = userId.trim()
    const p = platformInstanceId.trim()
    if (u === '' || p === '') return
    try {
      await addRosterAdmin({ userId: u, platformInstanceId: p })
      userId = ''
      platformInstanceId = ''
      await load()
      status = 'Admin added.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(row: AdminRosterRow): Promise<void> {
    error = null
    status = null
    try {
      await removeRosterAdmin({ userId: row.userId, platformInstanceId: row.platformInstanceId })
      await load()
      status = 'Admin removed.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="admins" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Roster</p>
      <h2>Admins</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>User ID</span><input data-testid="admin-user-input" value={userId} oninput={(e) => (userId = (e.target as HTMLInputElement).value)} /></label>
    <label><span>Platform instance ID</span><input data-testid="admin-platform-input" value={platformInstanceId} oninput={(e) => (platformInstanceId = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="admin-add">Add admin</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Platform instance</th><th>Actions</th></tr></thead>
      <tbody>
        {#each admins as admin (`${admin.userId}:${admin.platformInstanceId}`)}
          <tr>
            <td>{admin.userId}</td><td>{admin.platformInstanceId}</td>
            <td><button type="button" data-testid={`admin-remove-${admin.userId}`} onclick={() => void remove(admin)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
