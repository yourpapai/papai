<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminPluginConfig, patchAdminPluginConfig } from '../../admin-fetchers.js'
  import type { AdminPluginConfigEntry } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Secret from '../../../shared/ui/Secret.svelte'

  let plugins: AdminPluginConfigEntry[] = $state([])
  let drafts: Record<string, string> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  function draftKey(pluginId: string, key: string): string {
    return `${pluginId}::${key}`
  }

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      plugins = (await fetchAdminPluginConfig()).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(pluginId: string, key: string): Promise<void> {
    error = null
    status = null
    const dk = draftKey(pluginId, key)
    const value = drafts[dk] ?? ''
    if (value.trim() === '') return
    try {
      await patchAdminPluginConfig({ pluginId, key, value })
      drafts[dk] = ''
      await load()
      status = `${pluginId} / ${key} updated.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="plugin-config" class="settings-section">
  <PageHeader eyebrow="Admin · Plugins" title="Plugin config">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load()}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#each plugins as plugin (plugin.pluginId)}
    <div class="plugin-block">
      <p class="plugin-block__id">{plugin.pluginId}</p>
      <div class="settings-field-list">
        {#each plugin.keys as keyState (keyState.key)}
          <div
            class="settings-field"
            data-testid={`plugin-config-key-${plugin.pluginId}-${keyState.key}`}>
            <div class="settings-field__head">
              <span class="settings-field__label">{keyState.label}</span>
              {#if keyState.value !== null}
                <Secret value={keyState.value} />
              {:else}
                <span class="placeholder">unset</span>
              {/if}
              {#if keyState.required}<span class="badge-required">required</span>{/if}
            </div>
            <Field label="New value">
              <div class="settings-field__editor-row">
                <Input
                  type={keyState.sensitive ? 'password' : 'text'}
                  value={drafts[draftKey(plugin.pluginId, keyState.key)] ?? ''}
                  placeholder="enter a new value"
                  onInput={(v) => (drafts[draftKey(plugin.pluginId, keyState.key)] = v)}
                  testid={`plugin-config-input-${plugin.pluginId}-${keyState.key}`} />
                <Btn
                  variant="primary"
                  size="sm"
                  testid={`plugin-config-save-${plugin.pluginId}-${keyState.key}`}
                  onClick={() => void save(plugin.pluginId, keyState.key)}>
                  {#snippet children()}Save{/snippet}
                </Btn>
              </div>
            </Field>
          </div>
        {/each}
      </div>
    </div>
  {/each}

  {#if plugins.length === 0 && !loading}
    <EmptyState title="No plugin config keys" hint="No plugins with admin config keys found." />
  {/if}
</section>

<style>
  .plugin-block {
    margin-bottom: 16px;
  }
  .plugin-block__id {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg2);
    margin: 0 0 8px 0;
  }
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
  .badge-required {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .settings-field__editor-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
</style>
