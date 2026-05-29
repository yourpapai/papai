<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminUser, fetchAdminUsers, removeAdminUser } from '../../fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas.js'

  let users: AdminUserRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let newUsername = $state('')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      users = (await fetchAdminUsers()).users
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      const username = newUsername.trim()
      await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      await load()
      status = 'User added.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(userId: string): Promise<void> {
    error = null
    status = null
    try {
      await removeAdminUser({ userId })
      await load()
      status = 'User removed.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="users" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Access</p>
      <h2>Users</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>User ID</span><input data-testid="user-add-input" value={newUserId} oninput={(e) => (newUserId = (e.target as HTMLInputElement).value)} /></label>
    <label><span>Username (optional)</span><input value={newUsername} oninput={(e) => (newUsername = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="user-add">Add user</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Username</th><th>Actions</th></tr></thead>
      <tbody>
        {#each users as user (user.platform_user_id)}
          <tr>
            <td>{user.platform_user_id}</td><td>{user.username ?? '—'}</td>
            <td><button type="button" data-testid={`user-remove-${user.platform_user_id}`} onclick={() => void remove(user.platform_user_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
