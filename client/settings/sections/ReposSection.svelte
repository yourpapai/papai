<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
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

  // Add form state
  let addName = $state('')
  let addUrl = $state('')
  let addBranch = $state('')
  let addPreset = $state('cautious')
  let addEgress = $state('')

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
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
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
      error = err instanceof Error ? err.message : String(err)
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
      error = err instanceof Error ? err.message : String(err)
    } finally {
      deletingId = null
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

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

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
            variant="ghost"
            size="sm"
            testid={`repos-delete-${repo.repoId}`}
            disabled={deletingId === repo.repoId}
            onClick={() => void handleDelete(repo.repoId)}>
            {#snippet children()}{deletingId === repo.repoId ? 'Removing…' : 'Delete'}{/snippet}
          </Btn>
        </div>
      {/each}
    </div>

    <div class="settings-repos__add">
      <p class="settings-repos__add-label">Add repository</p>
      <div class="settings-repos__add-form">
        <Field label="Name">
          <Input
            value={addName}
            onInput={(v) => (addName = v)}
            placeholder="my-project"
            testid="repos-add-name" />
        </Field>
        <Field label="Repository URL (https)">
          <Input
            value={addUrl}
            onInput={(v) => (addUrl = v)}
            placeholder="https://github.com/org/repo.git"
            testid="repos-add-url" />
        </Field>
        <Field label="Base branch">
          <Input
            value={addBranch}
            onInput={(v) => (addBranch = v)}
            placeholder="main"
            testid="repos-add-branch" />
        </Field>
        <Field label="Permission preset">
          <select
            class="settings-repos__preset-select"
            data-testid="repos-add-preset"
            value={addPreset}
            onchange={(e) => (addPreset = (e.target as HTMLSelectElement).value)}>
            <option value="autonomous">autonomous</option>
            <option value="cautious">cautious</option>
            <option value="readonly">readonly</option>
          </select>
        </Field>
        <Field label="Additional egress domains">
          <textarea
            class="settings-repos__egress-input"
            data-testid="repos-add-egress"
            value={addEgress}
            oninput={(e) => (addEgress = (e.target as HTMLTextAreaElement).value)}
            placeholder="pypi.org, files.pythonhosted.org"></textarea>
          <p class="settings-repos__egress-help">
            Extra domains this project's sessions may reach, added to the defaults. One per line or comma-separated. A
            domain may still be blocked if your operator's egress policy doesn't include it.
          </p>
        </Field>
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
</section>

<style>
  .settings-repos {
    display: grid;
    gap: 8px;
    margin-bottom: 20px;
  }
  .settings-repos__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
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
    color: var(--fg1);
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
    color: var(--fg3);
  }
  .settings-repos__add {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-repos__add-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
    margin: 0;
  }
  .settings-repos__add-form {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
  }
  .settings-repos__add-form :global(.ui-field) {
    min-width: 180px;
  }
  .settings-repos__preset-select {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg1);
  }
  .settings-repos__egress-input {
    width: 100%;
    min-height: 52px;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg1);
    resize: vertical;
  }
  .settings-repos__egress-help {
    font-size: 11px;
    color: var(--fg3);
    margin: 4px 0 0;
  }
</style>
