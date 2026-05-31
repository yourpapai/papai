<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { sendAnnounce } from '../../admin-fetchers.js'
  import type { AnnounceResult } from '../../fetcher-schemas.js'

  let message = $state('')
  let error: string | null = $state(null)
  let result: AnnounceResult | null = $state(null)
  let sending = $state(false)

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
</script>

<section id="announce" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin</p>
      <h2>Announce</h2>
    </div>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void send() }}>
    <label style="flex: 1; min-width: 280px;">
      <span>Message</span>
      <textarea data-testid="announce-message" rows="3" value={message} oninput={(e) => (message = (e.target as HTMLTextAreaElement).value)}></textarea>
    </label>
    <button type="submit" data-testid="announce-send" disabled={sending}>{sending ? 'Sending…' : 'Send announcement'}</button>
  </form>

  {#if result !== null}
    <p class="status-success" data-testid="announce-result">
      Delivered to {result.successCount}/{result.totalUsers} (failed: {result.failCount}).
    </p>
  {/if}
</section>

<style>
  textarea {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
    font-family: var(--font-mono);
    width: 100%;
    resize: vertical;
  }
</style>
