<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminFeatureFlagRow, AdminFeatureFlagState } from '../../../admin/feature-flags-fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import { fetchAdminFeatureFlags, saveAdminFeatureFlags } from '../../admin-fetchers.js'

  type FlagKey = keyof AdminFeatureFlagState
  const FLAG_KEYS: FlagKey[] = ['result_compaction', 'progressive_disclosure', 'semantic_tool_retrieval']
  const FLAG_LABELS: Record<FlagKey, string> = {
    result_compaction: 'Compaction',
    progressive_disclosure: 'Disclosure',
    semantic_tool_retrieval: 'Semantic retrieval',
  }

  let killSwitchEngaged = $state(false)
  let rows: AdminFeatureFlagRow[] = $state([])
  let drafts: Record<string, AdminFeatureFlagState> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let savingId: string | null = $state(null)

  function isDirty(row: AdminFeatureFlagRow): boolean {
    const draft = drafts[row.contextId]
    if (draft === undefined) return false
    return FLAG_KEYS.some((key) => draft[key] !== row.flags[key])
  }

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const snapshot = await fetchAdminFeatureFlags()
      killSwitchEngaged = snapshot.killSwitchEngaged
      rows = snapshot.contexts
      drafts = Object.fromEntries(snapshot.contexts.map((row) => [row.contextId, { ...row.flags }]))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(row: AdminFeatureFlagRow): Promise<void> {
    const draft = drafts[row.contextId]
    if (draft === undefined) return
    error = null
    status = null
    savingId = row.contextId
    try {
      const updated = await saveAdminFeatureFlags({ contextId: row.contextId, flags: draft })
      rows = rows.map((r) => (r.contextId === updated.contextId ? updated : r))
      drafts[updated.contextId] = { ...updated.flags }
      status = `${updated.label} updated.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      savingId = null
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="feature-flags" class="settings-section">
  <PageHeader eyebrow="Admin · Experimental" title="Feature flags">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="feature-flags-refresh" />
    {/snippet}
  </PageHeader>

  {#if killSwitchEngaged}
    <p class="status-error">
      All reduction flags are forced OFF by TOOL_CONTEXT_REDUCTION_DISABLED; toggles below are stored but inert until
      the variable is unset.
    </p>
  {/if}
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if rows.length === 0 && !loading}
    <EmptyState title="No known contexts yet." />
  {:else}
    <div class="settings-field-list">
      {#each rows as row (row.contextId)}
        <div class="settings-field" data-testid={`feature-flags-row-${row.contextId}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{row.label}</span>
            <span class="t-meta">{row.kind} · {row.platformInstanceLabel}</span>
          </div>
          <div class="settings-field__controls">
            {#if drafts[row.contextId] !== undefined}
              {#each FLAG_KEYS as key (key)}
                <label class="t-meta">
                  <input
                    type="checkbox"
                    bind:checked={drafts[row.contextId]![key]}
                    data-testid={`feature-flags-${row.contextId}-${key}`} />
                  {FLAG_LABELS[key]}
                </label>
              {/each}
            {/if}
            <Btn
              variant="primary"
              size="sm"
              disabled={!isDirty(row) || savingId === row.contextId}
              onClick={() => void save(row)}
              testid={`feature-flags-save-${row.contextId}`}>
              {#snippet children()}Save{/snippet}
            </Btn>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .settings-field {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-field__head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__controls {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
</style>
