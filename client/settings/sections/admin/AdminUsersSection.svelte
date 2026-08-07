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
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import Pill from '../../../shared/ui/Pill.svelte'
  import { describeAddedBy, removeUserLabel, userStatus } from './admin-users-presenters.js'
  import type { UserStatus } from './admin-users-presenters.js'
  import { statusTone } from '../../../shared/ui/status-tone.js'
  import { markTouched, shownError } from '../../../shared/ui/field-touched.js'

  interface UserRow {
    platform_user_id: string
    username: string
    status: UserStatus
    added_by: string
    blocked: boolean
  }

  let users: AdminUserRow[] = $state([])
  let openDmAccess = $state(false)
  let openAccessLoaded = $state(false)
  let togglingAccess = $state(false)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let usersLoadError: string | null = $state(null)
  let openAccessError: string | null = $state(null)
  let loading = $state(false)
  let initialLoad = $state(true)
  let newUserId = $state('')
  let newUsername = $state('')
  let adding = $state(false)
  let userTouched: string[] = $state([])

  const userErrors = $derived<Record<string, string | undefined>>(
    newUserId.trim() === '' ? { userId: 'Enter a numeric user ID or an @username.' } : {},
  )
  const addBlocked = $derived(userErrors.userId !== undefined)
  let pendingRemovalRow: UserRow | null = $state(null)
  let blocking: string | null = $state(null)
  let removing = $state(false)
  let removeError = $state<string | null>(null)
  const pendingRemovalLabel = $derived(
    pendingRemovalRow === null
      ? ''
      : removeUserLabel({ username: pendingRemovalRow.username, userId: pendingRemovalRow.platform_user_id }),
  )

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function load(): Promise<void> {
    error = null
    status = null
    usersLoadError = null
    openAccessError = null
    loading = true
    const [usersResult, accessResult] = await Promise.allSettled([fetchAdminUsers(), fetchOpenAccess()])
    if (usersResult.status === 'fulfilled') {
      users = usersResult.value.users
    } else {
      users = []
      usersLoadError = errorMessage(usersResult.reason)
    }
    if (accessResult.status === 'fulfilled') {
      openDmAccess = accessResult.value.openDmAccess
      openAccessLoaded = true
    } else {
      openAccessLoaded = false
      openAccessError = errorMessage(accessResult.reason)
    }
    loading = false
    initialLoad = false
  }

  async function toggleAccess(): Promise<void> {
    if (!openAccessLoaded) return
    error = null
    status = null
    togglingAccess = true
    const enabling = !openDmAccess
    try {
      await patchOpenAccess({ enabled: enabling })
      await load()
      status = enabling ? 'Open DM access enabled.' : 'Open DM access disabled.'
    } catch (err) {
      error = errorMessage(err)
    } finally {
      togglingAccess = false
    }
  }

  async function add(): Promise<void> {
    userTouched = markTouched(userTouched, 'userId')
    if (addBlocked || adding) return
    error = null
    status = null
    adding = true
    const userId = newUserId.trim()
    try {
      const username = newUsername.trim()
      const result = await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      userTouched = []
      await load()
      status =
        result.pending === true ? "User added — they'll be authorized when they first message the bot." : 'User added.'
    } catch (err) {
      error = errorMessage(err)
    } finally {
      adding = false
    }
  }

  async function confirmRemove(): Promise<void> {
    const userId = pendingRemovalRow?.platform_user_id
    if (userId === undefined || removing) return
    removeError = null
    removing = true
    let ok = false
    try {
      await removeAdminUser({ userId })
      ok = true
    } catch (err) {
      removeError = errorMessage(err)
    } finally {
      removing = false
    }
    if (ok) {
      pendingRemovalRow = null
      await load()
      status = 'User removed.'
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
      error = errorMessage(err)
    } finally {
      blocking = null
    }
  }

  $effect(() => {
    void load()
  })

  const userRows = $derived<UserRow[]>(
    users.map((u) => {
      const blocked = u.blocked_at != null
      return {
        platform_user_id: u.platform_user_id,
        username: u.username ?? '—',
        status: userStatus({ userId: u.platform_user_id, blocked }),
        added_by: u.added_by ?? '',
        blocked,
      }
    }),
  )

  const userColumns = [
    { key: 'platform_user_id' as const, label: 'User ID', width: '25%', sortable: true },
    { key: 'username' as const, label: 'Username', width: '25%', sortable: true },
    { key: 'status' as const, label: 'Status', width: '15%', sortable: true },
    { key: 'added_by' as const, label: 'Added by', width: '15%', sortable: true },
    { key: 'actions' as const, label: 'Actions', align: 'right' as const, width: '20%' },
  ]
</script>

<section id="users" class="settings-section">
  <PageHeader eyebrow="Admin · Access" title="Users">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="users-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if usersLoadError !== null}
    <ErrorState
      message="Could not load the user list."
      detail={usersLoadError}
      onRetry={() => void load()} />
  {:else if loading && initialLoad}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="open-access-card" data-testid="open-access-card">
      <div>
        <div class="open-access-title">
          <strong>Open DM access</strong>
          {#if openAccessLoaded}
            <Pill tone={openDmAccess ? 'accent' : 'mute'} dot>
              {#snippet children()}<span data-testid="open-access-state">{openDmAccess ? 'enabled' : 'disabled'}</span>{/snippet}
            </Pill>
          {/if}
        </div>
        <p class="open-access-hint">
          Anyone can DM this bot. New users are added automatically and listed below; block individuals to revoke.
        </p>
        {#if openAccessError !== null}
          <p class="status-error" role="alert" data-testid="open-access-error">
            Could not read the open DM access setting — {openAccessError}
          </p>
        {/if}
      </div>
      <Btn
        variant={openDmAccess ? 'danger' : 'primary'}
        size="sm"
        testid="open-access-toggle"
        disabled={togglingAccess || !openAccessLoaded}
        onClick={() => void toggleAccess()}>
        {#snippet children()}
          {!openAccessLoaded ? 'Unavailable' : togglingAccess ? 'Saving…' : openDmAccess ? 'Disable' : 'Enable'}
        {/snippet}
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
        error={shownError(userErrors, userTouched, 'userId')}
        hint="For Telegram, @username adds a pending entry that activates when the user first messages the bot">
        {#snippet children()}
          <Input
            value={newUserId}
            onInput={(v) => {
              newUserId = v
              userTouched = markTouched(userTouched, 'userId')
            }}
            testid="user-add-input"
            placeholder="123456789 or @username" />
        {/snippet}
      </Field>
      <Field label="Username" hint="optional">
        {#snippet children()}
          <Input value={newUsername} onInput={(v) => (newUsername = v)} />
        {/snippet}
      </Field>
      <Btn variant="primary" type="submit" testid="user-add" disabled={addBlocked || adding} busy={adding}>
        {#snippet children()}{adding ? 'Adding…' : 'Add user'}{/snippet}
      </Btn>
    </form>

    <div class="settings-table-wrap">
      {#snippet cell(row: UserRow, col: { key: string; label: string })}
        {#if col.key === 'actions'}
          <Btn
            variant="secondary"
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
            onClick={() => {
              removeError = null
              pendingRemovalRow = row
            }}>
            {#snippet children()}Remove{/snippet}
          </Btn>
        {:else if col.key === 'platform_user_id'}
          {#if row.status === 'pending'}
            <span class="t-mono-data pending-id" title={row.username}>{row.username}</span>
          {:else}
            <IdCell value={row.platform_user_id} />
          {/if}
        {:else if col.key === 'username'}
          <span class="cell-text" data-testid={`user-username-${row.platform_user_id}`} title={row.username}>
            {row.username}
          </span>
        {:else if col.key === 'status'}
          <Pill tone={statusTone(row.status)}>
            {#snippet children()}<span data-testid={`user-status-${row.platform_user_id}`}>{row.status}</span>{/snippet}
          </Pill>
        {:else if col.key === 'added_by'}
          {@const addedBy = describeAddedBy(row.added_by)}
          <span data-testid={`user-added-by-${row.platform_user_id}`}>
            {#if addedBy.kind === 'label'}
              <Pill tone="neutral">{#snippet children()}{addedBy.text}{/snippet}</Pill>
            {:else if addedBy.kind === 'id'}
              <IdCell value={addedBy.value} head={4} tail={4} />
            {:else}
              <span class="t-help">—</span>
            {/if}
          </span>
        {:else}
          {String(row[col.key as keyof UserRow] ?? '')}
        {/if}
      {/snippet}
      <SettingsTable
        columns={userColumns}
        rows={userRows}
        rowKey="platform_user_id"
        searchKeys={['platform_user_id', 'username', 'status', 'added_by']}
        defaultSort={{ key: 'username', dir: 'asc' }}
        {cell}
        searchPlaceholder="Search users by ID, name, or status…">
        {#snippet empty()}No users{/snippet}
      </SettingsTable>
    </div>
  {/if}

  <Confirm
    open={pendingRemovalRow !== null}
    title="Remove user"
    danger
    busy={removing}
    confirmLabel="Remove"
    onCancel={() => (pendingRemovalRow = null)}
    onConfirm={() => void confirmRemove()}>
    {#snippet body()}
      <p>Remove {pendingRemovalLabel}?</p>
      <p class="confirm-hint">
        They lose access entirely and drop off this list. To keep the record and revoke access reversibly, Block them
        instead.
      </p>
      {#if removeError !== null}<p class="status-error" role="alert">{removeError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .pending-id {
    color: var(--text-muted);
  }
  .cell-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
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
    color: var(--text-muted);
    margin: 2px 0 0;
  }
  .open-access-title {
    display: flex;
    align-items: center;
    gap: var(--gap-inline);
  }
  .placeholder {
    color: var(--text-muted);
    font-size: 12px;
  }
  .confirm-hint {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
