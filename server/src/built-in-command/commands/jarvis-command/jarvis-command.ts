import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { getJarvisPolicyManager } from '@/core/jarvis-policy/jarvis-policy-manager'

const SUBCOMMANDS = ['policy', 'pending', 'approve', 'deny', 'audit'] as const

export class JarvisCommand extends BuiltInCommand {
  protected override description =
    'Inspect JARVIS policy, approvals and audit history.'
  protected override icon_name = 'ri-shield-check-line'
  protected override supported_usages = [
    '/jarvis policy',
    '/jarvis pending',
    '/jarvis approve <approval_id>',
    '/jarvis deny <approval_id>',
    '/jarvis audit'
  ]
  protected override help_usage =
    '/jarvis <policy|pending|approve|deny|audit>'

  public constructor() {
    super('jarvis')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const typed = context.args[0]?.toLowerCase() || ''

    return SUBCOMMANDS
      .filter((name) => name.startsWith(typed))
      .map((name) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name,
        description: this.describe(name),
        usage: `/jarvis ${name}`,
        supported_usages: this.getSupportedUsages(),
        value: `/jarvis ${name}`
      }))
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const subcommand = context.args[0]?.toLowerCase() || 'policy'

    if (subcommand === 'policy') {
      const policy = getJarvisPolicyManager().getPolicySummary()
      return {
        status: 'completed',
        result: createListResult({
          title: 'JARVIS Safety Policy',
          tone: 'info',
          items: [
            { label: 'VERDE', value: policy.green, tone: 'success' },
            { label: 'GIALLA', value: policy.yellow, tone: 'warning' },
            { label: 'ROSSA', value: policy.red, tone: 'error' },
            {
              label: 'Validità approvazione',
              value: `${policy.approvalTtlMinutes} minuti, uso singolo`
            }
          ]
        })
      }
    }

    if (subcommand === 'pending') {
      const pending = getJarvisPolicyManager().listPending()
      return {
        status: 'completed',
        result: createListResult({
          title: 'JARVIS Pending Approvals',
          tone: 'info',
          items: pending.length
            ? pending.map((record) => ({
                label: record.id,
                value: `${record.risk.toUpperCase()} · ${record.action.method || ''} ${record.action.path || record.action.functionName}`,
                description: 'Usa /jarvis approve <id> oppure /jarvis deny <id>.'
              }))
            : [{ label: 'Nessuna approvazione in attesa.', tone: 'success' }]
        })
      }
    }

    if (subcommand === 'approve' || subcommand === 'deny') {
      const id = context.args[1]?.trim() || ''
      if (!id) {
        return {
          status: 'error',
          result: createListResult({
            title: 'Approval ID Missing',
            tone: 'error',
            items: [{
              label: `Usa /jarvis ${subcommand} <approval_id>.`,
              tone: 'error'
            }]
          })
        }
      }

      const record =
        subcommand === 'approve'
          ? getJarvisPolicyManager().approve(id)
          : getJarvisPolicyManager().deny(id)

      if (!record) {
        return {
          status: 'error',
          result: createListResult({
            title: 'Approval Not Available',
            tone: 'error',
            items: [{
              label:
                'ID non trovato, già usato, scaduto oppure non più approvabile.',
              tone: 'error'
            }]
          })
        }
      }

      return {
        status: 'completed',
        result: createListResult({
          title:
            subcommand === 'approve'
              ? 'JARVIS Action Approved'
              : 'JARVIS Action Denied',
          tone: subcommand === 'approve' ? 'success' : 'info',
          items: [
            {
              label: record.id,
              value: `${record.risk.toUpperCase()} · ${record.action.method || ''} ${record.action.path || record.action.functionName}`
            },
            {
              label:
                subcommand === 'approve'
                  ? 'Approvazione valida una sola volta. Ripeti ora la richiesta originale.'
                  : 'Azione bloccata.'
            }
          ]
        })
      }
    }

    if (subcommand === 'audit') {
      const entries = getJarvisPolicyManager().listRecentAudit(12)
      return {
        status: 'completed',
        result: createListResult({
          title: 'JARVIS Audit',
          tone: 'info',
          items: entries.length
            ? entries.map((entry) => ({
                label: new Date(entry.timestamp).toLocaleString('it-IT'),
                value: `${entry.event} · ${entry.risk.toUpperCase()}`,
                description:
                  `${entry.action.method || ''} ${entry.action.path || entry.action.functionName}`.trim()
              }))
            : [{ label: 'Audit ancora vuoto.' }]
        })
      }
    }

    return {
      status: 'error',
      result: createListResult({
        title: 'Unsupported JARVIS Command',
        tone: 'error',
        items: [{
          label: `Comando "${subcommand}" non supportato.`,
          description: 'Usa /jarvis policy, pending, approve, deny oppure audit.'
        }]
      })
    }
  }

  private describe(name: typeof SUBCOMMANDS[number]): string {
    const descriptions = {
      policy: 'Mostra le policy VERDE/GIALLA/ROSSA.',
      pending: 'Mostra le azioni in attesa di approvazione.',
      approve: 'Approva una singola azione.',
      deny: 'Nega una singola azione.',
      audit: 'Mostra gli eventi recenti del registro di sicurezza.'
    }

    return descriptions[name]
  }
}
