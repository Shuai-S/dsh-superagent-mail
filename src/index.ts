/**
 * dsh-superagent-mail — multi-mailbox IMAP/SMTP Source for dsh-superagent.
 *
 * Registers the 'mail' Source kind through the same extension seam the bundled
 * watchers use (inject 'orchestrator'), polls each configured mailbox for new
 * mail (IMAP), and replies via SMTP with proper In-Reply-To threading.
 *
 * @module dsh-superagent-mail
 */
import type { Context } from '@deepseek-ai/cordis'
import type { OrchestratorLike } from './types.ts'
import { mailKind, HEALTH_ENTRY } from './mail-kind.ts'
import { watch } from './watch.ts'

export const name: string = 'dsh-superagent-mail'
export const inject: string[] = ['orchestrator']

export function apply(ctx: Context): void {
  const orchestrator = (ctx as unknown as { orchestrator: OrchestratorLike }).orchestrator
  ctx.effect(() => orchestrator.sources.register(mailKind), 'mail: source kind')
  ctx.effect(() => {
    const source = orchestrator.context(mailKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => {
      source.report(HEALTH_ENTRY, { state: 'error', detail: String(error).slice(0, 300) })
    })
    return async () => { controller.abort(); await running }
  })
}
export { mailKind, MailConfigSchema } from './mail-kind.ts'
