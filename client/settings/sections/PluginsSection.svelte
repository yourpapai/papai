<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { fetchPlugins, patchPluginConfig, togglePlugin } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

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

  const eligTone = (plugin: PluginEntry): 'accent' | 'warn' | 'mute' => {
    if (plugin.eligibility.eligible) return 'accent'
    if (plugin.eligibility.reason === 'inactive' || plugin.eligibility.reason === 'disabled') return 'mute'
    return 'warn'
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
    error = null
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function saveConfig(pluginId: string, key: string): Promise<void> {
    error = null
    const value = drafts[draftKey(pluginId, key)] ?? ''
    const plugin = plugins.find((p) => p.id === pluginId)
    const cfg = plugin?.contextConfig.find((c) => c.key === key)
    if (cfg?.required === true && value.trim() === '') {
      error = `${cfg.label} is required.`
      return
    }
    try {
      await patchPluginConfig({ pluginId, key, value, contextId })
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
  <PageHeader title="Plugins">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load(contextId)}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  {#if loading && plugins.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if !loading && error === null && plugins.length === 0}
    <EmptyState title="No plugins discovered" />
  {/if}

  {#if plugins.length > 0}
    <div class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <div class="settings-plugins__card">
          <div class="settings-plugins__head">
            <span class="settings-plugins__name">{plugin.name}</span>
            <span class="settings-plugins__elig">
              <Pill tone={eligTone(plugin)}>{#snippet children()}{eligibilityLabel(plugin)}{/snippet}</Pill>
            </span>
            <Btn
              variant="secondary"
              size="sm"
              testid={`plugin-toggle-${plugin.id}`}
              disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
              onClick={() => void toggle(plugin)}>
              {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
            </Btn>
          </div>
          {#if plugin.contextConfig.length > 0}
            <div class="settings-plugins__cfg">
              {#each plugin.contextConfig as cfg (cfg.key)}
                <Field label={`${cfg.label}${cfg.required ? ' *' : ''}${cfg.hasValue ? ' (set)' : ''}`}>
                  {#snippet children()}
                    <div class="settings-plugins__cfg-row">
                      <Input
                        type={cfg.sensitive ? 'password' : 'text'}
                        value={drafts[draftKey(plugin.id, cfg.key)] ?? ''}
                        placeholder={cfg.sensitive ? 'enter a new value' : ''}
                        onInput={(v) => (drafts[draftKey(plugin.id, cfg.key)] = v)} />
                      <Btn
                        variant="primary"
                        size="sm"
                        testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                        onClick={() => void saveConfig(plugin.id, cfg.key)}>
                        {#snippet children()}Save{/snippet}
                      </Btn>
                    </div>
                  {/snippet}
                </Field>
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
  .settings-plugins__cfg {
    display: grid;
    gap: 10px;
  }
  .settings-plugins__cfg-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-plugins__cfg-row :global(.ui-input) {
    flex: 1;
    min-width: 0;
  }
</style>
