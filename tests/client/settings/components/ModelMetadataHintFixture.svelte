<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ModelMetadataHint from '../../../../client/settings/components/ModelMetadataHint.svelte'

  interface Props {
    providerType?: string
    baseUrl?: string
    baseProvider?: string
    baseModel?: string
    model: string
    debounceMs?: number
  }

  let { providerType = '', baseUrl = '', baseProvider = '', baseModel = '', model, debounceMs = 1 }: Props = $props()

  export function setModel(next: string): void {
    model = next
  }

  export function setBase(next: { baseProvider: string; baseModel: string }): void {
    baseProvider = next.baseProvider
    baseModel = next.baseModel
  }
</script>

<ModelMetadataHint {providerType} {baseUrl} {baseProvider} {baseModel} {model} {debounceMs} />
