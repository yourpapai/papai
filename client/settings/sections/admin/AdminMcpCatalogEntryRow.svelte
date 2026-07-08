<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  export interface DraftToolPolicyRow {
    tool: string
    permission: 'allow' | 'ask' | 'deny'
  }

  export interface DraftMcpCatalogEntry {
    name: string
    upstream_url: string
    host: string
    header: string
    default_tool_policy: '' | 'allow' | 'ask' | 'deny'
    toolPolicy: DraftToolPolicyRow[]
  }

  export function emptyDraftEntry(): DraftMcpCatalogEntry {
    return { name: '', upstream_url: '', host: '', header: '', default_tool_policy: '', toolPolicy: [] }
  }
</script>

<script lang="ts">
  import Btn from '../../../shared/ui/Btn.svelte'
  import Input from '../../../shared/ui/Input.svelte'

  interface Props {
    entry: DraftMcpCatalogEntry
    index: number
    disabled: boolean
    onRemove: () => void
  }

  let { entry, index, disabled, onRemove }: Props = $props()

  const POLICIES = ['allow', 'ask', 'deny'] as const

  function addToolPolicyRow(): void {
    entry.toolPolicy = [...entry.toolPolicy, { tool: '', permission: 'allow' }]
  }

  function removeToolPolicyRow(toolIndex: number): void {
    entry.toolPolicy = entry.toolPolicy.filter((_, i) => i !== toolIndex)
  }
</script>

<div class="mcp-catalog-entry" data-testid={`mcp-catalog-entry-${index}`}>
  <div class="mcp-catalog-entry__fields">
    <label class="mcp-catalog-entry__field">
      Name
      <Input
        value={entry.name}
        placeholder="Jira"
        {disabled}
        onInput={(v) => {
          entry.name = v
        }}
        testid={`mcp-catalog-name-${index}`} />
    </label>
    <label class="mcp-catalog-entry__field">
      Upstream URL
      <Input
        value={entry.upstream_url}
        placeholder="https://mcp.example.com/v1"
        {disabled}
        onInput={(v) => {
          entry.upstream_url = v
        }}
        testid={`mcp-catalog-upstream-url-${index}`} />
    </label>
    <label class="mcp-catalog-entry__field">
      Host
      <Input
        value={entry.host}
        placeholder="mcp.example.com"
        {disabled}
        onInput={(v) => {
          entry.host = v
        }}
        testid={`mcp-catalog-host-${index}`} />
    </label>
    <label class="mcp-catalog-entry__field">
      Header (optional)
      <Input
        value={entry.header}
        placeholder="Authorization: Bearer …"
        {disabled}
        onInput={(v) => {
          entry.header = v
        }}
        testid={`mcp-catalog-header-${index}`} />
    </label>
    <label class="mcp-catalog-entry__field">
      Default tool policy
      <select
        data-testid={`mcp-catalog-default-policy-${index}`}
        value={entry.default_tool_policy}
        {disabled}
        onchange={(e) => {
          entry.default_tool_policy = (e.currentTarget as HTMLSelectElement).value as DraftMcpCatalogEntry['default_tool_policy']
        }}>
        <option value="">Unset</option>
        {#each POLICIES as p (p)}
          <option value={p}>{p}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="mcp-catalog-entry__tool-policy">
    <h4 class="mcp-catalog-entry__tool-policy-heading">Per-tool policy overrides</h4>
    {#each entry.toolPolicy as row, toolIndex (toolIndex)}
      <div class="mcp-catalog-entry__tool-policy-row">
        <Input
          value={row.tool}
          placeholder="tool_name"
          {disabled}
          onInput={(v) => {
            row.tool = v
          }}
          testid={`mcp-catalog-tool-name-${index}-${toolIndex}`} />
        <select
          data-testid={`mcp-catalog-tool-permission-${index}-${toolIndex}`}
          value={row.permission}
          {disabled}
          onchange={(e) => {
            row.permission = (e.currentTarget as HTMLSelectElement).value as DraftToolPolicyRow['permission']
          }}>
          {#each POLICIES as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
        <Btn
          variant="ghost"
          size="sm"
          testid={`mcp-catalog-tool-remove-${index}-${toolIndex}`}
          {disabled}
          onClick={() => removeToolPolicyRow(toolIndex)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      </div>
    {/each}
    <Btn
      variant="secondary"
      size="sm"
      testid={`mcp-catalog-tool-add-${index}`}
      {disabled}
      onClick={addToolPolicyRow}>
      {#snippet children()}Add tool policy{/snippet}
    </Btn>
  </div>

  <div class="mcp-catalog-entry__actions">
    <Btn variant="danger" size="sm" testid={`mcp-catalog-remove-${index}`} {disabled} onClick={onRemove}>
      {#snippet children()}Remove server{/snippet}
    </Btn>
  </div>
</div>

<style>
  .mcp-catalog-entry {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control, 4px);
  }
  .mcp-catalog-entry__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
  }
  .mcp-catalog-entry__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }
  .mcp-catalog-entry__field select {
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .mcp-catalog-entry__tool-policy {
    display: grid;
    gap: 8px;
  }
  .mcp-catalog-entry__tool-policy-heading {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
    margin: 0;
  }
  .mcp-catalog-entry__tool-policy-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mcp-catalog-entry__tool-policy-row select {
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .mcp-catalog-entry__actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
