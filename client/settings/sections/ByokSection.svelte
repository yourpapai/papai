<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Confirm from '../../shared/Confirm.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import ProviderForm from '../components/ProviderForm.svelte'
  import RoleBindingBlock from '../components/RoleBindingBlock.svelte'
  import VerificationPill from '../components/VerificationPill.svelte'
  import type { ByokResponse } from '../fetcher-schemas.js'
  import type { LlmRoleBindings, PublicProviderAccount, RoleBinding } from '../fetcher-schemas-llm-providers.js'
  import { fetchByok, toggleByok } from '../fetchers.js'
  import {
    deleteByokProviderAction,
    refreshByokModels,
    setByokRolesAction,
    upsertByokProviderAction,
  } from '../byok-provider-fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: ByokResponse | null = $state(null)
  let loadedContextId: string | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let toggling = $state(false)
  let saving = $state(false)
  let showAddForm = $state(false)
  let draftRoles: LlmRoleBindings | null = $state(null)
  let deleteTarget: PublicProviderAccount | null = $state(null)
  let deleteError: string | null = $state(null)
  let refreshingId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  type PillTone = 'accent' | 'warn' | 'danger' | 'mute'
  interface PillState {
    tone: PillTone
    dot: boolean
    text: string
  }
  const pillState = $derived.by((): PillState | null => {
    if (currentData === null) return null
    if (!currentData.enabled) return { tone: 'mute', dot: false, text: 'Central credentials' }
    if (unreadableError !== null) return { tone: 'danger', dot: true, text: 'Unreadable' }
    if (currentData.providers.length === 0) return { tone: 'warn', dot: true, text: 'No providers' }
    return { tone: 'accent', dot: true, text: 'Active' }
  })

  const rolesDirty = $derived(
    currentData !== null &&
      draftRoles !== null &&
      JSON.stringify(draftRoles) !== JSON.stringify(currentData.roles),
  )

  const deleteTargetLabel = $derived(deleteTarget?.label ?? '')

  function clearContextState(): void {
    data = null
    loadedContextId = null
    draftRoles = null
    showAddForm = false
  }

  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    if (id !== loadedContextId) clearContextState()
    loading = true
    try {
      const next = await fetchByok(id)
      if (id !== contextId) return false
      data = next
      loadedContextId = id
      draftRoles = JSON.parse(JSON.stringify(next.roles)) as LlmRoleBindings
      showAddForm = false
      return true
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function setEnabled(next: boolean): Promise<void> {
    if (loading || toggling) return
    error = null
    status = null
    toggling = true
    try {
      await toggleByok({ contextId, enabled: next })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      toggling = false
    }
  }

  async function onAddProvider(input: {
    label: string
    providerType: string
    baseUrl: string
    apiKey: string
  }): Promise<boolean> {
    saving = true
    error = null
    try {
      const provider = {
        id: `prov_${Math.random().toString(36).slice(2, 14)}`,
        label: input.label,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        verification: {
          status: 'unverified' as const,
          error: null,
          at: null,
          models: [],
          modelsFetchedAt: null,
        },
      }
      await upsertByokProviderAction({ contextId, provider })
      await load(contextId)
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
    error = null
    try {
      await deleteByokProviderAction({ contextId, id: deleteTarget.id })
      deleteTarget = null
      await load(contextId)
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err)
    }
  }

  function requestDelete(provider: PublicProviderAccount): void {
    deleteError = null
    deleteTarget = provider
  }

  async function refreshProviderModels(id: string): Promise<void> {
    refreshingId = id
    error = null
    try {
      await refreshByokModels({ contextId, id })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      refreshingId = null
    }
  }

  function onRoleChange(role: 'main' | 'small' | 'embedding', binding: RoleBinding): void {
    if (draftRoles === null) return
    draftRoles = { ...draftRoles, [role]: binding }
  }

  async function onSaveRoles(): Promise<void> {
    if (draftRoles === null || !rolesDirty) return
    saving = true
    error = null
    status = null
    try {
      await setByokRolesAction({ contextId, roles: draftRoles })
      await load(contextId)
      status = 'Role overrides saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })

  $effect(() => {
    void contextId
    untrack(() => {
      error = null
      status = null
    })
  })
</script>

<section id="byok" class="settings-section">
  <PageHeader eyebrow="Personal" title="BYOK LLM">
    {#snippet action()}
      {#if pillState !== null}
        <span data-testid="byok-state">
          <Pill tone={pillState.tone} dot={pillState.dot}>
            {#snippet children()}{pillState.text}{/snippet}
          </Pill>
        </span>
      {/if}
      {#if currentData !== null}
        <Btn
          variant={currentData.enabled ? 'outline' : 'primary'}
          size="sm"
          testid="byok-toggle"
          disabled={loading || toggling}
          onClick={() => void setEnabled(!currentData.enabled)}>
          {#snippet children()}{currentData.enabled ? 'Use central credentials' : 'Use my own credentials'}{/snippet}
        </Btn>
      {/if}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="byok-refresh" />
    {/snippet}
  </PageHeader>

  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null && !currentData.enabled}
    <p class="placeholder">
      Using the central LLM credentials. Turn on "Use my own credentials" to configure BYOK for this context.
    </p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">
        Stored BYOK credentials are unreadable. Re-add providers to repair this context.
      </p>
    {/if}

    {#if showAddForm}
      <div class="provider-create" data-testid="byok-add-form">
        <div class="t-subhead">Add provider</div>
        <ProviderForm
          onSave={onAddProvider}
          onCancel={() => (showAddForm = false)}
          busy={saving}
          testidPrefix="byok-provider-form" />
      </div>
    {:else}
      <div class="settings-byok__add">
        <Btn variant="primary" size="sm" testid="byok-add-provider" onClick={() => (showAddForm = true)}>
          {#snippet children()}Add provider{/snippet}
        </Btn>
      </div>
    {/if}

    {#if currentData.providers.length === 0}
      <p class="placeholder">No providers configured. Click "Add provider" to create one.</p>
    {:else}
      <div class="settings-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Type</th>
              <th>API Key</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each currentData.providers as provider (provider.id)}
              <tr>
                <td>{provider.label}</td>
                <td>{provider.providerType}</td>
                <td class="mono">{provider.apiKeyMasked}</td>
                <td><VerificationPill verification={provider.verification} /></td>
                <td>
                  <div class="row-actions">
                    <Btn
                      variant="ghost"
                      size="sm"
                      testid={`byok-refresh-models-${provider.id}`}
                      disabled={refreshingId === provider.id}
                      onClick={() => void refreshProviderModels(provider.id)}>
                      {#snippet children()}{refreshingId === provider.id ? '…' : 'Refresh'}{/snippet}
                    </Btn>
                    <Btn
                      variant="danger"
                      size="sm"
                      testid={`byok-delete-${provider.id}`}
                      onClick={() => requestDelete(provider)}>
                      {#snippet children()}Delete{/snippet}
                    </Btn>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="settings-byok__roles">
      <div class="settings-byok__roles-head">
        <div class="t-subhead">Role overrides</div>
        <Btn
          variant="primary"
          size="sm"
          testid="byok-roles-save"
          disabled={!rolesDirty || saving}
          onClick={() => void onSaveRoles()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save roles'}{/snippet}
        </Btn>
      </div>
      {#if draftRoles !== null}
        <RoleBindingBlock
          roleName="main"
          providers={currentData.providers}
          binding={draftRoles.main}
          canInherit={false}
          onChange={(binding) => onRoleChange('main', binding)}
          testid="byok-role-main" />
        <RoleBindingBlock
          roleName="small"
          providers={currentData.providers}
          binding={draftRoles.small}
          canInherit={true}
          inheritLabel="Inherit admin"
          onChange={(binding) => onRoleChange('small', binding)}
          testid="byok-role-small" />
        <RoleBindingBlock
          roleName="embedding"
          providers={currentData.providers}
          binding={draftRoles.embedding}
          canInherit={true}
          inheritLabel="Inherit admin"
          onChange={(binding) => onRoleChange('embedding', binding)}
          testid="byok-role-embedding" />
      {/if}
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
  .settings-byok__add {
    margin-bottom: var(--gap-field);
  }
  .provider-create {
    border: 1px solid var(--border);
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: var(--gap-field);
  }
  .settings-byok__roles {
    margin-top: var(--gap-field);
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-byok__roles-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .row-actions {
    display: flex;
    gap: 4px;
  }
</style>
