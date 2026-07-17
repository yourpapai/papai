<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchModuleSections, patchModuleSection, unsetModuleSection } from '../../admin-fetchers.js'
  import type { ModuleSection } from '../../fetcher-schemas-module-sections.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Secret from '../../../shared/ui/Secret.svelte'
  import Confirm from '../../../shared/Confirm.svelte'
  import SettingsFieldShell from '../../components/SettingsFieldShell.svelte'

  let sections: ModuleSection[] = $state([])
  let drafts: Record<string, string> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let pendingClear: { sectionId: string; key: string; required: boolean } | null = $state(null)
  let clearing = $state(false)
  let clearError = $state<string | null>(null)

  function draftKey(sectionId: string, key: string): string {
    return `${sectionId}::${key}`
  }

  async function load(): Promise<boolean> {
    error = null
    status = null
    loading = true
    try {
      sections = (await fetchModuleSections()).sections
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      loading = false
    }
  }

  async function save(sectionId: string, key: string): Promise<void> {
    error = null
    status = null
    const dk = draftKey(sectionId, key)
    const value = drafts[dk] ?? ''
    if (value.trim() === '') return
    try {
      await patchModuleSection({ id: sectionId, key, value })
      drafts[dk] = ''
      const ok = await load()
      if (ok) status = `${sectionId} / ${key} updated.`
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
      await unsetModuleSection({ id: p.sectionId, key: p.key })
      ok = true
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = null
      const reloaded = await load()
      if (reloaded) status = `${p.sectionId} / ${p.key} cleared.`
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="module-sections" class="settings-section">
  <PageHeader eyebrow="Admin · Modules" title="Module settings">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="module-sections-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#each sections as section (section.id)}
    <div class="module-block">
      <p class="module-block__id">{section.label}</p>
      <div class="settings-field-list">
        {#each section.fields as field (field.key)}
          {#if field.control === 'readonly-derived'}
            <SettingsFieldShell
              label={field.label}
              editorOpen={false}
              testid={`module-section-field-${section.id}-${field.key}`}>
              {#snippet head()}
                {#if field.value !== null}
                  {#if field.sensitive}
                    <Secret value={field.value} />
                  {:else}
                    <span class="derived-value">{field.value}</span>
                  {/if}
                {:else}
                  <span class="placeholder">unset</span>
                {/if}
                {#if field.required}<span class="badge-required">required</span>{/if}
              {/snippet}
            </SettingsFieldShell>
          {:else}
            <SettingsFieldShell
              label={field.label}
              testid={`module-section-field-${section.id}-${field.key}`}>
              {#snippet head()}
                {#if field.value !== null}
                  <Secret value={field.value} />
                {:else}
                  <span class="placeholder">unset</span>
                {/if}
                {#if field.required}<span class="badge-required">required</span>{/if}
              {/snippet}
              {#snippet editor()}
                <Input
                  type={field.sensitive ? 'password' : 'text'}
                  value={drafts[draftKey(section.id, field.key)] ?? ''}
                  placeholder="enter a new value"
                  onInput={(v) => (drafts[draftKey(section.id, field.key)] = v)}
                  testid={`module-section-input-${section.id}-${field.key}`} />
                <Btn
                  variant="primary"
                  size="sm"
                  testid={`module-section-save-${section.id}-${field.key}`}
                  disabled={(drafts[draftKey(section.id, field.key)] ?? '').trim() === ''}
                  onClick={() => void save(section.id, field.key)}>
                  {#snippet children()}Save{/snippet}
                </Btn>
                {#if field.value !== null}
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`module-section-clear-${section.id}-${field.key}`}
                    onClick={() => {
                      pendingClear = { sectionId: section.id, key: field.key, required: field.required }
                      clearError = null
                    }}>
                    {#snippet children()}Clear{/snippet}
                  </Btn>
                {/if}
              {/snippet}
            </SettingsFieldShell>
          {/if}
        {/each}
      </div>
    </div>
  {/each}

  {#if sections.length === 0 && !loading}
    <EmptyState title="No module settings" hint="No installed modules expose admin settings." />
  {/if}

  <Confirm
    open={pendingClear !== null}
    title="Clear module setting value"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = null)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Clear the stored value for this field?{pendingClear?.required ? ' This field is required — clearing it will make the module ineligible for this context.' : ' The field will revert to its default (unset).'}</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .module-block {
    margin-bottom: 16px;
  }
  .module-block__id {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg2);
    margin: 0 0 8px 0;
  }
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .badge-required {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .derived-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg2);
  }
</style>
