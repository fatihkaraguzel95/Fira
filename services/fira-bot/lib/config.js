import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Settings come from a file the server owns, never from the repo: the bot token,
 * the service role key and the JWT secret must not exist anywhere the browser
 * bundle or git can reach.
 *
 * Lookup order — first hit wins per key:
 *   1. process environment (handy for one-off runs)
 *   2. $FIRA_BOT_ENV
 *   3. services/fira-bot/.env   (local development; .gitignore covers it)
 *   4. /etc/fira-bot.env        (production, mode 600)
 */
const here = dirname(fileURLToPath(import.meta.url))

function parse(path) {
  try {
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

const files = [
  process.env.FIRA_BOT_ENV,
  join(here, '..', '.env'),
  '/etc/fira-bot.env',
].filter(Boolean).map(parse)

const get = (key, fallback) => {
  for (const source of [process.env, ...files]) {
    if (source[key] !== undefined && source[key] !== '') return source[key]
  }
  return fallback
}

const trimSlash = (s) => (s || '').replace(/\/+$/, '')

export const config = {
  botToken: get('TELEGRAM_BOT_TOKEN'),
  // Uygulamanın kullandığı Supabase projesi; .env ile ezilebilir.
  supabaseUrl: trimSlash(get('SUPABASE_URL', 'https://zkyegeioiyxaiamugbjt.supabase.co')),
  // Yeni anahtar düzeninde sb_secret_… / sb_publishable_…, eskisinde JWT'ler.
  serviceKey: get('SUPABASE_SERVICE_ROLE_KEY'),
  anonKey: get('SUPABASE_ANON_KEY'),
  // Varsa kullanıcı token'ı yerelde imzalanır; yoksa Auth admin oturumu alınır.
  jwtSecret: get('SUPABASE_JWT_SECRET'),
  baseUrl: trimSlash(get('FIRA_BASE_URL', 'https://fira.flpconsulting.de')),
  // Long polling holds the request open, so this is only the gap after an error.
  pollTimeout: Number(get('POLL_TIMEOUT_SECONDS', '25')),
  // A draft older than this is treated as abandoned: the next plain message
  // starts over instead of silently landing in a conversation from yesterday.
  draftTtlMinutes: Number(get('DRAFT_TTL_MINUTES', '120')),

  // ── Yapay zekâ (NVIDIA NIM, OpenAI uyumlu uç) ────────────────────────────
  // Anahtar yoksa sohbet kapalı kalır, düğmeli /yeni akışı çalışmaya devam eder.
  aiKey: get('NVIDIA_API_KEY'),
  aiBaseUrl: trimSlash(get('AI_BASE_URL', 'https://integrate.api.nvidia.com/v1')),
  aiModel: get('AI_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),

  // ── Görevlerin açılacağı yer ─────────────────────────────────────────────
  // Liste (proje) isimle çözülür: ilk eşleşen kullanılır. Kullanıcı /hedef ile
  // değiştirince seçim telegram_accounts'a yazılır ve buradaki isimlere bir daha
  // bakılmaz.
  targetProjects: get('FIRA_PROJECT', 'Uygulama hata analizi,SportIQ').split(',').map((s) => s.trim()).filter(Boolean),

  // Durum sorulmaz. Telegram'dan açılan her görev listenin "yapılacaklar"
  // durumuna düşer: yeni iş oraya girer, oradan panoda ilerler. Kurulumlar
  // sütunu farklı adlandırdığı için ad yerine bir takım eşanlamlı denenir ve
  // hiçbiri tutmazsa `backlog` kategorisindeki sütuna düşülür (bkz.
  // data.js → standardColumn).
  targetStatus: get('FIRA_STATUS', 'Yapılacaklar'),
  targetStatusAliases: ['yapılacaklar', 'yapılacak', 'yapilacaklar', 'yapilacak', 'to do', 'todo', 'backlog'],
}

export function assertConfig() {
  // jwtSecret isteğe bağlı: yoksa token.js Auth admin yolundan oturum alır.
  const missing = ['botToken', 'serviceKey', 'anonKey'].filter((k) => !config[k])
  if (missing.length) {
    throw new Error(`eksik ayar: ${missing.join(', ')} — .env dosyasını ya da FIRA_BOT_ENV yolunu kontrol et`)
  }
}
