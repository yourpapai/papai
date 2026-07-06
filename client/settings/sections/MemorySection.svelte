<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import { statusTone } from '../../shared/ui/status-tone.js'

  import type { MemoryRecordView, MemoryResponse } from '../fetcher-schemas.js'
  import {
    archiveMemoryRecord,
    clearMemory,
    fetchMemory,
    setMemoryCapture,
    updateMemoryProfile,
  } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let memory: MemoryResponse | null = $state(null)
  let profileDraft = $state('')
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let savingProfile = $state(false)
  let togglingCapture = $state(false)
  let archivingId: string | null = $state(null)
  let initialLoad = $state(true)
  let loadedContextId: string | null = $state(null)
  let pendingClear = $state(false)
  let clearing = $state(false)
  let clearError: string | null = $state(null)

  const currentMemory = $derived(loadedContextId === contextId ? memory : null)
  const scopeSub = $derived(
    currentMemory?.scopeType === 'group'
      ? "Durable facts learned from this group's chats, shared across all threads."
      : 'Durable facts the assistant learns from your chats to personalize replies.',
  )
  const activeRecords = $derived(currentMemory?.records.filter((record) => record.status === 'active') ?? [])
  const pendingRecords = $derived(currentMemory?.records.filter((record) => record.status === 'provisional') ?? [])

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function applyMemory(next: MemoryResponse): void {
    memory = next
    profileDraft = next.profile
    loadedContextId = next.contextId
  }

  function clearContextState(): void {
    memory = null
    profileDraft = ''
    loadedContextId = null
    pendingClear = false
  }

  function shortDate(value: string): string {
    return value.length >= 10 ? value.slice(0, 10) : value
  }

  function recordText(record: MemoryRecordView): string {
    return record.summary ?? record.content
  }

  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    if (id !== loadedContextId) clearContextState()
    loading = true
    try {
      const next = await fetchMemory(id)
      if (id !== contextId) return false
      applyMemory(next)
      initialLoad = false
      return true
    } catch (err) {
      if (id === contextId) {
        clearContextState()
        error = messageFrom(err)
        initialLoad = false
      }
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function toggleCapture(): Promise<void> {
    if (currentMemory === null) return
    error = null
    status = null
    togglingCapture = true
    try {
      await setMemoryCapture({ contextId, enabled: !currentMemory.enabled })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      togglingCapture = false
    }
  }

  async function saveProfile(): Promise<void> {
    error = null
    status = null
    savingProfile = true
    try {
      await updateMemoryProfile({ contextId, profile: profileDraft })
      if (await load(contextId)) status = 'Saved.'
    } catch (err) {
      error = messageFrom(err)
    } finally {
      savingProfile = false
    }
  }

  async function confirmClear(): Promise<void> {
    if (clearing) return
    clearError = null
    status = null
    clearing = true
    let ok = false
    try {
      await clearMemory({ contextId })
      ok = true
    } catch (err) {
      clearError = messageFrom(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = false
      await load(contextId)
    }
  }

  async function archiveRecord(id: string): Promise<void> {
    error = null
    status = null
    archivingId = id
    try {
      await archiveMemoryRecord(contextId, id)
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      archivingId = null
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      initialLoad = true
      void load(id)
    })
  })
</script>

<section id="memory" class="settings-section">
  <PageHeader
    eyebrow={currentMemory?.scopeType === 'group' ? 'Group' : 'Personal'}
    title="Memory"
    sub={scopeSub}>
    {#snippet action()}
      <div class="settings-memory__header-actions">
        <Btn
          variant="danger"
          size="sm"
          disabled={currentMemory === null || togglingCapture || clearing || archivingId !== null}
          testid="memory-clear"
          onClick={() => {
            pendingClear = true
            clearError = null
          }}>
          {#snippet children()}Clear memory{/snippet}
        </Btn>
        <Btn
          variant={currentMemory?.enabled ? 'outline' : 'primary'}
          size="sm"
          disabled={currentMemory === null || loading || togglingCapture}
          testid="memory-capture-toggle"
          onClick={() => void toggleCapture()}>
          {#snippet children()}{currentMemory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
        </Btn>
      </div>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentMemory !== null}
    <div class="settings-memory">
      <p class="settings-memory__note">
        Disabling stops new capture. Existing memory is kept and still used — use Clear memory
        to remove it.
      </p>
      <div class="settings-memory__profile">
        <Field label="Pinned profile">
          <Input
            value={profileDraft}
            multiline={true}
            rows={5}
            onInput={(value) => (profileDraft = value)}
            testid="memory-profile" />
        </Field>
        <div class="settings-memory__profile-actions">
          <Btn
            variant="primary"
            size="sm"
            disabled={savingProfile}
            testid="memory-profile-save"
            onClick={() => void saveProfile()}>
            {#snippet children()}{savingProfile ? 'Saving…' : 'Save profile'}{/snippet}
          </Btn>
        </div>
      </div>

      {#snippet recordItem(record: MemoryRecordView)}
        <li class="settings-memory__record">
          <div class="settings-memory__record-main">
            <div class="settings-memory__record-head">
              <Pill tone="info">{#snippet children()}{record.kind}{/snippet}</Pill>
              <Pill tone={statusTone(record.status)}>{#snippet children()}{record.status}{/snippet}</Pill>
              <span class="settings-memory__source">{record.source}</span>
              <span class="settings-memory__seen">last {shortDate(record.lastSeenAt)}</span>
            </div>
            <p class="settings-memory__text">{recordText(record)}</p>
            {#if record.tags.length > 0}
              <div class="settings-memory__tags">
                {#each record.tags as tag (tag)}
                  <span class="settings-memory__tag">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>
          <Btn
            variant="outline"
            size="sm"
            busy={archivingId === record.id}
            disabled={archivingId !== null}
            testid={`memory-archive-${record.id}`}
            onClick={() => void archiveRecord(record.id)}>
            {#snippet children()}Archive{/snippet}
          </Btn>
        </li>
      {/snippet}

      {#if activeRecords.length === 0}
        <div data-testid="memory-empty">
          <EmptyState title="No active memory records" hint="Captured memory records for this context will appear here." />
        </div>
      {:else}
        <ul class="settings-memory__records">
          {#each activeRecords as record (record.id)}
            {@render recordItem(record)}
          {/each}
        </ul>
      {/if}

      {#if pendingRecords.length > 0}
        <div class="settings-memory__pending" data-testid="memory-pending">
          <h3 class="settings-memory__pending-title">Pending (provisional)</h3>
          <p class="settings-memory__pending-hint">
            Captured from conversation threads and awaiting promotion to shared memory.
          </p>
          <ul class="settings-memory__records">
            {#each pendingRecords as record (record.id)}
              {@render recordItem(record)}
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}

  <Confirm
    open={pendingClear}
    title="Clear memory for this context"
    danger
    busy={clearing}
    confirmLabel="Clear memory"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Clear the memory profile and all memory records for this context? This cannot be undone.</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-memory {
    display: grid;
    gap: var(--gap-inline);
  }

  .settings-memory__header-actions {
    display: flex;
    gap: var(--gap-tight);
  }

  .settings-memory__note {
    margin: 0;
    font-size: 11px;
    color: var(--fg2);
  }

  .settings-memory__profile {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .settings-memory__profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .settings-memory__records {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .settings-memory__pending {
    display: grid;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .settings-memory__pending-title {
    margin: 0;
    font-size: 13px;
    color: var(--fg);
  }

  .settings-memory__pending-hint {
    margin: 0;
    font-size: 11px;
    color: var(--fg3);
  }

  .settings-memory__record {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    min-height: 76px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .settings-memory__record-main {
    min-width: 0;
    display: grid;
    gap: 7px;
  }

  .settings-memory__record-head,
  .settings-memory__tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .settings-memory__source,
  .settings-memory__seen,
  .settings-memory__tag {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }

  .settings-memory__text {
    margin: 0;
    color: var(--fg);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }

  .settings-memory__tag {
    padding: 1px 6px;
    border: 1px solid var(--hair);
    color: var(--fg2);
  }

  @media (max-width: 640px) {
    .settings-memory__record {
      grid-template-columns: 1fr;
    }
  }
</style>
