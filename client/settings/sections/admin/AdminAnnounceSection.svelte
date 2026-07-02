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
  import { sendAnnounce } from '../../admin-fetchers.js'
  import type { AnnounceResult } from '../../fetcher-schemas-admin.js'

  let message = $state('')
  let error: string | null = $state(null)
  let result: AnnounceResult | null = $state(null)
  let sending = $state(false)
  let confirming = $state(false)

  async function send(): Promise<void> {
    const text = message.trim()
    if (text === '') return
    error = null
    result = null
    sending = true
    try {
      result = await sendAnnounce({ message: text })
      message = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      sending = false
    }
  }

  function requestSend(): void {
    if (message.trim() === '') return
    confirming = true
  }

  async function confirmedSend(): Promise<void> {
    confirming = false
    await send()
  }
</script>

<section id="announce" class="settings-section">
  <PageHeader eyebrow="Admin" title="Announce" />

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); requestSend() }}>
    <Field label="Message">
      <Input value={message} onInput={(v) => (message = v)} testid="announce-message" multiline rows={3} />
    </Field>
    <Btn variant="primary" type="submit" testid="announce-send" disabled={sending}>
      {#snippet children()}{sending ? 'Sending…' : 'Send announcement'}{/snippet}
    </Btn>
  </form>

  {#if result !== null}
    <p class="status-success" data-testid="announce-result">
      Delivered to {result.successCount}/{result.totalUsers} (failed: {result.failCount}).
    </p>
  {/if}
</section>

<Confirm
  open={confirming}
  title="Broadcast to all users"
  danger
  confirmLabel="Send to everyone"
  onCancel={() => (confirming = false)}
  onConfirm={() => void confirmedSend()}>
  {#snippet body()}<p>This sends the message to every user. Continue?</p>{/snippet}
</Confirm>
