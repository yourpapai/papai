<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminByok, patchAdminByok } from '../../admin-fetchers.js'
  import type { AdminByokContext } from '../../fetcher-schemas.js'
  import IdCell from '../../components/IdCell.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

  let contexts: AdminByokContext[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let toggling: string | null = $state(null)

  interface ByokAdminRow extends Record<string, unknown> {
    contextId: string
    status: string
    missing: string
    updatedAt: string
    updatedBy: string
    action: string
    raw: AdminByokContext
  }

  const columns = [
    { key: 'contextId' as const, label: 'Context' },
    { key: 'status' as const, label: 'Status' },
    { key: 'missing' as const, label: 'Missing' },
    { key: 'updatedAt' as const, label: 'Updated' },
    { key: 'updatedBy' as const, label: 'Updated by' },
    { key: 'action' as const, label: '', align: 'right' as const },
  ]

  function statusFor(row: AdminByokContext): string {
    if (row.unreadable === true) return 'Unreadable'
    if (!row.enabled) return 'Disabled'
    return row.complete ? 'Enabled / Complete' : 'Enabled / Incomplete'
  }

  function formatUpdatedAt(value: number): string {
    return value > 0 ? new Date(value).toISOString() : '—'
  }

  const rows = $derived<ByokAdminRow[]>(
    contexts.map((row) => ({
      contextId: row.contextId,
      status: statusFor(row),
      missing: row.missing.length > 0 ? row.missing.join(', ') : '—',
      updatedAt: formatUpdatedAt(row.updatedAt),
      updatedBy: row.updatedBy || '—',
      action: row.enabled ? 'Disable' : 'Enable',
      raw: row,
    })),
  )

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      contexts = (await fetchAdminByok()).contexts
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function toggle(row: AdminByokContext): Promise<void> {
    error = null
    status = null
    toggling = row.contextId
    try {
      await patchAdminByok({ contextId: row.contextId, enabled: !row.enabled })
      await load()
      status = `BYOK ${row.enabled ? 'disabled' : 'enabled'} for ${row.contextId}.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      toggling = null
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="byok-admin" class="settings-section">
  <PageHeader eyebrow="Admin · System" title="BYOK LLM">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-byok-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-table-wrap">
    {#snippet cell(row: ByokAdminRow, col: { key: string; label: string })}
      {#if col.key === 'action'}
        <Btn
          variant={row.raw.enabled ? 'danger' : 'secondary'}
          size="sm"
          testid={`admin-byok-toggle-${row.contextId}`}
          disabled={toggling === row.contextId}
          onClick={() => void toggle(row.raw)}>
          {#snippet children()}{toggling === row.contextId ? 'Saving…' : row.action}{/snippet}
        </Btn>
      {:else if col.key === 'contextId'}
        <IdCell value={row.contextId} />
      {:else if col.key === 'status' && row.raw.unreadable === true}
        <span class="settings-byok-admin__unreadable">Unreadable</span>
        {#if row.raw.error !== undefined}<span class="settings-byok-admin__error">{row.raw.error}</span>{/if}
      {:else}
        {String(row[col.key as keyof ByokAdminRow] ?? '')}
      {/if}
    {/snippet}
    <SettingsTable
      {columns}
      {rows}
      rowKey="contextId"
      searchKeys={['contextId', 'status', 'missing', 'updatedBy']}
      {cell}
      searchPlaceholder="Search BYOK contexts…">
      {#snippet empty()}No BYOK contexts{/snippet}
    </SettingsTable>
  </div>
</section>

<style>
  .settings-byok-admin__unreadable {
    display: inline-block;
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: 8px;
  }
  .settings-byok-admin__error {
    color: var(--fg3);
    font-size: 12px;
  }
</style>
