<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import {
    addAdminUser,
    fetchAdminUsers,
    fetchOpenAccess,
    patchOpenAccess,
    removeAdminUser,
    setUserBlocked,
  } from '../../admin-fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas-admin.js'
  import Confirm from '../../../shared/Confirm.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'
  import IdCell from '../../components/IdCell.svelte'

  let users: AdminUserRow[] = $state([])
  let openDmAccess = $state(false)
  let togglingAccess = $state(false)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let newUsername = $state('')
  let pendingRemoval: string | null = $state(null)
  let blocking: string | null = $state(null)
  const pendingRemovalLabel = $derived(pendingRemoval ?? '')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const [usersResult, accessResult] = await Promise.all([fetchAdminUsers(), fetchOpenAccess()])
      users = usersResult.users
      openDmAccess = accessResult.openDmAccess
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function toggleAccess(): Promise<void> {
    error = null
    status = null
    togglingAccess = true
    const enabling = !openDmAccess
    try {
      await patchOpenAccess({ enabled: enabling })
      await load()
      status = enabling ? 'Open DM access enabled.' : 'Open DM access disabled.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      togglingAccess = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      const username = newUsername.trim()
      const result = await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      await load()
      status =
        result.pending === true ? "User added — they'll be authorized when they first message the bot." : 'User added.'
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

  async function toggleBlock(userId: string, blocked: boolean): Promise<void> {
    error = null
    status = null
    blocking = userId
    try {
      await setUserBlocked({ userId, blocked })
      await load()
      status = blocked ? 'User blocked.' : 'User unblocked.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      blocking = null
    }
  }

  $effect(() => {
    void load()
  })

  interface UserRow {
    platform_user_id: string
    username: string
    source: string
    blocked: boolean
  }

  const userRows = $derived<UserRow[]>(
    users.map((u) => ({
      platform_user_id: u.platform_user_id,
      username: u.username ?? '—',
      source: u.added_by ?? '—',
      blocked: u.blocked_at != null,
    })),
  )

  const userColumns = [
    { key: 'platform_user_id' as const, label: 'User ID' },
    { key: 'username' as const, label: 'Username' },
    { key: 'source' as const, label: 'Source' },
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

  <div class="open-access-card" data-testid="open-access-card">
    <div>
      <strong>Open DM access</strong>
      <p class="open-access-hint">
        Anyone can DM this bot. New users are added automatically and listed below; block individuals to revoke.
      </p>
    </div>
    <Btn
      variant={openDmAccess ? 'danger' : 'primary'}
      size="sm"
      testid="open-access-toggle"
      disabled={togglingAccess}
      onClick={() => void toggleAccess()}>
      {#snippet children()}{togglingAccess ? 'Saving…' : openDmAccess ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>

  <form
    class="settings-form"
    onsubmit={(event) => {
      event.preventDefault()
      void add()
    }}>
    <Field
      label="User ID or @username"
      hint="For Telegram, @username adds a pending entry that activates when the user first messages the bot">
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
        <Btn
          variant={row.blocked ? 'secondary' : 'danger'}
          size="sm"
          testid={`user-block-${row.platform_user_id}`}
          disabled={blocking === row.platform_user_id}
          onClick={() => void toggleBlock(row.platform_user_id, !row.blocked)}>
          {#snippet children()}{row.blocked ? 'Unblock' : 'Block'}{/snippet}
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          testid={`user-remove-${row.platform_user_id}`}
          disabled={blocking === row.platform_user_id}
          onClick={() => (pendingRemoval = row.platform_user_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else if col.key === 'platform_user_id'}
        {#if row.platform_user_id.startsWith('placeholder-')}
          <span class="pending-badge" data-testid="user-pending-badge">pending</span>
        {:else}
          <IdCell value={row.platform_user_id} />
        {/if}
      {:else if col.key === 'source'}
        <span class="source-badge" data-testid={`user-source-${row.platform_user_id}`}>{row.source}</span>
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
    onConfirm={() => {
      const id = pendingRemoval
      pendingRemoval = null
      if (id !== null) void remove(id)
    }}>
    {#snippet body()}<p>Remove user {pendingRemovalLabel}? This cannot be undone.</p>{/snippet}
  </Confirm>
</section>

<style>
  .pending-badge,
  .source-badge {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .open-access-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .open-access-hint {
    font-size: 12px;
    color: var(--fg2);
    margin: 2px 0 0;
  }
</style>
