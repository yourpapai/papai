<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Confirm from '../../../shared/Confirm.svelte'
  import {
    broadcastReleaseNotes,
    fetchReleaseNotes,
    regenerateReleaseNotes,
    saveReleaseNotes,
  } from '../../admin-fetchers.js'
  import type { ReleaseBroadcastResult, ReleaseNotesResponse } from '../../fetcher-schemas-release.js'

  let data = $state<ReleaseNotesResponse | null>(null)
  let body = $state('')
  let error: string | null = $state(null)
  let busy = $state(false)
  let confirming = $state(false)
  let lastBroadcast = $state<ReleaseBroadcastResult | null>(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(): Promise<void> {
    error = null
    busy = true
    try {
      data = await fetchReleaseNotes()
      body = data.body ?? ''
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function regenerate(): Promise<void> {
    error = null
    busy = true
    try {
      data = await regenerateReleaseNotes()
      body = data.body ?? ''
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function save(): Promise<void> {
    if (body.trim() === '') return
    error = null
    busy = true
    try {
      data = await saveReleaseNotes(body)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function confirmedBroadcast(): Promise<void> {
    confirming = false
    error = null
    busy = true
    try {
      lastBroadcast = await broadcastReleaseNotes()
      await load()
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="release-notes" class="settings-section">
  <PageHeader eyebrow="Admin" title="Release notes" />

  {#if error !== null}<p class="status-error" data-testid="release-notes-error">{error}</p>{/if}

  {#if data !== null}
    <p class="settings-section__caption">
      Version {data.version} · {data.counts.dm} DM + {data.counts.group} group subscriber(s)
      {#if data.broadcastAt !== null} · already broadcast{/if}
    </p>

    <Field label="Announcement">
      <Input value={body} onInput={(v) => (body = v)} testid="release-notes-body" multiline rows={8} />
    </Field>

    <div class="settings-actions">
      <Btn variant="outline" size="sm" disabled={busy} testid="release-notes-regenerate" onClick={() => void regenerate()}>
        {#snippet children()}Regenerate{/snippet}
      </Btn>
      <Btn variant="outline" size="sm" disabled={busy || body.trim() === ''} testid="release-notes-save" onClick={() => void save()}>
        {#snippet children()}Save{/snippet}
      </Btn>
      <Btn
        variant="primary"
        size="sm"
        disabled={busy || body.trim() === ''}
        testid="release-notes-broadcast"
        onClick={() => (confirming = true)}>
        {#snippet children()}Broadcast{/snippet}
      </Btn>
    </div>

    {#if lastBroadcast !== null}
      <p class="status-success" data-testid="release-notes-result">
        Sent {lastBroadcast.broadcast.sent}, failed {lastBroadcast.broadcast.failed}, skipped {lastBroadcast.broadcast.skipped}.
      </p>
    {/if}
  {/if}
</section>

<Confirm
  open={confirming}
  title="Broadcast release notes"
  danger
  confirmLabel="Send to subscribers"
  onCancel={() => (confirming = false)}
  onConfirm={() => void confirmedBroadcast()}>
  {#snippet body()}<p>This sends the announcement to all opt-in subscribers. Continue?</p>{/snippet}
</Confirm>
