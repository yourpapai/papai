<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { ConfigField } from '../fetcher-schemas.js'
  import { patchConfig, unsetConfigField } from '../fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SegmentedControl from '../../shared/ui/SegmentedControl.svelte'
  import Confirm from '../../shared/Confirm.svelte'

  interface Props {
    contextId: string
    field: ConfigField
    onSaved: () => void
  }

  let { contextId, field, onSaved }: Props = $props()

  // Editing state. Sensitive fields start collapsed (masked); "Replace" opens an empty input.
  let replacing = $state(false)
  let draft = $state(field.sensitive ? '' : field.value)
  let error: string | null = $state(null)
  let saving = $state(false)
  let pendingClear = $state(false)
  const isEnum = $derived(field.control === 'toggle' || field.control === 'select')
  let current = $state(field.value)

  // An unset secret (no stored value) has nothing to mask, so open the editor
  // directly — otherwise there is no Replace button and no way to enter a first value.
  const editorOpen = $derived(!field.sensitive || replacing || !field.hasValue)

  $effect(() => {
    // Re-sync local edit state when the field prop changes (parent re-fetch / context switch).
    const sensitive = field.sensitive
    const value = field.value
    void field.key
    untrack(() => {
      draft = sensitive ? '' : value
      current = value
      replacing = false
    })
  })

  async function save(): Promise<void> {
    error = null
    saving = true
    try {
      await patchConfig({ key: field.key, value: draft, contextId })
      replacing = false
      onSaved()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function clearField(): Promise<void> {
    error = null
    saving = true
    try {
      await unsetConfigField({ key: field.key, contextId })
      onSaved()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function saveEnum(next: string): Promise<void> {
    if (saving) return
    const previous = current
    current = next
    error = null
    saving = true
    try {
      await patchConfig({ key: field.key, value: next, contextId })
      onSaved()
    } catch (err) {
      current = previous
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

{#if isEnum}
  <div class="settings-field" data-testid={`cfg-row-${field.key}`}>
    <div class="settings-field__head">
      <span class="t-label settings-field__label">{field.label}</span>
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
      {#if field.hasValue}
        <Btn variant="ghost" size="sm" testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    </div>
    {#if error !== null}
      <p class="status-error">{error}</p>
    {/if}
  </div>
{:else}
  <div class="settings-field" data-testid={`cfg-row-${field.key}`}>
    <div class="settings-field__head">
      <span class="t-label settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
      {#if field.sensitive && field.hasValue && !replacing}
        <Secret value={maskSecret(field.value)} />
        <Btn variant="secondary" size="sm" testid={`cfg-replace-${field.key}`} onClick={() => (replacing = true)}>
          {#snippet children()}Replace{/snippet}
        </Btn>
      {/if}
      {#if field.hasValue}
        <Btn variant="ghost" size="sm" testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    </div>

    {#if editorOpen}
      <div class="settings-field__editor">
        <Input
          type={field.sensitive ? 'password' : 'text'}
          value={draft}
          placeholder={field.sensitive ? 'enter a new value' : ''}
          onInput={(v) => (draft = v)}
          testid={`cfg-input-${field.key}`} />
        <Btn variant="primary" size="sm" testid={`cfg-save-${field.key}`} disabled={saving} onClick={() => void save()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
        {#if field.sensitive && field.hasValue}
          <Btn variant="ghost" size="sm" testid={`cfg-cancel-${field.key}`} onClick={() => { replacing = false; draft = '' }}>
            {#snippet children()}Cancel{/snippet}
          </Btn>
        {/if}
      </div>
    {/if}

    {#if error !== null}
      <p class="status-error">{error}</p>
    {/if}
  </div>
{/if}

<Confirm
  open={pendingClear}
  title="Clear field value"
  danger
  confirmLabel="Clear"
  onCancel={() => (pendingClear = false)}
  onConfirm={() => { pendingClear = false; void clearField() }}>
  {#snippet body()}<p>Clear the stored value for <strong>{field.label}</strong>?{field.required ? ' This field is required — clearing it will make the plugin ineligible for this context.' : ' The field will revert to its default.'}</p>{/snippet}
</Confirm>

<style>
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
    gap: 8px;
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-input) {
    flex: 1;
    min-width: 200px;
  }
</style>
