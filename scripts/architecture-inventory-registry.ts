import type { PieceCandidate, PieceRecord, PieceSource } from './architecture-inventory-model.js'
import { slugifyPieceName } from './architecture-inventory-model.js'

export interface RepositoryAssetMap {
  readonly sourcePaths: readonly string[]
  readonly scriptPaths: readonly string[]
  readonly testPaths: readonly string[]
  readonly docPaths: readonly string[]
}

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)].toSorted()

const uniqueSources = (sources: readonly PieceSource[]): readonly PieceSource[] => [
  ...sources
    .reduce((accumulator, source) => {
      accumulator.set(`${source.kind}:${source.location}`, source)
      return accumulator
    }, new Map<string, PieceSource>())
    .values(),
]

const pieceKey = (candidate: Pick<PieceCandidate, 'name' | 'type'>): string =>
  `${slugifyPieceName(candidate.name)}:${candidate.type}`

const stripTrailingSlash = (path: string): string => path.replace(/\/$/u, '')

const normalizedDeclaredPaths = (candidate: Pick<PieceCandidate, 'declaredPaths'>): readonly string[] =>
  uniqueStrings(candidate.declaredPaths.map(stripTrailingSlash))

const pathsOverlap = (left: string, right: string): boolean => {
  if (left === right) {
    return true
  }

  if (left.startsWith(`${right}/`)) {
    return true
  }

  return right.startsWith(`${left}/`)
}

const candidatesAlignByBoundary = (
  left: Pick<PieceCandidate, 'declaredPaths'>,
  right: Pick<PieceCandidate, 'declaredPaths'>,
): boolean => {
  const leftPaths = normalizedDeclaredPaths(left)
  const rightPaths = normalizedDeclaredPaths(right)

  if (leftPaths.length === 0 && rightPaths.length === 0) {
    return false
  }

  if (leftPaths.length === 0 || rightPaths.length === 0) {
    return true
  }

  return leftPaths.some((leftPath) => rightPaths.some((rightPath) => pathsOverlap(leftPath, rightPath)))
}

const hasBoundaryEvidence = (candidate: Pick<PieceCandidate, 'declaredPaths'>): boolean =>
  normalizedDeclaredPaths(candidate).length > 0

const mergeStatus = (left: PieceCandidate['status'], right: PieceCandidate['status']): PieceCandidate['status'] => {
  if (left === right) {
    return left
  }

  if (left === 'unclear') {
    return right
  }

  if (right === 'unclear') {
    return left
  }

  return 'unclear'
}

const mergeCandidates = (left: PieceCandidate, right: PieceCandidate): PieceCandidate => ({
  ...left,
  status: mergeStatus(left.status, right.status),
  summary: left.summary.length >= right.summary.length ? left.summary : right.summary,
  declaredPaths: uniqueStrings([...left.declaredPaths, ...right.declaredPaths]),
  aliases: uniqueStrings([...left.aliases, ...right.aliases]),
  tags: uniqueStrings([...left.tags, ...right.tags]),
  sources: uniqueSources([...left.sources, ...right.sources]),
})

const normalizeToken = (value: string): string => slugifyPieceName(value)

const GENERIC_OWNERSHIP_TOKENS = new Set(['tool', 'tools', 'workflow', 'workflows', 'group', 'groups', 'review'])

const pieceTokens = (piece: Pick<PieceCandidate, 'name' | 'aliases' | 'tags'>): readonly string[] =>
  uniqueStrings(
    [piece.name, ...piece.aliases, ...piece.tags]
      .flatMap((value) => normalizeToken(value).split('-'))
      .filter((token) => token.length >= 4)
      .filter((token) => !GENERIC_OWNERSHIP_TOKENS.has(token)),
  )

const pathOwnsPrefix = (prefix: string, relativePath: string): boolean => {
  const normalizedPrefix = stripTrailingSlash(prefix)
  if (relativePath === normalizedPrefix) {
    return true
  }

  return relativePath.startsWith(`${normalizedPrefix}/`)
}

const pathSegments = (relativePath: string): readonly string[] =>
  relativePath
    .split('/')
    .flatMap((segment) => normalizeToken(segment).split('-'))
    .filter((segment) => segment.length > 0)

const pathMatchesTokens = (tokens: readonly string[], relativePath: string): boolean => {
  const segments = pathSegments(relativePath)
  const matchingTokenCount = tokens.filter((token) => segments.includes(token)).length
  return matchingTokenCount >= 2
}

const pathMatchesPiece = (piece: PieceRecord, relativePath: string): boolean => {
  if (piece.primaryPaths.some((pathPrefix) => pathOwnsPrefix(pathPrefix, relativePath))) {
    return true
  }

  return pathMatchesTokens(pieceTokens(piece), relativePath)
}

const isEntrypoint = (relativePath: string): boolean => {
  if (/\/index\.(ts|js)$/u.test(relativePath)) {
    return true
  }

  return ['src/index.ts', 'src/bot.ts', 'codeindex/src/cli.ts'].includes(relativePath)
}

const inferEntrypoints = (piece: PieceRecord, assets: Readonly<RepositoryAssetMap>): readonly string[] =>
  uniqueStrings([
    ...assets.sourcePaths.filter((relativePath) => pathMatchesPiece(piece, relativePath) && isEntrypoint(relativePath)),
    ...assets.scriptPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)),
  ])

const manualReviewQuestionsFor = (piece: PieceRecord): readonly string[] => {
  const questions = [
    piece.primaryPaths.length === 0 ? `Which source path is the primary owner of ${piece.name}?` : null,
    piece.relatedTests.length === 0 ? `Is ${piece.name} intentionally untested, or is test coverage missing?` : null,
    piece.relatedDocs.length === 0 ? `Should ${piece.name} gain a stable architecture or user-facing document?` : null,
    piece.entrypoints.length === 0 ? `What is the current activation or entrypoint for ${piece.name}?` : null,
  ].filter((question): question is string => question !== null)

  return questions.length === 0 ? [`Does ${piece.name} still reflect the current architecture boundary?`] : questions
}

const buildEmptyRecord = (candidate: PieceCandidate): PieceRecord => ({
  ...candidate,
  pieceId: slugifyPieceName(candidate.name),
  primaryPaths: uniqueStrings(candidate.declaredPaths),
  secondaryPaths: [],
  entrypoints: [],
  relatedTests: [],
  relatedDocs: [],
  relatedScripts: [],
  configOrEnvDependencies: [],
  runtimeDependencies: [],
  dependents: [],
  signals: [],
  manualReviewQuestions: [],
})

const clusterCandidates = (candidates: readonly PieceCandidate[]): readonly PieceCandidate[] => {
  const groupedClusters: PieceCandidate[] = []
  const concreteCandidateCount = candidates.filter((candidate) => hasBoundaryEvidence(candidate)).length

  candidates.forEach((candidate) => {
    const isPathlessCandidate = !hasBoundaryEvidence(candidate)
    if (isPathlessCandidate) {
      if (concreteCandidateCount === 1) {
        const concreteClusterIndex = groupedClusters.findIndex((existing) => hasBoundaryEvidence(existing))
        if (concreteClusterIndex !== -1) {
          groupedClusters[concreteClusterIndex] = mergeCandidates(groupedClusters[concreteClusterIndex]!, candidate)
          return
        }
      }

      groupedClusters.push(candidate)
      return
    }

    const matchingIndex = groupedClusters.findIndex(
      (existing) => hasBoundaryEvidence(existing) && candidatesAlignByBoundary(existing, candidate),
    )
    if (matchingIndex === -1) {
      groupedClusters.push(candidate)
      return
    }

    groupedClusters[matchingIndex] = mergeCandidates(groupedClusters[matchingIndex]!, candidate)
  })

  return groupedClusters
}

const withStablePieceIds = (pieces: readonly PieceRecord[]): readonly PieceRecord[] => {
  const countsBySlug = pieces.reduce<Map<string, number>>((accumulator, piece) => {
    const existingCount = accumulator.get(piece.pieceId)
    if (existingCount === undefined) {
      accumulator.set(piece.pieceId, 1)
      return accumulator
    }

    accumulator.set(piece.pieceId, existingCount + 1)
    return accumulator
  }, new Map<string, number>())

  const seenBySlug = new Map<string, number>()

  return pieces.map((piece) => {
    const duplicateCount = countsBySlug.get(piece.pieceId)
    if (duplicateCount === undefined || duplicateCount <= 1) {
      return piece
    }

    const previousIndex = seenBySlug.get(piece.pieceId)
    const nextIndex = previousIndex === undefined ? 1 : previousIndex + 1
    seenBySlug.set(piece.pieceId, nextIndex)

    return {
      ...piece,
      pieceId: `${piece.pieceId}-${nextIndex}`,
    }
  })
}

const groupCandidatesByKey = (candidates: readonly PieceCandidate[]): ReadonlyMap<string, readonly PieceCandidate[]> =>
  candidates.reduce<Map<string, readonly PieceCandidate[]>>((accumulator, candidate) => {
    const key = pieceKey(candidate)
    const groupedCandidates = accumulator.get(key)
    if (groupedCandidates === undefined) {
      accumulator.set(key, [candidate])
      return accumulator
    }

    accumulator.set(key, groupedCandidates.concat(candidate))
    return accumulator
  }, new Map<string, readonly PieceCandidate[]>())

export const buildCanonicalRegistry = (candidates: readonly PieceCandidate[]): readonly PieceRecord[] =>
  withStablePieceIds(
    [...groupCandidatesByKey(candidates).values()]
      .flatMap((groupedCandidates) => clusterCandidates(groupedCandidates))
      .map((candidate) => buildEmptyRecord(candidate))
      .toSorted((left, right) => left.pieceId.localeCompare(right.pieceId)),
  )

const ownedSourcePathsFor = (piece: PieceRecord, sourcePaths: readonly string[]): readonly string[] =>
  uniqueStrings(sourcePaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)))

export const attachRepositoryAssets = (
  pieces: readonly PieceRecord[],
  assets: Readonly<RepositoryAssetMap>,
): readonly PieceRecord[] =>
  pieces.map((piece) => {
    const secondaryPaths = ownedSourcePathsFor(piece, assets.sourcePaths).filter(
      (relativePath) => !piece.primaryPaths.includes(relativePath),
    )
    const relatedScripts = uniqueStrings(
      assets.scriptPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)),
    )
    const relatedTests = uniqueStrings(assets.testPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)))
    const relatedDocs = uniqueStrings(assets.docPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)))
    const entrypoints = inferEntrypoints(piece, assets)
    const enrichedPiece: PieceRecord = {
      ...piece,
      secondaryPaths,
      relatedScripts,
      relatedTests,
      relatedDocs,
      entrypoints,
    }

    return {
      ...enrichedPiece,
      manualReviewQuestions: manualReviewQuestionsFor(enrichedPiece),
    }
  })
