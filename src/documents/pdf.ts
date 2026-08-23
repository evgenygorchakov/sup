import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import process from 'node:process'
import { Config } from '../config.ts'
import { normalizePath, removeTokenWithSurroundingSpaces, shortPath, stripFileUri, unquote } from '../files/paths.ts'
import { startSpinner } from '../ui/interactive/spinner.ts'
import { gray, yellow } from '../utils/colors.ts'

const PDF_EXTENSION_PATTERN = /\.pdf$/i
// `\\ ` keeps shell-escaped spaces inside the token: a drop of "my sup/Brooks 1986.pdf" is one path.
const INLINE_PDF_PATH_PATTERN = /"[^"]+\.pdf"|'[^']+\.pdf'|(?:\\ |\S)+\.pdf\b/gi
const UNESCAPED_SPACE_PATTERN = /(?<!\\)\s/
const PDF_SIGNATURE = '%PDF-'

/** The "conversion is off" hint is worth saying once per session, not on every dropped file. */
let offNoticeShown = false

export interface ConvertedDocument {
  /** Name of the file that was dropped, e.g. report.pdf. */
  sourceName: string
  /** Absolute path of the markdown written next to the session. */
  markdownPath: string
  /** Length of the markdown that was written. */
  chars: number
  pages: number | null
}

type Conversion
  = | { ok: true, document: ConvertedDocument }
    | { ok: false, reason: string, missing?: boolean }

export function looksLikePdfPath(token: string): boolean {
  return PDF_EXTENSION_PATTERN.test(stripFileUri(unquote(token.trim())))
}

/**
 * A whole line is a dropped path only if nothing but the path is on it: "look at report.pdf" ends in
 * .pdf too, and belongs to the inline pass. Spaces are allowed when the drop quoted or escaped them.
 */
function isPdfPathLine(line: string): boolean {
  if (!looksLikePdfPath(line)) {
    return false
  }
  const raw = unquote(line)
  return raw !== line || !UNESCAPED_SPACE_PATTERN.test(raw)
}

/** Reads the leading bytes instead of trusting the extension — same idea as detectMimeType for images. */
async function isPdfFile(path: string): Promise<boolean> {
  let handle
  try {
    handle = await open(path, 'r')
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(PDF_SIGNATURE.length), 0, PDF_SIGNATURE.length, 0)
    return bytesRead === PDF_SIGNATURE.length && buffer.toString('latin1') === PDF_SIGNATURE
  }
  catch {
    return false
  }
  finally {
    await handle?.close()
  }
}

function markdownPathFor(source: string): string {
  return resolve(process.cwd(), `${basename(source, extname(source))}.md`)
}

/** A markdown file newer than its PDF is the previous conversion of it, so the converter can stay asleep. */
async function isConversionFresh(source: string, target: string): Promise<boolean> {
  try {
    const [pdf, markdown] = await Promise.all([stat(source), stat(target)])
    return markdown.mtimeMs >= pdf.mtimeMs
  }
  catch {
    return false
  }
}

/** Only for the line printed after a conversion — the markdown itself never leaves the file. */
async function countChars(target: string): Promise<number | null> {
  try {
    return (await readFile(target, 'utf8')).length
  }
  catch {
    return null
  }
}

interface ConverterReply {
  ok?: unknown
  pages?: unknown
  chars?: unknown
  error?: unknown
}

function lastLine(output: string): string {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

type ConverterRun
  = | { ok: true, pages: number | null }
    | { ok: false, reason: string, missing?: boolean }

function runConverter(source: string, target: string): Promise<ConverterRun> {
  return new Promise((resolvePromise) => {
    const args = [source, target]
    if (Config.PDF_EXTRACT_IMAGES) {
      args.push('--images', target.replace(/\.md$/, '.assets'))
    }

    let child
    try {
      child = spawn(Config.PDF_CONVERTER, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    }
    catch {
      resolvePromise({ ok: false, reason: `${Config.PDF_CONVERTER} is not installed`, missing: true })
      return
    }

    // Own timer instead of the spawn option: that one survives a converter that never started
    // (ENOENT) and would keep the whole session alive for PDF_TIMEOUT_MS.
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Config.PDF_TIMEOUT_MS)
    deadline.unref()

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(deadline)
      const missing = error.code === 'ENOENT'
      resolvePromise({
        ok: false,
        missing,
        reason: missing ? `${Config.PDF_CONVERTER} is not installed` : `${Config.PDF_CONVERTER} failed to start (${error.message})`,
      })
    })

    child.on('close', (code) => {
      clearTimeout(deadline)
      if (timedOut) {
        resolvePromise({ ok: false, reason: `the converter went quiet for ${Config.PDF_TIMEOUT_MS} ms` })
        return
      }

      let payload: ConverterReply
      try {
        payload = JSON.parse(lastLine(stdout)) as ConverterReply
      }
      catch {
        const detail = lastLine(stderr)
        resolvePromise({ ok: false, reason: detail || `the converter exited with code ${code} and said nothing` })
        return
      }

      if (payload.ok !== true) {
        resolvePromise({ ok: false, reason: typeof payload.error === 'string' ? payload.error : `the converter exited with code ${code}` })
        return
      }

      resolvePromise({ ok: true, pages: typeof payload.pages === 'number' ? payload.pages : null })
    })
  })
}

function describe(document: ConvertedDocument, cached: boolean): string {
  const parts = [
    document.pages === null ? '' : `${document.pages} ${document.pages === 1 ? 'page' : 'pages'}`,
    `${document.chars} chars`,
    cached ? 'cached' : '',
  ].filter(Boolean)
  return `📄 ${document.sourceName} → ${shortPath(document.markdownPath)} · ${parts.join(' · ')}`
}

/**
 * Converts a dropped PDF into a markdown file next to the session. The markdown stays on disk: the
 * model is told the path at most, never the text. Anything that goes wrong is reported here.
 */
export async function convertPdfToMarkdown(rawPath: string): Promise<Conversion> {
  const source = normalizePath(rawPath)
  if (!(await isPdfFile(source))) {
    return { ok: false, reason: 'not a PDF file' }
  }

  const target = markdownPathFor(source)
  const name = basename(source)

  if (await isConversionFresh(source, target)) {
    const document: ConvertedDocument = { sourceName: name, markdownPath: target, chars: (await countChars(target)) ?? 0, pages: null }
    console.warn(gray(describe(document, true)))
    return { ok: true, document }
  }

  const spinner = startSpinner(`Converting ${name}…`)
  let run: ConverterRun
  try {
    run = await runConverter(source, target)
  }
  finally {
    spinner.stop()
  }

  if (!run.ok) {
    if (run.missing) {
      Config.USE_PDF_CONVERT = false
      console.warn(yellow(`PDF converter "${Config.PDF_CONVERTER}" is not installed — see optional/pdf/README.md. Turn it back on with /pdf on once it is there.`))
    }
    else {
      console.warn(yellow(`${name} stayed a PDF: ${run.reason}`))
    }
    return { ok: false, reason: run.reason, missing: run.missing }
  }

  const chars = await countChars(target)
  if (chars === null) {
    console.warn(yellow(`${name} was converted but ${target} could not be read back`))
    return { ok: false, reason: `could not read ${target}` }
  }

  const document: ConvertedDocument = { sourceName: name, markdownPath: target, chars, pages: run.pages }
  console.warn(gray(describe(document, false)))
  return { ok: true, document }
}

export interface PdfDropResult {
  /** What is left of the message once the converted PDFs are out of it. */
  text: string
  converted: number
}

/**
 * Every dropped PDF is converted once, and that is the whole effect: the markdown file is written
 * and the path leaves the message. A drop of nothing but PDFs therefore leaves nothing to send; a
 * path inside a sentence becomes the path of the markdown, so the model can read it if it needs to.
 * A path that fails to convert stays in the text as it was typed.
 */
export async function convertDroppedPdfs(input: string): Promise<PdfDropResult> {
  const lines = input.split('\n').map(line => line.trim()).filter(Boolean)
  const pathsOnly = lines.length > 0 && lines.every(isPdfPathLine)
  const tokens = pathsOnly ? lines : (input.match(INLINE_PDF_PATH_PATTERN) ?? [])
  if (tokens.length === 0) {
    return { text: input, converted: 0 }
  }

  if (!Config.USE_PDF_CONVERT) {
    if (!offNoticeShown) {
      offNoticeShown = true
      console.warn(gray('PDF conversion is off — /pdf on turns it on, /pdf <path> converts one file. It needs the marker converter: see optional/pdf/README.md.'))
    }
    return { text: input, converted: 0 }
  }

  let converted = 0
  let text = input

  for (const token of tokens) {
    const conversion = await convertPdfToMarkdown(unquote(token))
    if (!conversion.ok) {
      continue
    }
    converted++
    text = pathsOnly
      ? removeTokenWithSurroundingSpaces(text, token)
      // A function replacement keeps `$` in a path from being read as a capture reference.
      : text.replace(token, () => shortPath(conversion.document.markdownPath))
  }

  return { text: text.trim(), converted }
}
