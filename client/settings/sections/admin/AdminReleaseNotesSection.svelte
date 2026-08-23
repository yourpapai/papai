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
    type ReleaseLocale,
  } from '../../admin-fetchers.js'
  import type { ReleaseBroadcastResult, ReleaseNotesResponse } from '../../fetcher-schemas-release.js'

  const LOCALES: readonly ReleaseLocale[] = ['en', 'ru']

  let data = $state<ReleaseNotesResponse | null>(null)
  let activeLocale = $state<ReleaseLocale>('en')
  let bodiesByLocale = $state<Record<ReleaseLocale, string>>({ en: '', ru: '' })
  let error: string | null = $state(null)
  let busy = $state(false)
  let confirming = $state(false)
  let lastBroadcast = $state<ReleaseBroadcastResult | null>(null)
  let broadcasting = $state(false)
  let broadcastError = $state<string | null>(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function syncFromData(next: ReleaseNotesResponse): void {
    data = next
    bodiesByLocale = { en: next.bodies.en ?? '', ru: next.bodies.ru ?? '' }
    if (bodiesByLocale[activeLocale] === '' && next.rawBody !== null && next.rawBody !== undefined) {
      bodiesByLocale = { ...bodiesByLocale, [activeLocale]: next.rawBody }
    }
  }

  async function load(): Promise<void> {
    error = null
    busy = true
    try {
      syncFromData(await fetchReleaseNotes())
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function regenerate(locale: ReleaseLocale): Promise<void> {
    error = null
    busy = true
    try {
      const next = await regenerateReleaseNotes(locale)
      data = next
      bodiesByLocale = { ...bodiesByLocale, [locale]: next.bodies[locale] ?? '' }
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function save(locale: ReleaseLocale): Promise<void> {
    if (bodiesByLocale[locale].trim() === '') return
    error = null
    busy = true
    try {
      const next = await saveReleaseNotes(bodiesByLocale[locale], locale)
      data = next
      bodiesByLocale = { ...bodiesByLocale, [locale]: next.bodies[locale] ?? '' }
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function confirmedBroadcast(): Promise<void> {
    if (broadcasting) return
    broadcastError = null
    broadcasting = true
    lastBroadcast = null
    let ok = false
    let result: ReleaseBroadcastResult | null = null
    try {
      // Persist any dirty locale before broadcasting, newest edit first.
      for (const locale of LOCALES) {
        const saved = data?.bodies[locale] ?? null
        const draft = bodiesByLocale[locale]
        if (draft.trim() !== '' && draft !== (saved ?? '')) {
          data = await saveReleaseNotes(draft, locale)
        }
      }
      result = await broadcastReleaseNotes()
      ok = true
    } catch (err) {
      broadcastError = messageFrom(err)
    } finally {
      broadcasting = false
    }
    if (ok) {
      confirming = false
      lastBroadcast = result
      await load()
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="release-notes" class="settings-section">
  <PageHeader eyebrow="Admin" title="Release notes" />

  {#if error !== null}<p class="status-error" data-testid="release-notes-error">{error}</p>{/if}

  {#if busy && data === null}<p class="settings-section__caption" data-testid="release-notes-loading">Loading…</p>{/if}

  {#if data !== null}
    <p class="settings-section__caption">
      Version {data.version} · {data.counts.dm} DM + {data.counts.group} group subscriber(s)
      {#if data.broadcastAt !== null} · already broadcast{/if}
    </p>

    <div class="settings-actions" data-testid="release-notes-locale-switcher" role="tablist">
      {#each LOCALES as locale (locale)}
        <Btn
          variant={activeLocale === locale ? 'primary' : 'outline'}
          size="sm"
          testid="release-notes-locale-{locale}"
          onClick={() => (activeLocale = locale)}>
          {#snippet children()}{locale === 'en' ? 'English' : 'Русский'}{/snippet}
        </Btn>
      {/each}
    </div>

    {#each LOCALES as locale (locale)}
      {#if activeLocale === locale}
        <Field label="Announcement ({locale})">
          <Input
            value={bodiesByLocale[locale]}
            onInput={(v) => (bodiesByLocale = { ...bodiesByLocale, [locale]: v })}
            testid="release-notes-body-{locale}"
            multiline
            rows={8} />
        </Field>

        <div class="settings-actions">
          <Btn
            variant="outline"
            size="sm"
            disabled={busy}
            testid="release-notes-regenerate-{locale}"
            onClick={() => void regenerate(locale)}>
            {#snippet children()}Regenerate{/snippet}
          </Btn>
          <Btn
            variant="outline"
            size="sm"
            disabled={busy || bodiesByLocale[locale].trim() === ''}
            testid="release-notes-save-{locale}"
            onClick={() => void save(locale)}>
            {#snippet children()}Save{/snippet}
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            disabled={busy || bodiesByLocale[locale].trim() === ''}
            testid="release-notes-broadcast"
            onClick={() => {
              broadcastError = null
              confirming = true
            }}>
            {#snippet children()}Broadcast{/snippet}
          </Btn>
        </div>
      {/if}
    {/each}

    {#if lastBroadcast !== null}
      <p class={lastBroadcast.broadcast.failed === 0 ? 'status-success' : 'status-error'} data-testid="release-notes-result">
        Sent {lastBroadcast.broadcast.sent}, failed {lastBroadcast.broadcast.failed}, skipped {lastBroadcast.broadcast.skipped}.
      </p>
    {/if}
  {/if}
</section>

<Confirm
  open={confirming}
  title="Broadcast release notes"
  danger
  busy={broadcasting}
  confirmLabel="Send to subscribers"
  onCancel={() => (confirming = false)}
  onConfirm={() => void confirmedBroadcast()}>
  {#snippet body()}
    <p>This sends the announcement to all opt-in subscribers. Continue?</p>
    {#if broadcastError !== null}<p class="status-error">{broadcastError}</p>{/if}
  {/snippet}
</Confirm>
