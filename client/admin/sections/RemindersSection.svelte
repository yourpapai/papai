<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { DeferredPrompt, RecurringTask } from '../../shared/api-types.js'
  import { fetchDeferredPrompts, fetchRecurringTasks } from '../fetchers.js'

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

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    void loadReminders()
  }
</script>

<section id="reminders" class="admin-data-section admin-section" bind:this={rootEl}>
  <header class="admin-section-header">
    <div>
      <p class="eyebrow">Schedules</p>
      <h2 data-testid="admin-section-title">Reminders</h2>
    </div>
  </header>

  <form class="admin-filter-form" onsubmit={submit}>
    <label>
      <span>User ID</span>
      <input data-testid="reminders-user-id" bind:value={userId} placeholder="user id" type="text" />
    </label>
    <button data-testid="reminders-load" disabled={userId.trim() === '' || loading} type="submit">
      {loading ? 'Loading...' : 'Load'}
    </button>
  </form>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if hasLoaded && recurring.length === 0 && deferred.length === 0}
    <p class="placeholder">No reminders found</p>
  {:else}
    <div class="admin-subsection-grid">
      <section>
        <h3>Recurring</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Schedule</th>
                <th>Next run</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#if recurring.length === 0}
                <tr><td colspan="4">No recurring reminders</td></tr>
              {:else}
                {#each recurring as task (task.id)}
                  <tr>
                    <td>{task.title}</td>
                    <td>{task.rrule ?? 'One-shot'}</td>
                    <td>{task.nextRun ?? 'Not scheduled'}</td>
                    <td>{task.enabled ? 'Enabled' : 'Paused'}</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3>Deferred</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Prompt</th>
                <th>Fire at</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#if deferred.length === 0}
                <tr><td colspan="4">No deferred reminders</td></tr>
              {:else}
                {#each deferred as prompt (prompt.id)}
                  <tr>
                    <td>{prompt.id}</td>
                    <td>{prompt.prompt}</td>
                    <td>{prompt.fireAt}</td>
                    <td>{prompt.status}</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  {/if}
</section>
