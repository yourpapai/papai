<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import type { CodingCredentialField, CodingCredentialsResponse } from '../fetcher-schemas.js'
  import { fetchCodingCredentials, patchCodingCredentials } from '../fetchers.js'
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
  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id, 'forge')
      if (id !== contextId) return
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
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
      await load(contextId)
      status = 'Code host saved.'
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
</script>

<section id="code-host" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Code host">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="code-host-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error">Stored credentials are unreadable. Re-enter your token to repair this context.</p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        {#if shouldShowField(field)}
          <div class="settings-field" data-testid={`coding-row-${field.key}`}>
            <div class="settings-field__head">
              <span class="t-label settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
              {#if field.sensitive && field.hasValue && !editorOpen(field)}
                <Secret value={displaySecret(field.value)} />
                <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                  {#snippet children()}Replace{/snippet}
                </Btn>
              {/if}
            </div>
            {#if field.control === 'select'}
              <div class="settings-field__editor">
                <Field label="Value">
                  {#snippet children()}
                    <select
                      data-testid={`coding-select-${field.key}`}
                      value={drafts[field.key] ?? ''}
                      disabled={saving || loading}
                      onchange={(e) => updateDraft(field.key, (e.currentTarget as HTMLSelectElement).value)}
                      class="coding-select">
                      {#each field.options ?? [] as opt (opt)}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  {/snippet}
                </Field>
              </div>
            {:else if editorOpen(field)}
              <div class="settings-field__editor">
                <Field label={field.sensitive ? 'New value' : 'Value'}>
                  {#snippet children()}
                    <Input
                      type={field.sensitive ? 'password' : 'text'}
                      value={drafts[field.key] ?? ''}
                      placeholder={field.sensitive ? 'enter a new value' : ''}
                      onInput={(value) => updateDraft(field.key, value)}
                      testid={`coding-input-${field.key}`} />
                  {/snippet}
                </Field>
                {#if field.sensitive && field.hasValue}
                  <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                    {#snippet children()}Cancel{/snippet}
                  </Btn>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}

      <div class="settings-field__actions">
        <Btn
          variant="primary"
          size="sm"
          testid="code-host-save"
          disabled={saving || loading}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}
</section>

<style>
  .settings-byok-fields {
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
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-field) {
    flex: 1;
    min-width: 200px;
  }
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
  }
  .coding-select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 14px;
  }
</style>
