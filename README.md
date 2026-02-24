# Fira — Ticket Yönetim Sistemi

Jira/Linear benzeri, Supabase destekli modern bir ticket yönetim sistemi.

## Kurulum

### 1. Bağımlılıkları Yükle

```bash
npm install
```

### 2. Supabase Projesi Oluştur

[app.supabase.com](https://app.supabase.com) adresinde yeni bir proje oluşturun.

### 3. `.env` Dosyasını Düzenle

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 4. SQL Migration'larını Çalıştır

Supabase Dashboard → SQL Editor'da aşağıdaki dosyaları sırasıyla çalıştırın:

```
src/supabase/migrations/001_enums.sql
src/supabase/migrations/002_profiles.sql
src/supabase/migrations/003_tickets.sql
src/supabase/migrations/004_ticket_attachments.sql
src/supabase/migrations/005_ticket_comments.sql
src/supabase/migrations/006_rls.sql
src/supabase/migrations/007_storage.sql
src/supabase/migrations/008_updated_at_trigger.sql
```

### 5. Geliştirme Sunucusunu Başlat

```bash
npm run dev
```

## Özellikler

- **Kanban Board** — Sütunlar arası drag-and-drop (dnd-kit)
- **Liste Görünümü** — Filtrelenebilir tablo
- **Ticket Detay Modalı** — URL tabanlı (`/ticket/:id`), inline edit
- **Kişi Atama** — Profiles tablosundan kullanıcı seçimi
- **Dosya/Resim Yükleme** — Supabase Storage
- **Yorumlar** — Ticket başına yorum akışı
- **Auth** — Supabase Email/Şifre
- **RLS** — Satır düzeyinde güvenlik politikaları

## Tech Stack

- React 18 + TypeScript + Vite
- Tailwind CSS
- Supabase (Auth + DB + Storage)
- @dnd-kit (drag-and-drop)
- TanStack Query v5
- React Router v6
