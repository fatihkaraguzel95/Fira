import { handleMessage, handleCallback } from '../services/fira-bot/lib/router.js'

/**
 * Telegram webhook — Vercel Function.
 *
 * services/fira-bot/index.js uzun yoklama (getUpdates) yapar ve bunun için hiç
 * durmayan bir process ister: bir NAS, sunucu ya da açık duran bir bilgisayar.
 * Burada yön tersine dönüyor — mesaj geldiğinde Telegram bu adrese POST atıyor,
 * fonksiyon yalnız o mesaj işlenirken çalışıyor. Sürekli açık kalan bir şey yok.
 *
 * `lib/` klasörüne dokunulmuyor: yoklama döngüsü de bu handler da aynı iki giriş
 * noktasını çağırıyor, sohbetin hangi adımda olduğu da bellekte değil
 * `telegram_compose` tablosunda duruyor (bkz. lib/compose.js). Yoklamaya özel olan
 * tek şey `bot_state` imleciydi; webhook'ta ona gerek yok.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'yalnız POST' })

  // Adres herkese açık. Bu kontrol olmazsa isteyen sahte güncelleme gönderip
  // bota istediğini yaptırabilir. Değeri setWebhook'un secret_token'ı ile
  // konur, Telegram her istekte bu başlıkta geri yollar.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook] TELEGRAM_WEBHOOK_SECRET tanımlı değil — istek reddedildi')
    return res.status(500).json({ error: 'webhook sırrı tanımlı değil' })
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'sır eşleşmedi' })
  }

  const update = req.body
  try {
    if (update?.message) await handleMessage(update.message)
    else if (update?.callback_query) await handleCallback(update.callback_query)
  } catch (err) {
    // Her durumda 200: 200 dışındaki her cevap Telegram'a "ulaşmadı" demek olur
    // ve aynı güncellemeyi tekrar yollar — ikinci çalıştırma ilkinin yaptığını
    // tekrarlar (aynı soru, aynı taslak, bazen aynı ticket).
    console.error('[webhook]', update?.update_id, err?.message ?? err)
  }
  return res.status(200).json({ ok: true })
}
