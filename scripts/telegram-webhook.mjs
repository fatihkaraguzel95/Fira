/**
 * Telegram webhook'unu kaydeder / siler / durumunu gösterir.
 *
 *   node scripts/telegram-webhook.mjs info
 *   node scripts/telegram-webhook.mjs set https://<proje>.vercel.app/api/telegram
 *   node scripts/telegram-webhook.mjs delete
 *
 * Token ve sır ortamdan okunur:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
 * ya da services/fira-bot/.env dosyasından.
 *
 * Webhook kurulduğu anda uzun yoklama (getUpdates) çalışmaz olur — Telegram ikisine
 * birden izin vermez. Yoklamaya dönmek istersen önce `delete` çalıştır.
 */
import { readFileSync } from 'node:fs'

function fromEnvFile(key) {
  for (const path of ['services/fira-bot/.env', '.env']) {
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m && m[1] === key && m[2]) return m[2].replace(/^["']|["']$/g, '')
      }
    } catch { /* dosya yoksa sıradaki */ }
  }
  return undefined
}

const get = (key) => process.env[key] || fromEnvFile(key)

const token = get('TELEGRAM_BOT_TOKEN')
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN yok — ortama koy ya da services/fira-bot/.env içine yaz')
  process.exit(1)
}

const api = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const body = await res.json()
  if (!body.ok) throw new Error(`${method}: ${body.description}`)
  return body.result
}

const [command, url] = process.argv.slice(2)

if (command === 'set') {
  if (!url) { console.error('kullanım: node scripts/telegram-webhook.mjs set <https://.../api/telegram>'); process.exit(1) }
  const secret = get('TELEGRAM_WEBHOOK_SECRET')
  if (!secret) {
    console.error('TELEGRAM_WEBHOOK_SECRET yok. Üret ve hem buraya hem Vercel ortam değişkenlerine koy:')
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
  }
  // drop_pending_updates: yoklama döneminden kalan eski mesajlar webhook açılır
  // açılmaz toplu işlenmesin.
  await api('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  console.log('webhook kuruldu →', url)
} else if (command === 'delete') {
  await api('deleteWebhook', { drop_pending_updates: false })
  console.log('webhook silindi — bot yeniden uzun yoklamaya hazır')
} else if (command === 'info' || !command) {
  const me = await api('getMe')
  const info = await api('getWebhookInfo')
  console.log(`bot: @${me.username} (${me.id})`)
  console.log('webhook:', info.url || '(kurulu değil — uzun yoklama modunda)')
  if (info.pending_update_count) console.log('bekleyen güncelleme:', info.pending_update_count)
  if (info.last_error_message) console.log('son hata:', info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : '', info.last_error_message)
} else {
  console.error('bilinmeyen komut:', command, '— info | set <url> | delete')
  process.exit(1)
}
