import { spawn } from 'node:child_process'

type TimeoutToken = ReturnType<typeof setTimeout>

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
}

type ExtensionApiLike = {
  readonly on: (eventName: string, handler: (event: unknown, ctx: unknown) => unknown) => void
}

export type ReindexDeps = {
  readonly schedule: (delayMs: number, run: () => void) => TimeoutToken
  readonly cancel: (token: TimeoutToken) => void
  readonly spawnReindex: (cwd: string) => void
  readonly toRelativePath: (filePath: string, cwd: string) => string
  readonly getExtension: (filePath: string) => string
}

const INDEXED_ROOTS = ['src', 'client']
const INDEXED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

const defaultDeps: ReindexDeps = {
  schedule: (delayMs, run) => setTimeout(run, delayMs),
  cancel: (token) => {
    clearTimeout(token)
  },
  spawnReindex: (cwd) => {
    const child = spawn('bun', ['run', 'scripts/codeindex-cli.ts', 'reindex'], {
      cwd,
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
  },
  toRelativePath: (filePath, cwd) => (filePath.startsWith('/') ? filePath.slice(`${cwd}/`.length) : filePath),
  getExtension: (filePath) => {
    const dotIndex = filePath.lastIndexOf('.')
    if (dotIndex < 0) return ''
    return filePath.slice(dotIndex)
  },
}

export const shouldReindexPath = (
  filePath: string,
  cwd: string,
  deps: Pick<ReindexDeps, 'toRelativePath' | 'getExtension'> = defaultDeps,
): boolean => {
  const relPath = deps.toRelativePath(filePath, cwd)
  const extension = deps.getExtension(relPath)
  if (!INDEXED_EXTENSIONS.has(extension)) return false

  const isInsideIndexedRoot = INDEXED_ROOTS.some(
    (root) => relPath.startsWith(`${root}/`) || relPath.startsWith(`${root}\\`),
  )
  if (!isInsideIndexedRoot) return false

  return !relPath.includes('.test.') && !relPath.includes('.spec.')
}

const isWritableToolName = (toolName: string): toolName is 'write' | 'edit' | 'multiedit' =>
  toolName === 'write' || toolName === 'edit' || toolName === 'multiedit'

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
  return (
    'cwd' in ctx &&
    'sessionManager' in ctx &&
    typeof ctx['cwd'] === 'string' &&
    isRecord(sessionManager) &&
    'getSessionId' in sessionManager &&
    typeof sessionManager['getSessionId'] === 'function'
  )
}

const hasStringPath = (
  event: ToolCallEvent,
): event is ToolCallEvent & {
  readonly input: Record<string, unknown> & { readonly path: string }
} => typeof event.input['path'] === 'string'

const handleToolCall = (event: unknown, filePathsByToolCallId: Map<string, string>): undefined => {
  if (!isToolCallEvent(event)) return undefined
  if (!isWritableToolName(event.toolName)) return undefined

  if (hasStringPath(event)) {
    filePathsByToolCallId.set(event.toolCallId, event.input['path'])
  }

  return undefined
}

const handleToolExecutionEnd = (
  event: unknown,
  ctx: unknown,
  filePathsByToolCallId: Map<string, string>,
  pendingBySessionId: Map<string, TimeoutToken>,
  deps: ReindexDeps,
): void => {
  if (!isToolExecutionEndEvent(event)) return
  if (!isExtensionContextLike(ctx)) return
  if (!isWritableToolName(event.toolName)) return
  if (event.isError) return

  const filePath = filePathsByToolCallId.get(event.toolCallId)
  if (filePath === undefined) return
  filePathsByToolCallId.delete(event.toolCallId)

  if (!shouldReindexPath(filePath, ctx.cwd, deps)) return

  const sessionId = ctx.sessionManager.getSessionId()
  const existingTimeout = pendingBySessionId.get(sessionId)
  if (existingTimeout !== undefined) {
    deps.cancel(existingTimeout)
  }

  const timeoutToken = deps.schedule(600, () => {
    pendingBySessionId.delete(sessionId)
    deps.spawnReindex(ctx.cwd)
  })
  pendingBySessionId.set(sessionId, timeoutToken)
}

export const registerCodeindexReindex = (pi: ExtensionApiLike, deps: ReindexDeps = defaultDeps): void => {
  const filePathsByToolCallId = new Map<string, string>()
  const pendingBySessionId = new Map<string, TimeoutToken>()

  pi.on('tool_call', (event) => {
    handleToolCall(event, filePathsByToolCallId)
  })
  pi.on('tool_execution_end', (event, ctx) => {
    handleToolExecutionEnd(event, ctx, filePathsByToolCallId, pendingBySessionId, deps)
  })
}

export default function (pi: ExtensionApiLike): void {
  registerCodeindexReindex(pi)
}
