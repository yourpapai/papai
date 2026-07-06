<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
  import type { CodingCredentialField, CodingCredentialsResponse } from '../fetcher-schemas.js'
  import { clearCodingCredentials, fetchCodingCredentials, patchCodingCredentials } from '../coding-credentials-fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'

  // Client-side mirror of src/coding-credentials/types.ts `needsInstanceUrl`
  function needsInstanceUrl(kind: string): boolean {
    return kind === 'github-enterprise' || kind === 'gitlab-self-hosted'
  }

  interface Props {
    contextId: string
  }
  let { contextId }: Props = $props()

  let data: CodingCredentialsResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const fields = $derived(currentData?.fields ?? [])
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  // Whole-record save is meaningful only when a field's draft differs from its stored value.
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))

  // Compute whether instance_url field should be shown based on selected kind
  const kindField = $derived(fields.find((f) => f.key === 'kind'))
  const currentKind = $derived(drafts['kind'] ?? kindField?.value ?? '')
  const showInstanceUrl = $derived(needsInstanceUrl(currentKind))

  function initialDrafts(nextFields: CodingCredentialField[]): Record<string, string> {
    return Object.fromEntries(
      nextFields.map((f) => {
        if (f.sensitive && f.hasValue) return [f.key, '']
        // Default an empty select to its first option so the persisted value matches
        // what the dropdown visibly shows (an empty <select> renders the first option).
        if (f.control === 'select' && (f.value ?? '') === '') return [f.key, f.options?.[0] ?? '']
        return [f.key, f.value]
      }),
    )
  }
  function displaySecret(value: string): string {
    return value.includes('*') ? maskSecret(value) : '••••••••'
  }
  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id, 'forge')
      if (id !== contextId) return false
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
      return true
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }
  function updateDraft(key: string, value: string): void {
    drafts = { ...drafts, [key]: value }
  }
  function replaceSecret(key: string): void {
    replacing = { ...replacing, [key]: true }
    updateDraft(key, '')
  }
  function cancelReplace(key: string): void {
    const { [key]: _, ...rest } = replacing
    replacing = rest
    updateDraft(key, '')
  }
  function editorOpen(field: CodingCredentialField): boolean {
    return !field.sensitive || replacing[field.key] === true || !field.hasValue
  }

  function shouldShowField(field: CodingCredentialField): boolean {
    if (field.key === 'instance_url') return showInstanceUrl
    return true
  }

  // Whole-record save: a forge connection is kind + instance_url + token validated
  // together server-side, so persist them in one PATCH. Saving fields individually
  // (e.g. kind before instance_url) hits the route's cross-field 422 and silently
  // drops the field, which previously left kind empty → mis-derived GitHub SaaS.
  function collectValues(): Record<string, string> {
    const values: Record<string, string> = {}
    for (const field of fields) {
      if (!shouldShowField(field)) continue
      // Preserve an untouched secret: omit it so the server keeps the stored value.
      if (field.sensitive && field.hasValue && replacing[field.key] !== true) continue
      values[field.key] = drafts[field.key] ?? ''
    }
    return values
  }
  async function saveAll(): Promise<void> {
    if (loading || saving || loadedContextId !== contextId) return
    error = null
    status = null
    saving = true
    try {
      await patchCodingCredentials({ contextId, namespace: 'forge', values: collectValues() })
      const ok = await load(contextId)
      if (ok) status = 'Code host saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  let pendingClear = $state(false)
  let clearing = $state(false)
  let clearError = $state<string | null>(null)

  async function confirmClear(): Promise<void> {
    if (clearing || loadedContextId !== contextId) return
    clearError = null
    status = null
    clearing = true
    let ok = false
    try {
      await clearCodingCredentials({ contextId, namespace: 'forge' })
      ok = true
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = false
      const reloaded = await load(contextId)
      if (reloaded) status = 'Code host credentials cleared.'
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })
</script>

<section id="code-host" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Code host">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="code-host-refresh" />
    {/snippet}
  </PageHeader>

  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your token to repair this context.</p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        {#if shouldShowField(field)}
          <SettingsFieldShell
            label={field.label}
            required={field.required}
            editorOpen={editorOpen(field)}
            testid={`coding-row-${field.key}`}>
            {#snippet head()}
              {#if field.sensitive && field.hasValue && !editorOpen(field)}
                <Secret value={displaySecret(field.value)} />
                <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                  {#snippet children()}Replace{/snippet}
                </Btn>
              {/if}
            {/snippet}
            {#snippet editor(labelId)}
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-select-${field.key}`}
                  aria-labelledby={labelId}
                  value={drafts[field.key] ?? ''}
                  disabled={saving || loading}
                  onchange={(e) => updateDraft(field.key, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  {#each field.options ?? [] as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else}
                <Input
                  type={field.sensitive ? 'password' : 'text'}
                  value={drafts[field.key] ?? ''}
                  placeholder={field.sensitive ? 'enter a new value' : ''}
                  onInput={(value) => updateDraft(field.key, value)}
                  testid={`coding-input-${field.key}`} />
                {#if field.sensitive && field.hasValue}
                  <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                    {#snippet children()}Cancel{/snippet}
                  </Btn>
                {/if}
              {/if}
            {/snippet}
          </SettingsFieldShell>
        {/if}
      {/each}

      <div class="settings-field__actions">
        {#if currentData.configured}
          <Btn
            variant="ghost"
            size="sm"
            testid="code-host-clear"
            disabled={saving || loading || clearing}
            onClick={() => {
              pendingClear = true
              clearError = null
            }}>
            {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
          </Btn>
        {/if}
        <Btn
          variant="primary"
          size="sm"
          testid="code-host-save"
          disabled={!formDirty || saving || loading || clearing}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}

  <Confirm
    open={pendingClear}
    title="Clear code host credentials"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Remove the stored code host connection and token for this context? This cannot be undone.</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-byok-fields {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
  }
  .coding-select {
    flex: 1;
    min-width: 200px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 14px;
  }
</style>
