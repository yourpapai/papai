<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../../shared/ui/Btn.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import RoleBindingBlock from '../../components/RoleBindingBlock.svelte'
  import { fetchAdminLlmRoles, fetchAdminProviders, putAdminLlmRoles } from '../../admin-fetchers.js'
  import type { PublicProviderAccount, RoleBinding, LlmRoleBindings } from '../../fetcher-schemas-llm-providers.js'

  let providers: PublicProviderAccount[] = $state([])
  let roles: LlmRoleBindings | null = $state(null)
  let draft: LlmRoleBindings = $state({ main: { providerId: '', model: '' }, small: null, embedding: null })
  let error: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let status: string | null = $state(null)

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const [provRes, rolesRes] = await Promise.all([fetchAdminProviders(), fetchAdminLlmRoles()])
      providers = provRes.providers
      roles = rolesRes.roles
      draft = JSON.parse(JSON.stringify(roles)) as LlmRoleBindings
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  const isDirty = $derived(roles !== null && JSON.stringify(draft) !== JSON.stringify(roles))

  function onRoleChange(role: 'main' | 'small' | 'embedding', binding: RoleBinding): void {
    draft = { ...draft, [role]: binding }
  }

  async function save(): Promise<void> {
    if (!isDirty || saving) return
    saving = true
    error = null
    status = null
    try {
      await putAdminLlmRoles(draft)
      roles = JSON.parse(JSON.stringify(draft)) as LlmRoleBindings
      status = 'Role bindings saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })
</script>

<section id="llm-models" class="settings-section">
  <PageHeader eyebrow="Admin" title="LLM Models">
    {#snippet action()}
      <Btn
        variant="primary"
        size="sm"
        testid="admin-models-save"
        disabled={!isDirty || saving}
        onClick={() => void save()}>
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-models-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if loading && roles === null}
    <p class="placeholder">Loading…</p>
  {:else if error !== null && roles === null}
    <ErrorState message={error} onRetry={() => void load()} />
  {:else}
    <RoleBindingBlock
      roleName="main"
      {providers}
      binding={draft.main}
      canInherit={false}
      onChange={(b) => onRoleChange('main', b)}
      testid="role-main" />
    <RoleBindingBlock
      roleName="small"
      {providers}
      binding={draft.small}
      canInherit={true}
      onChange={(b) => onRoleChange('small', b)}
      testid="role-small" />
    <RoleBindingBlock
      roleName="embedding"
      {providers}
      binding={draft.embedding}
      canInherit={true}
      onChange={(b) => onRoleChange('embedding', b)}
      testid="role-embedding" />
  {/if}
</section>

<style>
  .placeholder {
    color: var(--fg3);
    font-size: 12px;
    padding: 8px 0;
  }
</style>
