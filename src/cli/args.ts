export interface CliArgs {
  provider?: string
  resumeRequested: boolean
  resumeRunId?: string
  skipPermissions: boolean
  promptArgs: string[]
}

const FLAGS_APPLIED_BY_CONFIG_AT_IMPORT = new Set(['--read-only'])

export function parseArgs(argv: string[]): CliArgs {
  let provider: string | undefined
  let resumeRequested = false
  let resumeRunId: string | undefined
  let skipPermissions = false
  const promptArgs: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (FLAGS_APPLIED_BY_CONFIG_AT_IMPORT.has(arg)) {
      continue
    }
    if (arg === '--llama') {
      provider = 'llamacpp'
    }
    else if (arg === '--provider') {
      provider = argv[++index]
    }
    else if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length)
    }
    else if (arg === '--resume') {
      resumeRequested = true
    }
    else if (arg.startsWith('--resume=')) {
      resumeRequested = true
      resumeRunId = arg.slice('--resume='.length) || undefined
    }
    else if (arg === '--dangerously-skip-permissions') {
      skipPermissions = true
    }
    else {
      promptArgs.push(arg)
    }
  }

  return { provider, resumeRequested, resumeRunId, skipPermissions, promptArgs }
}
