import fs from 'node:fs'

/**
 * @typedef {Object} Surface
 * @property {string[]} exports
 * @property {Record<string, number>} signatures
 */

/**
 * Extract public API surface from a TS/JS source file.
 * Returns { exports: string[], signatures: Record<string, number> }
 *
 * Uses regex — accurate enough to detect gross new exports/params.
 * False negatives (e.g. complex dynamic exports) are acceptable; the goal is
 * catching unintentional surface expansion, not 100% coverage of all forms.
 *
 * @param {string} filePath
 * @returns {Surface}
 */
export function extractSurface(filePath) {
  const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const exports = []
  let m

  // export function/class/const/let/var/type/interface/enum Name
  const declPattern = /^export\s+(async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gmu
  while ((m = declPattern.exec(src)) !== null) exports.push(m[2])

  // export default function/class Name
  const defaultNamedPattern = /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gmu
  while ((m = defaultNamedPattern.exec(src)) !== null) exports.push(m[1])

  // export default Name (identifier) - captures the name being exported as default
  const defaultIdentifierPattern = /^export\s+default\s+(?!(?:function|class)\s)(\w+)/gmu
  while ((m = defaultIdentifierPattern.exec(src)) !== null) exports.push(m[1])

  // export { name1, name2 as alias }
  const namedPattern = /^export\s*\{([^}]+)\}/gmu
  while ((m = namedPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) =>
      exports.push(
        n
          .trim()
          .split(/\s+as\s+/u)
          .pop(),
      ),
    )

  // export { name1, name2 } from './module'
  // export { default as name } from './module'
  const reExportPattern = /^export\s*\{([^}]+)\}\s+from\s/gmu
  while ((m = reExportPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) =>
      exports.push(
        n
          .trim()
          .split(/\s+as\s+/u)
          .pop(),
      ),
    )

  // export * from './module' (marks as having re-exports)
  const starReExportPattern = /^export\s+\*\s+from\s/gmu
  if (starReExportPattern.test(src)) exports.push('*')

  // parameter counts for named functions (including async)
  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gmu
  const signatures = {}
  while ((m = fnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  // export default function name(params) - parameter count
  const defaultFnPattern = /^export\s+default\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gmu
  while ((m = defaultFnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  // export const/let name = (params) => ... - arrow function parameter count
  const arrowFnPattern = /^export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/gmu
  while ((m = arrowFnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  return { exports: [...new Set(exports)].sort(), signatures }
}
