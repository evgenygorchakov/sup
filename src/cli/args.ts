export interface CliArgs {
  provider?: string
  resumeRequested: boolean
  resumeRunId?: string
  skipPermissions: boolean
  noSystemPrompt: boolean
  promptArgs: string[]
}

export function parseArgs(argv: string[]): CliArgs {
  let provider: string | undefined
  let resumeRequested = false
  let resumeRunId: string | undefined
  let skipPermissions = false
  let noSystemPrompt = false
  const promptArgs: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--llama') {
      provider = 'llamacpp'
    }
    else if (arg === '--provider') {
      provider = argv[++index] ?? ''
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
    else if (arg === '--no-system-prompt') {
      noSystemPrompt = true
    }
    else {
      promptArgs.push(arg)
    }
  }

  return { provider, resumeRequested, resumeRunId, skipPermissions, noSystemPrompt, promptArgs }
}
