<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminUser, fetchAdminUsers, removeAdminUser } from '../../admin-fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import DataTable from '../../../shared/ui/DataTable.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

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

  interface UserRow {
    platform_user_id: string
    username: string
  }

  const userRows = $derived<UserRow[]>(
    users.map((u) => ({ platform_user_id: u.platform_user_id, username: u.username ?? '—' })),
  )

  const userColumns = [
    { key: 'platform_user_id' as const, label: 'User ID' },
    { key: 'username' as const, label: 'Username' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="users" class="settings-section">
  <PageHeader eyebrow="Admin · Access" title="Users">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load()}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="User ID">
      {#snippet children()}
        <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="user-add-input" />
      {/snippet}
    </Field>
    <Field label="Username" hint="optional">
      {#snippet children()}
        <Input value={newUsername} onInput={(v) => (newUsername = v)} />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="user-add">
      {#snippet children()}Add user{/snippet}
    </Btn>
  </form>

  <div class="settings-table-wrap">
    {#snippet cell(row: UserRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn variant="ghost" size="sm" testid={`user-remove-${row.platform_user_id}`} onClick={() => void remove(row.platform_user_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof UserRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={userColumns} rows={userRows} {cell} rowKey="platform_user_id">
      {#snippet empty()}No users{/snippet}
    </DataTable>
  </div>
</section>
