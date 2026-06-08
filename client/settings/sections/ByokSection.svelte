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
  import type { ByokField, ByokResponse } from '../fetcher-schemas.js'
  import { fetchByok, patchByok } from '../fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: ByokResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let savingKey: string | null = $state(null)
  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const fields = $derived(currentData?.fields ?? [])
  const missing = $derived(currentData?.missing ?? [])
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  function initialDrafts(nextFields: ByokField[]): Record<string, string> {
    return Object.fromEntries(nextFields.map((field) => [field.key, field.sensitive && field.hasValue ? '' : field.value]))
  }

  function clearContextState(): void {
    data = null
    drafts = {}
    replacing = {}
    loadedContextId = null
  }

  function displaySecret(value: string): string {
    return value.includes('*') ? maskSecret(value) : '••••••••'
  }

  async function load(id: string): Promise<void> {
    error = null
    status = null
    if (id !== loadedContextId) clearContextState()
    loading = true
    try {
      const next = await fetchByok(id)
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

  function editorOpen(field: ByokField): boolean {
    return !field.sensitive || replacing[field.key] === true || !field.hasValue
  }

  async function save(field: ByokField): Promise<void> {
    if (loading || loadedContextId !== contextId || !fields.some((candidate) => candidate.key === field.key)) return
    error = null
    status = null
    savingKey = field.key
    try {
      await patchByok({ contextId, values: { [field.key]: drafts[field.key] ?? '' } })
      await load(contextId)
      status = `${field.label} saved.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      savingKey = null
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
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="byok-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData !== null && !currentData.enabled}
    <p class="placeholder">BYOK is not enabled for this context. Ask a bot admin to enable it first.</p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error">Stored BYOK credentials are unreadable. Re-enter the values to repair this context.</p>
    {/if}
    {#if !currentData.complete && missing.length > 0}
      <p class="status-error">Missing required fields: {missing.join(', ')}</p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        <div class="settings-field" data-testid={`byok-row-${field.key}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
            {#if field.sensitive && field.hasValue && !editorOpen(field)}
              <Secret value={displaySecret(field.value)} />
              <Btn variant="secondary" size="sm" testid={`byok-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
          </div>

          {#if editorOpen(field)}
            <div class="settings-field__editor">
              <Field label={field.sensitive ? 'New value' : 'Value'}>
                {#snippet children()}
                  <Input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[field.key] ?? ''}
                    placeholder={field.sensitive ? 'enter a new value' : ''}
                    onInput={(value) => updateDraft(field.key, value)}
                    testid={`byok-input-${field.key}`} />
                {/snippet}
              </Field>
              <Btn
                variant="primary"
                size="sm"
                testid={`byok-save-${field.key}`}
                disabled={savingKey === field.key || loading}
                onClick={() => void save(field)}>
                {#snippet children()}{savingKey === field.key ? 'Saving…' : 'Save'}{/snippet}
              </Btn>
              {#if field.sensitive && field.hasValue}
                <Btn variant="ghost" size="sm" testid={`byok-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                  {#snippet children()}Cancel{/snippet}
                </Btn>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
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
</style>
