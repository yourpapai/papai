<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ModelMetadataHint from './ModelMetadataHint.svelte'
  import type { ModelHints } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    providerType?: string
    baseUrl?: string
    modelHints: ModelHints
    enumeratedModels?: readonly string[]
    onHintsChange?: (hints: ModelHints) => void
  }

  let { providerType = '', baseUrl = '', modelHints, enumeratedModels = [], onHintsChange }: Props = $props()

  const availableModels = $derived(enumeratedModels.filter((id) => !(id in modelHints)))

  const emit = (hints: ModelHints): void => {
    modelHints = hints
    onHintsChange?.(hints)
  }

  const updateHint = (model: string, field: 'baseProvider' | 'baseModel', value: string): void => {
    const current = modelHints[model]
    if (current === undefined) return
    emit({ ...modelHints, [model]: { ...current, [field]: value } })
  }

  const removeHint = (model: string): void => {
    emit(Object.fromEntries(Object.entries(modelHints).filter(([id]) => id !== model)))
  }

  const addHint = (event: Event): void => {
    const model = (event.currentTarget as HTMLSelectElement).value
    if (model === '' || model in modelHints) return
    emit({ ...modelHints, [model]: { baseProvider: '', baseModel: '' } })
  }
</script>

<div class="model-hints-editor" data-testid="model-hints-editor">
  {#each Object.entries(modelHints) as [model, hint] (model)}
    <div class="model-hints-row" data-testid="model-hints-row">
      <span class="model-hints-model">{model}</span>
      <input
        data-testid="model-hints-base-provider"
        placeholder="base provider"
        value={hint.baseProvider}
        oninput={(event) => updateHint(model, 'baseProvider', (event.currentTarget as HTMLInputElement).value)}
      />
      <input
        data-testid="model-hints-base-model"
        placeholder="base model"
        value={hint.baseModel}
        oninput={(event) => updateHint(model, 'baseModel', (event.currentTarget as HTMLInputElement).value)}
      />
      <ModelMetadataHint
        {providerType}
        {baseUrl}
        baseProvider={hint.baseProvider}
        baseModel={hint.baseModel}
        {model}
      />
      <button type="button" data-testid="model-hints-remove" onclick={() => removeHint(model)}>Remove</button>
    </div>
  {/each}
  {#if availableModels.length > 0}
    <select data-testid="model-hints-add-model" onchange={addHint}>
      {#each availableModels as model (model)}
        <option value={model}>{model}</option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .model-hints-editor {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .model-hints-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .model-hints-model {
    font-weight: 500;
  }
</style>
