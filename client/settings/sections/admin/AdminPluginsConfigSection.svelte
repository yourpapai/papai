<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminPluginConfig, patchAdminPluginConfig, unsetAdminPluginConfig } from '../../admin-fetchers.js'
  import type { AdminPluginConfigEntry } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Secret from '../../../shared/ui/Secret.svelte'
  import Confirm from '../../../shared/Confirm.svelte'

  let plugins: AdminPluginConfigEntry[] = $state([])
  let drafts: Record<string, string> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let pendingClear: { pluginId: string; key: string; required: boolean } | null = $state(null)
  let clearing = $state(false)
  let clearError = $state<string | null>(null)

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

  async function confirmClear(): Promise<void> {
    const p = pendingClear
    if (p === null || clearing) return
    clearError = null
    clearing = true
    let ok = false
    try {
      await unsetAdminPluginConfig({ pluginId: p.pluginId, key: p.key })
      ok = true
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = null
      await load()
      status = `${p.pluginId} / ${p.key} cleared.`
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="plugin-config" class="settings-section">
  <PageHeader eyebrow="Admin · Plugins" title="Plugin config">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="plugin-config-refresh" />
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
              <span class="t-label settings-field__label">{keyState.label}</span>
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
                {#if keyState.value !== null}
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`plugin-config-clear-${plugin.pluginId}-${keyState.key}`}
                    onClick={() => {
                      pendingClear = { pluginId: plugin.pluginId, key: keyState.key, required: keyState.required }
                      clearError = null
                    }}>
                    {#snippet children()}Clear{/snippet}
                  </Btn>
                {/if}
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

  <Confirm
    open={pendingClear !== null}
    title="Clear plugin config value"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = null)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Clear the stored value for this field?{pendingClear?.required ? ' This field is required — clearing it will make the plugin ineligible for this context.' : ' The field will revert to its default (unset).'}</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
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
