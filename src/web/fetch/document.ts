import type { Heading } from '../text/headings.ts'

export interface FetchedDocument {
  finalUrl: string
  contentType: string
  bytesRead: number
  byteLimit: number
  downloadCutOff: boolean
  markdown: string
  headings: Heading[]
}
