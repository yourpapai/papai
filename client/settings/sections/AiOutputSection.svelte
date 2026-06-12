<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  // Unset keys come back as value: ''. Display the first option (the default) so the
  // control is never rendered in an indeterminate state.
  const visible = $derived(
    fields
      .filter((field) => field.kind === 'ai-output')
      .map((field) => ({
        ...field,
        value: field.value === '' ? (field.options?.[0]?.value ?? '') : field.value,
      })),
  )

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      fields = (await fetchConfig(id)).fields
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="ai-output" class="settings-section">
  <PageHeader eyebrow="Personal" title="AI output">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="ai-output-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No AI output settings" hint="This context has no editable AI output settings." />
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
      {#if visible.some((field) => field.key === 'ai_output_detail_level')}
        <p class="ai-output-hint">Raw detail shows unredacted tool inputs/outputs and reasoning in chat.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .ai-output-hint {
    color: var(--fg2);
    font-size: 12px;
  }
</style>
