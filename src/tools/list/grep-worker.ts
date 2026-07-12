import { parentPort, workerData } from 'node:worker_threads'
import { searchWithNode } from './grep-node-search.ts'

interface WorkerInput {
  pattern: string
  searchPath: string
  glob: string | undefined
  caseSensitive: boolean
}

const input = workerData as WorkerInput

searchWithNode(input.pattern, input.searchPath, input.glob, input.caseSensitive)
  .then(result => parentPort?.postMessage({ ok: true, result }))
  .catch((error: unknown) => parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
