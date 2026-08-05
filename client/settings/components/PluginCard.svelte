<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { patchPluginConfig, togglePlugin } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

  interface Props {
    plugin: PluginEntry
    contextId: string
    onChanged: () => Promise<void>
    onRequestClear: (key: string, required: boolean) => void
    onError: (message: string | null) => void
  }

  let { plugin, contextId, onChanged, onRequestClear, onError }: Props = $props()

  let drafts: Record<string, string> = $state({})

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  const eligibilityLabel = (p: PluginEntry): string => {
    if (p.eligibility.eligible) return 'eligible'
    if (p.eligibility.reason === 'config_missing') return `config_missing: ${p.eligibility.missingKeys.join(', ')}`
    if (p.eligibility.reason === 'capability_missing') {
      return `capability_missing: ${p.eligibility.missingCapabilities.join(', ')}`
    }
    return p.eligibility.reason
  }

  const eligTone = (p: PluginEntry): 'accent' | 'warn' | 'mute' => {
    if (p.eligibility.eligible) return 'accent'
    if (p.eligibility.reason === 'inactive' || p.eligibility.reason === 'disabled') return 'mute'
    return 'warn'
  }

  async function toggle(): Promise<void> {
    onError(null)
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await onChanged()
    } catch (err) {
      onError(message(err))
    }
  }

  async function saveConfig(key: string): Promise<void> {
    onError(null)
    const value = drafts[key] ?? ''
    const cfg = plugin.contextConfig.find((c) => c.key === key)
    if (cfg?.required === true && value.trim() === '') {
      onError(`${cfg.label} is required.`)
      return
    }
    try {
      await patchPluginConfig({ pluginId: plugin.id, key, value, contextId })
      drafts[key] = ''
      await onChanged()
    } catch (err) {
      onError(message(err))
    }
  }
</script>

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
      onClick={() => void toggle()}>
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
                value={drafts[cfg.key] ?? ''}
                placeholder={cfg.sensitive ? 'enter a new value' : ''}
                onInput={(v) => (drafts[cfg.key] = v)} />
              <Btn
                variant="primary"
                size="sm"
                testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                onClick={() => void saveConfig(cfg.key)}>
                {#snippet children()}Save{/snippet}
              </Btn>
              {#if cfg.hasValue}
                <Btn
                  variant="ghost"
                  size="sm"
                  testid={`plugin-cfg-clear-${plugin.id}-${cfg.key}`}
                  onClick={() => onRequestClear(cfg.key, cfg.required)}>
                  {#snippet children()}Clear{/snippet}
                </Btn>
              {/if}
            </div>
          {/snippet}
        </Field>
      {/each}
    </div>
  {/if}
</div>

<style>
  .settings-plugins__card {
    border: 1px solid var(--border);
    background: var(--surface-1);
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
