import process from 'node:process'
import { Config } from '../config.ts'
import { gray } from '../utils/colors.ts'

export interface StreamPart {
  content?: string
  thinking?: string
}

export type OnStreamPart = (part: StreamPart) => void

export interface StreamPrinter {
  onStreamPart: OnStreamPart
  didPrintAnything: () => boolean
  didPrintContent: () => boolean
}

const showThinking = Config.SHOW_THINKING

export function createStreamPrinter(colorize: (text: string) => string): StreamPrinter {
  let printedContent = false
  let printedThinking = false
  let lastPrintedKind: 'content' | 'thinking' | null = null
  let hinted = false

  const onStreamPart: OnStreamPart = (part: StreamPart) => {
    if (part.thinking) {
      if (!showThinking) {
        if (!hinted) {
          hinted = true
          printedThinking = true
          process.stderr.write(gray('(thinking…)\n'))
        }
        return
      }

      if (lastPrintedKind === 'content') {
        process.stderr.write('\n')
      }
      printedThinking = true
      lastPrintedKind = 'thinking'
      process.stderr.write(gray(part.thinking))
    }

    if (part.content) {
      if (lastPrintedKind === 'thinking') {
        process.stderr.write('\n')
      }
      printedContent = true
      lastPrintedKind = 'content'
      process.stderr.write(colorize(part.content))
    }
  }

  return {
    onStreamPart,
    didPrintAnything: () => printedContent || printedThinking,
    didPrintContent: () => printedContent,
  }
}
