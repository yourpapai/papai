<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
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
  let mutating = $state(false)
  let initialLoad = $state(true)

  const activeRecords = $derived(memory?.records.filter((record) => record.status === 'active') ?? [])

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function applyMemory(next: MemoryResponse): void {
    memory = next
    profileDraft = next.profile
  }

  function shortDate(value: string): string {
    return value.length >= 10 ? value.slice(0, 10) : value
  }

  function recordText(record: MemoryRecordView): string {
    return record.summary ?? record.content
  }

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      applyMemory(await fetchMemory(id))
      initialLoad = false
    } catch (err) {
      memory = null
      error = messageFrom(err)
      initialLoad = false
    } finally {
      loading = false
    }
  }

  async function toggleCapture(): Promise<void> {
    if (memory === null) return
    error = null
    status = null
    mutating = true
    try {
      await setMemoryCapture({ contextId, enabled: !memory.enabled })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  async function saveProfile(): Promise<void> {
    error = null
    status = null
    savingProfile = true
    try {
      await updateMemoryProfile({ contextId, profile: profileDraft })
      await load(contextId)
      status = 'Saved.'
    } catch (err) {
      error = messageFrom(err)
    } finally {
      savingProfile = false
    }
  }

  async function clearRecords(): Promise<void> {
    error = null
    status = null
    mutating = true
    try {
      await clearMemory({ contextId })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  async function archiveRecord(id: string): Promise<void> {
    error = null
    status = null
    mutating = true
    try {
      await archiveMemoryRecord(contextId, id)
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  $effect(() => {
    initialLoad = true
    void load(contextId)
  })
</script>

<section id="memory" class="settings-section">
  <PageHeader eyebrow={memory?.scopeType === 'group' ? 'Group' : 'Personal'} title="Memory">
    {#snippet action()}
      <Btn
        variant={memory?.enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={memory === null || loading || mutating}
        testid="memory-capture-toggle"
        onClick={() => void toggleCapture()}>
        {#snippet children()}{memory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if memory !== null}
    <div class="settings-memory">
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
          <Btn variant="danger" size="sm" disabled={mutating} testid="memory-clear" onClick={() => void clearRecords()}>
            {#snippet children()}Clear memory{/snippet}
          </Btn>
        </div>
      </div>

      {#if activeRecords.length === 0}
        <div data-testid="memory-empty">
          <EmptyState title="No active memory records" hint="Captured memory records for this context will appear here." />
        </div>
      {:else}
        <ul class="settings-memory__records">
          {#each activeRecords as record (record.id)}
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
                variant="ghost"
                size="sm"
                disabled={mutating}
                testid={`memory-archive-${record.id}`}
                onClick={() => void archiveRecord(record.id)}>
                {#snippet children()}Archive{/snippet}
              </Btn>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .settings-memory {
    display: grid;
    gap: 14px;
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
    color: var(--fg3);
  }

  .settings-memory__seen {
    color: var(--fg4);
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
    color: var(--fg4);
  }

  @media (max-width: 640px) {
    .settings-memory__record {
      grid-template-columns: 1fr;
    }
  }
</style>
