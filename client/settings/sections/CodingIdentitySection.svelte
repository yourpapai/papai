<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import { fetchGroupCodingIdentity, fetchGroupMembers, patchGroupCodingIdentity } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  type PolicyKind = 'initiator' | 'shared' | 'designated'

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
  let members = $state<Array<{ user_id: string; added_by: string; added_at: string }>>([])
  let loading = $state(false)
  let mutating = $state(false)
  let error: string | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const [identityResult, membersResult] = await Promise.all([
        fetchGroupCodingIdentity(id),
        fetchGroupMembers(id),
      ])
      if (id !== contextId) return
      const parsed = parseIdentity(identityResult.identity)
      policyKind = parsed.kind
      designatedUserId = parsed.designatedUserId || (membersResult.members[0]?.user_id ?? '')
      members = membersResult.members
    } catch (err) {
      if (id === contextId) {
        error = messageFrom(err)
      }
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function save(): Promise<void> {
    error = null
    mutating = true
    try {
      const identity = policyKind === 'designated' ? `designated:${designatedUserId}` : policyKind
      await patchGroupCodingIdentity({ contextId, identity })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  function onPolicyChange(e: Event): void {
    policyKind = (e.currentTarget as HTMLSelectElement).value as PolicyKind
    if (policyKind !== 'designated') {
      designatedUserId = ''
    } else {
      designatedUserId = members[0]?.user_id ?? ''
    }
  }

  function onMemberChange(e: Event): void {
    designatedUserId = (e.currentTarget as HTMLSelectElement).value
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="coding-identity" class="settings-section">
  <PageHeader eyebrow="Group" title="Coding session identity">
    {#snippet action()}
      <Btn
        variant="primary"
        size="sm"
        disabled={loading || mutating}
        testid="coding-identity-save"
        onClick={() => void save()}>
        {#snippet children()}Save{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" data-testid="coding-identity-error">{error}</p>{/if}

  <div class="coding-identity__controls">
    <label class="settings-field__label" for="coding-identity-policy">Policy</label>
    <select
      id="coding-identity-policy"
      data-testid="coding-identity-policy"
      disabled={loading || mutating}
      value={policyKind}
      onchange={onPolicyChange}>
      <option value="initiator">Initiator — each user's own credentials</option>
      <option value="shared">Shared — group vault credentials</option>
      <option value="designated">Designated — a specific member's credentials</option>
    </select>

    {#if policyKind === 'designated'}
      <label class="settings-field__label" for="coding-identity-member">Member</label>
      <select
        id="coding-identity-member"
        data-testid="coding-identity-member"
        disabled={loading || mutating}
        value={designatedUserId}
        onchange={onMemberChange}>
        {#each members as member (member.user_id)}
          <option value={member.user_id}>{member.user_id}</option>
        {/each}
      </select>
    {/if}
  </div>

  <p class="settings-section__caption">
    Controls whose coding credentials (AI provider key, code host token, agent) are used for sessions started in this
    group. <strong>Initiator</strong> (default): the user who runs
    <code>/acp start</code> must have their own credentials configured. <strong>Shared</strong>: the group vault is
    used for everyone. <strong>Designated</strong>: a specific member's credentials are always used.
  </p>
</section>

<style>
  .coding-identity__controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  select {
    font-size: 13px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg2);
    color: var(--text);
    width: 100%;
    max-width: 360px;
  }

  select:disabled {
    opacity: 0.6;
  }

  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
</style>
