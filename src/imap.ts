/** Per-mailbox IMAP polling with imapflow + mailparser.
 *  First run of a mailbox establishes a baseline (records the highest UID,
 *  processes nothing) so configuring a mailbox never replays old mail. */
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface MailboxConfig {
  id: string
  name: string
  imapHost: string
  imapPort: string
  smtpHost: string
  smtpPort: string
  user: string
  password: string
  folder: string
}

export interface MailConfig {
  mailboxes: MailboxConfig[]
  pollSeconds: number
}

export interface MailInput {
  messageId: string
  from: string
  fromName: string
  to: string
  subject: string
  text: string
  date: string
  uid: number
  uidValidity: string
  attachments: number
  threadId: string
}

export const HEALTH_ENTRY = 'mailImap'

export function normalizeSubject(subject: string): string {
  let s = (subject || '').trim()
  for (;;) {
    const next = s.replace(/^(re|fwd|fw|回复|答复|转发)\s*[:：]\s*/i, '').trim()
    if (next === s) break
    s = next
  }
  return s.toLowerCase()
}

export function threadIdOf(mailboxId: string, subject: string): string {
  const norm = normalizeSubject(subject)
  const hash = createHash('sha1').update(norm || '(no subject)').digest('hex').slice(0, 12)
  return mailboxId + ':' + (norm ? hash : 'untitled-' + hash)
}

export function textOf(htmlOrText: string | undefined, cap = 8000): string {
  if (!htmlOrText) return ''
  let s = htmlOrText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.length > cap ? s.slice(0, cap) + '\n...(truncated)' : s
}

interface CursorState { [mailboxId: string]: { uid: number; uidValidity: string } }

function expandDir(dataDir: string): string {
  const p = dataDir.startsWith('~') ? join(homedir(), dataDir.slice(1)) : dataDir
  return p
}

export function readCursors(dataDir: string): CursorState {
  const file = join(expandDir(dataDir), 'cursors.json')
  if (!existsSync(file)) return {}
  try { return JSON.parse(readFileSync(file, 'utf8')) as CursorState } catch { return {} }
}

export function writeCursors(dataDir: string, cursors: CursorState): void {
  const d = expandDir(dataDir)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'cursors.json'), JSON.stringify(cursors, null, 1), 'utf8')
}

export async function pollMailbox(mb: MailboxConfig, state: { uid: number; uidValidity: string }): Promise<MailInput[]> {
  const port = Number(mb.imapPort) || 993
  const client = new ImapFlow({
    host: mb.imapHost,
    port,
    secure: port === 993,
    auth: { user: mb.user, pass: mb.password },
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock(mb.folder || 'INBOX')
  const out: MailInput[] = []
  try {
    const info = client.mailbox as unknown as { uidValidity: string | number; exists: number } | undefined
    if (!info) return out
    const uidValidity = String(info.uidValidity)
    if (state.uidValidity !== uidValidity) {
      // Mailbox recreated or first contact: baseline at the current highest UID.
      state.uid = Number(info.exists)
      state.uidValidity = uidValidity
      return out
    }
    const fromUid = state.uid + 1
    for await (const msg of client.fetch({ uid: fromUid + ':*' }, { uid: true, envelope: true, source: true })) {
      if (Number(msg.uid) < fromUid) continue
      const parsed = await simpleParser(msg.source as Buffer)
      const fromAddr = parsed.from?.value?.[0]?.address ?? ''
      const fromName = parsed.from?.value?.[0]?.name ?? ''
      const toObj = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to
      const toAddrs = (toObj?.value ?? []).map((a: { address?: string }) => a.address ?? '').filter(Boolean)
      const subject = parsed.subject ?? '(no subject)'
      const body = parsed.text || textOf(parsed.html || undefined)
      out.push({
        messageId: parsed.messageId ?? 'mail-' + mb.id + '-' + msg.uid,
        from: fromAddr,
        fromName,
        to: toAddrs.join(', '),
        subject,
        text: body,
        date: (parsed.date ?? new Date()).toISOString(),
        uid: Number(msg.uid),
        uidValidity,
        attachments: (parsed.attachments ?? []).length,
        threadId: threadIdOf(mb.id, subject),
      })
    }
    if (out.length) state.uid = Math.max(...out.map((m) => m.uid))
    else if (info.exists >= fromUid) state.uid = info.exists
    return out
  } finally {
    lock.release()
    try { await client.logout() } catch { /* connection already closed */ }
  }
}