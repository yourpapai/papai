<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addGroupMember, fetchGroupMembers, removeGroupMember } from '../fetchers.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let members: GroupMembersResponse['members'] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      members = (await fetchGroupMembers(id)).members
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    error = null
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      await addGroupMember({ userId, contextId })
      newUserId = ''
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(userId: string): Promise<void> {
    error = null
    try {
      await removeGroupMember({ userId, contextId })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="members" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Group</p>
      <h2>Members</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label>
      <span>User ID</span>
      <input data-testid="member-add-input" value={newUserId} oninput={(e) => (newUserId = (e.target as HTMLInputElement).value)} />
    </label>
    <button type="submit" data-testid="member-add">Add member</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Added by</th><th>Added at</th><th>Actions</th></tr></thead>
      <tbody>
        {#each members as member (member.user_id)}
          <tr>
            <td>{member.user_id}</td><td>{member.added_by}</td><td>{member.added_at}</td>
            <td><button type="button" data-testid={`member-remove-${member.user_id}`} onclick={() => void remove(member.user_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
