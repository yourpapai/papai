<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Checkbox from '../../shared/ui/Checkbox.svelte'
  import Confirm from '../../shared/Confirm.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import { FetchError } from '../../shared/fetcher-helpers.js'
  import type { SupervisedRepo } from '../fetcher-schemas-supervised-projects.js'
  import {
    deleteSupervisedProject,
    fetchSupervisedProject,
    saveSupervisedProject,
  } from '../supervised-projects-fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  type Row = { projectPath: string; repoUrl: string; baseBranch: string }

  let rows: Row[] = $state([])
  let autoReview = $state(false)
  let selfReviewEnabled = $state(true)
  let costBudget = $state('')
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let notConfigured = $state(false)
  let hasProject = $state(false)
  let loading = $state(false)
  let saving = $state(false)
  let initialLoad = $state(true)
  let pendingDelete = $state(false)
  let deleting = $state(false)
  let deleteError: string | null = $state(null)

  function toRow(r: SupervisedRepo): Row {
    return { projectPath: r.projectPath, repoUrl: r.repoUrl, baseBranch: r.baseBranch ?? '' }
  }

  function isNotConfigured(err: unknown): boolean {
    return err instanceof FetchError && err.status === 422 && err.message === 'nerv_not_configured'
  }

  async function load(id: string): Promise<void> {
    error = null
    notConfigured = false
    loading = true
    try {
      const data = await fetchSupervisedProject(id)
      if (id !== contextId) return
      rows = data.project ? data.project.repositories.map(toRow) : []
      autoReview = data.project?.autoReview ?? false
      selfReviewEnabled = data.project?.selfReviewEnabled ?? true
      costBudget = data.project?.costBudgetUsd == null ? '' : String(data.project.costBudgetUsd)
      hasProject = data.project !== null
      initialLoad = false
    } catch (err) {
      if (id !== contextId) return
      if (isNotConfigured(err)) notConfigured = true
      else error = err instanceof Error ? err.message : String(err)
      initialLoad = false
    } finally {
      if (id === contextId) loading = false
    }
  }

  function addRow(): void {
    rows = [...rows, { projectPath: '', repoUrl: '', baseBranch: '' }]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    error = null
    status = null

    const trimmedBudget = costBudget.trim()
    let costBudgetUsd: number | null = null
    if (trimmedBudget !== '') {
      const parsed = Number(trimmedBudget)
      if (!Number.isFinite(parsed) || parsed < 0) {
        error = 'Cost budget must be a number.'
        return
      }
      costBudgetUsd = parsed
    }

    saving = true
    try {
      await saveSupervisedProject({
        contextId,
        repositories: rows.map((r) => ({
          projectPath: r.projectPath.trim(),
          repoUrl: r.repoUrl.trim() === '' ? undefined : r.repoUrl.trim(),
          baseBranch: r.baseBranch.trim() === '' ? undefined : r.baseBranch.trim(),
        })),
        autoReview,
        selfReviewEnabled,
        costBudgetUsd,
      })
      status = 'Saved.'
      await load(contextId)
    } catch (err) {
      if (isNotConfigured(err)) notConfigured = true
      else error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function confirmDelete(): Promise<void> {
    deleteError = null
    deleting = true
    try {
      await deleteSupervisedProject(contextId)
      pendingDelete = false
      status = 'Project deleted.'
      await load(contextId)
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err)
    } finally {
      deleting = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="supervised-projects" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Supervised Projects">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="supervised-projects-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if notConfigured}
    <EmptyState
      title="Not available"
      hint="The nerv plugin is not configured for this deployment. Ask an admin to set the nerv base URL and token." />
  {:else}
    {#if rows.length === 0}
      <EmptyState title="No supervised repositories" hint="Add a repository for the supervised-coding agent to work in.">
        {#snippet action()}
          <Btn variant="primary" testid="supervised-projects-add" onClick={addRow}>
            {#snippet children()}Add repository{/snippet}
          </Btn>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="settings-supervised">
        {#each rows as row, index (index)}
          <div class="settings-supervised__row" data-testid={`supervised-projects-row-${index}`}>
            <div class="settings-supervised__fields">
              <Field label="Project path">
                <Input
                  value={row.projectPath}
                  onInput={(v) => (row.projectPath = v)}
                  placeholder="group/repo"
                  testid={`supervised-projects-path-${index}`} />
              </Field>
              <Field label="Repo URL (optional if a base URL default is set)">
                <Input
                  value={row.repoUrl}
                  onInput={(v) => (row.repoUrl = v)}
                  placeholder="https://forge.example.com/group/repo.git"
                  testid={`supervised-projects-url-${index}`} />
              </Field>
              <Field label="Base branch (optional)">
                <Input
                  value={row.baseBranch}
                  onInput={(v) => (row.baseBranch = v)}
                  placeholder="main"
                  testid={`supervised-projects-branch-${index}`} />
              </Field>
            </div>
            <Btn
              variant="outline"
              size="sm"
              testid={`supervised-projects-remove-${index}`}
              onClick={() => removeRow(index)}>
              {#snippet children()}Remove{/snippet}
            </Btn>
          </div>
        {/each}
        <div class="settings-supervised__add">
          <Btn variant="secondary" testid="supervised-projects-add" onClick={addRow}>
            {#snippet children()}Add repository{/snippet}
          </Btn>
        </div>
      </div>
    {/if}

    <div class="settings-supervised__flags">
      <Checkbox
        label="Auto review"
        checked={autoReview}
        onChange={(c) => (autoReview = c)}
        testid="supervised-projects-auto-review" />
      <Checkbox
        label="Self review enabled"
        checked={selfReviewEnabled}
        onChange={(c) => (selfReviewEnabled = c)}
        testid="supervised-projects-self-review" />
      <Field label="Cost budget (USD, blank = default)">
        <Input
          value={costBudget}
          onInput={(v) => (costBudget = v)}
          placeholder="e.g. 25"
          testid="supervised-projects-cost-budget" />
      </Field>
    </div>

    <div class="settings-supervised__actions">
      {#if hasProject}
        <Btn
          variant="ghost"
          testid="supervised-projects-delete"
          disabled={saving || loading}
          onClick={() => {
            pendingDelete = true
            deleteError = null
          }}>
          {#snippet children()}Delete project{/snippet}
        </Btn>
      {/if}
      <Btn
        variant="primary"
        testid="supervised-projects-save"
        disabled={saving || rows.length === 0}
        onClick={() => void save()}>
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
    </div>
  {/if}

  <Confirm
    open={pendingDelete}
    title="Delete supervised project"
    danger
    busy={deleting}
    confirmLabel="Delete"
    onCancel={() => (pendingDelete = false)}
    onConfirm={() => void confirmDelete()}>
    {#snippet body()}
      <p>
        Delete the supervised-project configuration for this context, including its repository list? This cannot be
        undone.
      </p>
      {#if deleteError !== null}<p class="status-error">{deleteError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-supervised {
    display: grid;
    gap: var(--gap-inline);
    margin-bottom: var(--gap-inline);
  }
  .settings-supervised__row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .settings-supervised__fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-inline);
    flex: 1 1 480px;
    min-width: 0;
  }
  .settings-supervised__fields :global(.ui-field) {
    flex: 1 1 180px;
    min-width: 0;
  }
  .settings-supervised__fields :global(.ui-input) {
    width: 100%;
  }
  .settings-supervised__add {
    display: flex;
  }
  .settings-supervised__flags {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--gap-inline);
    padding: var(--gap-inline) 0;
  }
  .settings-supervised__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-inline);
  }
</style>
