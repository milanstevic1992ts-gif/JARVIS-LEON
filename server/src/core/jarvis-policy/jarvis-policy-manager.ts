import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { StringHelper } from '@/helpers/string-helper'

export type JarvisRiskLevel = 'green' | 'yellow' | 'red'
export type JarvisApprovalStatus =
  | 'pending'
  | 'approved'
  | 'consumed'
  | 'denied'
  | 'expired'

export interface JarvisActionDescriptor {
  toolkitId: string
  toolId: string
  functionName: string
  method?: string
  path?: string
  params?: Record<string, unknown> | null
  description?: string
}

export interface JarvisApprovalRecord {
  id: string
  fingerprint: string
  risk: JarvisRiskLevel
  status: JarvisApprovalStatus
  createdAt: number
  expiresAt: number
  updatedAt: number
  action: Omit<JarvisActionDescriptor, 'params'> & {
    paramsPreview?: string
  }
}

export interface JarvisAuditEntry {
  timestamp: number
  event:
    | 'allowed'
    | 'approval_requested'
    | 'approval_granted'
    | 'approval_denied'
    | 'approval_consumed'
    | 'approval_expired'
    | 'execution_succeeded'
    | 'execution_failed'
  risk: JarvisRiskLevel
  approvalId?: string
  fingerprint: string
  action: Omit<JarvisActionDescriptor, 'params'> & {
    paramsPreview?: string
  }
  details?: Record<string, unknown>
}

const APPROVAL_TTL_MS = 10 * 60 * 1_000
const MAX_APPROVAL_RECORDS = 200
const MAX_AUDIT_ENTRIES_TO_READ = 100
const RED_PATH_TOKENS = [
  'delete',
  'remove',
  'destroy',
  'send',
  'publish',
  'campaign',
  'email',
  'message',
  'whatsapp',
  'payment',
  'payout',
  'invoice',
  'fattura',
  'broadcast',
  'execute'
]

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)])
    )
  }

  return value
}

function redactPreview(value: unknown): string {
  try {
    return StringHelper.redactSecrets(JSON.stringify(stableValue(value)))
      .replace(/\s+/g, ' ')
      .slice(0, 320)
  } catch {
    return '[unavailable]'
  }
}

export function classifyJarvisAction(
  action: Pick<JarvisActionDescriptor, 'method' | 'path' | 'functionName'>
): JarvisRiskLevel {
  const method = (action.method || '').trim().toUpperCase()
  const normalizedPath = (action.path || '').trim().toLowerCase()
  const normalizedFunction = action.functionName.trim().toLowerCase()
  const combined = `${normalizedPath} ${normalizedFunction}`

  if (
    method === 'DELETE' ||
    RED_PATH_TOKENS.some((token) => combined.includes(token))
  ) {
    return 'red'
  }

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    return 'yellow'
  }

  return 'green'
}

export function fingerprintJarvisAction(
  action: JarvisActionDescriptor
): string {
  const payload = stableValue({
    toolkitId: action.toolkitId,
    toolId: action.toolId,
    functionName: action.functionName,
    method: (action.method || '').toUpperCase(),
    path: action.path || '',
    params: action.params || null
  })

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
}

export class JarvisPolicyManager {
  private readonly policyDir: string
  private readonly approvalsPath: string
  private readonly auditPath: string

  public constructor(profileRoot?: string) {
    const root = profileRoot || getProfilePaths().root
    this.policyDir = path.join(root, 'policy')
    this.approvalsPath = path.join(this.policyDir, 'approvals.json')
    this.auditPath = path.join(this.policyDir, 'audit.jsonl')
    fs.mkdirSync(this.policyDir, { recursive: true })
  }

  public getPolicySummary(): {
    green: string
    yellow: string
    red: string
    approvalTtlMinutes: number
  } {
    return {
      green: 'automatic',
      yellow: 'explicit approval unless the calling tool has a stricter local gate',
      red: 'explicit one-time approval always required',
      approvalTtlMinutes: APPROVAL_TTL_MS / 60_000
    }
  }

  public requestApproval(
    action: JarvisActionDescriptor,
    risk = classifyJarvisAction(action)
  ): JarvisApprovalRecord {
    const fingerprint = fingerprintJarvisAction(action)
    const approvals = this.loadApprovals()
    const now = Date.now()

    this.expireOldApprovals(approvals, now)

    const existing = approvals.find(
      (record) =>
        record.fingerprint === fingerprint &&
        record.status === 'pending' &&
        record.expiresAt > now
    )

    if (existing) {
      return existing
    }

    const record: JarvisApprovalRecord = {
      id: crypto.randomBytes(6).toString('hex'),
      fingerprint,
      risk,
      status: 'pending',
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
      updatedAt: now,
      action: this.toSafeAction(action)
    }

    approvals.push(record)
    this.saveApprovals(approvals.slice(-MAX_APPROVAL_RECORDS))
    this.audit('approval_requested', action, risk, {
      approvalId: record.id
    })

    return record
  }

  public approve(id: string): JarvisApprovalRecord | null {
    const approvals = this.loadApprovals()
    const now = Date.now()
    this.expireOldApprovals(approvals, now)

    const record = approvals.find((entry) => entry.id === id)
    if (!record || record.status !== 'pending' || record.expiresAt <= now) {
      this.saveApprovals(approvals)
      return null
    }

    record.status = 'approved'
    record.updatedAt = now
    this.saveApprovals(approvals)
    this.auditRecord('approval_granted', record)

    return record
  }

  public deny(id: string): JarvisApprovalRecord | null {
    const approvals = this.loadApprovals()
    const record = approvals.find((entry) => entry.id === id)

    if (!record || !['pending', 'approved'].includes(record.status)) {
      return null
    }

    record.status = 'denied'
    record.updatedAt = Date.now()
    this.saveApprovals(approvals)
    this.auditRecord('approval_denied', record)

    return record
  }

  public consumeApproved(
    action: JarvisActionDescriptor
  ): JarvisApprovalRecord | null {
    const approvals = this.loadApprovals()
    const now = Date.now()
    this.expireOldApprovals(approvals, now)

    const fingerprint = fingerprintJarvisAction(action)
    const record = approvals.find(
      (entry) =>
        entry.fingerprint === fingerprint &&
        entry.status === 'approved' &&
        entry.expiresAt > now
    )

    if (!record) {
      this.saveApprovals(approvals)
      return null
    }

    record.status = 'consumed'
    record.updatedAt = now
    this.saveApprovals(approvals)
    this.auditRecord('approval_consumed', record)

    return record
  }

  public listPending(): JarvisApprovalRecord[] {
    const approvals = this.loadApprovals()
    this.expireOldApprovals(approvals, Date.now())
    this.saveApprovals(approvals)

    return approvals
      .filter((entry) => entry.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  public listRecentAudit(limit = 20): JarvisAuditEntry[] {
    if (!fs.existsSync(this.auditPath)) {
      return []
    }

    const lines = fs
      .readFileSync(this.auditPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.min(Math.max(limit, 1), MAX_AUDIT_ENTRIES_TO_READ))

    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as JarvisAuditEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is JarvisAuditEntry => Boolean(entry))
      .reverse()
  }

  public recordExecution(
    action: JarvisActionDescriptor,
    risk: JarvisRiskLevel,
    success: boolean,
    details: Record<string, unknown> = {}
  ): void {
    this.audit(
      success ? 'execution_succeeded' : 'execution_failed',
      action,
      risk,
      { details }
    )
  }

  public recordAllowed(
    action: JarvisActionDescriptor,
    risk: JarvisRiskLevel
  ): void {
    this.audit('allowed', action, risk)
  }

  private toSafeAction(
    action: JarvisActionDescriptor
  ): JarvisApprovalRecord['action'] {
    return {
      toolkitId: action.toolkitId,
      toolId: action.toolId,
      functionName: action.functionName,
      ...(action.method ? { method: action.method.toUpperCase() } : {}),
      ...(action.path ? { path: action.path } : {}),
      ...(action.description ? { description: action.description } : {}),
      ...(action.params
        ? { paramsPreview: redactPreview(action.params) }
        : {})
    }
  }

  private loadApprovals(): JarvisApprovalRecord[] {
    if (!fs.existsSync(this.approvalsPath)) {
      return []
    }

    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.approvalsPath, 'utf8')
      )
      return Array.isArray(parsed) ? parsed as JarvisApprovalRecord[] : []
    } catch {
      return []
    }
  }

  private saveApprovals(records: JarvisApprovalRecord[]): void {
    const tempPath = `${this.approvalsPath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(records, null, 2), 'utf8')
    fs.renameSync(tempPath, this.approvalsPath)
  }

  private expireOldApprovals(
    approvals: JarvisApprovalRecord[],
    now: number
  ): void {
    for (const record of approvals) {
      if (
        ['pending', 'approved'].includes(record.status) &&
        record.expiresAt <= now
      ) {
        record.status = 'expired'
        record.updatedAt = now
        this.auditRecord('approval_expired', record)
      }
    }
  }

  private auditRecord(
    event: JarvisAuditEntry['event'],
    record: JarvisApprovalRecord
  ): void {
    const entry: JarvisAuditEntry = {
      timestamp: Date.now(),
      event,
      risk: record.risk,
      approvalId: record.id,
      fingerprint: record.fingerprint,
      action: record.action
    }

    fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private audit(
    event: JarvisAuditEntry['event'],
    action: JarvisActionDescriptor,
    risk: JarvisRiskLevel,
    extras: {
      approvalId?: string
      details?: Record<string, unknown>
    } = {}
  ): void {
    const entry: JarvisAuditEntry = {
      timestamp: Date.now(),
      event,
      risk,
      fingerprint: fingerprintJarvisAction(action),
      action: this.toSafeAction(action),
      ...(extras.approvalId ? { approvalId: extras.approvalId } : {}),
      ...(extras.details ? { details: extras.details } : {})
    }

    fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8')
  }
}

export const JARVIS_POLICY = new JarvisPolicyManager()
