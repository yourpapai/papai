<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import {
    PROVIDER_TYPE_BASE_URLS,
    PROVIDER_TYPE_OPTIONS,
    type LlmProviderType,
  } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    onSave: (input: { label: string; providerType: LlmProviderType; baseUrl: string; apiKey: string }) => Promise<boolean>
    onCancel: () => void
    busy?: boolean
    initial?: Partial<{ label: string; providerType: LlmProviderType; baseUrl: string }> | null
    requireApiKey?: boolean
    testidPrefix?: string
  }

  let {
    onSave,
    onCancel,
    busy = false,
    initial = null,
    requireApiKey = true,
    testidPrefix = 'provider-form',
  }: Props = $props()

  let label = $state(initial?.label ?? '')
  let providerType = $state<LlmProviderType>(initial?.providerType ?? 'openai')
  let baseUrl = $state(initial?.baseUrl ?? PROVIDER_TYPE_BASE_URLS.openai ?? '')
  let apiKey = $state('')

  function onTypeChange(next: string): void {
    providerType = next as LlmProviderType
    const preset = PROVIDER_TYPE_BASE_URLS[next as LlmProviderType]
    if (preset !== undefined) baseUrl = preset
  }

  const canSave = $derived(label.trim().length > 0 && baseUrl.trim().length > 0 && (!requireApiKey || apiKey.trim().length > 0))

  async function save(): Promise<void> {
    if (!canSave || busy) return
    await onSave({ label: label.trim(), providerType, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })
  }
</script>

<div class="provider-form" data-testid={testidPrefix}>
  <label class="provider-form__field">
    <span class="provider-form__label">Type</span>
    <Select
      value={providerType}
      options={PROVIDER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      onChange={onTypeChange}
      testid={`${testidPrefix}-type`} />
  </label>
  <label class="provider-form__field">
    <span class="provider-form__label">Label</span>
    <Input value={label} placeholder="e.g. OpenAI work" onInput={(v) => (label = v)} testid={`${testidPrefix}-label`} />
  </label>
  <label class="provider-form__field">
    <span class="provider-form__label">Base URL</span>
    <Input value={baseUrl} placeholder="https://api.example.com/v1" onInput={(v) => (baseUrl = v)} testid={`${testidPrefix}-base-url`} />
  </label>
  {#if requireApiKey}
    <label class="provider-form__field">
      <span class="provider-form__label">API Key</span>
      <Input type="password" value={apiKey} placeholder="enter API key" onInput={(v) => (apiKey = v)} testid={`${testidPrefix}-api-key`} />
    </label>
  {/if}
  <div class="provider-form__actions">
    <Btn variant="primary" size="sm" disabled={!canSave || busy} onClick={() => void save()} testid={`${testidPrefix}-save`}>
      {#snippet children()}{busy ? 'Saving…' : 'Save'}{/snippet}
    </Btn>
    <Btn variant="ghost" size="sm" onClick={onCancel} testid={`${testidPrefix}-cancel`}>
      {#snippet children()}Cancel{/snippet}
    </Btn>
  </div>
</div>

<style>
  .provider-form { display: grid; gap: var(--gap-inline); }
  .provider-form__field { display: grid; gap: 4px; }
  .provider-form__label { font-size: 11px; color: var(--fg3); font-family: var(--font-mono); }
  .provider-form__actions { display: flex; gap: 8px; }
</style>
