<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
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

  const summaryTone = (s: ToolDomainSummary): 'accent' | 'warn' | 'danger' | 'mute' => {
    if (s === 'allow') return 'accent'
    if (s === 'ask') return 'warn'
    if (s === 'deny') return 'danger'
    return 'mute'
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
    <Btn variant="ghost" size="sm" onClick={() => void load(contextId)}>{#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}</Btn>
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
            <span data-testid={`domain-summary-${domain.domain}`}>
              <Pill tone={summaryTone(domain.summary)}>{#snippet children()}{domain.summary}{/snippet}</Pill>
            </span>
            <span class="settings-tools__domain-toggle">
              <Btn variant="ghost" size="sm" testid={`domain-toggle-${domain.domain}`} onClick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
                {#snippet children()}{domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
              </Btn>
            </span>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                <li class="settings-tools__tool">
                  <span class="settings-tools__name">{tool.name}</span>
                  <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                  <div class="settings-tools__perm-group" role="group" aria-label={`Permission for ${tool.name}`}>
                    <Btn variant={tool.permission === 'allow' ? 'primary' : 'secondary'} size="sm" testid={`tool-perm-allow-${tool.name}`} onClick={() => void onSetToolPermission(tool.name, 'allow')}>
                      {#snippet children()}Allow{/snippet}
                    </Btn>
                    <Btn variant={tool.permission === 'ask' ? 'primary' : 'secondary'} size="sm" testid={`tool-perm-ask-${tool.name}`} onClick={() => void onSetToolPermission(tool.name, 'ask')}>
                      {#snippet children()}Ask{/snippet}
                    </Btn>
                    <Btn variant={tool.permission === 'deny' ? 'primary' : 'secondary'} size="sm" testid={`tool-perm-deny-${tool.name}`} onClick={() => void onSetToolPermission(tool.name, 'deny')}>
                      {#snippet children()}Deny{/snippet}
                    </Btn>
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
    <EmptyState title="No togglable tools" hint="No togglable tools for this context." />
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
  .settings-tools__domain-toggle {
    margin-left: auto;
  }
  .settings-tools__perm-group {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
</style>
