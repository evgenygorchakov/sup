import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { formatTimestamp, listPlans, readPlanContent } from '../../plan-store.ts'
import { bold, brightGreen, gray, red } from '../../utils/colors.ts'

async function run(context: CommandContext): Promise<CommandResult> {
  const plans = await listPlans()

  if (plans.length === 0) {
    console.warn(gray('No saved plans in .sup/plans yet.'))
    return { kind: 'continue' }
  }

  const selector = context.args[0]

  if (!selector) {
    console.warn(bold(brightGreen('\nSaved plans:')))
    plans.forEach((plan, index) => {
      const request = plan.request ? ` — ${plan.request}` : ''
      console.warn(`  ${brightGreen(String(index + 1))}  ${plan.name} ${gray(`(${formatTimestamp(plan.modified)})${request}`)}`)
    })
    console.warn(gray('\nLoad one with /plan <number>.'))
    return { kind: 'continue' }
  }

  const index = Number(selector)
  const lowered = selector.toLowerCase()
  const chosen = Number.isInteger(index) && index >= 1
    ? plans[index - 1]
    : plans.find(plan => plan.name === selector)
      ?? plans.find(plan => plan.name.toLowerCase().includes(lowered) || plan.request.toLowerCase().includes(lowered))

  if (!chosen) {
    console.warn(red(`No plan matching "${selector}". Type /plan to list them.`))
    return { kind: 'continue' }
  }

  const content = await readPlanContent(chosen.file)
  if (content === null) {
    console.warn(red(`Could not read plan "${chosen.name}".`))
    return { kind: 'continue' }
  }

  context.messages.push({
    role: 'user',
    content: `Execute the following plan now, step by step, using tools as needed:\n\n${content}`,
  })
  console.warn(gray(`Running plan "${chosen.name}"…`))

  return { kind: 'run' }
}

export const planCommand: SlashCommand = {
  name: 'plan',
  description: 'List saved plans, or load one into the session: /plan [number].',
  run,
}
