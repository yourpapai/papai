<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { ConfigField } from '../fetcher-schemas.js'
  import { patchConfig } from '../fetchers.js'

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

  const editorOpen = $derived(!field.sensitive || replacing)

  async function save(): Promise<void> {
    error = null
    saving = true
    try {
      await patchConfig({ key: field.key, value: draft, contextId })
      replacing = false
      if (!field.sensitive) draft = field.value
      onSaved()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

<div class="settings-field" data-testid={`cfg-row-${field.key}`}>
  <div class="settings-field__head">
    <span class="settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
    {#if field.sensitive && field.hasValue && !replacing}
      <span class="masked-value">{field.value}</span>
      <button type="button" data-testid={`cfg-replace-${field.key}`} onclick={() => (replacing = true)}>Replace</button>
    {/if}
  </div>

  {#if editorOpen}
    <div class="settings-field__editor">
      <input
        data-testid={`cfg-input-${field.key}`}
        type={field.sensitive ? 'password' : 'text'}
        value={draft}
        placeholder={field.sensitive ? 'enter a new value' : ''}
        oninput={(event) => (draft = (event.target as HTMLInputElement).value)} />
      <button type="button" data-testid={`cfg-save-${field.key}`} disabled={saving} onclick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {#if field.sensitive}
        <button type="button" data-testid={`cfg-cancel-${field.key}`} onclick={() => { replacing = false; draft = '' }}>
          Cancel
        </button>
      {/if}
    </div>
  {/if}

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}
</div>

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
  .settings-field__editor input {
    flex: 1;
    min-width: 200px;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-field__editor button,
  .settings-field__head button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
</style>
