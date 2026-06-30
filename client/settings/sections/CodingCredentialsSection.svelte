<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import type { CodingCredentialField, CodingCredentialsResponse } from '../fetcher-schemas.js'
  import { fetchCodingCredentials, patchCodingCredentials } from '../fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'

  // Client-side compatibility map (mirrors src/coding-credentials/types.ts `compatible`)
  function compatibleProviders(agent: string, allProviders: readonly string[]): string[] {
    if (agent === 'claude') return allProviders.filter((p) => p === 'anthropic')
    if (agent === 'codex') return allProviders.filter((p) => p === 'openai' || p === 'openai-compatible')
    if (agent === 'opencode')
      return allProviders.filter((p) => p === 'anthropic' || p === 'openai' || p === 'openai-compatible')
    return [...allProviders]
  }

  interface Props {
    contextId: string
  }
  let { contextId }: Props = $props()

  let data: CodingCredentialsResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const fields = $derived(currentData?.fields ?? [])
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  // Track current agent draft for filtering provider options
  const agentField = $derived(fields.find((f) => f.key === 'agent'))
  const currentAgent = $derived(drafts['agent'] ?? agentField?.value ?? '')

  // Track current provider draft to surface base-URL-required hint for openai-compatible
  const providerField = $derived(fields.find((f) => f.key === 'provider'))
  const currentProvider = $derived(drafts['provider'] ?? providerField?.value ?? '')
  const isOpenAiCompatible = $derived(currentProvider === 'openai-compatible')

  function selectOptionsFor(field: CodingCredentialField): string[] {
    const opts = field.options ?? []
    if (field.key === 'agent') {
      const allowed = currentData?.allowedAgents
      return allowed !== undefined && allowed.length > 0 ? opts.filter((o) => allowed.includes(o)) : opts
    }
    if (field.key === 'provider' && currentAgent.length > 0) {
      return compatibleProviders(currentAgent, opts)
    }
    return opts
  }

  function initialDrafts(nextFields: CodingCredentialField[]): Record<string, string> {
    return Object.fromEntries(nextFields.map((f) => [f.key, f.sensitive && f.hasValue ? '' : f.value]))
  }
  function displaySecret(value: string): string {
    return value.includes('*') ? maskSecret(value) : '••••••••'
  }
  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id)
      if (id !== contextId) return
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === contextId) loading = false
    }
  }
  function updateDraft(key: string, value: string): void {
    drafts = { ...drafts, [key]: value }
  }
  function replaceSecret(key: string): void {
    replacing = { ...replacing, [key]: true }
    updateDraft(key, '')
  }
  function cancelReplace(key: string): void {
    const { [key]: _, ...rest } = replacing
    replacing = rest
    updateDraft(key, '')
  }
  function editorOpen(field: CodingCredentialField): boolean {
    return !field.sensitive || replacing[field.key] === true || !field.hasValue
  }
  // Selecting a value only updates the local draft — nothing persists until Save.
  // When the agent changes and the current provider is no longer compatible, reset
  // the provider draft to the first compatible option so the whole-record save is
  // always internally consistent (never sends an invalid agent/provider pair).
  function onSelectChange(field: CodingCredentialField, value: string): void {
    updateDraft(field.key, value)
    if (field.key === 'agent') {
      const compatible = compatibleProviders(value, fields.find((f) => f.key === 'provider')?.options ?? [])
      const currentProvider = drafts['provider'] ?? ''
      if (compatible.length > 0 && !compatible.includes(currentProvider)) {
        updateDraft('provider', compatible[0]!)
      }
    }
  }

  // Whole-record save: agent/provider/base-URL are validated together server-side, so
  // persist them in one PATCH. Saving fields individually hits the route's cross-field
  // 422 (e.g. openai-compatible before its base URL) and silently drops the field.
  function collectValues(): Record<string, string> {
    const values: Record<string, string> = {}
    for (const field of fields) {
      // Preserve an untouched secret: omit it so the server keeps the stored value.
      if (field.sensitive && field.hasValue && replacing[field.key] !== true) continue
      values[field.key] = drafts[field.key] ?? ''
    }
    return values
  }
  async function saveAll(): Promise<void> {
    if (loading || saving || loadedContextId !== contextId) return
    error = null
    status = null
    saving = true
    try {
      await patchCodingCredentials({ contextId, values: collectValues() })
      await load(contextId)
      status = 'AI provider saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })
</script>

<section id="coding-credentials" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="AI provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="coding-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error">Stored credentials are unreadable. Re-enter your key to repair this context.</p>
    {/if}
    {#if !currentData.complete}
      <p class="placeholder">
        Coding sessions need your model-provider API key. Enter it below — it is encrypted and used only to run your sessions.
      </p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        {@const effectiveRequired = field.required || (field.key === 'provider_base_url' && isOpenAiCompatible)}
        <div class="settings-field" data-testid={`coding-row-${field.key}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{field.label}{effectiveRequired ? ' *' : ''}</span>
            {#if field.sensitive && field.hasValue && !editorOpen(field)}
              <Secret value={displaySecret(field.value)} />
              <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
          </div>
          {#if field.control === 'select'}
            <div class="settings-field__editor">
              <Field label="Value">
                {#snippet children()}
                  <select
                    data-testid={`coding-select-${field.key}`}
                    value={drafts[field.key] ?? ''}
                    disabled={saving || loading}
                    onchange={(e) => onSelectChange(field, (e.currentTarget as HTMLSelectElement).value)}
                    class="coding-select">
                    {#each selectOptionsFor(field) as opt (opt)}
                      <option value={opt}>{opt}</option>
                    {/each}
                  </select>
                {/snippet}
              </Field>
            </div>
          {:else if editorOpen(field)}
            <div class="settings-field__editor">
              <Field label={field.sensitive ? 'New value' : 'Value'}>
                {#snippet children()}
                  <Input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[field.key] ?? ''}
                    placeholder={field.sensitive
                      ? 'enter a new value'
                      : field.key === 'provider_base_url' && isOpenAiCompatible
                        ? 'https://your-llm-endpoint/v1 (required)'
                        : ''}
                    onInput={(value) => updateDraft(field.key, value)}
                    testid={`coding-input-${field.key}`} />
                {/snippet}
              </Field>
              {#if field.sensitive && field.hasValue}
                <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                  {#snippet children()}Cancel{/snippet}
                </Btn>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <div class="settings-field__actions">
        <Btn
          variant="primary"
          size="sm"
          testid="coding-credentials-save"
          disabled={saving || loading}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}
</section>

<style>
  .settings-byok-fields {
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
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-field) {
    flex: 1;
    min-width: 200px;
  }
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
  }
  .coding-select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 14px;
  }
</style>
