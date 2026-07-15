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
  import VerificationPill from '../../components/VerificationPill.svelte'
  import {
    createAdminProvider,
    deleteAdminProvider,
    fetchAdminProviders,
  } from '../../admin-fetchers.js'
  import type { PublicProviderAccount } from '../../fetcher-schemas-llm-providers.js'

  let providers: PublicProviderAccount[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let showAddForm = $state(false)
  let saving = $state(false)
  let deleteTarget: PublicProviderAccount | null = $state(null)
  let deleteError: string | null = $state(null)

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
            <th></th>
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
                <Btn
                  variant="danger"
                  size="sm"
                  testid={`admin-providers-delete-${provider.id}`}
                  onClick={() => requestDelete(provider)}>
                  {#snippet children()}Delete{/snippet}
                </Btn>
              </td>
            </tr>
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
    color: var(--fg3);
    font-size: 12px;
    padding: 8px 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
