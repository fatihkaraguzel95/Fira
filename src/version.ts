/**
 * Uygulama sürümü (#74d303e2). Derleme anında package.json'dan gelir; sürüm notları
 * (src/changelog.ts, ~180 KB) yalnız "Yenilikler" penceresi ve tur açılınca iner.
 * changelog.ts'teki ilk kayıt ile package.json aynı sürümü taşımalı —
 * src/changelog.test.ts denetler.
 */
export const APP_VERSION: string = __APP_VERSION__
