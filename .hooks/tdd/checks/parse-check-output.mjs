const FILE_PATH_PATTERN = /(?:^|✗ )((?:src|tests|client)\/[^\s:,(]+)/mu

const SECTION_RE = /^✗ (\S+) failed \(exit code \d+\):\n---\n([\s\S]*?)\n---/gmu

export function parseCheckOutput(output) {
  if (!output) return null

  const failures = []
  let match

  while ((match = SECTION_RE.exec(output)) !== null) {
    const check = match[1]
    const body = match[2]
    const files = new Set()

    for (const line of body.split('\n')) {
      FILE_PATH_PATTERN.lastIndex = 0
      const fileMatch = FILE_PATH_PATTERN.exec(line)
      if (fileMatch) {
        files.add(fileMatch[1])
      }
    }

    failures.push({ check, files: [...files].sort() })
  }

  if (failures.length === 0) return null
  return failures
}
