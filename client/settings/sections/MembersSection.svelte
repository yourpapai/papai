<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addGroupMember, fetchGroupMembers, removeGroupMember } from '../fetchers.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'
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

  interface MemberRow {
    user_id: string
    added_by: string
    added_at: string
  }

  const memberRows = $derived<MemberRow[]>(
    members.map((m) => ({ user_id: m.user_id, added_by: m.added_by, added_at: m.added_at })),
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
    <Field label="User ID">
      {#snippet children()}
        <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="member-add-input" />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="member-add">
      {#snippet children()}Add member{/snippet}
    </Btn>
  </form>

  <div class="settings-table-wrap">
    {#snippet cell(row: MemberRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn variant="ghost" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => void remove(row.user_id)}>
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
</section>
