// Loads a dependency-light TypeScript module from the repo for Node tests (transpile only, no type check).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drcsfa-tests-'))

export const repoRoot = root

/**
 * Like loadTs, but returns a fresh, independent instance (module singletons are not shared),
 * e.g. to simulate several peers in one process.
 */
export function loadTsFresh(relPath) {
  compileTs(relPath)
  Object.keys(require.cache).forEach(key => { if (key.startsWith(outDir)) delete require.cache[key] })
  return require(compiledPath(relPath))
}

/** The instance of an already-loaded compiled module (e.g. a dependency of the last loadTsFresh). */
export function requireLoaded(relPath) {
  return require(compiledPath(relPath))
}

const compiledPath = (relPath) => path.join(outDir, relPath.replace(/\\/g, '/').replace(/\.ts$/, '.cjs'))
const compileTs = (relPath) => loadTsSync(relPath)

/** Transpiles `relPath` (and its relative imports) to CommonJS in a temp dir and requires it. */
export function loadTs(relPath) {
  return import(pathToFileURL(loadTsSync(relPath)).href).then(mod => mod.default ?? mod)
}

function loadTsSync(relPath) {
  const seen = new Map()
  const compile = (file) => {
    if (seen.has(file)) return seen.get(file)
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const target = path.join(outDir, rel.replace(/\.ts$/, '.cjs'))
    seen.set(file, target)
    let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    code = code.replace(/require\("(\.{1,2}\/[^"]+)"\)/g, (_, spec) => {
      const dep = path.resolve(path.dirname(file), spec) + '.ts'
      return `require(${JSON.stringify(compile(dep))})`
    })
    // Bare imports resolve from the repo's node_modules
    code = code.replace(/require\("([^.\/][^"]*)"\)/g, (_, spec) => `require(${JSON.stringify(require.resolve(spec))})`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, code)
    return target
  }
  return compile(path.join(root, relPath))
}
