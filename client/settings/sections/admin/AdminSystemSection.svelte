<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminSystem, submitAdminSystem } from '../../admin-fetchers.js'
  import type { AdminSystemResponse } from '../../fetcher-schemas.js'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SystemKvRow from '../../components/SystemKvRow.svelte'

  const SENSITIVE_SYSTEM_KEYS = new Set<string>(['llm_apikey'])

  let config: AdminSystemResponse['config'] = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  const keys = $derived(Object.keys(config))

  async function load(): Promise<void> {
    error = null; status = null; loading = true
    try { config = (await fetchAdminSystem()).config }
    catch (err) { error = err instanceof Error ? err.message : String(err) }
    finally { loading = false }
  }

  async function save(key: string, value: string): Promise<boolean> {
    error = null; status = null
    try {
      await submitAdminSystem({ key, value })
      await load()
      status = `${key} updated.`
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  $effect(() => { void load() })
</script>

<section id="system" class="settings-section">
  <PageHeader eyebrow="Admin · System" title="System (LLM)">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="system-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <table class="system-kv">
    <thead>
      <tr><th scope="col" class="t-label">Key</th><th scope="col" class="t-label">Value</th><th scope="col" class="t-label system-kv__th-action">Action</th></tr>
    </thead>
    <tbody>
      {#each keys as key (key)}
        <SystemKvRow
          keyName={key}
          value={config[key]?.value ?? null}
          sensitive={SENSITIVE_SYSTEM_KEYS.has(key)}
          onSave={(v) => save(key, v)} />
      {/each}
    </tbody>
  </table>
</section>

<style>
  .system-kv { width: 100%; border-collapse: collapse; font-family: var(--font-mono); }
  .system-kv th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .system-kv__th-action { text-align: right; }
</style>
