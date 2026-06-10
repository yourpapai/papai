<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminUser, fetchAdminUsers, removeAdminUser } from '../../admin-fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas.js'
  import Confirm from '../../../shared/Confirm.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'
  import IdCell from '../../components/IdCell.svelte'

  let users: AdminUserRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let newUsername = $state('')
  let pendingRemoval: string | null = $state(null)
  const pendingRemovalLabel = $derived(pendingRemoval ?? '')

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
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="users-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="User ID or @username" hint="For Telegram, you can use @username instead of numeric ID">
      {#snippet children()}
        <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="user-add-input" placeholder="123456789 or @username" />
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
        <Btn variant="danger" size="sm" testid={`user-remove-${row.platform_user_id}`} onClick={() => (pendingRemoval = row.platform_user_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else if col.key === 'platform_user_id'}
        <IdCell value={row.platform_user_id} />
      {:else}
        {String(row[col.key as keyof UserRow] ?? '')}
      {/if}
    {/snippet}
    <SettingsTable
      columns={userColumns}
      rows={userRows}
      rowKey="platform_user_id"
      searchKeys={['platform_user_id', 'username']}
      {cell}
      searchPlaceholder="Search users by ID or name…">
      {#snippet empty()}No users{/snippet}
    </SettingsTable>
  </div>

  <Confirm
    open={pendingRemoval !== null}
    title="Remove user"
    danger
    confirmLabel="Remove"
    onCancel={() => (pendingRemoval = null)}
    onConfirm={() => { const id = pendingRemoval; pendingRemoval = null; if (id !== null) void remove(id) }}>
    {#snippet body()}<p>Remove user {pendingRemovalLabel}? This cannot be undone.</p>{/snippet}
  </Confirm>
</section>
