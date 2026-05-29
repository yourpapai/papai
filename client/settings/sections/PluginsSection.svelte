<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { fetchPlugins, patchPluginConfig, togglePlugin } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let drafts: Record<string, string> = $state({})

  const eligibilityLabel = (plugin: PluginEntry): string => {
    if (plugin.eligibility.eligible) return 'eligible'
    if (plugin.eligibility.reason === 'config_missing') {
      return `config_missing: ${plugin.eligibility.missingKeys.join(', ')}`
    }
    if (plugin.eligibility.reason === 'capability_missing') {
      return `capability_missing: ${plugin.eligibility.missingCapabilities.join(', ')}`
    }
    return plugin.eligibility.reason
  }

  const draftKey = (pluginId: string, key: string): string => `${pluginId}::${key}`

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      plugins = (await fetchPlugins(id)).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function toggle(plugin: PluginEntry): Promise<void> {
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function saveConfig(pluginId: string, key: string): Promise<void> {
    try {
      await patchPluginConfig({ pluginId, key, value: drafts[draftKey(pluginId, key)] ?? '', contextId })
      drafts[draftKey(pluginId, key)] = ''
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="plugins" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Plugins</p>
      <h2>Plugins</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  {#if loading && plugins.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if !loading && error === null && plugins.length === 0}
    <p class="placeholder">No plugins discovered.</p>
  {/if}

  {#if plugins.length > 0}
    <div class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <div class="settings-plugins__card">
          <div class="settings-plugins__head">
            <span class="settings-plugins__name">{plugin.name}</span>
            <span class="settings-plugins__elig">{eligibilityLabel(plugin)}</span>
            <button
              type="button"
              data-testid={`plugin-toggle-${plugin.id}`}
              disabled={!plugin.active}
              onclick={() => void toggle(plugin)}>
              {plugin.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          {#if plugin.contextConfig.length > 0}
            <div class="settings-plugins__cfg">
              {#each plugin.contextConfig as cfg (cfg.key)}
                <label>
                  <span>{cfg.label}{cfg.required ? ' *' : ''}{cfg.hasValue ? ' (set)' : ''}</span>
                  <input
                    type={cfg.sensitive ? 'password' : 'text'}
                    value={drafts[draftKey(plugin.id, cfg.key)] ?? ''}
                    placeholder={cfg.sensitive ? 'enter a new value' : ''}
                    oninput={(e) => (drafts[draftKey(plugin.id, cfg.key)] = (e.target as HTMLInputElement).value)} />
                  <button
                    type="button"
                    data-testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                    onclick={() => void saveConfig(plugin.id, cfg.key)}>Save</button>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-plugins {
    display: grid;
    gap: 12px;
  }
  .settings-plugins__card {
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 12px;
    display: grid;
    gap: 10px;
  }
  .settings-plugins__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .settings-plugins__name {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .settings-plugins__elig {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-plugins__head button {
    margin-left: auto;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
  .settings-plugins__cfg {
    display: grid;
    gap: 10px;
  }
  .settings-plugins__cfg label {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-plugins__cfg span {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    min-width: 140px;
  }
  .settings-plugins__cfg input {
    flex: 1;
    min-width: 180px;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
  .settings-plugins__cfg button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
</style>
