<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Pill from '../../shared/ui/Pill.svelte'

  import type { ToolDomainView, ToolRisk } from '../fetcher-schemas.js'
  import { fetchTools, toggleTool } from '../fetchers.js'

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

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = await fetchTools(id)
      domains = result.domains
      for (const d of result.domains) {
        if (!(d.domain in expanded)) {
          expanded[d.domain] = true
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onToggleDomain(domain: string): Promise<void> {
    try {
      const result = await toggleTool({ kind: 'domain', domain, contextId })
      domains = result.domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function onToggleTool(tool: string): Promise<void> {
    try {
      const result = await toggleTool({ kind: 'tool', tool, contextId })
      domains = result.domains
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
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if domains.length === 0}
    <p class="placeholder">No togglable tools for this context.</p>
  {:else}
    <div class="settings-tools">
      {#each domains as domain (domain.domain)}
        <div class="settings-tools__domain">
          <div class="settings-tools__domain-head">
            <button
              type="button"
              class="settings-tools__expand"
              onclick={() => (expanded[domain.domain] = !expanded[domain.domain])}>
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain}
            </button>
            <span class="settings-tools__status">{domain.status}</span>
            <button
              type="button"
              data-testid={`domain-toggle-${domain.domain}`}
              onclick={() => void onToggleDomain(domain.domain)}>
              {domain.status === 'off' ? 'Enable all' : 'Disable all'}
            </button>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                <li class="settings-tools__tool">
                  <span class="settings-tools__name">{tool.name}</span>
                  <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                  <button
                    type="button"
                    data-testid={`tool-toggle-${tool.name}`}
                    onclick={() => void onToggleTool(tool.name)}>
                    {tool.enabled ? 'Disable' : 'Enable'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
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
  .settings-tools__status {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
  }
  .settings-tools__domain-head button:last-child,
  .settings-tools__tool button {
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
</style>
