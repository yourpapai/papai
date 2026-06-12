<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { DeferredPrompt, RecurringTask } from '../../shared/api-types.js'
  import { fetchDeferredPrompts, fetchRecurringTasks } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import Toolbar from '../../shared/ui/Toolbar.svelte'

  let userId = $state('')
  let recurring: RecurringTask[] = $state([])
  let deferred: DeferredPrompt[] = $state([])
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)
  let rootEl: HTMLElement | undefined = $state()
  let loaded = $state(false)

  async function loadReminders(): Promise<void> {
    if (userId.trim() === '') return
    loading = true
    error = null
    try {
      const normalizedUserId = userId.trim()
      const [nextRecurring, nextDeferred] = await Promise.all([
        fetchRecurringTasks(normalizedUserId),
        fetchDeferredPrompts(normalizedUserId),
      ])
      recurring = nextRecurring
      deferred = nextDeferred
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      error = err instanceof Error ? err.message : String(err)
      recurring = []
      deferred = []
    } finally {
      loading = false
    }
  }

  async function loadInitial(): Promise<void> {
    if (loaded) return
    loaded = true
  }

  $effect(() => {
    if (rootEl === undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadInitial()
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '0px' },
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  })
</script>

<section id="reminders" class="admin-section" bind:this={rootEl}>
  <Toolbar>
    <Field label="user id">
      <Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="reminders-user-id" />
    </Field>
    <Btn variant="primary" size="sm" testid="reminders-load" disabled={userId.trim() === '' || loading} onClick={() => { void loadReminders() }}>
      {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
    </Btn>
  </Toolbar>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if hasLoaded && recurring.length === 0 && deferred.length === 0}
    <p class="placeholder">No reminders found</p>
  {:else}
    <div class="reminders__grid">
      <Panel title="recurring tasks" count={recurring.length}>
        {#snippet body()}
          {#if recurring.length === 0}
            <p class="placeholder">No recurring reminders</p>
          {:else}
            <ul class="reminders__list">
              {#each recurring as r (r.id)}
                <li class="reminders__row">
                  <div class="reminders__row-main">
                    <span class="reminders__title">{r.title}</span>
                    <span class="reminders__sub">{r.rrule ?? 'one-shot'}</span>
                  </div>
                  <StatusPill status={r.enabled ? 'enabled' : 'paused'} />
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
      </Panel>

      <Panel title="deferred prompts" count={deferred.length}>
        {#snippet body()}
          {#if deferred.length === 0}
            <p class="placeholder">No deferred reminders</p>
          {:else}
            <ul class="reminders__list">
              {#each deferred as d (d.id)}
                <li class="reminders__row">
                  <div class="reminders__row-main">
                    <span class="reminders__title">{d.prompt}</span>
                    <span class="reminders__sub">fires at {d.fireAt}</span>
                  </div>
                  <StatusPill status={d.status} />
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
      </Panel>
    </div>
  {/if}
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .reminders__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 0 12px 12px;
  }
  .reminders__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }
  .reminders__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .reminders__row:last-child {
    border-bottom: none;
  }
  .reminders__row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .reminders__title {
    color: var(--fg);
  }
  .reminders__sub {
    color: var(--fg3);
    font-size: 11px;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    padding: 12px;
    color: var(--red, #e25);
  }
</style>
