<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Pill from '../../shared/ui/Pill.svelte'

  import type { ToolDomainSummary, ToolDomainView, ToolPermission, ToolRisk } from '../fetcher-schemas.js'
  import { fetchTools, setToolPermission } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let domains: ToolDomainView[] = $state([])
  let expanded: Record<string, boolean> = $state({})
  let error: string | null = $state(null)
  let loading = $state(false)

  const riskTone = (risk: ToolRisk): 'mute' | 'info' | 'warn' | 'danger' => {
    if (risk === 'read') return 'mute'
    if (risk === 'write') return 'info'
    if (risk === 'open-world') return 'warn'
    return 'danger'
  }

  /** Cycle summary: partial → allow → ask → deny → allow */
  const nextDomainPermission = (summary: ToolDomainSummary): ToolPermission => {
    if (summary === 'partial' || summary === 'deny') return 'allow'
    if (summary === 'allow') return 'ask'
    return 'deny'
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    expanded = {}
    try {
      domains = (await fetchTools(id)).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onSetDomainPermission(domain: string, summary: ToolDomainSummary): Promise<void> {
    error = null
    const permission = nextDomainPermission(summary)
    try {
      domains = (await setToolPermission({ kind: 'domain', domain, permission, contextId })).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function onSetToolPermission(tool: string, permission: ToolPermission): Promise<void> {
    error = null
    try {
      domains = (await setToolPermission({ kind: 'tool', tool, permission, contextId })).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="tools" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Tools</p>
      <h2>Tools</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  {#if domains.length > 0}
    <div class="settings-tools">
      {#each domains as domain (domain.domain)}
        <div class="settings-tools__domain">
          <div class="settings-tools__domain-head">
            <button
              type="button"
              class="settings-tools__expand"
              data-testid={`domain-expand-${domain.domain}`}
              aria-expanded={expanded[domain.domain] === true}
              onclick={() => (expanded[domain.domain] = !expanded[domain.domain])}>
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain}
            </button>
            <span class="settings-tools__summary" data-testid={`domain-summary-${domain.domain}`}>{domain.summary}</span>
            <button
              type="button"
              data-testid={`domain-toggle-${domain.domain}`}
              onclick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
              {domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}
            </button>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                <li class="settings-tools__tool">
                  <span class="settings-tools__name">{tool.name}</span>
                  <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                  <div class="settings-tools__perm-group" role="group" aria-label={`Permission for ${tool.name}`}>
                    <button
                      type="button"
                      data-testid={`tool-perm-allow-${tool.name}`}
                      class:active={tool.permission === 'allow'}
                      onclick={() => void onSetToolPermission(tool.name, 'allow')}>
                      Allow
                    </button>
                    <button
                      type="button"
                      data-testid={`tool-perm-ask-${tool.name}`}
                      class:active={tool.permission === 'ask'}
                      onclick={() => void onSetToolPermission(tool.name, 'ask')}>
                      Ask
                    </button>
                    <button
                      type="button"
                      data-testid={`tool-perm-deny-${tool.name}`}
                      class:active={tool.permission === 'deny'}
                      onclick={() => void onSetToolPermission(tool.name, 'deny')}>
                      Deny
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if error === null}
    <p class="placeholder">No togglable tools for this context.</p>
  {/if}
</section>

<style>
  .settings-tools {
    display: grid;
    gap: 8px;
  }
  .settings-tools__domain {
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
  }
  .settings-tools__expand {
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .settings-tools__summary {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
  }
  .settings-tools__domain-head button:last-child {
    margin-left: auto;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 4px 8px;
    border-radius: 2px;
  }
  .settings-tools__list {
    list-style: none;
    margin: 0;
    padding: 0 10px 10px;
    display: grid;
    gap: 6px;
  }
  .settings-tools__tool {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .settings-tools__name {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-tools__perm-group {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .settings-tools__perm-group button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 4px 8px;
    border-radius: 2px;
    cursor: pointer;
  }
  .settings-tools__perm-group button.active {
    background: var(--strong);
    color: var(--bg);
  }
</style>
