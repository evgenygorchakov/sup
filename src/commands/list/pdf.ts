import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { Config } from '../../config.ts'
import { convertPdfToMarkdown } from '../../documents/pdf.ts'
import { shortPath } from '../../files/paths.ts'
import { gray } from '../../utils/colors.ts'

const SWITCHES = new Set(['on', 'off'])

function state(): string {
  return Config.USE_PDF_CONVERT ? 'on' : 'off'
}

async function run(context: CommandContext): Promise<CommandResult> {
  const first = context.args[0]

  if (!first) {
    console.warn(gray(`Dropped PDFs are converted to markdown: ${state()}. Convert one now with /pdf <path>, or flip the automatic conversion with /pdf on|off.`))
    return { kind: 'continue' }
  }

  if (SWITCHES.has(first.toLowerCase())) {
    Config.USE_PDF_CONVERT = first.toLowerCase() === 'on'
    console.warn(gray(`Dropped PDFs are converted to markdown: ${state()}.`))
    return { kind: 'continue' }
  }

  const conversion = await convertPdfToMarkdown(context.args.join(' '))
  if (conversion.ok) {
    console.warn(gray(`The markdown stays on disk — ask about ${shortPath(conversion.document.markdownPath)} when you want the model to read it.`))
  }

  return { kind: 'continue' }
}

export const pdfCommand: SlashCommand = {
  name: 'pdf',
  description: 'Convert a PDF to markdown: /pdf <path>, or /pdf [on|off] for dropped files.',
  run,
}
