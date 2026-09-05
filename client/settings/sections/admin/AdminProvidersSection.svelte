<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../../shared/ui/Btn.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Confirm from '../../../shared/Confirm.svelte'
  import ProviderForm from '../../components/ProviderForm.svelte'
  import ProviderModelsEditor from '../../components/ProviderModelsEditor.svelte'
  import VerificationPill from '../../components/VerificationPill.svelte'
  import {
    createAdminProvider,
    deleteAdminProvider,
    fetchAdminProviders,
    refreshAdminProviderModels,
    updateAdminProvider,
  } from '../../admin-fetchers.js'
  import type { LlmProviderType, ProviderPatch, PublicProviderAccount } from '../../fetcher-schemas-llm-providers.js'

  let providers: PublicProviderAccount[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let showAddForm = $state(false)
  let saving = $state(false)
  let deleteTarget: PublicProviderAccount | null = $state(null)
  let deleteError: string | null = $state(null)
  let editTarget: PublicProviderAccount | null = $state(null)
  let modelsTarget: PublicProviderAccount | null = $state(null)
  let refreshingId: string | null = $state(null)

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const res = await fetchAdminProviders()
      providers = res.providers
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onAdd(input: {
    label: string
    providerType: string
    baseUrl: string
    apiKey: string
    baseProvider: string | null
    baseModel: string | null
  }): Promise<boolean> {
    saving = true
    try {
      await createAdminProvider(input as never)
      showAddForm = false
      await load()
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      saving = false
    }
  }

  async function onDelete(): Promise<void> {
    if (deleteTarget === null) return
    deleteError = null
    try {
      await deleteAdminProvider(deleteTarget.id)
      deleteTarget = null
      await load()
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err)
    }
  }

  function requestDelete(provider: PublicProviderAccount): void {
    deleteError = null
    deleteTarget = provider
  }

  async function patchAndReload(id: string, patch: ProviderPatch): Promise<boolean> {
    saving = true
    try {
      await updateAdminProvider(id, patch)
      await load()
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      saving = false
    }
  }

  async function onEdit(
    id: string,
    input: {
      label: string
      providerType: LlmProviderType
      baseUrl: string
      apiKey: string
      baseProvider: string | null
      baseModel: string | null
    },
  ): Promise<boolean> {
    const patch: ProviderPatch = {
      label: input.label,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      baseProvider: input.baseProvider,
      baseModel: input.baseModel,
    }
    if (input.apiKey.length > 0) patch.apiKey = input.apiKey
    const ok = await patchAndReload(id, patch)
    if (ok) editTarget = null
    return ok
  }

  async function onSaveModels(id: string, models: string[]): Promise<boolean> {
    const ok = await patchAndReload(id, { models })
    if (ok) modelsTarget = null
    return ok
  }

  async function refreshModels(id: string): Promise<void> {
    refreshingId = id
    error = null
    try {
      await refreshAdminProviderModels(id)
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      refreshingId = null
    }
  }

  function startEdit(provider: PublicProviderAccount): void {
    editTarget = provider
    modelsTarget = null
  }

  function startModelsEdit(provider: PublicProviderAccount): void {
    modelsTarget = provider
    editTarget = null
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })

  const deleteTargetLabel = $derived(deleteTarget?.label ?? '')
</script>

<section id="llm-providers" class="settings-section">
  <PageHeader eyebrow="Admin · LLM" title="Providers">
    {#snippet action()}
      <Btn variant="primary" size="sm" testid="admin-providers-add" onClick={() => (showAddForm = true)}>
        {#snippet children()}Add provider{/snippet}
      </Btn>
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-providers-refresh" />
    {/snippet}
  </PageHeader>

  {#if showAddForm}
    <div class="provider-create" data-testid="admin-providers-add-form">
      <div class="t-subhead">Add provider</div>
      <ProviderForm onSave={onAdd} onCancel={() => (showAddForm = false)} busy={saving} />
    </div>
  {/if}

  {#if loading && providers.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if error !== null && providers.length === 0}
    <ErrorState message={error} onRetry={() => void load()} />
  {:else if providers.length === 0}
    <p class="placeholder">No providers configured. Click 'Add provider' to create one.</p>
  {:else}
    <div class="settings-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Type</th>
            <th>Base URL</th>
            <th>API Key</th>
            <th>Status</th>
            <th>Models</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each providers as provider (provider.id)}
            <tr>
              <td>{provider.label}</td>
              <td>{provider.providerType}</td>
              <td>{provider.baseUrl}</td>
              <td class="mono">{provider.apiKeyMasked}</td>
              <td>
                <VerificationPill verification={provider.verification} />
              </td>
              <td>{provider.verification.models.length}</td>
              <td>
                <div class="row-actions">
                  <Btn
                    variant="secondary"
                    size="sm"
                    testid={`admin-providers-edit-${provider.id}`}
                    onClick={() => startEdit(provider)}>
                    {#snippet children()}Edit{/snippet}
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`admin-providers-refresh-models-${provider.id}`}
                    disabled={refreshingId === provider.id}
                    onClick={() => void refreshModels(provider.id)}>
                    {#snippet children()}{refreshingId === provider.id ? 'Refreshing…' : 'Refresh'}{/snippet}
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`admin-providers-models-${provider.id}`}
                    onClick={() => startModelsEdit(provider)}>
                    {#snippet children()}Models{/snippet}
                  </Btn>
                  <Btn
                    variant="danger"
                    size="sm"
                    testid={`admin-providers-delete-${provider.id}`}
                    onClick={() => requestDelete(provider)}>
                    {#snippet children()}Delete{/snippet}
                  </Btn>
                </div>
              </td>
            </tr>
            {#if editTarget?.id === provider.id}
              <tr>
                <td colspan="7">
                  <ProviderForm
                    editMode={true}
                    initial={{
                      label: provider.label,
                      providerType: provider.providerType,
                      baseUrl: provider.baseUrl,
                      baseProvider: provider.baseProvider,
                      baseModel: provider.baseModel,
                    }}
                    onSave={(input) => onEdit(provider.id, input)}
                    onCancel={() => (editTarget = null)}
                    busy={saving}
                    testidPrefix="provider-edit-form" />
                </td>
              </tr>
            {/if}
            {#if modelsTarget?.id === provider.id}
              <tr>
                <td colspan="7">
                  <ProviderModelsEditor
                    models={provider.verification.models}
                    onSave={(models) => onSaveModels(provider.id, models)}
                    onCancel={() => (modelsTarget = null)}
                    busy={saving}
                    testid={`provider-models-${provider.id}`} />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <Confirm
    open={deleteTarget !== null}
    title="Delete provider"
    danger
    confirmLabel="Delete"
    onCancel={() => (deleteTarget = null)}
    onConfirm={() => void onDelete()}>
    {#snippet body()}
      <p>Delete provider {deleteTargetLabel}? This cannot be undone.</p>
      {#if deleteError !== null}<p class="status-error">{deleteError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .provider-create {
    border: 1px solid var(--border);
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: var(--gap-field);
  }
  .placeholder {
    color: var(--text-dim);
    font-size: 12px;
    padding: 8px 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .row-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
</style>
