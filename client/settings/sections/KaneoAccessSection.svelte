<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { KaneoCredentials } from '../fetcher-schemas-kaneo.js'
  import { KaneoCredentialsSchema } from '../fetcher-schemas-kaneo.js'
  import { revealKaneoPassword, settingsFetch } from '../fetchers.js'
  import { readBody } from '../../shared/fetcher-helpers.js'

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
      if (res.status === 404) {
        notProvisioned = true
        return
      }
      const body = await readBody(res)
      if (!res.ok) {
        const msg = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `request failed with status ${res.status}`
        error = msg
        return
      }
      credentials = KaneoCredentialsSchema.parse(body)
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
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

<section id="kaneo-access">
  <h2>My Kaneo access</h2>
  {#if loading}
    <p>Loading…</p>
  {:else if notProvisioned}
    <p>Your Kaneo account is not provisioned in this group. Contact your group admin.</p>
  {:else if error !== null}
    <p class="error">{error}</p>
  {:else if credentials !== null}
    <dl>
      <dt>Login email</dt>
      <dd>{credentials.login}</dd>
      {#if credentials.kaneoUrl !== null}
        <dt>Workspace URL</dt>
        <dd><a href={credentials.kaneoUrl} target="_blank" rel="noopener noreferrer">{credentials.kaneoUrl}</a></dd>
      {/if}
      <dt>Status</dt>
      <dd>{credentials.status}</dd>
    </dl>

    {#if revealedPassword !== null}
      <p><strong>Password (shown once):</strong> <code>{revealedPassword}</code></p>
      <p>Store this password securely — it will not be shown again.</p>
    {:else}
      <button data-action="reveal-password" disabled={revealing} onclick={revealPassword}>
        {revealing ? 'Revealing…' : 'Reveal password'}
      </button>
    {/if}
  {/if}
</section>
