<script lang="ts">
  import PropertiesTable from './PropertiesTable.svelte'
  import { formatTime, levelClass, levelName } from '../helpers.js'
  import type { LogEntry } from '../dashboard-types.js'

  interface Props {
    entry: LogEntry
  }

  let { entry }: Props = $props()

  const STANDARD = new Set(['time', 'level', 'msg', 'scope'])
  const extra = $derived.by(() => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(entry)) {
      if (!STANDARD.has(k)) out[k] = v
    }
    return out
  })

  const hasExtra = $derived(Object.keys(extra).length > 0)
</script>

<div class="log-detail-meta">
  <div class="log-detail-meta-item"><div class="label">Time</div><div class="value">{formatTime(entry.time)}</div></div>
  <div class="log-detail-meta-item">
    <div class="label">Level</div>
    <div class="value {levelClass(entry.level)}">{levelName(entry.level)} ({entry.level})</div>
  </div>
  <div class="log-detail-meta-item"><div class="label">Scope</div><div class="value">{entry.scope ?? 'none'}</div></div>
</div>

<div class="log-detail-section">
  <h4>Message</h4>
  <pre class="log-detail-msg">{entry.msg}</pre>
</div>

{#if hasExtra}
  <div class="log-detail-section">
    <h4>Properties</h4>
    <PropertiesTable obj={extra} />
  </div>
{/if}
