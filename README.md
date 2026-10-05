# Fira — Ticket Yönetim Sistemi

Jira/Linear benzeri, Supabase destekli ticket yönetim sistemi.

## Kurulum

### 1. Bağımlılıkları yükle

```bash
npm ci
```

### 2. Supabase projesi

[app.supabase.com](https://app.supabase.com) üzerinde bir proje açın (ya da self-hosted bir
Supabase kullanın).

### 3. `.env` dosyası

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

`VITE_SUPABASE_URL` göreli de olabilir (`/api`): aynı origin altında duran self-hosted
Supabase için çalışma anında sayfanın origin'i ile birleştirilir (`src/lib/supabase.ts`).

### 4. SQL migration'larını çalıştır

Şema `supabase/migrations/` altında, numara sırasıyla uygulanır (001 → 115).
Supabase CLI ile:

```bash
supabase login
supabase link --project-ref <proje-ref>
supabase db push
```

ya da Supabase Dashboard → SQL Editor'da dosyaları **numara sırasıyla** çalıştırın.
Sıra atlanamaz; her dosya kendinden öncekilerin şemasını varsayar.

### 5. Geliştirme sunucusu

```bash
npm run dev     # http://localhost:5173
npm test        # vitest
npm run build   # dist/
```

## Özellikler

- **Kanban panosu** — sütunlar arası drag-and-drop (dnd-kit)
- **Liste görünümü** — gruplama, sıralama, sütun seçimi, satır içi düzenleme, toplu işlem, kayıtlı görünümler
- **Görev penceresi** — URL tabanlı (`/ticket/:id`), alt görevler, yapılacaklar, bağlı görevler, ekler
- **Sayfalar** — markdown sayfa ağacı, sürüm geçmişi, çöp kutusu
- **Tuval** — çizim ve whiteboard (beta)
- **Komut paleti** — `⌘K` / `Ctrl+K`, bulanık arama ve komutlar
- **Gelen kutusu** — bildirimler, etkinlik akışı, sürüm notları
- **İçe aktarma** — OneNote, Excel/CSV, MS Planner
- **Yedek ve taşıma** — ZIP/CSV dışa ve içe aktarma
- **Yönetim** (`/admin`) — sunucu durumu, ağ & istekler, duyuru/bakım
- **Telegram botu** — `services/fira-bot` (telefondan görev açma, görev sorgulama)
- **PWA** — yüklenebilir, bekleyen sürüm kendiliğinden uygulanır
- **Çok dillilik** — tr (kaynak), en, de
- **Tema** — açık / koyu / otomatik + renk paletleri
- **Auth + RLS** — Supabase e-posta/şifre, satır düzeyinde güvenlik

## Tech stack

- React 19 + TypeScript + Vite 5
- Tailwind CSS 3 (tema tokenları `src/index.css`)
- Supabase (Auth + PostgREST + Storage + Realtime)
- TanStack Query v5, React Router v7
- @dnd-kit, tiptap 3, Excalidraw
- Vitest + happy-dom

## Daha fazlası

- `CLAUDE.md` — proje kuralları ve mimari kararların özeti
- `DEVELOPMENT_LOG.md` — teknik günlük
- `docs/teknik-dokuman.md` — teknik mimari
- `docs/kullanici-kilavuzu.md` — kullanıcı kılavuzu
- `docs/backup-and-migration.md` — yedek ve taşıma
