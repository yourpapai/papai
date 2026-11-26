<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { KaneoMembership } from '../fetcher-schemas-kaneo.js'
  import { fetchKaneoMemberships, revealKaneoSelfPassword } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Code from '../../shared/ui/Code.svelte'
  import CopyButton from '../../shared/ui/CopyButton.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'

  let memberships: KaneoMembership[] | null = $state(null)
  let loading = $state(true)
  let error: string | null = $state(null)
  // Reveal is destructive server-side (the ciphertext is cleared before responding), so a
  // revealed row must never re-arm: a second attempt 409s and the user would have thrown
  // away the only copy to reach it.
  let revealedPasswords: Record<string, string> = $state({})
  let revealedOnce: Record<string, boolean> = $state({})
  let revealingContextId: string | null = $state(null)

  async function load(): Promise<void> {
    memberships = null
    error = null
    loading = true
    try {
      const result = await fetchKaneoMemberships()
      memberships = result.memberships
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void load()
  })

  async function revealPassword(membership: KaneoMembership): Promise<void> {
    revealingContextId = membership.contextId
    error = null
    try {
      const result = await revealKaneoSelfPassword(membership.contextId)
      revealedPasswords[membership.contextId] = result.password
      revealedOnce[membership.contextId] = true
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      error = message
    } finally {
      revealingContextId = null
    }
  }
</script>

<section id="kaneo-access-self" class="settings-section">
  <PageHeader eyebrow="Personal" title="My Kaneo access">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load()}
        testid="kaneo-self-refresh" />
    {/snippet}
  </PageHeader>

  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if error !== null}
    <ErrorState message={error} onRetry={() => void load()} />
  {:else if memberships !== null && memberships.length === 0}
    <EmptyState
      title="No Kaneo access yet"
      hint="You aren't provisioned in any group workspace yet. Group members are set up automatically — if this persists, ask a group admin to add you.">
      {#snippet action()}
        <Btn
          variant="secondary"
          size="sm"
          busy={loading}
          testid="kaneo-self-empty-recheck"
          onClick={() => void load()}>
          {#snippet children()}Check again{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
  {:else if memberships !== null}
    <div class="kaneo-self-list">
      {#each memberships as membership (membership.contextId)}
        <article class="kaneo-self-row" data-testid={`kaneo-self-row-${membership.contextId}`}>
          <h3 class="kaneo-self-row__group">{membership.groupLabel}</h3>
          <div class="kaneo-self-row__rows">
            <KV k="Login email" v={membership.login} />
            {#if membership.kaneoUrl !== null}
              <div class="kaneo-self-url">
                <KV k="Workspace URL">
                  {#snippet v()}
                    <a
                      class="kaneo-self-url__link"
                      href={membership.kaneoUrl}
                      target="_blank"
                      rel="noopener noreferrer">{membership.kaneoUrl}</a>
                  {/snippet}
                </KV>
              </div>
            {/if}
            <KV k="Status">
              {#snippet v()}<StatusPill status={membership.status} />{/snippet}
            </KV>
          </div>

          {#if revealedPasswords[membership.contextId] !== undefined}
            <div class="kaneo-self-pw">
              <span class="kaneo-self-pw__label">Password (shown once)</span>
              <div class="kaneo-self-pw__row">
                <Code truncate={false}>{revealedPasswords[membership.contextId]}</Code>
                <CopyButton value={revealedPasswords[membership.contextId]} label="Copy password" />
                <Btn
                  variant="ghost"
                  size="sm"
                  testid={`kaneo-self-hide-${membership.contextId}`}
                  onClick={() => delete revealedPasswords[membership.contextId]}>
                  {#snippet children()}Hide{/snippet}
                </Btn>
              </div>
              <p class="placeholder">
                Store this password securely — hiding it here is permanent, and it won't be shown again.
              </p>
            </div>
          {:else if revealedOnce[membership.contextId] === true}
            <p class="placeholder" data-testid={`kaneo-self-pw-hidden-${membership.contextId}`}>
              Password hidden. It was shown once and can't be shown again — ask a group admin to re-provision your
              account if you no longer have it.
            </p>
          {:else}
            <div class="kaneo-self-pw__reveal">
              <Btn
                variant="secondary"
                size="sm"
                disabled={revealingContextId === membership.contextId}
                testid={`kaneo-self-reveal-${membership.contextId}`}
                onClick={() => void revealPassword(membership)}>
                {#snippet children()}
                  {revealingContextId === membership.contextId ? 'Revealing…' : 'Reveal password'}
                {/snippet}
              </Btn>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .kaneo-self-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-field);
    margin-top: var(--gap-field);
  }
  .kaneo-self-row {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--gap-field);
    display: flex;
    flex-direction: column;
    gap: var(--gap-inline);
  }
  .kaneo-self-row__group {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  .kaneo-self-row__rows {
    display: flex;
    flex-direction: column;
    gap: var(--gap-inline);
  }
  /* URL row: let a long workspace host wrap instead of KV's default nowrap+ellipsis */
  .kaneo-self-url :global(.ui-kv__v) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
  .kaneo-self-url__link {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .kaneo-self-pw {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kaneo-self-pw__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .kaneo-self-pw__row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
