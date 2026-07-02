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
      const result = await fetchGroupMembers(id)
      if (id !== contextId) return
      members = result.members
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function add(): Promise<void> {
    if (adding) return
    error = null
    const userId = newUserId.trim()
    if (userId === '') return
    const ctx = contextId
    adding = true
    try {
      await addGroupMember({ userId, contextId: ctx })
      newUserId = ''
      await load(ctx)
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
    const ctx = contextId
    removeError = null
    removing = true
    let ok = false
    try {
      await removeGroupMember({ userId: target.userId, contextId: ctx })
      ok = true
    } catch (err) {
      removeError = err instanceof Error ? err.message : String(err)
    } finally {
      removing = false
    }
    if (ok) {
      pendingRemove = null
      await load(ctx)
    }
  }

  $effect(() => {
    void load(contextId)
  })

  interface MemberRow {
    user_id: string
    added_by: string
    added_at: string
    user_label: string | null
    added_by_label: string | null
  }

  const memberRows = $derived<MemberRow[]>(
    members.map((m) => ({
      user_id: m.user_id,
      added_by: m.added_by,
      added_at: formatDateTime(m.added_at),
      user_label: m.user_label ?? null,
      added_by_label: m.added_by_label ?? null,
    })),
  )

  const memberColumns = [
    { key: 'user_id' as const, label: 'Member' },
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

  {#if error !== null}<p class="status-error members-error">{error}</p>{/if}

  <form class="settings-form members-add" onsubmit={(event) => { event.preventDefault(); void add() }}>
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
          <Btn variant="danger" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => requestRemove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
        {:else if col.key === 'user_id'}
          <span class="member-cell">
            <span>{row.user_label ?? row.user_id}</span>
            {#if row.user_label !== null}<span class="member-cell__raw">{row.user_id}</span>{/if}
          </span>
        {:else if col.key === 'added_by'}
          {row.added_by_label ?? row.added_by}
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

<style>
  .members-error {
    margin: 0 0 var(--gap-field);
  }
  /* Keep the input growing and the button on the same baseline; hint wraps below the row. */
  .members-add :global(.ui-field) {
    flex: 1;
    min-width: 220px;
  }
  .member-cell {
    display: inline-flex;
    flex-direction: column;
    line-height: 1.3;
  }
  .member-cell__raw {
    color: var(--fg3);
    font-size: 11px;
  }
</style>
