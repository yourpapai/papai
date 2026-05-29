<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminSystem, submitAdminSystem } from '../../fetchers.js'
  import type { AdminSystemResponse } from '../../fetcher-schemas.js'

  let config: AdminSystemResponse['config'] = $state({})
  let drafts: Record<string, string> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  const keys = $derived(Object.keys(config))

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      config = (await fetchAdminSystem()).config
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(key: string): Promise<void> {
    error = null
    status = null
    try {
      await submitAdminSystem({ key, value: drafts[key] ?? '' })
      drafts[key] = ''
      await load()
      status = `${key} updated.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="system" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · System</p>
      <h2>System (LLM)</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-field-list">
    {#each keys as key (key)}
      <div class="settings-field" data-testid={`system-row-${key}`}>
        <div class="settings-field__head">
          <span class="settings-field__label">{key}</span>
          {#if config[key]?.value !== null}<span class="masked-value">{config[key]?.value}</span>{:else}<span class="placeholder">unset</span>{/if}
        </div>
        <div class="settings-field__editor">
          <input
            data-testid={`system-input-${key}`}
            value={drafts[key] ?? ''}
            placeholder="enter a new value"
            oninput={(e) => (drafts[key] = (e.target as HTMLInputElement).value)} />
          <button type="button" data-testid={`system-save-${key}`} onclick={() => void save(key)}>Save</button>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .settings-field-list {
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
    gap: 10px;
    align-items: center;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    gap: 8px;
  }
  .settings-field__editor input {
    flex: 1;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-field__editor button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
</style>
