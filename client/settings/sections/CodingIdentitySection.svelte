<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'
  import { fetchGroupCodingIdentity, fetchGroupMembers, patchGroupCodingIdentity } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  type PolicyKind = 'initiator' | 'shared' | 'designated'
  type Member = GroupMembersResponse['members'][number]

  const POLICY_OPTIONS = [
    { value: 'initiator', label: "Initiator — each user's own credentials" },
    { value: 'shared', label: 'Shared — group vault credentials' },
    { value: 'designated', label: "Designated — a specific member's credentials" },
  ]

  /** Parse the raw identity string into a policy kind + optional designated userId. */
  function parseIdentity(identity: string): { kind: PolicyKind; designatedUserId: string } {
    if (identity.startsWith('designated:')) {
      return { kind: 'designated', designatedUserId: identity.slice('designated:'.length) }
    }
    if (identity === 'shared') return { kind: 'shared', designatedUserId: '' }
    return { kind: 'initiator', designatedUserId: '' }
  }

  let policyKind = $state<PolicyKind>('initiator')
  let designatedUserId = $state('')
  let members = $state<Member[]>([])
  let loading = $state(false)
  let saving = $state(false)
  let loaded = $state(false)
  let loadError: unknown = $state(null)
  let saveError: unknown = $state(null)
  let status: string | null = $state(null)

  const memberOptions = $derived(members.map((m) => ({ value: m.user_id, label: m.user_label ?? m.user_id })))
  const designatedEmpty = $derived(policyKind === 'designated' && designatedUserId === '')

  async function load(id: string): Promise<void> {
    loadError = null
    loading = true
    try {
      const [identityResult, membersResult] = await Promise.all([fetchGroupCodingIdentity(id), fetchGroupMembers(id)])
      if (id !== contextId) return
      const parsed = parseIdentity(identityResult.identity)
      policyKind = parsed.kind
      designatedUserId = parsed.designatedUserId || (membersResult.members[0]?.user_id ?? '')
      members = membersResult.members
      loaded = true
    } catch (err) {
      if (id === contextId) loadError = err
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function save(): Promise<void> {
    saveError = null
    status = null
    if (designatedEmpty) return
    saving = true
    try {
      const identity = policyKind === 'designated' ? `designated:${designatedUserId}` : policyKind
      await patchGroupCodingIdentity({ contextId, identity })
      await load(contextId)
      status = 'Saved.'
    } catch (err) {
      saveError = err
    } finally {
      saving = false
    }
  }

  function onPolicyChange(value: string): void {
    policyKind = value as PolicyKind
    status = null
    saveError = null
    designatedUserId = policyKind === 'designated' ? (members[0]?.user_id ?? '') : ''
  }

  function onMemberChange(value: string): void {
    designatedUserId = value
    status = null
    saveError = null
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="coding-identity" class="settings-section">
  <PageHeader eyebrow="Group" title="Coding session identity" />

  {#if loadError !== null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && !loaded}
    <p class="placeholder">Loading…</p>
  {:else}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    {#if saveError !== null}
      <p class="status-error" role="alert" data-testid="coding-identity-error">{formatFetchError(saveError)}</p>
    {/if}

    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label="Policy">
        <Select value={policyKind} options={POLICY_OPTIONS} onChange={onPolicyChange} testid="coding-identity-policy" />
      </Field>

      {#if policyKind === 'designated'}
        <Field label="Member" error={designatedEmpty ? 'Add a group member to use the Designated policy.' : undefined}>
          <Select value={designatedUserId} options={memberOptions} onChange={onMemberChange} testid="coding-identity-member" />
        </Field>
      {/if}

      <Btn variant="primary" type="submit" disabled={saving || designatedEmpty} busy={saving} testid="coding-identity-save">
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
    </form>

    <p class="settings-section__caption">
      Controls whose coding credentials (AI provider key, code host token, agent) are used for sessions started in this
      group. <strong>Initiator</strong> (default): the user who runs
      <code>/acp start</code> must have their own credentials configured. <strong>Shared</strong>: the group vault is
      used for everyone. <strong>Designated</strong>: a specific member's credentials are always used.
    </p>
  {/if}
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
</style>
