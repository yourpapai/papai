<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminGroup, fetchAdminGroups, removeAdminGroup } from '../../admin-fetchers.js'
  import type { AdminGroupRow, ObservedGroup } from '../../fetcher-schemas-admin.js'
  import Confirm from '../../../shared/Confirm.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'
  import IdCell from '../../components/IdCell.svelte'

  let groups: AdminGroupRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newGroupId = $state('')
  let observed: ObservedGroup[] = $state([])
  let pendingRemoval: string | null = $state(null)
  let removing = $state(false)
  let removeError = $state<string | null>(null)
  const pendingRemovalLabel = $derived(pendingRemoval ?? '')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const res = await fetchAdminGroups()
      groups = res.groups
      observed = res.observed
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

  async function authorize(contextId: string): Promise<void> {
    error = null
    status = null
    try {
      await addAdminGroup({ groupId: contextId })
      await load()
      status = 'Group authorized.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function confirmRemove(): Promise<void> {
    const groupId = pendingRemoval
    if (groupId === null || removing) return
    removeError = null
    removing = true
    let ok = false
    try {
      await removeAdminGroup({ groupId })
      ok = true
    } catch (err) {
      removeError = err instanceof Error ? err.message : String(err)
    } finally {
      removing = false
    }
    if (ok) {
      pendingRemoval = null
      await load()
      status = 'Group removed.'
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
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="groups-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if observed.length > 0}
    <div class="settings-observed">
      <h3>Observed groups</h3>
      <ul class="settings-observed__list">
        {#each observed as g (g.contextId)}
          <li class="settings-observed__item">
            <span class="settings-observed__name">{g.displayName}{g.parentName ? ` · ${g.parentName}` : ''}</span>
            <Btn variant="ghost" size="sm" testid={`group-authorize-${g.contextId}`} onClick={() => void authorize(g.contextId)}>
              {#snippet children()}Authorize{/snippet}
            </Btn>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="Group ID or chat ID">
      {#snippet children()}
        <Input value={newGroupId} onInput={(v) => (newGroupId = v)} testid="group-add-input" />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="group-add">
      {#snippet children()}Add group{/snippet}
    </Btn>
  </form>
  <p class="placeholder">Raw chat IDs are scoped to your platform instance automatically.</p>

  <div class="settings-table-wrap">
    {#snippet cell(row: GroupRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn
          variant="danger"
          size="sm"
          testid={`group-remove-${row.group_id}`}
          onClick={() => {
            removeError = null
            pendingRemoval = row.group_id
          }}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else if col.key === 'group_id'}
        <IdCell value={row.group_id} />
      {:else}
        {String(row[col.key as keyof GroupRow] ?? '')}
      {/if}
    {/snippet}
    <SettingsTable
      columns={groupColumns}
      rows={groupRows}
      rowKey="group_id"
      searchKeys={['group_id', 'added_by']}
      {cell}>
      {#snippet empty()}No groups{/snippet}
    </SettingsTable>
  </div>

  <Confirm
    open={pendingRemoval !== null}
    title="Remove group"
    danger
    busy={removing}
    confirmLabel="Remove"
    onCancel={() => (pendingRemoval = null)}
    onConfirm={() => void confirmRemove()}>
    {#snippet body()}
      <p>Remove group {pendingRemovalLabel}? This cannot be undone.</p>
      {#if removeError !== null}<p class="status-error">{removeError}</p>{/if}
    {/snippet}
  </Confirm>
</section>
