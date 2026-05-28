import fs from 'node:fs'
import path from 'node:path'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

/**
 * @typedef {Object} PendingFailure
 * @property {string} file
 * @property {string} output
 */

/**
 * @typedef {Object} CoverageStats
 * @property {number} covered
 * @property {number} total
 */

/**
 * @typedef {Object} Surface
 * @property {string[]} exports
 * @property {Record<string, number>} signatures
 */

/**
 * @typedef {Object} SurfaceSnapshot
 * @property {Surface} surface
 * @property {CoverageStats | null} coverage
 * @property {string} filePath
 */

/**
 * @typedef {Object} Survivor
 * @property {string} mutator
 * @property {string} replacement
 * @property {number | undefined} line
 * @property {string} description
 */

/**
 * @typedef {Object} MutationSnapshot
 * @property {Survivor[]} survivors
 * @property {string} filePath
 */

/**
 * @typedef {Object} SessionStateData
 * @property {string[]} writtenTests
 * @property {PendingFailure | null} pendingFailure
 * @property {Map<string, SurfaceSnapshot>} surfaceSnapshots
 * @property {Map<string, MutationSnapshot>} mutationSnapshots
 * @property {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> | null} sessionMutationBaseline
 * @property {string[]} changedSourceFiles
 * @property {boolean} docReviewSuggested
 */

/**
 * File-based session state for TDD enforcement
 * Persists session data across process restarts
 */
export class SessionState {
  /** @type {string} */
  #filePath
  /** @type {SessionStateData | null} */
  #state

  /**
   * @param {string} sessionId
   * @param {string} stateDir
   */
  constructor(sessionId, stateDir) {
    this.#filePath = path.join(stateDir, `tdd-session-${sessionId}.json`)
    this.#state = null
  }

  #ensureLoaded() {
    if (this.#state !== null) return

    try {
      const stat = fs.statSync(this.#filePath)
      if (Date.now() - stat.mtimeMs > SESSION_TTL_MS) {
        fs.unlinkSync(this.#filePath)
        this.#state = this.#createEmptyState()
      } else {
        this.#state = JSON.parse(fs.readFileSync(this.#filePath, 'utf8'))
        // Restore Maps from plain objects
        this.#state.surfaceSnapshots = new Map(Object.entries(this.#state.surfaceSnapshots || {}))
        this.#state.mutationSnapshots = new Map(Object.entries(this.#state.mutationSnapshots || {}))
      }
    } catch {
      this.#state = this.#createEmptyState()
    }
  }

  /**
   * @returns {SessionStateData}
   */
  #createEmptyState() {
    return {
      writtenTests: [],
      pendingFailure: null,
      surfaceSnapshots: new Map(),
      mutationSnapshots: new Map(),
      sessionMutationBaseline: null,
      needsRecheck: true,
      changedSourceFiles: [],
      docReviewSuggested: false,
    }
  }

  #persist() {
    const stateForFile = {
      ...this.#state,
      surfaceSnapshots: Object.fromEntries(this.#state.surfaceSnapshots),
      mutationSnapshots: Object.fromEntries(this.#state.mutationSnapshots),
    }

    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true })
    const tmp = `${this.#filePath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(stateForFile))
    fs.renameSync(tmp, this.#filePath)
  }

  // Core session state

  /**
   * @returns {string[]}
   */
  getWrittenTests() {
    this.#ensureLoaded()
    return this.#state.writtenTests
  }

  /**
   * @param {string} testPath
   * @returns {void}
   */
  addWrittenTest(testPath) {
    this.#ensureLoaded()
    this.#state.writtenTests.push(testPath)
    this.#persist()
  }

  /**
   * @returns {PendingFailure | null}
   */
  getPendingFailure() {
    this.#ensureLoaded()
    return this.#state.pendingFailure
  }

  /**
   * @param {string} file
   * @param {string} output
   * @returns {void}
   */
  setPendingFailure(file, output) {
    this.#ensureLoaded()
    this.#state.pendingFailure = { file, output }
    this.#persist()
  }

  /**
   * @returns {void}
   */
  clearPendingFailure() {
    this.#ensureLoaded()
    this.#state.pendingFailure = null
    this.#persist()
  }

  getNeedsRecheck() {
    this.#ensureLoaded()
    return this.#state.needsRecheck
  }

  setNeedsRecheck(value) {
    this.#ensureLoaded()
    this.#state.needsRecheck = value
    this.#persist()
  }

  // Changed source files and doc review

  /**
   * @returns {string[]}
   */
  getChangedSourceFiles() {
    this.#ensureLoaded()
    return this.#state.changedSourceFiles
  }

  /**
   * @param {string} filePath
   * @returns {void}
   */
  addChangedSourceFile(filePath) {
    this.#ensureLoaded()
    if (!this.#state.changedSourceFiles.includes(filePath)) {
      this.#state.changedSourceFiles.push(filePath)
      this.#persist()
    }
  }

  /**
   * @returns {boolean}
   */
  getDocReviewSuggested() {
    this.#ensureLoaded()
    return this.#state.docReviewSuggested
  }

  /**
   * @param {boolean} value
   * @returns {void}
   */
  setDocReviewSuggested(value) {
    this.#ensureLoaded()
    this.#state.docReviewSuggested = value
    this.#persist()
  }

  // Surface snapshots (check [2] and [6])

  /**
   * @param {string} fileKey
   * @returns {SurfaceSnapshot | null}
   */
  getSurfaceSnapshot(fileKey) {
    this.#ensureLoaded()
    return this.#state.surfaceSnapshots.get(fileKey) ?? null
  }

  /**
   * @param {string} fileKey
   * @param {SurfaceSnapshot} data
   * @returns {void}
   */
  setSurfaceSnapshot(fileKey, data) {
    this.#ensureLoaded()
    this.#state.surfaceSnapshots.set(fileKey, data)
    this.#persist()
  }

  // Mutation snapshots (check [3] and [7])

  /**
   * @param {string} fileKey
   * @returns {MutationSnapshot | null}
   */
  getMutationSnapshot(fileKey) {
    this.#ensureLoaded()
    return this.#state.mutationSnapshots.get(fileKey) ?? null
  }

  /**
   * @param {string} fileKey
   * @param {MutationSnapshot} data
   * @returns {void}
   */
  setMutationSnapshot(fileKey, data) {
    this.#ensureLoaded()
    this.#state.mutationSnapshots.set(fileKey, data)
    this.#persist()
  }

  // Session-level mutation baseline (all src files)

  /**
   * @param {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>>} baseline
   * @returns {void}
   */
  setSessionMutationBaseline(baseline) {
    this.#ensureLoaded()
    this.#state.sessionMutationBaseline = baseline
    this.#persist()
  }

  /**
   * @returns {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> | null}
   */
  getSessionMutationBaseline() {
    this.#ensureLoaded()
    return this.#state.sessionMutationBaseline ?? null
  }
}
