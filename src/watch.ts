/** Poll loop: per configured mailbox, poll IMAP for new mail past the UID
 *  cursor, map each mail to a Trigger (addressed 'direct' when the mailbox is
 *  among the recipients), and hand it to receive(). Health reports the last
 *  mailbox failure while staying quiet when everything is fine. */
import type { SourceContextLike, TriggerLike } from './types.ts'
import { HEALTH_ENTRY, type MailConfig } from './imap.ts'
import { channelConfig } from './mail-kind.ts'
import { pollMailbox, readCursors, writeCursors } from './imap.ts'

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
    const stop = () => { clearTimeout(timer); resolve() }
    signal.addEventListener('abort', stop, { once: true })
  })
}

function buildTrigger(mailboxId: string, mail: { messageId: string; from: string; fromName: string; to: string; subject: string; text: string; date: string; uid: number; uidValidity: string; attachments: number; threadId: string }, user: string): TriggerLike {
  const addressedToMe = mail.to.toLowerCase().split(',').some((a) => a.trim() === user.toLowerCase())
  return {
    id: 'mail:' + mailboxId + ':' + mail.uidValidity + ':' + mail.uid,
    source: 'mail',
    threads: [{ source: 'mail', id: mail.threadId }],
    actor: { source: 'mail', id: mail.from },
    human: true,
    ...(addressedToMe ? { addressed: 'direct' as const } : {}),
    at: mail.date,
    text: mail.text,
    channel: { source: 'mail', thread: 'mail:' + mailboxId + ':' + mail.threadId,
      address: { mailbox: mailboxId, to: mail.from, messageId: mail.messageId, subject: mail.subject } },
    meta: { mailboxId, uid: mail.uid, uidValidity: mail.uidValidity, messageId: mail.messageId, subject: mail.subject, from: mail.from, fromName: mail.fromName, attachments: mail.attachments },
  }
}

export async function watch(source: SourceContextLike, signal: AbortSignal): Promise<void> {
  const cursors: ReturnType<typeof readCursors> = {}
  while (!signal.aborted) {
    try {
      const config = source.config<MailConfig>('mail')
      if (config && (config.mailboxes ?? []).length > 0) {
        channelConfig.current = config
        const stored = readCursors('~/.local/state/dsh-superagent-mail')
        for (const mb of config.mailboxes) {
          if (signal.aborted) break
          const state = cursors[mb.id] ?? stored[mb.id] ?? { uid: 0, uidValidity: '' }
          const mails = await pollMailbox(mb, state)
          cursors[mb.id] = state
          for (const mail of mails) {
            const trigger = buildTrigger(mb.id, mail, mb.user)
            await source.receive(trigger)
          }
        }
        writeCursors('~/.local/state/dsh-superagent-mail', cursors)
        source.report(HEALTH_ENTRY, { state: 'ready', detail: '' })
      } else {
        source.report(HEALTH_ENTRY, { state: 'paused', detail: 'waiting for mailbox configuration' })
      }
    } catch (error) {
      source.report(HEALTH_ENTRY, { state: 'error', detail: String(error).slice(0, 300) })
    }
    let pollSeconds = 60
    try { const config = source.config<MailConfig>('mail'); if (config?.pollSeconds) pollSeconds = config.pollSeconds } catch { /* keep default */ }
    await pause(pollSeconds * 1000, signal)
  }
}
