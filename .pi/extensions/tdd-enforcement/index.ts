import { blockGitCheckoutDiscard } from '../../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitStash } from '../../../.hooks/git/checks/block-git-stash.mjs'
import { checkFull } from '../../../.hooks/tdd/checks/check-full.mjs'
import { enforceTdd } from '../../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { trackTestWrite } from '../../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../../.hooks/tdd/checks/verify-test-import.mjs'
import { getSessionsDir } from '../../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../../.hooks/tdd/session-state.mjs'

type BlockResult = {
  readonly decision: 'block'
  readonly reason: string
}

type NotifyLevel = 'info' | 'warning' | 'error'

type ToolCallEvent = {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: Record<string, unknown>
}

type ToolExecutionEndEvent = {
  readonly toolCallId: string
  readonly toolName: string
  readonly result: unknown
  readonly isError: boolean
}

type ExtensionContextLike = {
  readonly cwd: string
  readonly sessionManager: {
    readonly getSessionId: () => string
  }
  readonly ui: {
    readonly notify: (message: string, level?: NotifyLevel) => void
  }
}

type ExtensionApiLike = {
  readonly on: (eventName: string, handler: (event: unknown, ctx: unknown) => unknown) => void
}

type WriteHookContext = {
  readonly tool_name?: string
  readonly tool_input: Record<string, unknown> & { readonly file_path: string; readonly path?: string }
  readonly session_id: string
  readonly cwd: string
}

type PostWriteHookContext = {
  readonly tool_input: { readonly file_path: string }
  readonly session_id: string
  readonly cwd: string
}

type SessionStateLike = {
  readonly getNeedsRecheck: () => boolean
  readonly setNeedsRecheck: (value: boolean) => void
}

type TddDeps = {
  readonly blockGitStash: (ctx: {
    readonly tool_name?: string
    readonly tool_input: Record<string, unknown>
  }) => BlockResult | null
  readonly blockGitCheckoutDiscard: (ctx: {
    readonly tool_name?: string
    readonly tool_input: Record<string, unknown>
  }) => BlockResult | null
  readonly enforceWritePolicy: (ctx: WriteHookContext) => BlockResult | null
  readonly enforceTdd: (ctx: WriteHookContext) => BlockResult | null
  readonly trackTestWrite: (ctx: PostWriteHookContext) => null
  readonly verifyTestImport: (ctx: PostWriteHookContext) => BlockResult | null
  readonly checkFull: (ctx: { readonly cwd: string; readonly session_id: string }) => BlockResult | null
  readonly createSessionState: (sessionId: string, cwd: string) => SessionStateLike
}

const castBlockResult = (value: unknown): BlockResult | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return null
  if (!('decision' in value) || !('reason' in value)) return null
  const decision = value['decision']
  const reason = value['reason']
  if (decision !== 'block' || typeof reason !== 'string') return null
  return { decision, reason }
}

const defaultDeps: TddDeps = {
  blockGitStash,
  blockGitCheckoutDiscard,
  enforceWritePolicy: (ctx) => castBlockResult(enforceWritePolicy(ctx)),
  enforceTdd: (ctx) => castBlockResult(enforceTdd(ctx)),
  trackTestWrite: (ctx) => trackTestWrite(ctx),
  verifyTestImport: (ctx) => castBlockResult(verifyTestImport(ctx)),
  checkFull: (ctx) => castBlockResult(checkFull(ctx)),
  createSessionState: (sessionId, cwd) => new SessionState(sessionId, getSessionsDir(cwd)),
}

const isWritableToolName = (toolName: string): toolName is 'write' | 'edit' =>
  toolName === 'write' || toolName === 'edit'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && value !== undefined && typeof value === 'object'

const isToolCallEvent = (event: unknown): event is ToolCallEvent => {
  if (!isRecord(event)) return false
  return (
    'toolCallId' in event &&
    'toolName' in event &&
    'input' in event &&
    typeof event['toolCallId'] === 'string' &&
    typeof event['toolName'] === 'string' &&
    isRecord(event['input'])
  )
}

const isToolExecutionEndEvent = (event: unknown): event is ToolExecutionEndEvent => {
  if (!isRecord(event)) return false
  return (
    'toolCallId' in event &&
    'toolName' in event &&
    'isError' in event &&
    typeof event['toolCallId'] === 'string' &&
    typeof event['toolName'] === 'string' &&
    typeof event['isError'] === 'boolean'
  )
}

const isExtensionContextLike = (ctx: unknown): ctx is ExtensionContextLike => {
  if (!isRecord(ctx)) return false
  const sessionManager = ctx['sessionManager']
  const ui = ctx['ui']
  return (
    'cwd' in ctx &&
    'sessionManager' in ctx &&
    'ui' in ctx &&
    typeof ctx['cwd'] === 'string' &&
    isRecord(sessionManager) &&
    'getSessionId' in sessionManager &&
    typeof sessionManager['getSessionId'] === 'function' &&
    isRecord(ui) &&
    'notify' in ui &&
    typeof ui['notify'] === 'function'
  )
}

const isBashToolCallEvent = (
  event: ToolCallEvent,
): event is ToolCallEvent & {
  readonly toolName: 'bash'
  readonly input: { readonly command: string }
} => event.toolName === 'bash' && typeof event.input['command'] === 'string'

const toBlockResponse = (result: BlockResult | null): { readonly block: true; readonly reason: string } | undefined => {
  if (result === null) return undefined
  return { block: true, reason: result.reason }
}

const createWriteHookContext = (
  toolName: 'write' | 'edit',
  input: Record<string, unknown> & { readonly path: string },
  sessionId: string,
  cwd: string,
): WriteHookContext => ({
  tool_name: toolName,
  tool_input: { ...input, file_path: input['path'] },
  session_id: sessionId,
  cwd,
})

const createPostWriteHookContext = (filePath: string, sessionId: string, cwd: string): PostWriteHookContext => ({
  tool_input: { file_path: filePath },
  session_id: sessionId,
  cwd,
})

const getSessionId = (ctx: ExtensionContextLike): string => ctx.sessionManager.getSessionId()

const handleBashToolCall = (
  event: ToolCallEvent & { readonly toolName: 'bash'; readonly input: { readonly command: string } },
  deps: TddDeps,
): { readonly block: true; readonly reason: string } | undefined => {
  const bashInput = { tool_name: 'bash' as const, tool_input: { command: event.input['command'] } }
  return toBlockResponse(deps.blockGitStash(bashInput) ?? deps.blockGitCheckoutDiscard(bashInput))
}

const handleWriteToolCall = (
  event: ToolCallEvent,
  ctx: ExtensionContextLike,
  filePathsByToolCallId: Map<string, string>,
  deps: TddDeps,
): { readonly block: true; readonly reason: string } | undefined => {
  const pathValue = event.input['path']
  if (typeof pathValue !== 'string' || pathValue.length === 0) return undefined

  const writeInput = { ...event.input, path: pathValue } as Record<string, unknown> & { readonly path: string }
  filePathsByToolCallId.set(event.toolCallId, writeInput['path'])

  const toolName = event.toolName
  if (toolName !== 'write' && toolName !== 'edit') return undefined
  const hookContext = createWriteHookContext(toolName, writeInput, getSessionId(ctx), ctx.cwd)
  const writePolicyResult = deps.enforceWritePolicy(hookContext)
  if (writePolicyResult !== null) return toBlockResponse(writePolicyResult)

  const tddResult = deps.enforceTdd(hookContext)
  if (tddResult !== null) return toBlockResponse(tddResult)

  deps.createSessionState(getSessionId(ctx), ctx.cwd).setNeedsRecheck(true)
  return undefined
}

const handleToolCallEvent = (
  event: unknown,
  ctx: unknown,
  filePathsByToolCallId: Map<string, string>,
  deps: TddDeps,
): { readonly block: true; readonly reason: string } | undefined => {
  if (!isToolCallEvent(event)) return undefined
  if (!isExtensionContextLike(ctx)) return undefined

  if (isBashToolCallEvent(event)) return handleBashToolCall(event, deps)
  if (!isWritableToolName(event.toolName)) return undefined

  return handleWriteToolCall(event, ctx, filePathsByToolCallId, deps)
}

const handleToolExecutionEndEvent = (
  event: unknown,
  ctx: unknown,
  filePathsByToolCallId: Map<string, string>,
  deps: TddDeps,
): void => {
  if (!isToolExecutionEndEvent(event)) return
  if (!isExtensionContextLike(ctx)) return
  if (!isWritableToolName(event.toolName)) return
  if (event.isError) return

  const filePath = filePathsByToolCallId.get(event.toolCallId)
  if (filePath === undefined) return
  filePathsByToolCallId.delete(event.toolCallId)

  const hookContext = createPostWriteHookContext(filePath, getSessionId(ctx), ctx.cwd)
  deps.trackTestWrite(hookContext)

  const importResult = deps.verifyTestImport(hookContext)
  if (importResult !== null) {
    ctx.ui.notify(importResult.reason, 'error')
  }
}

const handleAgentEndEvent = (ctx: unknown, deps: TddDeps): void => {
  if (!isExtensionContextLike(ctx)) return

  const sessionState = deps.createSessionState(getSessionId(ctx), ctx.cwd)
  if (!sessionState.getNeedsRecheck()) {
    sessionState.setNeedsRecheck(true)
    return
  }

  const result = deps.checkFull({ cwd: ctx.cwd, session_id: getSessionId(ctx) })
  if (result === null) {
    sessionState.setNeedsRecheck(true)
    return
  }

  sessionState.setNeedsRecheck(false)
  ctx.ui.notify(result.reason, 'error')
}

export const registerTddEnforcement = (pi: ExtensionApiLike, deps: TddDeps = defaultDeps): void => {
  const filePathsByToolCallId = new Map<string, string>()

  pi.on('tool_call', (event, ctx) => {
    return handleToolCallEvent(event, ctx, filePathsByToolCallId, deps)
  })
  pi.on('tool_execution_end', (event, ctx) => {
    handleToolExecutionEndEvent(event, ctx, filePathsByToolCallId, deps)
  })
  pi.on('agent_end', (_event, ctx) => {
    handleAgentEndEvent(ctx, deps)
  })
}

export default function (pi: ExtensionApiLike): void {
  registerTddEnforcement(pi)
}
