<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import TreeView from '../../shared/TreeView.svelte'
  import type { Session } from '../dashboard-types.js'

  interface Props {
    userId: string
    session: Session
  }

  let { userId, session }: Props = $props()

  function tryParseStructured(content: string): unknown {
    const trimmed = content.trim()
    if (trimmed === '') return undefined
    const first = trimmed[0]
    if (first !== '{' && first !== '[') return undefined
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      return undefined
    }
  }

  const configEntries = $derived(session.config === undefined ? [] : Object.entries(session.config))

  const configRows = $derived(
    configEntries.map(([key, value]) => ({ key, value: value === null ? 'null' : String(value) })),
  )
  const configColumns = [
    { key: 'key' as const, label: 'Key' },
    { key: 'value' as const, label: 'Value' },
  ]
</script>

<div class="session-detail-section">
  <h4>Basic Info</h4>
  <SummaryList items={[
    { k: 'User ID', v: userId },
    { k: 'Last Accessed', v: formatTime(session.lastAccessed) },
    { k: 'History Length', v: `${session.historyLength} messages` },
    { k: 'Has Tools', v: session.hasTools === true ? 'yes' : 'no' },
  ]} />
</div>

{#if session.summary !== null && session.summary !== ''}
  <div class="session-detail-section">
    <h4>Summary</h4>
    <pre class="generated-text">{session.summary}</pre>
  </div>
{/if}

{#if configEntries.length > 0}
  <div class="session-detail-section">
    <h4>Configuration</h4>
    <DataTable columns={configColumns} rows={configRows} rowKey="key" />
  </div>
{/if}

{#if session.facts !== undefined && session.facts.length > 0}
  <div class="session-detail-section">
    <h4>Facts ({session.facts.length})</h4>
    <div class="facts-list">
      {#each session.facts as fact (fact.identifier)}
        <div class="fact-item">
          <div class="fact-summary">
            <span class="fact-title">{fact.title}</span>
            <span class="fact-id">{fact.identifier}</span>
          </div>
          <div class="tool-call-id">{fact.url}</div>
          <div class="tool-section">
            <KV k="Last seen" v={formatTime(fact.lastSeen)} />
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if session.instructions !== undefined && session.instructions !== null && session.instructions.length > 0}
  <div class="session-detail-section">
    <h4>Instructions ({session.instructions.length})</h4>
    <div class="instructions-list">
      {#each session.instructions as instruction (instruction.id)}
        <div class="instruction-item">
          <div class="instruction-text">{instruction.text}</div>
          <div class="instruction-meta">ID: {instruction.id} · Created: {formatTime(instruction.createdAt)}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if session.history !== undefined && session.history.length > 0}
  <div class="session-detail-section">
    <h4>Conversation History ({session.history.length} messages)</h4>
    <div class="history-list">
      {#each session.history as msg, i (i)}
        {@const role = msg.role ?? 'unknown'}
        {@const parsed = tryParseStructured(msg.content)}
        <div class="history-item {role}">
          <div class="history-role">{role}</div>
          {#if parsed !== undefined}
            <div class="history-content json">
              <pre class="tree-container"><TreeView value={parsed} /></pre>
            </div>
          {:else}
            <div class="history-content">{msg.content}</div>
          {/if}
          {#if msg.tool_call_id !== undefined}
            <div class="history-meta">Tool call ID: {msg.tool_call_id}</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .facts-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fact-item {
    background: var(--raised);
    border-left: 3px solid var(--accent);
    padding: 12px;
  }

  .fact-summary {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .fact-summary .fact-title {
    font-weight: bold;
    color: var(--accent);
  }

  .fact-id {
    color: var(--fg3);
    font-size: 11px;
    word-break: break-all;
  }

  /* Instructions list */
  .instructions-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .instruction-item {
    background: var(--surface);
    padding: 8px 12px;
    border-radius: 2px;
    border-left: 2px solid var(--warn);
  }

  .instruction-item .instruction-text {
    color: var(--fg);
    font-size: 11px;
    white-space: pre-wrap;
    margin-bottom: 4px;
  }

  .instruction-item .instruction-meta {
    color: var(--fg3);
    font-size: 10px;
  }

  /* History list */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-item {
    background: var(--surface);
    padding: 10px 12px;
    border-radius: 2px;
    border-left: 2px solid transparent;
  }

  .history-item.user {
    border-left-color: var(--info);
  }

  .history-item.assistant {
    border-left-color: var(--accent);
  }

  .history-item.system {
    border-left-color: var(--warn);
  }

  .history-item.tool {
    border-left-color: var(--danger);
  }

  .history-item .history-role {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--fg3);
    margin-bottom: 4px;
  }

  .history-item .history-content {
    color: var(--fg);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .history-item .history-meta {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--fg3);
  }
</style>
