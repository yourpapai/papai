<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminGroup, fetchAdminGroups, removeAdminGroup } from '../../fetchers.js'
  import type { AdminGroupRow } from '../../fetcher-schemas.js'

  let groups: AdminGroupRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newGroupId = $state('')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      groups = (await fetchAdminGroups()).groups
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const groupId = newGroupId.trim()
    if (groupId === '') return
    try {
      await addAdminGroup({ groupId })
      newGroupId = ''
      await load()
      status = 'Group added.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(groupId: string): Promise<void> {
    error = null
    status = null
    try {
      await removeAdminGroup({ groupId })
      await load()
      status = 'Group removed.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="groups" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Access</p>
      <h2>Groups</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>Group ID</span><input data-testid="group-add-input" value={newGroupId} oninput={(e) => (newGroupId = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="group-add">Add group</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>Group ID</th><th>Added by</th><th>Added at</th><th>Actions</th></tr></thead>
      <tbody>
        {#each groups as group (group.group_id)}
          <tr>
            <td>{group.group_id}</td><td>{group.added_by}</td><td>{group.added_at}</td>
            <td><button type="button" data-testid={`group-remove-${group.group_id}`} onclick={() => void remove(group.group_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
