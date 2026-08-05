<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { PluginConfigField, PluginEntry } from '../fetcher-schemas.js'
  import { patchPluginConfig, togglePlugin } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

  interface Props {
    plugin: PluginEntry
    contextId: string
    /** Awaited, so the card's controls stay busy across the parent's re-fetch. */
    onChanged: () => Promise<void>
    onRequestClear: (key: string, required: boolean) => void
  }

  let { plugin, contextId, onChanged, onRequestClear }: Props = $props()

  // How long a save acknowledgement stays on screen. Long enough to notice, short
  // enough that it never reads as persistent state. Mirrors ConfigFieldRow.
  const NOTE_VISIBLE_MS = 2000
  const SAVED_NOTE = '✓ Saved'
  const UNCHANGED_NOTE = 'No change — the stored value was the same'

  let drafts: Record<string, string> = $state({})
  let fieldErrors: Record<string, string> = $state({})
  let savingKeys: Record<string, boolean> = $state({})
  let notes: Record<string, string> = $state({})
  let toggling = $state(false)
  let cardError: string | null = $state(null)

  const noteTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

  // The card writes in place with no submit-and-navigate step, so without an explicit
  // acknowledgement a completed save is indistinguishable from a control never touched.
  function markNote(key: string, text: string): void {
    notes[key] = text
    const existing = noteTimers.get(key)
    if (existing !== undefined) clearTimeout(existing)
    noteTimers.set(
      key,
      setTimeout(() => {
        delete notes[key]
        noteTimers.delete(key)
      }, NOTE_VISIBLE_MS),
    )
  }

  $effect(() => () => {
    for (const timer of noteTimers.values()) clearTimeout(timer)
    noteTimers.clear()
  })

  // Re-sync edit state when the parent re-fetches: a sensitive field's editor baseline
  // is '' (the masked stored value is never a draft), everything else shows what is stored.
  $effect(() => {
    const fields = plugin.contextConfig
    untrack(() => {
      const next: Record<string, string> = {}
      for (const f of fields) next[f.key] = f.sensitive ? '' : f.value
      drafts = next
      fieldErrors = {}
    })
  })

  async function toggle(): Promise<void> {
    if (toggling) return
    cardError = null
    toggling = true
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await onChanged()
    } catch (err) {
      cardError = message(err)
    } finally {
      toggling = false
    }
  }

  async function saveConfig(cfg: PluginConfigField): Promise<void> {
    if (savingKeys[cfg.key] === true) return
    cardError = null
    const value = drafts[cfg.key] ?? ''
    delete fieldErrors[cfg.key]
    if (cfg.required && value.trim() === '') {
      fieldErrors[cfg.key] = `${cfg.label} is required.`
      return
    }
    savingKeys[cfg.key] = true
    try {
      const result = await patchPluginConfig({ pluginId: plugin.id, key: cfg.key, value, contextId })
      markNote(cfg.key, result.unchanged === true ? UNCHANGED_NOTE : SAVED_NOTE)
      await onChanged()
    } catch (err) {
      fieldErrors[cfg.key] = message(err)
    } finally {
      savingKeys[cfg.key] = false
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
      busy={toggling}
      disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
      onClick={() => void toggle()}>
      {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>
  {#if cardError !== null}
    <p class="status-error" role="alert" data-testid={`plugin-card-error-${plugin.id}`}>{cardError}</p>
  {/if}
  {#if plugin.contextConfig.length > 0}
    <div class="settings-plugins__cfg">
      {#each plugin.contextConfig as cfg (cfg.key)}
        <div class="settings-plugins__cfg-field" data-testid={`plugin-cfg-row-${plugin.id}-${cfg.key}`}>
          <Field
            label={`${cfg.label}${cfg.required ? ' *' : ''}${cfg.hasValue ? ' (set)' : ''}`}
            error={fieldErrors[cfg.key]}>
            {#snippet children()}
              <div class="settings-plugins__cfg-row">
                <Input
                  type={cfg.sensitive ? 'password' : 'text'}
                  value={drafts[cfg.key] ?? ''}
                  placeholder={cfg.sensitive ? 'enter a new value' : ''}
                  testid={`plugin-cfg-input-${plugin.id}-${cfg.key}`}
                  onInput={(v) => (drafts[cfg.key] = v)} />
                <Btn
                  variant="primary"
                  size="sm"
                  testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                  busy={savingKeys[cfg.key] === true}
                  onClick={() => void saveConfig(cfg)}>
                  {#snippet children()}{savingKeys[cfg.key] === true ? 'Saving…' : 'Save'}{/snippet}
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
                {#if notes[cfg.key] !== undefined}
                  <span class="settings-plugins__note" role="status" data-testid={`plugin-cfg-note-${plugin.id}-${cfg.key}`}>{notes[cfg.key]}</span>
                {/if}
              </div>
            {/snippet}
          </Field>
        </div>
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
  .settings-plugins__note {
    color: var(--success);
    font-size: 11px;
    white-space: nowrap;
  }
</style>
