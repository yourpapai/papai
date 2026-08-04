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
  import { groupSummary, groupToolEntries } from '../lib/group-tools.js'

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
  let applying = $state(false)
  let clearing = $state(false)

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
    pendingClear = false
    applying = false
    clearing = false
    try {
      const res = await fetchToolsFn(id)
      if (id !== contextId) return
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === contextId) loading = false
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

  async function onSetGroupPermission(domain: string, group: string, summary: ToolDomainSummary): Promise<void> {
    error = null
    const permission = nextDomainPermission(summary)
    try {
      const res = await setToolPermissionFn({ kind: 'group', domain, group, permission, contextId })
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
    if (applying || clearing) return
    error = null
    pendingClear = false
    pendingPreset = preset
  }

  async function confirmPreset(): Promise<void> {
    const preset = pendingPreset
    if (preset === null || applying || clearing) return
    error = null
    applying = true
    try {
      const res = await applyToolPresetFn({ preset, contextId })
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      applying = false
      pendingPreset = null
    }
  }

  async function confirmClear(): Promise<void> {
    if (clearPresetFn === undefined || clearing || applying) return
    error = null
    clearing = true
    try {
      const res = await clearPresetFn()
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
      pendingClear = false
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
    <span class="settings-tools__presets-label">
      Preset: <span data-testid="preset-active">{activePreset === null ? 'Custom' : presetLabel(activePreset)}</span>
    </span>
    {#each PRESET_OPTIONS as preset (preset.value)}
      {@const active = activePreset === preset.value}
      <span class="settings-tools__preset" class:settings-tools__preset--active={active}>
        <Btn
          variant="outline"
          size="sm"
          busy={applying || clearing}
          disabled={applying || clearing}
          ariaPressed={active}
          testid={`preset-${preset.value}`}
          onClick={() => requestPreset(preset.value)}>
          {#snippet children()}{#if active}<span aria-hidden="true">✓ </span>{/if}{preset.label}{/snippet}
        </Btn>
      </span>
    {/each}
  </div>
  <p class="settings-tools__presets-hint">New tools follow the selected preset by their risk level.</p>

  {#if pendingPreset !== null}
    <div class="settings-tools__confirm" data-testid="preset-confirm">
      <span>Apply "{presetLabel(pendingPreset)}"? This replaces your per-tool and per-domain settings.</span>
      <Btn
        variant="primary"
        size="sm"
        busy={applying}
        disabled={applying}
        testid="preset-confirm-apply"
        onClick={() => void confirmPreset()}>
        {#snippet children()}{applying ? 'Applying…' : 'Apply'}{/snippet}
      </Btn>
      <Btn
        variant="ghost"
        size="sm"
        disabled={applying}
        testid="preset-confirm-cancel"
        onClick={() => (pendingPreset = null)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}

  {#if clearPresetFn !== undefined && storedDefaults && !pendingClear && pendingPreset === null}
    <div class="settings-tools__clear-row">
      <Btn
        variant="ghost"
        size="sm"
        disabled={applying || clearing}
        testid="tool-defaults-clear"
        onClick={() => { pendingPreset = null; pendingClear = true }}>
        {#snippet children()}Clear admin defaults{/snippet}
      </Btn>
    </div>
  {/if}

  {#if pendingClear}
    <div class="settings-tools__confirm" data-testid="tool-defaults-clear-confirm">
      <span>Clear all admin default tool permissions? Contexts will revert to the allow-all baseline.</span>
      <Btn
        variant="danger"
        size="sm"
        busy={clearing}
        disabled={clearing}
        testid="tool-defaults-clear-confirm-apply"
        onClick={() => void confirmClear()}>
        {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
      </Btn>
      <Btn
        variant="ghost"
        size="sm"
        disabled={clearing}
        testid="tool-defaults-clear-confirm-cancel"
        onClick={() => (pendingClear = false)}>
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
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain} ({domain.tools.length})
            </button>
            <span data-testid={`domain-summary-${domain.domain}`}>
              <Pill tone={summaryTone(domain.summary)}>{#snippet children()}{domain.summary}{/snippet}</Pill>
            </span>
            <span class="settings-tools__domain-toggle">
              <Btn
                variant="outline"
                size="sm"
                disabled={applying || clearing}
                testid={`domain-toggle-${domain.domain}`}
                onClick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
                {#snippet children()}{domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
              </Btn>
            </span>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each groupToolEntries(domain.tools) as toolGroup (toolGroup.group ?? '')}
                {#if toolGroup.group !== null}
                  {@const groupName = toolGroup.group}
                  {@const summary = groupSummary(toolGroup.tools)}
                  <li class="settings-tools__group-head" data-testid={`group-head-${groupName}`}>
                    <span class="settings-tools__group-name">{groupName} ({toolGroup.tools.length})</span>
                    <Pill tone={summaryTone(summary)}>{#snippet children()}{summary}{/snippet}</Pill>
                    <span class="settings-tools__group-toggle">
                      <Btn
                        variant="outline"
                        size="sm"
                        disabled={applying || clearing}
                        testid={`group-toggle-${groupName}`}
                        onClick={() => void onSetGroupPermission(domain.domain, groupName, summary)}>
                        {#snippet children()}{summary === 'deny' ? 'Allow all' : summary === 'ask' ? 'Deny all' : summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
                      </Btn>
                    </span>
                  </li>
                {/if}
                {#each toolGroup.tools as tool (tool.name)}
                  <li class="settings-tools__tool" class:settings-tools__tool--grouped={toolGroup.group !== null}>
                    <span class="settings-tools__name">{tool.name}</span>
                    <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                    <div class="settings-tools__perm">
                      <SegmentedControl
                        options={PERM_OPTIONS}
                        value={tool.permission}
                        ariaLabel={`Permission for ${tool.name}`}
                        disabled={applying || clearing}
                        onChange={(p) => void onSetToolPermission(tool.name, p as ToolPermission)}
                        testidPrefix={`tool-perm-${tool.name}`} />
                    </div>
                  </li>
                {/each}
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if error === null}
    <EmptyState title="No togglable tools" hint="No tools are available for this context yet. Tools appear here once a task provider or plugin is configured.">
      {#snippet action()}
        <Btn variant="outline" size="sm" testid="tools-empty-refresh" onClick={() => void load(contextId)}>
          {#snippet children()}Refresh{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
  {/if}
</section>

<style>
  .settings-tools {
    display: grid;
    gap: 8px;
  }
  .settings-tools__domain {
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s3);
    flex-wrap: wrap;
  }
  .settings-tools__expand {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-height: var(--control-h-sm);
    padding: 0 var(--s1);
    background: none;
    border: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .settings-tools__list {
    list-style: none;
    margin: 0;
    padding: 0 var(--s3) var(--s3);
    display: grid;
    gap: var(--s2);
  }
  .settings-tools__tool {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  .settings-tools__name {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-tools__domain-toggle {
    margin-left: auto;
  }
  .settings-tools__group-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding-top: var(--s2);
    border-top: 1px solid var(--border);
  }
  .settings-tools__group-name {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
  .settings-tools__group-toggle {
    margin-left: auto;
  }
  .settings-tools__tool--grouped {
    padding-left: var(--s4);
  }
  .settings-tools__perm { margin-left: auto; }
  .settings-tools__presets {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    margin-bottom: var(--s2);
  }
  .settings-tools__presets-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
  .settings-tools__preset--active :global(.ui-btn) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .settings-tools__presets-hint {
    margin: 0 0 var(--s3);
    font-size: 11px;
    color: var(--text-dim);
  }
  .settings-tools__confirm {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    padding: var(--s2) var(--s3);
    margin-bottom: var(--s3);
    border: 1px solid var(--border);
    background: var(--surface-1);
    font-size: 12px;
  }
  .settings-tools__clear-row {
    display: flex;
    margin-bottom: var(--s3);
  }
</style>
