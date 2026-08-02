<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import type { RepoRecord } from '../fetcher-schemas-repos.js'
  import { addRepo, deleteRepo, fetchRepos } from '../repos-fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let repos: RepoRecord[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let adding = $state(false)
  let deletingId: string | null = $state(null)
  let pendingDeleteId: string | null = $state(null)

  // Add form state
  let addName = $state('')
  let addUrl = $state('')
  let addBranch = $state('')
  let addPreset = $state('cautious')
  let addEgress = $state('')

  const PRESET_OPTIONS = [
    { value: 'readonly', label: 'readonly' },
    { value: 'cautious', label: 'cautious' },
    { value: 'autonomous', label: 'autonomous' },
  ]

  const parseEgress = (raw: string): string[] => {
    const seen = new Set<string>()
    for (const part of raw.split(/[\n,]/u)) {
      const host = part.trim().toLowerCase()
      if (host.length > 0) seen.add(host)
    }
    return [...seen]
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const data = await fetchRepos(id)
      if (id !== contextId) return
      repos = data.repos
    } catch (err) {
      if (id === contextId) error = formatFetchError(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function handleAdd(): Promise<void> {
    error = null
    status = null
    adding = true
    try {
      await addRepo({
        contextId,
        name: addName,
        repoUrl: addUrl,
        baseBranch: addBranch,
        permissionPreset: addPreset,
        additionalEgressDomains: parseEgress(addEgress),
      })
      addName = ''
      addUrl = ''
      addBranch = ''
      addPreset = 'cautious'
      addEgress = ''
      await load(contextId)
      status = 'Repository added.'
    } catch (err) {
      error = formatFetchError(err)
    } finally {
      adding = false
    }
  }

  async function handleDelete(repoId: string): Promise<void> {
    error = null
    status = null
    deletingId = repoId
    try {
      await deleteRepo({ contextId, repoId })
      await load(contextId)
      status = 'Repository removed.'
    } catch (err) {
      error = formatFetchError(err)
    } finally {
      deletingId = null
      pendingDeleteId = null
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="repos" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Repositories">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="repos-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if loading && repos.length === 0}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="settings-repos">
      {#each repos as repo (repo.repoId)}
        <div class="settings-repos__row" data-testid={`repos-row-${repo.repoId}`}>
          <div class="settings-repos__info">
            <span class="settings-repos__name">{repo.name}</span>
            <span class="settings-repos__url">{repo.repoUrl}</span>
            <span class="settings-repos__meta"
              >{repo.baseBranch} · {repo.permissionPreset}{repo.additionalEgressDomains.length > 0
                ? ` · egress: ${repo.additionalEgressDomains.join(', ')}`
                : ''}</span>
          </div>
          <Btn
            variant="danger"
            size="sm"
            testid={`repos-delete-${repo.repoId}`}
            disabled={deletingId === repo.repoId}
            onClick={() => (pendingDeleteId = repo.repoId)}>
            {#snippet children()}{deletingId === repo.repoId ? 'Removing…' : 'Delete'}{/snippet}
          </Btn>
        </div>
      {:else}
        <EmptyState
          title="No repositories connected"
          hint="Add one below to make it available to coding sessions in this context." />
      {/each}
    </div>

    <div class="settings-repos__add">
      <div class="settings-repos__add-head">
        <p class="settings-repos__add-label">Add repository</p>
        <p class="settings-repos__add-note">
          Branch, preset and egress domains are fixed when a repository is added — change them by removing and
          re-adding it.
        </p>
      </div>
      <div class="settings-form">
        <Field label="Name" required>
          <Input
            value={addName}
            onInput={(v) => (addName = v)}
            placeholder="my-project"
            testid="repos-add-name" />
        </Field>
        <Field label="Repository URL (https)" required>
          <Input
            value={addUrl}
            onInput={(v) => (addUrl = v)}
            placeholder="https://github.com/org/repo.git"
            testid="repos-add-url" />
        </Field>
        <Field label="Base branch" required>
          <Input
            value={addBranch}
            onInput={(v) => (addBranch = v)}
            placeholder="main"
            testid="repos-add-branch" />
        </Field>
        <Field label="Permission preset" hint="readonly is the most restricted, autonomous the least.">
          <Select
            value={addPreset}
            options={PRESET_OPTIONS}
            onChange={(v) => (addPreset = v)}
            testid="repos-add-preset" />
        </Field>
        <Field
          label="Additional egress domains"
          hint="Extra domains this project's sessions may reach, added to the defaults. One per line or comma-separated. A domain may still be blocked if your operator's egress policy doesn't include it.">
          <Input
            value={addEgress}
            onInput={(v) => (addEgress = v)}
            multiline={true}
            rows={3}
            placeholder="pypi.org, files.pythonhosted.org"
            testid="repos-add-egress" />
        </Field>
      </div>
      <div class="settings-repos__actions">
        <Btn
          variant="primary"
          testid="repos-add-submit"
          disabled={adding || addName.trim().length === 0 || addUrl.trim().length === 0 || addBranch.trim().length === 0}
          onClick={() => void handleAdd()}>
          {#snippet children()}{adding ? 'Adding…' : 'Add'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}

  <Confirm
    open={pendingDeleteId !== null}
    title="Delete repository"
    danger
    busy={deletingId !== null}
    confirmLabel="Delete"
    onCancel={() => {
      pendingDeleteId = null
    }}
    onConfirm={() => {
      if (pendingDeleteId !== null) void handleDelete(pendingDeleteId)
    }}>
    {#snippet body()}
      <p>
        Delete {repos.find((r) => r.repoId === pendingDeleteId)?.name ?? 'this repository'}? Coding sessions in this
        context will no longer be able to use it.
      </p>
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-repos {
    display: grid;
    gap: var(--gap-tight);
    margin-bottom: var(--gap-field);
  }
  .settings-repos__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    padding: var(--gap-tight) var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .settings-repos__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .settings-repos__name {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    font-weight: 600;
  }
  .settings-repos__url {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .settings-repos__meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
  }
  .settings-repos__add {
    display: grid;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .settings-repos__add-head {
    display: grid;
    gap: var(--s1);
  }
  .settings-repos__add-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
    margin: 0;
  }
  .settings-repos__add-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
    margin: 0;
  }
  #repos .settings-form {
    margin-bottom: 0;
    align-items: start;
  }
  #repos .settings-form :global(.ui-field) {
    flex: 1 1 180px;
  }
  .settings-repos__actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
