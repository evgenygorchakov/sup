import type { FetchedDocument } from './document.ts'
import { Config } from '../../config.ts'

const MAX_CACHED_DOCUMENTS = 16
const MAX_CACHED_CHARS = 4_000_000

interface CacheEntry {
  storedAt: number
  document: FetchedDocument
}

const cachedDocuments = new Map<string, CacheEntry>()

export function documentCacheKey(url: string, byteLimit: number): string {
  return `${byteLimit} ${url}`
}

export function readCachedDocument(key: string): FetchedDocument | null {
  const entry = cachedDocuments.get(key)
  if (!entry) {
    return null
  }

  if (Date.now() - entry.storedAt >= Config.FETCH_URL_CACHE_TTL_MS) {
    cachedDocuments.delete(key)
    return null
  }

  return entry.document
}

function storedChars(): number {
  let total = 0
  for (const entry of cachedDocuments.values()) {
    total += entry.document.markdown.length
  }
  return total
}

export function writeCachedDocument(key: string, document: FetchedDocument): void {
  if (Config.FETCH_URL_CACHE_TTL_MS <= 0) {
    return
  }

  cachedDocuments.delete(key)
  cachedDocuments.set(key, { storedAt: Date.now(), document })

  let chars = storedChars()
  while (cachedDocuments.size > MAX_CACHED_DOCUMENTS || (chars > MAX_CACHED_CHARS && cachedDocuments.size > 1)) {
    const oldest = cachedDocuments.keys().next()
    if (oldest.done) {
      break
    }
    chars -= cachedDocuments.get(oldest.value)?.document.markdown.length ?? 0
    cachedDocuments.delete(oldest.value)
  }
}

export function clearDocumentCache(): void {
  cachedDocuments.clear()
}
