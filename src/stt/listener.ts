import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { Config } from '../config.ts'
import { isTimeout } from '../utils/timeout.ts'

const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2
const MIN_AUDIO_BYTES = 16_000
const WAV_HEADER_BYTES = 44
const STOP_GRACE_MS = 1_000

export type Dictation
  = | { ok: true, text: string }
    | { ok: false, reason: string }

export interface Recording {
  finish: () => Promise<Dictation>
  cancel: () => void
}

function toWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  header.write('RIFF', 0)
  header.writeUInt32LE(WAV_HEADER_BYTES - 8 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32)
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function transcribe(audio: Buffer): Promise<Dictation> {
  let response: Response
  try {
    response = await fetch(`${Config.STT_HOST}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(Config.STT_TIMEOUT_MS),
    })
  }
  catch (error) {
    return {
      ok: false,
      reason: isTimeout(error)
        ? `${Config.STT_HOST} went quiet for ${Config.STT_TIMEOUT_MS} ms`
        : `no connection to ${Config.STT_HOST}`,
    }
  }

  if (!response.ok) {
    return { ok: false, reason: `recognition server replied ${response.status}` }
  }

  let payload: { text?: unknown }
  try {
    payload = await response.json() as { text?: unknown }
  }
  catch {
    return { ok: false, reason: 'recognition server sent something other than JSON' }
  }

  if (typeof payload.text !== 'string') {
    return { ok: false, reason: 'recognition server replied without a text field' }
  }
  return { ok: true, text: payload.text.trim() }
}

export function startRecording(): Recording {
  const recorder = spawn('parecord', [
    '--raw',
    '--format=s16le',
    `--rate=${SAMPLE_RATE}`,
    '--channels=1',
    ...(Config.STT_DEVICE ? ['-d', Config.STT_DEVICE] : []),
  ], { stdio: ['ignore', 'pipe', 'ignore'] })

  const killOnExit = (): void => {
    recorder.kill('SIGKILL')
  }
  process.once('exit', killOnExit)

  const chunks: Buffer[] = []
  const collect = (chunk: Buffer): void => {
    chunks.push(chunk)
  }
  recorder.stdout?.on('data', collect)

  let spawnFailed = false
  recorder.on('error', () => {
    spawnFailed = true
  })

  let exitCode: number | null = null
  let exited = false
  recorder.on('exit', (code) => {
    exitCode = code
    exited = true
  })

  const drained = new Promise<void>((resolve) => {
    recorder.on('close', () => {
      resolve()
    })
  })

  const stop = async (): Promise<void> => {
    recorder.kill('SIGTERM')
    await Promise.race([drained, delay(STOP_GRACE_MS, undefined, { ref: false })])
    if (exited) {
      return
    }
    recorder.kill('SIGKILL')
    await Promise.race([drained, delay(STOP_GRACE_MS, undefined, { ref: false })])
  }

  const release = (): void => {
    recorder.stdout?.off('data', collect)
    chunks.length = 0
    process.removeListener('exit', killOnExit)
  }

  return {
    cancel: (): void => {
      void stop().then(release).catch(() => {})
    },
    finish: async (): Promise<Dictation> => {
      await stop()

      if (spawnFailed) {
        release()
        return { ok: false, reason: 'parecord not found (package pulseaudio-utils)' }
      }

      if (!exited) {
        release()
        return { ok: false, reason: 'parecord survived SIGTERM and SIGKILL — check the PulseAudio server' }
      }

      if (exitCode) {
        release()
        return { ok: false, reason: `parecord exited with code ${exitCode} — check STT_DEVICE and the PulseAudio server` }
      }

      const pcm = Buffer.concat(chunks)
      release()

      if (pcm.length < MIN_AUDIO_BYTES) {
        return { ok: true, text: '' }
      }
      return await transcribe(toWav(pcm))
    },
  }
}
