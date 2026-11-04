/** The 'mail' Source kind: multiple IMAP mailboxes, each an independent
 *  admission scope; replies via SMTP with In-Reply-To threading. */
import { z } from 'zod'
import nodemailer from 'nodemailer'
import type { Localized, OutboundMessageLike, SourceContextLike, TriggerLike } from './types.ts'
import { emptyLink } from './robot-helpers.ts'
import type { MailboxConfig, MailConfig } from './imap.ts'

export const HEALTH_ENTRY = 'mailImap'

// channel.send reads config through this holder; watch() refreshes it every round.
export const channelConfig: { current?: MailConfig } = {}

export const MailConfigSchema = z.object({
  mailboxes: z.array(z.object({
    id: z.string().min(1),
    name: z.string().default(''),
    imapHost: z.string().min(1),
    imapPort: z.string().default('993'),
    smtpHost: z.string().min(1),
    smtpPort: z.string().default('465'),
    user: z.string().min(1),
    password: z.string().default(''),
    folder: z.string().default('INBOX'),
  })).default([]),
  pollSeconds: z.number().int().min(15).max(3600).default(60),
}).strict()

export const mailKind = {
  kind: 'mail',
  title: { zh: '邮箱', en: 'Mail' },
  description: { zh: 'IMAP 多邮箱轮询：白名单发件人的新邮件自动成为工单，回复经 SMTP 直接回邮件串。', en: 'Multi-mailbox IMAP polling: whitelisted senders become tickets; replies via SMTP thread back.' },
  schema: MailConfigSchema,
  fields: [
    { key: 'mailboxes', type: 'rows', label: { zh: '邮箱账户', en: 'Mailboxes' }, columns: [
      { key: 'id', type: 'text', label: { zh: '标识', en: 'ID' } },
      { key: 'name', type: 'text', label: { zh: '名称', en: 'Name' }, optional: true },
      { key: 'imapHost', type: 'text', label: { zh: 'IMAP 服务器', en: 'IMAP host' } },
      { key: 'imapPort', type: 'text', label: { zh: 'IMAP 端口', en: 'IMAP port' }, optional: true },
      { key: 'smtpHost', type: 'text', label: { zh: 'SMTP 服务器', en: 'SMTP host' } },
      { key: 'smtpPort', type: 'text', label: { zh: 'SMTP 端口', en: 'SMTP port' }, optional: true },
      { key: 'user', type: 'text', label: { zh: '账号', en: 'User' } },
      { key: 'password', type: 'text', label: { zh: '密码/授权码', en: 'Password / auth code' } },
      { key: 'folder', type: 'text', label: { zh: '文件夹', en: 'Folder' }, optional: true },
    ] },
    { key: 'pollSeconds', type: 'number', min: 15, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Poll interval (s)' }, advanced: true },
  ],
  health: ['mailImap'],
  scope(input: { meta: Record<string, unknown> }, config: MailConfig) {
    const mailboxId = String(input.meta.mailboxId ?? '')
    const row = config.mailboxes.find((m) => m.id === mailboxId)
    if (!row) return { listened: false, reason: 'mail: mailbox not configured: ' + mailboxId }
    return { listened: true, observed: false, row: row.id }
  },
  channel: {
    async send(_host: unknown, message: OutboundMessageLike): Promise<'sent' | 'gone'> {
      const config = (channelConfig as { current?: MailConfig }).current
      if (!config) throw new Error('mail: channel not ready (no config yet)')
      const address = message.channel.address as { mailbox: string; to: string; messageId: string; subject: string }
      const mb = config.mailboxes.find((m) => m.id === address.mailbox)
      if (!mb) throw new Error('mail: mailbox not found: ' + address.mailbox)
      const port = Number(mb.smtpPort) || 465
      const transport = nodemailer.createTransport({
        host: mb.smtpHost,
        port,
        secure: port === 465,
        auth: { user: mb.user, pass: mb.password },
      })
      await transport.sendMail({
        from: mb.user,
        to: address.to,
        subject: 'Re: ' + (address.subject || '(no subject)'),
        inReplyTo: address.messageId,
        references: address.messageId,
        text: message.text,
      })
      return 'sent'
    },
    link(address: Record<string, string>) {
      return emptyLink({ zh: '邮箱 ' + String(address.mailbox ?? ''), en: 'Mail ' + String(address.mailbox ?? '') })
    },
  },
  threadContext: {
    messageId(trigger: TriggerLike): string {
      return String(trigger.meta.messageId ?? '')
    },
    async read(_commands: unknown, trigger: TriggerLike, part: 'thread' | 'root' | 'parent', _cursor: string | undefined, _config: MailConfig) {
      // v1: the assessment reads the trigger's own mail; full thread history
      // needs an IMAP re-fetch (planned M2+).
      const own = { id: String(trigger.meta.messageId ?? trigger.id), from: String(trigger.meta.from ?? trigger.actor.id), at: trigger.at, text: trigger.text }
      return { messages: part === 'parent' ? [] : [own], body: {}, status: undefined }
    },
  },
  policy: {
    schema: z.object({
      allowed: z.array(z.object({ id: z.string(), name: z.string().optional() })).default([]),
    }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '允许的发件人', en: 'Allowed senders' }, columns: [
        { key: 'id', type: 'text', label: { zh: '邮箱地址', en: 'Email address' } },
        { key: 'name', type: 'text', label: { zh: '名称', en: 'Name' }, optional: true },
      ] },
    ],
    explicit: { zh: '发送到所配邮箱的新邮件（白名单发件人）', en: 'New mail to a configured mailbox from an allowed sender' },
    rows(config: Record<string, unknown>) {
      const mailboxes = (Array.isArray(config.mailboxes) ? config.mailboxes : []) as MailboxConfig[]
      return mailboxes.map((m) => ({
        id: m.id,
        label: m.name || m.user,
        note: { zh: '收件人为该邮箱的邮件即明确指派', en: 'Mail addressed to this mailbox is an explicit assignment' },
        cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true },
      }))
    },
  },
} as unknown as import('./types.ts').SourceKindLike
