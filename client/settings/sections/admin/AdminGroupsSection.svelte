<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminGroup, fetchAdminGroups, removeAdminGroup } from '../../admin-fetchers.js'
  import type { AdminGroupRow } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import DataTable from '../../../shared/ui/DataTable.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

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

  interface GroupRow {
    group_id: string
    added_by: string
    added_at: string
  }

  const groupRows = $derived<GroupRow[]>(
    groups.map((g) => ({ group_id: g.group_id, added_by: g.added_by, added_at: g.added_at })),
  )

  const groupColumns = [
    { key: 'group_id' as const, label: 'Group ID' },
    { key: 'added_by' as const, label: 'Added by' },
    { key: 'added_at' as const, label: 'Added at' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="groups" class="settings-section">
  <PageHeader eyebrow="Admin · Access" title="Groups">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load()}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="Group ID">
      {#snippet children()}
        <Input value={newGroupId} onInput={(v) => (newGroupId = v)} testid="group-add-input" />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="group-add">
      {#snippet children()}Add group{/snippet}
    </Btn>
  </form>

  <div class="settings-table-wrap">
    {#snippet cell(row: GroupRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn variant="ghost" size="sm" testid={`group-remove-${row.group_id}`} onClick={() => void remove(row.group_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof GroupRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={groupColumns} rows={groupRows} {cell} rowKey="group_id">
      {#snippet empty()}No groups{/snippet}
    </DataTable>
  </div>
</section>
