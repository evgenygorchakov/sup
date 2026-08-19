import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { Config } from '../config.ts'
import { gray } from '../utils/colors.ts'
import { isTimeout } from '../utils/timeout.ts'

const FENCE = '```'
const SENTENCE_END = /[.!?…][*_`~"'»)\]]*(?=\s|$)/
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/gm
const INLINE_CODE = /`[^`\n]*`/g
const SPEAKABLE = /\p{L}/u
const MIN_PHRASE_LENGTH = 2

type Synthesis = { ok: true, audio: Buffer } | { ok: false }

export interface Speaker {
  speak: (text: string) => void
  stop: () => void
}

function notify(text: string): void {
  process.stderr.write(`${gray(text)}\n`)
}

function stripMarkup(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(INLINE_CODE, ' ')
    .replace(LIST_MARKER, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTable(line: string): boolean {
  return line.trimStart().startsWith('|')
}

function dropUnreadableLines(text: string): string {
  let inCode = false
  let readable = ''
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith(FENCE)) {
      inCode = !inCode
      continue
    }
    if (inCode || isTable(line)) {
      continue
    }
    readable += `${line}\n`
  }
  return readable
}

function splitIntoPhrases(text: string): string[] {
  const phrases: string[] = []
  let rest = text

  while (true) {
    const match = SENTENCE_END.exec(rest)
    if (!match) {
      break
    }
    const cut = match.index + match[0].length
    phrases.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) {
    phrases.push(rest)
  }

  return phrases
    .map(stripMarkup)
    .filter(phrase => phrase.length >= MIN_PHRASE_LENGTH && SPEAKABLE.test(phrase))
}

function createSpeaker(): Speaker {
  const queue: string[] = []
  let draining = false
  let player: ChildProcess | null = null
  let generation = 0
  let pendingRequest: AbortController | null = null
  let prefetched: { phrase: string, synthesis: Promise<Synthesis> } | null = null

  process.once('exit', () => {
    player?.kill('SIGKILL')
  })

  const disable = (reason: string): void => {
    Config.USE_TTS = false
    queue.length = 0
    prefetched = null
    notify(`(speech off: ${reason} — turn it back on with /tts once it is fixed)`)
  }

  const synthesize = async (text: string): Promise<Synthesis> => {
    const request = new AbortController()
    pendingRequest = request
    try {
      const response = await fetch(`${Config.TTS_HOST}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          ...Config.TTS_VOICE ? { voice: Config.TTS_VOICE } : {},
          ...Config.TTS_RATE ? { rate: Config.TTS_RATE } : {},
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(Config.TTS_TIMEOUT_MS)]),
      })
      if (!response.ok) {
        disable(`synthesis server replied ${response.status}`)
        return { ok: false }
      }
      return { ok: true, audio: Buffer.from(await response.arrayBuffer()) }
    }
    catch (error) {
      if (!request.signal.aborted) {
        disable(isTimeout(error)
          ? `${Config.TTS_HOST} went quiet for ${Config.TTS_TIMEOUT_MS} ms`
          : `no connection to ${Config.TTS_HOST}`)
      }
      return { ok: false }
    }
    finally {
      pendingRequest = null
    }
  }

  const play = (audio: Buffer): Promise<void> => new Promise((resolve) => {
    const started = spawn('paplay', ['--file-format=wav'], { stdio: ['pipe', 'ignore', 'pipe'] })
    player = started

    let settled = false
    let complaint = ''

    const settle = (reason?: string): void => {
      if (settled) {
        return
      }
      settled = true
      player = null
      if (reason) {
        disable(reason)
      }
      resolve()
    }

    started.stderr?.on('data', (chunk: Buffer) => {
      if (!complaint) {
        complaint = chunk.toString().trim().split('\n')[0] ?? ''
      }
    })
    started.on('error', () => {
      settle('paplay not found (package pulseaudio-utils)')
    })
    started.on('close', (code) => {
      settle(code ? `paplay exited with code ${code}${complaint ? ` — ${complaint}` : ''}` : undefined)
    })
    started.stdin?.on('error', () => {})
    started.stdin?.end(audio)
  })

  const take = (phrase: string): Promise<Synthesis> => {
    const ready = prefetched?.phrase === phrase ? prefetched.synthesis : null
    prefetched = null
    return ready ?? synthesize(phrase)
  }

  const drain = async (): Promise<void> => {
    if (draining) {
      return
    }
    draining = true
    try {
      while (Config.USE_TTS) {
        const spokenGeneration = generation
        const phrase = queue.shift()
        if (phrase === undefined) {
          break
        }
        const synthesis = await take(phrase)
        if (!synthesis.ok || generation !== spokenGeneration) {
          continue
        }
        const upcoming = queue[0]
        if (upcoming !== undefined) {
          prefetched = { phrase: upcoming, synthesis: synthesize(upcoming) }
        }
        await play(synthesis.audio)
      }
    }
    finally {
      draining = false
    }
  }

  return {
    speak: (text: string): void => {
      if (!Config.USE_TTS) {
        return
      }
      queue.push(...splitIntoPhrases(dropUnreadableLines(text)))
      void drain().catch(() => {})
    },
    stop: (): void => {
      generation += 1
      queue.length = 0
      prefetched = null
      pendingRequest?.abort()
      player?.kill('SIGKILL')
    },
  }
}

let shared: Speaker | null = null

export function getSpeaker(): Speaker {
  shared ??= createSpeaker()
  return shared
}
