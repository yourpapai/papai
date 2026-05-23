<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
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
</script>

<div class="session-detail-section">
  <h4>Basic Info</h4>
  <div class="session-detail-grid">
    <div class="session-detail-item"><div class="label">User ID</div><div class="value">{userId}</div></div>
    <div class="session-detail-item"><div class="label">Last Accessed</div><div class="value">{formatTime(session.lastAccessed)}</div></div>
    <div class="session-detail-item"><div class="label">History Length</div><div class="value">{session.historyLength} messages</div></div>
    <div class="session-detail-item">
      <div class="label">Workspace</div>
      <div class="value" class:null={session.workspaceId === null}>{session.workspaceId === null ? 'none' : session.workspaceId}</div>
    </div>
    <div class="session-detail-item"><div class="label">Has Tools</div><div class="value">{session.hasTools === true ? 'yes' : 'no'}</div></div>
  </div>
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
    <table class="config-table">
      <thead>
        <tr><th>Key</th><th>Value</th></tr>
      </thead>
      <tbody>
        {#each configEntries as [key, value] (key)}
          <tr>
            <td>{key}</td>
            <td class="value" class:null={value === null}>{value === null ? 'null' : value}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if session.facts !== undefined && session.facts.length > 0}
  <div class="session-detail-section">
    <h4>Facts ({session.facts.length})</h4>
    <div class="tool-calls-list">
      {#each session.facts as fact (fact.identifier)}
        <div class="tool-call-item">
          <div class="tool-call-summary">
            <span class="tool-name">{fact.title}</span>
            <span class="tool-id">{fact.identifier}</span>
          </div>
          <div class="tool-call-id">{fact.url}</div>
          <div class="tool-section">
            <div class="label">Last seen</div>
            <div class="value">{formatTime(fact.lastSeen)}</div>
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
