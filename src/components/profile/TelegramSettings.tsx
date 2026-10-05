import { useEffect, useState } from 'react'
import { useTelegramAccount, useTelegramLinkCode, useTelegramTest, useTelegramUnlink, telegramStartUrl, TELEGRAM_BOT_USERNAME } from '../../hooks/useTelegram'
import { useT } from '../../i18n'

/**
 * The Telegram channel row: link state, the one-time code flow, and the two
 * buttons a linked account needs. The browser never touches Telegram itself —
 * it only writes the pairing code and lets the server-side bot do the talking.
 */
export function TelegramSettings({ enabled, onEnabledChange, onLinkedChange }: {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  onLinkedChange: (linked: boolean) => void
}) {
  const t = useT()
  const { data: account, isLoading } = useTelegramAccount()
  const linkCode = useTelegramLinkCode()
  const unlink = useTelegramUnlink()
  const test = useTelegramTest()
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const linked = Boolean(account && !account.blocked_at)
  useEffect(() => { onLinkedChange(linked) }, [linked, onLinkedChange])
  useEffect(() => { if (linked) setCode(null) }, [linked])

  const button = 'text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50'

  return (
    <div className="flex items-start gap-3 py-2.5">
      <button
        role="switch"
        aria-checked={enabled && linked}
        disabled={!linked}
        onClick={() => onEnabledChange(!enabled)}
        className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative disabled:opacity-40 ${enabled && linked ? 'bg-primary-600' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${enabled && linked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">Telegram</p>
        <p className="text-xs text-fg-muted">{t('settings.telegram.hint')}</p>

        {isLoading ? (
          <p className="text-xs text-fg-faint mt-1.5">{t('common.loading')}</p>
        ) : linked ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-lg bg-success/10 text-success font-medium">
              {t('settings.telegram.linked')}{account?.username ? ` · @${account.username}` : ''}
            </span>
            <button
              className={button}
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isSuccess ? t('settings.notif.sent') : test.isPending ? t('settings.telegram.sending') : t('settings.telegram.sendTest')}
            </button>
            <button className={`${button} text-danger`} disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {t('settings.telegram.unlink')}
            </button>
            {test.isError && <span className="text-xs text-danger">{t('settings.telegram.sendFailed')}</span>}
          </div>
        ) : account?.blocked_at ? (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-warning">{t('settings.telegram.blocked')}</p>
            <button className={button} onClick={() => unlink.mutate()}>{t('settings.telegram.reset')}</button>
          </div>
        ) : code ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-base font-semibold tracking-[0.2em] px-2.5 py-1.5 rounded-lg bg-field border border-line text-fg">{code}</code>
              <button
                className={button}
                onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }}
              >
                {copied ? t('common.copied') : t('common.copy')}
              </button>
              <a className={button} href={telegramStartUrl(code)} target="_blank" rel="noopener noreferrer">
                {t('settings.telegram.openInTelegram')}
              </a>
            </div>
            <p className="text-xs text-fg-muted">
              {t('settings.telegram.step1')}<span className="font-medium text-fg-2">@{TELEGRAM_BOT_USERNAME}</span>{t('settings.telegram.step2')}
              <code className="mx-1 px-1 rounded-md bg-field border border-line">/start {code}</code>{t('settings.telegram.step3')}
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className={button} disabled={linkCode.isPending} onClick={() => linkCode.mutate(undefined, { onSuccess: setCode })}>
              {linkCode.isPending ? t('settings.telegram.gettingCode') : t('settings.telegram.getCode')}
            </button>
            {linkCode.isError && <span className="text-xs text-danger">{t('settings.telegram.codeFailed')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
