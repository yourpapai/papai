<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { KaneoCredentials } from '../fetcher-schemas-kaneo.js'
  import { KaneoCredentialsSchema } from '../fetcher-schemas-kaneo.js'
  import { revealKaneoPassword, settingsFetch } from '../fetchers.js'
  import { readBody } from '../../shared/fetcher-helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Code from '../../shared/ui/Code.svelte'
  import CopyButton from '../../shared/ui/CopyButton.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let credentials: KaneoCredentials | null = $state(null)
  let notProvisioned = $state(false)
  let loading = $state(true)
  let error: string | null = $state(null)
  let revealedPassword: string | null = $state(null)
  let revealing = $state(false)

  async function load(id: string): Promise<void> {
    credentials = null
    notProvisioned = false
    error = null
    loading = true
    try {
      const res = await settingsFetch(`/settings/api/kaneo/credentials?contextId=${encodeURIComponent(id)}`)
      if (id !== contextId) return
      if (res.status === 404) {
        notProvisioned = true
        return
      }
      const body = await readBody(res)
      if (id !== contextId) return
      if (!res.ok) {
        const msg = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `request failed with status ${res.status}`
        error = msg
        return
      }
      credentials = KaneoCredentialsSchema.parse(body)
    } catch (e: unknown) {
      if (id === contextId) error = e instanceof Error ? e.message : String(e)
    } finally {
      if (id === contextId) loading = false
    }
  }

  $effect(() => {
    void load(contextId)
  })

  async function revealPassword(): Promise<void> {
    if (credentials === null) return
    revealing = true
    error = null
    try {
      const result = await revealKaneoPassword(contextId)
      revealedPassword = result.password
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      revealing = false
    }
  }
</script>

<section id="kaneo-access" class="settings-section">
  <PageHeader eyebrow="Personal" title="My Kaneo access">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="kaneo-refresh" />
    {/snippet}
  </PageHeader>

  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if notProvisioned}
    <EmptyState
      title="No Kaneo access yet"
      hint="Your account isn't provisioned in this group yet. Group members are set up automatically — if this persists, ask a group admin to add you." />
  {:else if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if credentials !== null}
    <div class="kaneo-rows">
      <KV k="Login email" v={credentials.login} />
      {#if credentials.kaneoUrl !== null}
        <div class="kaneo-url">
          <KV k="Workspace URL">
            {#snippet v()}
              <a
                class="kaneo-url__link"
                href={credentials.kaneoUrl}
                target="_blank"
                rel="noopener noreferrer">{credentials.kaneoUrl}</a>
            {/snippet}
          </KV>
        </div>
      {/if}
      <KV k="Status">
        {#snippet v()}<StatusPill status={credentials.status} />{/snippet}
      </KV>
    </div>

    {#if revealedPassword !== null}
      <div class="kaneo-pw">
        <span class="kaneo-pw__label">Password (shown once)</span>
        <div class="kaneo-pw__row">
          <Code truncate={false}>{revealedPassword}</Code>
          <CopyButton value={revealedPassword} label="Copy password" />
        </div>
        <p class="placeholder">Store this password securely — it won't be shown again.</p>
      </div>
    {:else}
      <div class="kaneo-pw__reveal">
        <Btn
          variant="secondary"
          size="sm"
          disabled={revealing}
          testid="kaneo-reveal"
          onClick={() => void revealPassword()}>
          {#snippet children()}{revealing ? 'Revealing…' : 'Reveal password'}{/snippet}
        </Btn>
      </div>
    {/if}
  {/if}
</section>

<style>
  .kaneo-rows {
    display: flex;
    flex-direction: column;
    gap: var(--gap-inline);
    margin-top: var(--gap-field);
  }
  /* URL row: let a long workspace host wrap instead of KV's default nowrap+ellipsis */
  .kaneo-url :global(.ui-kv__v) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
  .kaneo-url__link {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .kaneo-pw {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: var(--gap-field);
  }
  .kaneo-pw__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .kaneo-pw__row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .kaneo-pw__reveal {
    margin-top: var(--gap-field);
  }
</style>
