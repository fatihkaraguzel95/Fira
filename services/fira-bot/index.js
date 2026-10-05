import { config, assertConfig } from './lib/config.js'
import { getState, setState } from './lib/supa.js'
import { getMe, getUpdates, setMyCommands } from './lib/tg.js'
import { tokenStrategy } from './lib/token.js'
import { handleMessage, handleCallback } from './lib/router.js'

/**
 * Fira Telegram botu — telefondan görev açma.
 *
 * Fira kurum VPN'inin arkasında: sunucuya dışarıdan istek giremediği için webhook
 * kurulamıyor, bot `getUpdates` ile uzun yoklama yapıyor. Dışa doğru çıkış yeterli.
 *
 * Tek döngü, tek iş: gelen mesajı yönlendir. Bildirim gönderme bu servisin işi
 * değil — o ayrı serviste duruyor, böylece biri düşerse diğeri susmuyor.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let stopping = false

async function loop(offsetKey) {
  let offset = (await getState(offsetKey))?.value ?? 0

  while (!stopping) {
    let updates
    try {
      updates = await getUpdates(offset || undefined)
    } catch (err) {
      // 409: aynı token ile ikinci bir getUpdates açık. İki örnek birbirinin
      // mesajını yer; hangisinin kalacağına insan karar vermeli.
      if (err.status === 409) {
        console.error('[bot] bu token ile başka bir örnek çalışıyor (409) — diğerini durdur')
        await sleep(15000)
      } else {
        console.error('[bot] getUpdates:', err.message)
        await sleep(3000)
      }
      continue
    }

    for (const update of updates ?? []) {
      offset = update.update_id + 1
      try {
        if (update.message) await handleMessage(update.message)
        else if (update.callback_query) await handleCallback(update.callback_query)
      } catch (err) {
        // Tek bir bozuk güncelleme döngüyü durdurmasın; offset ilerlemeye devam
        // etsin, yoksa aynı hata sonsuza kadar tekrarlanır.
        console.error(`[bot] ${update.update_id} işlenemedi:`, err.message)
      }
    }

    // Offset'i ancak işledikten sonra yazıyoruz: yeniden başlatma, işlenmemiş
    // mesajı tekrar getirir — kaybetmekten iyidir.
    if (updates?.length) await setState(offsetKey, { value: offset })
  }
}

async function main() {
  assertConfig()
  const me = await getMe()

  // Geliştirme botu ile canlı bot aynı veritabanını paylaşabiliyor; ortak bir
  // offset ikisinin birbirinin mesajını yutmasına yol açardı.
  const offsetKey = `fira_bot_offset:${me.id}`

  console.info(`[bot] @${me.username} ayakta · Supabase ${config.supabaseUrl} · ${config.baseUrl}`)
  console.info(`[bot] kullanıcı yetkisi: ${tokenStrategy()}`)
  await setMyCommands().catch((err) => console.warn('[bot] komut listesi yazılamadı:', err.message))

  await loop(offsetKey)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(0)
    stopping = true
    console.info(`[bot] ${signal} alındı, kapanıyor`)
    setTimeout(() => process.exit(0), 3000)
  })
}

main().catch((err) => {
  console.error('[bot] başlatılamadı:', err.message)
  process.exit(1)
})
