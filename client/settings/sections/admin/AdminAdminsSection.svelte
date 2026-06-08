<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addRosterAdmin, fetchAdminRoster, removeRosterAdmin } from '../../admin-fetchers.js'
  import type { AdminRosterRow } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import DataTable from '../../../shared/ui/DataTable.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

  let admins: AdminRosterRow[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let userId = $state('')
  let platformInstanceId = $state('')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      admins = (await fetchAdminRoster()).admins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const u = userId.trim()
    const p = platformInstanceId.trim()
    if (u === '' || p === '') return
    try {
      await addRosterAdmin({ userId: u, platformInstanceId: p })
      userId = ''
      platformInstanceId = ''
      await load()
      status = 'Admin added.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(row: { userId: string; platformInstanceId: string }): Promise<void> {
    error = null
    status = null
    try {
      await removeRosterAdmin({ userId: row.userId, platformInstanceId: row.platformInstanceId })
      await load()
      status = 'Admin removed.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })

  interface AdminRow {
    rowKey: string
    userId: string
    platformInstanceId: string
  }

  const adminRows = $derived<AdminRow[]>(
    admins.map((a) => ({
      rowKey: `${a.userId}:${a.platformInstanceId}`,
      userId: a.userId,
      platformInstanceId: a.platformInstanceId,
    })),
  )

  const adminColumns = [
    { key: 'userId' as const, label: 'User ID' },
    { key: 'platformInstanceId' as const, label: 'Platform instance' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="admins" class="settings-section">
  <PageHeader eyebrow="Admin · Roster" title="Admins">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admins-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <Field label="User ID">
      {#snippet children()}
        <Input value={userId} onInput={(v) => (userId = v)} testid="admin-user-input" />
      {/snippet}
    </Field>
    <Field label="Platform instance ID">
      {#snippet children()}
        <Input value={platformInstanceId} onInput={(v) => (platformInstanceId = v)} testid="admin-platform-input" />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="admin-add">
      {#snippet children()}Add admin{/snippet}
    </Btn>
  </form>

  <div class="settings-table-wrap">
    {#snippet cell(row: AdminRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn variant="ghost" size="sm" testid={`admin-remove-${row.userId}`} onClick={() => void remove({ userId: row.userId, platformInstanceId: row.platformInstanceId })}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof AdminRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={adminColumns} rows={adminRows} {cell} rowKey="rowKey">
      {#snippet empty()}No admins{/snippet}
    </DataTable>
  </div>
</section>
