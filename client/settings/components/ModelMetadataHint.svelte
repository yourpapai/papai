<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchLlmModelMetadata } from '../llm-model-metadata-fetchers.js'
  import type { LlmModelMetadata } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    providerType?: string
    baseUrl?: string
    baseProvider?: string | null
    baseModel?: string | null
    model: string
    debounceMs?: number
  }

  let { providerType = '', baseUrl = '', baseProvider = null, baseModel = null, model, debounceMs = 300 }: Props =
    $props()

  let result: LlmModelMetadata | null = $state(null)

  const cache = new Map<string, LlmModelMetadata>()
  let latestRequest = 0
  let activeController: AbortController | null = null

  const lookupKey = $derived(
    [providerType ?? '', baseUrl ?? '', baseProvider ?? '', baseModel ?? '', model.trim()].join('\u0000'),
  )

  $effect(() => {
    const key = lookupKey
    if (model.trim() === '') {
      result = null
      return
    }
    const cached = cache.get(key)
    if (cached !== undefined) {
      result = cached
      return
    }
    const requestId = ++latestRequest
    const timer = setTimeout(
      () => {
        const controller = new AbortController()
        activeController?.abort()
        activeController = controller
        void fetchLlmModelMetadata(
          {
            providerType,
            baseUrl,
            baseProvider: baseProvider ?? undefined,
            baseModel: baseModel ?? undefined,
            model: model.trim(),
          },
          { signal: controller.signal },
        )
          .then((resolved) => {
            if (requestId !== latestRequest) return
            if (resolved.snapshotFetchedAt !== null) cache.set(key, resolved)
            result = resolved
          })
          .catch(() => {
            if (requestId !== latestRequest) return
            result = null
          })
      },
      Math.max(0, debounceMs),
    )
    return () => {
      clearTimeout(timer)
      activeController?.abort()
      activeController = null
    }
  })
</script>

{#if result !== null}
  <span class="model-metadata-hint" data-testid="model-metadata-hint">
    {#if result.source === 'models-dev'}
      models.dev · {result.providerId}/{result.modelId} · ctx {result.contextWindow ?? '—'} · max out {result
        .maxOutputTokens ?? '—'}{result.via === 'override' ? ' · via override' : ''}
    {:else if result.source === 'prefix-table'}
      prefix guess · ctx {result.contextWindow ?? '—'}
    {:else if result.snapshotFetchedAt === null}
      catalogue unavailable
    {:else}
      no limits known
    {/if}
  </span>
{/if}

<style>
  .model-metadata-hint {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
</style>
