<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import SegmentedControl from '../../shared/ui/SegmentedControl.svelte'

  import type {
    ToolDomainSummary,
    ToolDomainView,
    ToolPermission,
    ToolPreset,
    ToolRisk,
    ToolsResponse,
  } from '../fetcher-schemas-tools.js'
  import { applyToolPreset, fetchTools, setToolPermission } from '../fetchers.js'

  const PERM_OPTIONS = [
    { value: 'allow', label: 'Allow' },
    { value: 'ask', label: 'Ask' },
    { value: 'deny', label: 'Deny' },
  ] as const

  const PRESET_OPTIONS = [
    { value: 'read-only', label: 'Read-only' },
    { value: 'non-destructive', label: 'Non-destructive' },
    { value: 'allow-all', label: 'Allow all' },
  ] as const

  const presetLabel = (preset: ToolPreset): string =>
    PRESET_OPTIONS.find((p) => p.value === preset)?.label ?? preset

  type SetToolPermissionInput = Parameters<typeof setToolPermission>[0]

  interface Props {
    contextId: string
    sectionId?: string
    eyebrow?: string
    title?: string
    fetchToolsFn?: (contextId: string) => Promise<ToolsResponse>
    setToolPermissionFn?: (input: SetToolPermissionInput) => Promise<ToolsResponse>
    applyToolPresetFn?: (input: { preset: ToolPreset; contextId: string }) => Promise<ToolsResponse>
    clearPresetFn?: () => Promise<ToolsResponse>
    hasStoredDefaults?: boolean
  }

  let {
    contextId,
    sectionId = 'tools',
    eyebrow = 'Personal',
    title = 'Tools',
    fetchToolsFn = fetchTools,
    setToolPermissionFn = setToolPermission,
    applyToolPresetFn = applyToolPreset,
    clearPresetFn = undefined,
    hasStoredDefaults = false,
  }: Props = $props()

  let domains: ToolDomainView[] = $state([])
  let expanded: Record<string, boolean> = $state({})
  let error: string | null = $state(null)
  let loading = $state(false)
  let activePreset: ToolPreset | null = $state(null)
  let storedDefaults = $state(hasStoredDefaults)
  let pendingPreset: ToolPreset | null = $state(null)
  let pendingClear = $state(false)

  const riskTone = (risk: ToolRisk): 'mute' | 'info' | 'warn' | 'danger' => {
    if (risk === 'read') return 'mute'
    if (risk === 'write') return 'info'
    if (risk === 'open-world') return 'warn'
    return 'danger'
  }

  const summaryTone = (s: ToolDomainSummary): 'accent' | 'warn' | 'danger' | 'mute' => {
    if (s === 'allow') return 'accent'
    if (s === 'ask') return 'warn'
    if (s === 'deny') return 'danger'
    return 'mute'
  }

  /** Cycle summary: partial → allow → ask → deny → allow */
  const nextDomainPermission = (summary: ToolDomainSummary): ToolPermission => {
    if (summary === 'partial' || summary === 'deny') return 'allow'
    if (summary === 'allow') return 'ask'
    return 'deny'
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    expanded = {}
    pendingPreset = null
    try {
      const res = await fetchToolsFn(id)
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onSetDomainPermission(domain: string, summary: ToolDomainSummary): Promise<void> {
    error = null
    const permission = nextDomainPermission(summary)
    try {
      const res = await setToolPermissionFn({ kind: 'domain', domain, permission, contextId })
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function onSetToolPermission(tool: string, permission: ToolPermission): Promise<void> {
    error = null
    try {
      const res = await setToolPermissionFn({ kind: 'tool', tool, permission, contextId })
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function requestPreset(preset: ToolPreset): void {
    error = null
    pendingPreset = preset
  }

  async function confirmPreset(): Promise<void> {
    const preset = pendingPreset
    if (preset === null) return
    pendingPreset = null
    error = null
    try {
      const res = await applyToolPresetFn({ preset, contextId })
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function confirmClear(): Promise<void> {
    if (clearPresetFn === undefined) return
    pendingClear = false
    error = null
    try {
      const res = await clearPresetFn()
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id={sectionId} class="settings-section">
  <PageHeader eyebrow={eyebrow} title={title}>
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="tools-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <div class="settings-tools__presets" data-testid="tools-presets">
    <span class="settings-tools__presets-label">Preset</span>
    {#each PRESET_OPTIONS as preset (preset.value)}
      <Btn
        variant={activePreset === preset.value ? 'primary' : 'ghost'}
        size="sm"
        testid={`preset-${preset.value}`}
        onClick={() => requestPreset(preset.value)}>
        {#snippet children()}{preset.label}{/snippet}
      </Btn>
    {/each}
    <span class="settings-tools__presets-active" data-testid="preset-active">
      <Pill tone="mute">{#snippet children()}{activePreset === null ? 'Custom' : presetLabel(activePreset)}{/snippet}</Pill>
    </span>
  </div>
  <p class="settings-tools__presets-hint">New tools follow the selected preset by their risk level.</p>

  {#if pendingPreset !== null}
    <div class="settings-tools__confirm" data-testid="preset-confirm">
      <span>Apply "{presetLabel(pendingPreset)}"? This replaces your per-tool and per-domain settings.</span>
      <Btn variant="primary" size="sm" testid="preset-confirm-apply" onClick={() => void confirmPreset()}>
        {#snippet children()}Apply{/snippet}
      </Btn>
      <Btn variant="ghost" size="sm" testid="preset-confirm-cancel" onClick={() => (pendingPreset = null)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}

  {#if clearPresetFn !== undefined && storedDefaults && !pendingClear}
    <div class="settings-tools__clear-row">
      <Btn variant="ghost" size="sm" testid="tool-defaults-clear" onClick={() => (pendingClear = true)}>
        {#snippet children()}Clear admin defaults{/snippet}
      </Btn>
    </div>
  {/if}

  {#if pendingClear}
    <div class="settings-tools__confirm" data-testid="tool-defaults-clear-confirm">
      <span>Clear all admin default tool permissions? Contexts will revert to the allow-all baseline.</span>
      <Btn variant="danger" size="sm" testid="tool-defaults-clear-confirm-apply" onClick={() => void confirmClear()}>
        {#snippet children()}Clear{/snippet}
      </Btn>
      <Btn variant="ghost" size="sm" testid="tool-defaults-clear-confirm-cancel" onClick={() => (pendingClear = false)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}

  {#if domains.length > 0}
    <div class="settings-tools">
      {#each domains as domain (domain.domain)}
        <div class="settings-tools__domain">
          <div class="settings-tools__domain-head">
            <button
              type="button"
              class="settings-tools__expand"
              data-testid={`domain-expand-${domain.domain}`}
              aria-expanded={expanded[domain.domain] === true}
              onclick={() => (expanded[domain.domain] = !expanded[domain.domain])}>
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain}
            </button>
            <span data-testid={`domain-summary-${domain.domain}`}>
              <Pill tone={summaryTone(domain.summary)}>{#snippet children()}{domain.summary}{/snippet}</Pill>
            </span>
            <span class="settings-tools__domain-toggle">
              <Btn variant="ghost" size="sm" testid={`domain-toggle-${domain.domain}`} onClick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
                {#snippet children()}{domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
              </Btn>
            </span>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                <li class="settings-tools__tool">
                  <span class="settings-tools__name">{tool.name}</span>
                  <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                  <div class="settings-tools__perm">
                    <SegmentedControl
                      options={PERM_OPTIONS}
                      value={tool.permission}
                      ariaLabel={`Permission for ${tool.name}`}
                      onChange={(p) => void onSetToolPermission(tool.name, p as ToolPermission)}
                      testidPrefix={`tool-perm-${tool.name}`} />
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if error === null}
    <EmptyState title="No togglable tools" hint="No togglable tools for this context." />
  {/if}
</section>

<style>
  .settings-tools {
    display: grid;
    gap: 8px;
  }
  .settings-tools__domain {
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
  }
  .settings-tools__expand {
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .settings-tools__list {
    list-style: none;
    margin: 0;
    padding: 0 10px 10px;
    display: grid;
    gap: 6px;
  }
  .settings-tools__tool {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .settings-tools__name {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-tools__domain-toggle {
    margin-left: auto;
  }
  .settings-tools__perm { margin-left: auto; }
  .settings-tools__presets {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .settings-tools__presets-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg2);
  }
  .settings-tools__presets-active {
    margin-left: auto;
  }
  .settings-tools__presets-hint {
    margin: 0 0 12px;
    font-size: 11px;
    color: var(--fg3);
  }
  .settings-tools__confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 12px;
  }
</style>
