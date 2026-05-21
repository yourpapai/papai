<script lang="ts">
  import BillingPanel from './billing/BillingPanel.svelte'
  import SubjectDetail from './billing/SubjectDetail.svelte'
  import { fetchBillingDetail } from './billing/fetchers.js'
  import ContextChips from './components/ContextChips.svelte'
  import ContextPanel from './components/ContextPanel.svelte'
  import FailureDetail from './components/FailureDetail.svelte'
  import Header from './components/Header.svelte'
  import LogDetail from './components/LogDetail.svelte'
  import LogExplorer from './components/LogExplorer.svelte'
  import MemosPanel from './components/MemosPanel.svelte'
  import Modal from '../shared/Modal.svelte'
  import NotificationsPanel from './components/NotificationsPanel.svelte'
  import RemindersPanel from './components/RemindersPanel.svelte'
  import SessionDetail from './components/SessionDetail.svelte'
  import SessionsList from './components/SessionsList.svelte'
  import ToolFailuresPanel from './components/ToolFailuresPanel.svelte'
  import TraceDetail from './components/TraceDetail.svelte'
  import TraceList from './components/TraceList.svelte'
  import TurnDetail from './components/TurnDetail.svelte'
  import TurnsPanel from './components/TurnsPanel.svelte'
  import StatsPanel from './stats/StatsPanel.svelte'
  import SubjectStatsPanel from './stats/SubjectStatsPanel.svelte'

  import { dashboard } from './dashboard.svelte.js'
  import { fetchInitialLogs, parseLogsArray, collectScopes } from './log-bootstrap.js'
  import { setupEventSource } from './sse.js'
  import type { BillingSubject, Session, LogEntry, LlmTrace, Turn, ToolFailure } from './dashboard-types.js'

  let selectedSession: { userId: string; session: Session } | null = $state(null)
  let selectedTrace: LlmTrace | null = $state(null)
  let selectedLog: { entry: LogEntry; index: number } | null = $state(null)
  let selectedTurn: Turn | null = $state(null)
  let selectedFailure: ToolFailure | null = $state(null)
  let selectedBillingSubject: BillingSubject | null = $state(null)

  async function openBillingSubject(subject: BillingSubject): Promise<void> {
    selectedBillingSubject = subject
    try {
      const detail = await fetchBillingDetail(subject.storageContextId, dashboard.billingWindow)
      dashboard.billingDetail = detail
    } catch {
      dashboard.billingDetail = null
    }
  }

  function closeBillingSubject(): void {
    selectedBillingSubject = null
    dashboard.billingDetail = null
  }

  $effect(() => {
    void (async () => {
      try {
        const rawLogs = await fetchInitialLogs()
        const parsed = parseLogsArray(rawLogs)
        dashboard.logs = parsed
        const scopes = collectScopes(parsed)
        for (const s of scopes) dashboard.logScopes.add(s)
      } catch {
        // SSE will populate from live events
      }
    })()

    const conn = setupEventSource(dashboard, (connected) => {
      dashboard.connected = connected
    })
    return () => conn.close()
  })

  function showLogsForTurn(turnId: string): void {
    dashboard.activeLogFilter.turnId = turnId
    document.getElementById('log-explorer')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<Header {dashboard} />
<ContextChips {dashboard} />

<main>
  <aside id="left-panel">
    <SessionsList {dashboard} onSelect={(userId, session) => (selectedSession = { userId, session })} />
    <TraceList {dashboard} onSelect={(trace) => (selectedTrace = trace)} />
  </aside>

  <div class="panel-grid">
    <TurnsPanel
      {dashboard}
      onShowTurn={(turn) => (selectedTurn = turn)}
      onShowLogsForTurn={showLogsForTurn} />
    <NotificationsPanel {dashboard} />
    <ToolFailuresPanel {dashboard} onShowFailure={(failure) => (selectedFailure = failure)} />
    <RemindersPanel {dashboard} />
    <MemosPanel {dashboard} />
    <ContextPanel {dashboard} />
    <BillingPanel
      {dashboard}
      onSelectSubject={(subject) => {
        void openBillingSubject(subject)
      }} />
    <StatsPanel {dashboard} />
  </div>

  <LogExplorer {dashboard} onSelectLog={(entry, index) => (selectedLog = { entry, index })} />
</main>

<Modal open={selectedSession !== null} title={selectedSession === null ? '' : `Session: ${selectedSession.userId}`} onClose={() => (selectedSession = null)}>
  {#snippet body()}
    {#if selectedSession !== null}
      <SessionDetail userId={selectedSession.userId} session={selectedSession.session} />
    {/if}
  {/snippet}
</Modal>

<Modal open={selectedTrace !== null} title={selectedTrace === null ? '' : `LLM Trace: ${selectedTrace.model}`} onClose={() => (selectedTrace = null)}>
  {#snippet body()}
    {#if selectedTrace !== null}
      <TraceDetail trace={selectedTrace} />
    {/if}
  {/snippet}
</Modal>

<Modal open={selectedLog !== null} title={selectedLog === null ? '' : `Log Entry #${selectedLog.index + 1}`} onClose={() => (selectedLog = null)}>
  {#snippet body()}
    {#if selectedLog !== null}
      <LogDetail entry={selectedLog.entry} />
    {/if}
  {/snippet}
</Modal>

<Modal open={selectedTurn !== null} title={selectedTurn === null ? '' : `Turn: ${selectedTurn.turnId}`} onClose={() => (selectedTurn = null)}>
  {#snippet body()}
    {#if selectedTurn !== null}
      <TurnDetail turn={selectedTurn} />
    {/if}
  {/snippet}
</Modal>

<Modal
  open={selectedFailure !== null}
  title={selectedFailure === null ? '' : `Tool Failure: ${typeof selectedFailure.data['toolName'] === 'string' ? selectedFailure.data['toolName'] : 'unknown'}`}
  onClose={() => (selectedFailure = null)}>
  {#snippet body()}
    {#if selectedFailure !== null}
      <FailureDetail failure={selectedFailure} />
    {/if}
  {/snippet}
</Modal>

<Modal
  open={selectedBillingSubject !== null}
  title={selectedBillingSubject === null
    ? ''
    : `Billing: ${selectedBillingSubject.displayName ?? selectedBillingSubject.storageContextId}`}
  onClose={closeBillingSubject}>
  {#snippet body()}
    {#if dashboard.billingDetail !== null}
      <SubjectDetail detail={dashboard.billingDetail} />
    {/if}
    {#if selectedBillingSubject !== null}
      <SubjectStatsPanel storageContextId={selectedBillingSubject.storageContextId} />
    {/if}
  {/snippet}
</Modal>
