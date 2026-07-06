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
  import SettingsFieldShell from './SettingsFieldShell.svelte'

  interface Props {
    contextId: string
    field: ConfigField
    onSaved: () => void
    hint?: string
  }

  let { contextId, field, onSaved, hint }: Props = $props()

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

  // Save is meaningful only when the draft differs from the stored value. A sensitive
  // field's editor baseline is '' (an untouched/absent secret), so Save stays disabled
  // until the user types.
  const dirty = $derived(draft !== (field.sensitive ? '' : field.value))

  const hintId = $derived(`cfg-hint-${field.key}`)

  // Confirm-dialog copy for clearing. Only plugin/provider config makes a plugin ineligible;
  // a required preference/ai-output field simply reverts to its default.
  const clearWarning = $derived(
    field.required
      ? field.kind === 'plugin-context' || field.kind === 'provider-context'
        ? ' This field is required — clearing it will make the plugin ineligible for this context.'
        : ' This field is required — clearing it reverts it to the default.'
      : ' The field will revert to its default.',
  )

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
    if (saving) return
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
  <SettingsFieldShell label={field.label} editorOpen={false} testid={`cfg-row-${field.key}`}>
    {#snippet head()}
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        ariaDescribedBy={hint ? hintId : undefined}
        disabled={saving}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {/if}
      {#if hint}
        <p class="settings-field__hint" id={hintId}>{hint}</p>
      {/if}
    {/snippet}
  </SettingsFieldShell>
{:else}
  <SettingsFieldShell label={field.label} required={field.required} editorOpen={editorOpen} testid={`cfg-row-${field.key}`}>
    {#snippet head()}
      {#if field.sensitive && field.hasValue && !replacing}
        <Secret value={maskSecret(field.value)} />
        <Btn variant="secondary" size="sm" testid={`cfg-replace-${field.key}`} onClick={() => (replacing = true)}>
          {#snippet children()}Replace{/snippet}
        </Btn>
      {/if}
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet editor()}
      <Input
        type={field.sensitive ? 'password' : 'text'}
        value={draft}
        placeholder={field.sensitive ? 'enter a new value' : ''}
        onInput={(v) => (draft = v)}
        testid={`cfg-input-${field.key}`} />
      <Btn variant="primary" size="sm" testid={`cfg-save-${field.key}`} disabled={!dirty || saving} onClick={() => void save()}>
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
      {#if field.sensitive && field.hasValue}
        <Btn variant="ghost" size="sm" testid={`cfg-cancel-${field.key}`} onClick={() => { replacing = false; draft = '' }}>
          {#snippet children()}Cancel{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {/if}
      {#if hint}
        <p class="settings-field__hint" id={hintId}>{hint}</p>
      {/if}
    {/snippet}
  </SettingsFieldShell>
{/if}

<Confirm
  open={pendingClear}
  title="Clear field value"
  danger
  confirmLabel="Clear"
  onCancel={() => (pendingClear = false)}
  onConfirm={() => { pendingClear = false; void clearField() }}>
  {#snippet body()}<p>Clear the stored value for <strong>{field.label}</strong>?{clearWarning}</p>{/snippet}
</Confirm>

<style>
  .settings-field__hint {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
