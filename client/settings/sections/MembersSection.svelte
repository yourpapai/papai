<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addGroupMember, fetchGroupMembers, removeGroupMember } from '../fetchers.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'
  import { formatDateTime } from '../../shared/helpers.js'
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let members: GroupMembersResponse['members'] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let adding = $state(false)
  let pendingRemove = $state<{ userId: string; label: string } | null>(null)
  let removing = $state(false)
  let removeError = $state<string | null>(null)

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
    if (adding) return
    error = null
    const userId = newUserId.trim()
    if (userId === '') return
    adding = true
    try {
      await addGroupMember({ userId, contextId })
      newUserId = ''
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      adding = false
    }
  }

  function requestRemove(userId: string): void {
    removeError = null
    pendingRemove = { userId, label: userId }
  }

  async function confirmRemove(): Promise<void> {
    const target = pendingRemove
    if (target === null || removing) return
    removeError = null
    removing = true
    let ok = false
    try {
      await removeGroupMember({ userId: target.userId, contextId })
      ok = true
    } catch (err) {
      removeError = err instanceof Error ? err.message : String(err)
    } finally {
      removing = false
    }
    if (ok) {
      pendingRemove = null
      await load(contextId)
    }
  }

  $effect(() => {
    void load(contextId)
  })

  interface MemberRow {
    user_id: string
    added_by: string
    added_at: string
  }

  const memberRows = $derived<MemberRow[]>(
    members.map((m) => ({ user_id: m.user_id, added_by: m.added_by, added_at: formatDateTime(m.added_at) })),
  )

  const memberColumns = [
    { key: 'user_id' as const, label: 'User ID' },
    { key: 'added_by' as const, label: 'Added by' },
    { key: 'added_at' as const, label: 'Added at' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="members" class="settings-section">
  <PageHeader eyebrow="Group" title="Members">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="members-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="User ID or @username" hint="For Telegram, you can use @username instead of numeric ID">
      {#snippet children()}
        <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="member-add-input" placeholder="123456789 or @username" />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" disabled={adding} testid="member-add">
      {#snippet children()}{adding ? 'Adding…' : 'Add member'}{/snippet}
    </Btn>
  </form>

  {#if loading && members.length === 0}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="settings-table-wrap">
      {#snippet cell(row: MemberRow, col: { key: string; label: string })}
        {#if col.key === 'actions'}
          <Btn variant="ghost" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => requestRemove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
        {:else}
          {String(row[col.key as keyof MemberRow] ?? '')}
        {/if}
      {/snippet}
      <DataTable columns={memberColumns} rows={memberRows} {cell} rowKey="user_id">
        {#snippet empty()}No members{/snippet}
      </DataTable>
    </div>
  {/if}

  <Confirm
    open={pendingRemove !== null}
    title="Remove member"
    danger
    busy={removing}
    confirmLabel="Remove"
    onCancel={() => {
      pendingRemove = null
    }}
    onConfirm={() => void confirmRemove()}>
    {#snippet body()}
      <p>Remove {pendingRemove?.label} from this group? They'll lose access to the bot here.</p>
      {#if removeError !== null}<p class="status-error" data-testid="member-remove-error">{removeError}</p>{/if}
    {/snippet}
  </Confirm>
</section>
