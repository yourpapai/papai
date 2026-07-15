<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Combobox from '../../shared/ui/Combobox.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import type { PublicProviderAccount, RoleBinding } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    roleName: string
    providers: PublicProviderAccount[]
    binding: RoleBinding
    canInherit: boolean
    inheritLabel?: string
    onChange: (binding: RoleBinding) => void
    testid: string
  }

  let {
    roleName,
    providers,
    binding,
    canInherit,
    inheritLabel = 'Inherit main',
    onChange,
    testid,
  }: Props = $props()

  const isInherit = $derived(canInherit && binding === null)

  const providerOptions = $derived(
    providers.map((p) => ({ value: p.id, label: p.label })),
  )

  const selectedProvider = $derived(
    binding !== null
      ? providers.find((p) => p.id === binding.providerId) ?? null
      : null,
  )

  const modelOptions = $derived(
    selectedProvider !== null
      ? selectedProvider.verification.models.map((m) => ({ value: m }))
      : [],
  )

  function onInheritToggle(): void {
    if (isInherit) {
      onChange(providers.length > 0 ? { providerId: providers[0]!.id, model: '' } : { providerId: '', model: '' })
    } else {
      onChange(null)
    }
  }

  function onProviderChange(providerId: string): void {
    onChange({ providerId, model: '' })
  }

  function onModelInput(model: string): void {
    if (binding === null) return
    onChange({ ...binding, model })
  }
</script>

<div class="role-binding" data-testid={testid}>
  <div class="role-binding__head">
    <span class="role-binding__name">{roleName}</span>
    {#if canInherit}
      <label class="role-binding__inherit">
        <input type="checkbox" checked={isInherit} onchange={onInheritToggle} data-testid={`${testid}-inherit`} />
        {inheritLabel}
      </label>
    {/if}
  </div>
  {#if !isInherit}
    <div class="role-binding__controls">
      <Select
        value={binding?.providerId ?? ''}
        options={providerOptions}
        onChange={onProviderChange}
        placeholder="Select provider"
        testid={`${testid}-provider`} />
      <Combobox
        value={binding?.model ?? ''}
        options={modelOptions}
        onInput={onModelInput}
        placeholder="Enter or select model"
        testid={`${testid}-model`} />
    </div>
  {/if}
</div>

<style>
  .role-binding { display: grid; gap: 6px; padding: 8px 0; }
  .role-binding__head { display: flex; align-items: center; justify-content: space-between; }
  .role-binding__name { font-family: var(--font-mono); font-size: 12px; text-transform: capitalize; color: var(--fg2); }
  .role-binding__inherit { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg3); cursor: pointer; }
  .role-binding__controls { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
