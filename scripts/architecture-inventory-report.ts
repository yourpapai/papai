import type { PieceRecord } from './architecture-inventory-model.js'

export interface InventoryOutputFile {
  readonly relativePath: string
  readonly content: string
}

export interface BuildInventoryOutputInput {
  readonly generatedAt: string
  readonly pieces: readonly PieceRecord[]
}

const joinLines = (lines: readonly string[]): string => lines.join('\n')

const listOrNone = (values: readonly string[]): string =>
  values.length === 0 ? '_None._' : values.map((value) => `- ${value}`).join('\n')

const primaryPathsText = (piece: PieceRecord): string => {
  if (piece.primaryPaths.length === 0) {
    return '_none_'
  }

  return piece.primaryPaths.join(', ')
}

const signalNamesText = (piece: PieceRecord): string => {
  if (piece.signals.length === 0) {
    return 'none'
  }

  return piece.signals.map((signal) => signal.name).join(', ')
}

const reviewRank = (piece: PieceRecord): number => {
  const unclearScore = piece.status === 'unclear' ? 100 : 0
  const overlapScore = piece.signals.some((signal) => signal.name === 'overlapping-implementation-detected') ? 50 : 0
  return unclearScore + overlapScore + piece.signals.length
}

const compareReviewRank = (left: PieceRecord, right: PieceRecord): number => {
  const rankDifference = reviewRank(right) - reviewRank(left)
  if (rankDifference !== 0) {
    return rankDifference
  }

  return left.pieceId.localeCompare(right.pieceId)
}

const renderSignalList = (piece: PieceRecord): string => {
  if (piece.signals.length === 0) {
    return '- no concerning signals currently observed'
  }

  return piece.signals
    .map((signal) => [`- \`${signal.name}\``, ...signal.evidence.map((evidence) => `  - ${evidence}`)].join('\n'))
    .join('\n')
}

const renderSection = (title: string, body: string): readonly string[] => [title, '', body, '']

const renderVariantSection = (piece: PieceRecord): readonly string[] =>
  renderSection(
    '## Variants Or Overlapping Pieces',
    listOrNone(
      piece.signals
        .filter((signal) => signal.name === 'variant-with-same-purpose')
        .flatMap((signal) => signal.evidence),
    ),
  )

const renderIdentitySections = (piece: PieceRecord): readonly string[] => [
  ...renderSection('## Name', piece.name),
  ...renderSection('## Type', piece.type),
  ...renderSection('## Status', piece.status),
  ...renderSection('## Summary', piece.summary),
  ...renderSection(
    '## Why It Exists',
    piece.sources.map((source) => `- ${source.kind}: ${source.location}`).join('\n'),
  ),
]

const renderOwnershipSections = (piece: PieceRecord): readonly string[] => [
  ...renderSection('## Primary Paths', listOrNone(piece.primaryPaths)),
  ...renderSection('## Secondary Paths', listOrNone(piece.secondaryPaths)),
  ...renderSection('## Entrypoints And Activation', listOrNone(piece.entrypoints)),
  ...renderSection(
    '## Runtime And Config Dependencies',
    listOrNone([...piece.runtimeDependencies, ...piece.configOrEnvDependencies]),
  ),
]

const renderRelationshipSections = (piece: PieceRecord): readonly string[] => [
  ...renderSection('## Related Tests', listOrNone(piece.relatedTests)),
  ...renderSection('## Related Docs', listOrNone(piece.relatedDocs)),
  ...renderSection('## Dependents And Consumers', listOrNone(piece.dependents)),
  ...renderVariantSection(piece),
]

const renderInventoryIndex = (input: Readonly<BuildInventoryOutputInput>): string =>
  joinLines([
    '# Architecture Inventory',
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '| Piece | Type | Status | Primary Paths | Dossier |',
    '| --- | --- | --- | --- | --- |',
    ...input.pieces.map(
      (piece) =>
        `| ${piece.name} | ${piece.type} | ${piece.status} | ${primaryPathsText(piece)} | pieces/${piece.pieceId}.md |`,
    ),
    '',
  ])

const renderSimpleMatrix = (
  title: string,
  pieces: readonly PieceRecord[],
  includePiece: (piece: PieceRecord) => boolean,
): string =>
  joinLines([
    `# ${title}`,
    '',
    '| Piece | Status | Notes |',
    '| --- | --- | --- |',
    ...pieces
      .filter((piece) => includePiece(piece))
      .map((piece) => `| ${piece.name} | ${piece.status} | ${signalNamesText(piece)} |`),
    '',
  ])

export const renderPieceDossier = (piece: PieceRecord): string =>
  joinLines([
    `# ${piece.name}`,
    '',
    ...renderIdentitySections(piece),
    ...renderOwnershipSections(piece),
    ...renderRelationshipSections(piece),
    ...renderSection('## Deletion-Candidate Signals', renderSignalList(piece)),
    ...renderSection('## Open Questions For Manual Review', listOrNone(piece.manualReviewQuestions)),
  ])

export const renderCandidateReviewQueue = (pieces: readonly PieceRecord[]): string =>
  joinLines([
    '# Candidate Review Queue',
    '',
    '| Piece | Type | Status | Signals | Dossier |',
    '| --- | --- | --- | --- | --- |',
    ...pieces
      .filter((piece) => piece.signals.length > 0)
      .toSorted(compareReviewRank)
      .map(
        (piece) =>
          `| ${piece.name} | ${piece.type} | ${piece.status} | ${piece.signals.map((signal) => signal.name).join(', ')} | pieces/${piece.pieceId}.md |`,
      ),
    '',
  ])

const hasOverlapSignals = (piece: PieceRecord): boolean =>
  piece.signals.some((signal) => {
    if (signal.name === 'overlapping-implementation-detected') {
      return true
    }

    return signal.name === 'variant-with-same-purpose'
  })

const hasDocsMismatchSignals = (piece: PieceRecord): boolean =>
  piece.signals.some((signal) => {
    if (signal.name === 'docs-code-mismatch') {
      return true
    }

    return signal.name === 'historical-docs-only'
  })

export const buildInventoryOutputFiles = (
  input: Readonly<BuildInventoryOutputInput>,
): readonly InventoryOutputFile[] => [
  {
    relativePath: 'inventory.md',
    content: renderInventoryIndex(input),
  },
  {
    relativePath: 'inventory.json',
    content: `${JSON.stringify(input, null, 2)}\n`,
  },
  {
    relativePath: 'candidate-review-queue.md',
    content: renderCandidateReviewQueue(input.pieces),
  },
  {
    relativePath: 'overlap-matrix.md',
    content: renderSimpleMatrix('Overlap Matrix', input.pieces, hasOverlapSignals),
  },
  {
    relativePath: 'orphan-matrix.md',
    content: renderSimpleMatrix(
      'Orphan Matrix',
      input.pieces,
      (piece) => piece.entrypoints.length === 0 && piece.dependents.length === 0,
    ),
  },
  {
    relativePath: 'docs-code-mismatch.md',
    content: renderSimpleMatrix('Docs Code Mismatch', input.pieces, hasDocsMismatchSignals),
  },
  {
    relativePath: 'test-presence-report.md',
    content: renderSimpleMatrix('Test Presence Report', input.pieces, (piece) => piece.relatedTests.length === 0),
  },
  ...input.pieces.map((piece) => ({
    relativePath: `pieces/${piece.pieceId}.md`,
    content: renderPieceDossier(piece),
  })),
]
