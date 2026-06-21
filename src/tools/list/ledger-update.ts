import type { Tool } from '../../types.ts'
import { markStep } from '../../babysitter/index.ts'
import { cyan } from '../../utils/colors.ts'

export const ledgerUpdate: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'ledger_update',
      description: 'Updates the status of a step in your task ledger (the checklist shown in harness reminders). USE WHEN: you start working on a step (mark it in_progress) or finish one (mark it done). Do this as you go so the harness tracks real progress. EXAMPLE: {"id": 2, "status": "done"}.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'The id of the ledger step to update.',
          },
          status: {
            type: 'string',
            description: 'New status for the step.',
            enum: ['in_progress', 'done'],
          },
        },
        required: ['id', 'status'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { id?: unknown, status?: unknown }
    if (typeof args.id !== 'number' || !Number.isInteger(args.id)) {
      return 'ERROR: ledger_update expects an integer "id".'
    }
    if (args.status !== 'in_progress' && args.status !== 'done') {
      return 'ERROR: ledger_update "status" must be "in_progress" or "done".'
    }
    return markStep(args.id, args.status)
  },
  primaryArgs: ['id', 'status'],
  accentColor: cyan,
  renderResult: (args) => {
    const id = typeof args.id === 'number' ? args.id : '?'
    const status = typeof args.status === 'string' ? args.status : '?'
    return `Ledger step ${id} → ${status}`
  },
  autoApprove: true,
}
