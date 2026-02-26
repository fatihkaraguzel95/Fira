/**
 * Fira AI Ticket Processor
 *
 * "ai" etiketiyle işaretlenmiş ticketları Supabase'den çeker,
 * Claude API ile analiz eder, uygulanabilir olanları otomatik
 * olarak kodlar ve GitHub PR açar.
 *
 * Gerekli env değişkenleri:
 *   ANTHROPIC_API_KEY     - Anthropic API anahtarı
 *   SUPABASE_URL          - Supabase proje URL'i
 *   SUPABASE_SERVICE_KEY  - Supabase service_role anahtarı (admin)
 *   TARGET_PROJECT_ID     - Hangi projenin ticketları işlensin
 *   GH_TOKEN              - GitHub PR açmak için (GitHub Actions'ta otomatik gelir)
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// ─── Config ───────────────────────────────────────────────────────────────────

const {
  ANTHROPIC_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  TARGET_PROJECT_ID,
  AI_TAG_NAME = 'ai',
} = process.env

if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TARGET_PROJECT_ID) {
  console.error('❌ Eksik env değişkenleri:')
  console.error('   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, TARGET_PROJECT_ID')
  process.exit(1)
}

const REPO_ROOT = process.cwd()
const SAFE_DIRS = ['src', 'public']       // Sadece bu dizinlere yazılabilir
const MAX_ITERATIONS = 25                  // Agentic loop max adım

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Claude Araçları ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'read_file',
    description: 'Repodan bir kaynak dosyasını oku.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo kökünden göreli yol (örn: src/components/Sidebar.tsx)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Repoda bir dosyayı yaz ya da üzerine yaz. Yalnızca src/ ve public/ içine izin verilir.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo kökünden göreli yol' },
        content: { type: 'string', description: 'Dosyanın tam içeriği' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'Bir dizindeki dosya ve klasörleri listele.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo kökünden göreli yol (örn: src/components)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'task_complete',
    description: 'Tüm değişiklikler yapıldığında bunu çağır. Ne implement edildiğini özetle.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Yapılan değişikliklerin kısa özeti (Türkçe)' },
      },
      required: ['summary'],
    },
  },
]

// ─── Araç Uygulayıcı ─────────────────────────────────────────────────────────

function isSafePath(filePath) {
  const normalized = path.normalize(filePath).replace(/\\/g, '/')
  return SAFE_DIRS.some(dir => normalized.startsWith(dir + '/'))
}

function executeTool(name, input) {
  if (name === 'read_file') {
    const fullPath = path.join(REPO_ROOT, input.path)
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      // Büyük dosyaları kırp
      return content.length > 18000
        ? content.slice(0, 18000) + '\n\n... [dosya çok büyük, kırpıldı]'
        : content
    } catch {
      return `HATA: Dosya bulunamadı: ${input.path}`
    }
  }

  if (name === 'write_file') {
    if (!isSafePath(input.path)) {
      return `HATA: "${input.path}" yoluna yazma izni yok. Sadece src/ ve public/ içine yazılabilir.`
    }
    const fullPath = path.join(REPO_ROOT, input.path)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, input.content, 'utf-8')
    return `OK: ${input.path} yazıldı (${input.content.length} karakter)`
  }

  if (name === 'list_directory') {
    const fullPath = path.join(REPO_ROOT, input.path)
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      return entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
        .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
        .join('\n')
    } catch {
      return `HATA: Dizin bulunamadı: ${input.path}`
    }
  }

  if (name === 'task_complete') {
    return 'DONE'
  }

  return `Bilinmeyen araç: ${name}`
}

// ─── Uygulanabilirlik Kontrolü ────────────────────────────────────────────────

async function checkFeasibility(ticket) {
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Fira, React/TypeScript ile yazılmış bir proje yönetim uygulamasıdır (Kanban board, ticket yönetimi, Supabase backend).

Aşağıdaki ticket frontend kaynak kodu değiştirilerek uygulanabilir mi?

Başlık: ${ticket.title}
Açıklama: ${ticket.description ?? '(açıklama yok)'}

Sadece JSON ile cevap ver (başka metin yok):
{"feasible": true/false, "reason": "max 80 karakter Türkçe açıklama"}`,
      },
    ],
  })

  try {
    const text = response.content[0].text
    return JSON.parse(text.match(/\{[\s\S]*?\}/)[0])
  } catch {
    return { feasible: false, reason: 'Yanıt parse edilemedi' }
  }
}

// ─── Agentic Uygulama Döngüsü ─────────────────────────────────────────────────

async function implementTicket(ticket) {
  const messages = [
    {
      role: 'user',
      content: `Sen Fira adlı bir proje yönetim uygulamasının (React 19 + TypeScript + Vite + Tailwind CSS + Supabase) AI geliştiricisisin.

Şu ticket'ı implement et:
**Başlık:** ${ticket.title}
**Açıklama:** ${ticket.description ?? '(açıklama yok)'}

Çalışma adımları:
1. Önce list_directory("src") ile genel yapıyı gör
2. İlgili klasörlere/dosyalara bak (list_directory, read_file)
3. Gerekli değişiklikleri write_file ile uygula
4. Bitince task_complete çağır

Kurallar:
- Sadece src/ ve public/ dizinlerine yazabilirsin
- Türkçe UI metinleri kullan
- Mevcut kod stilini koru (Tailwind sınıfları, TypeScript tipleri)
- Yalnızca bu ticket ile ilgili değişiklik yap, fazlasını yapma
- Mevcut dosyaları okumadan düzenleme yapma`,
    },
  ]

  const writtenFiles = []
  let summary = ''
  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8096,
      tools: TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults = []
      let isDone = false

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        const label = block.input.path ?? block.input.summary ?? ''
        console.log(`      🔧 ${block.name}(${label})`)

        const result = executeTool(block.name, block.input)

        if (block.name === 'write_file' && result.startsWith('OK:')) {
          writtenFiles.push(block.input.path)
        }
        if (block.name === 'task_complete') {
          summary = block.input.summary
          isDone = true
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: String(result),
        })
      }

      messages.push({ role: 'user', content: toolResults })
      if (isDone) break
    } else {
      break
    }
  }

  return { writtenFiles, summary, iterations }
}

// ─── Git Yardımcıları ─────────────────────────────────────────────────────────

function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim()
}

function remoteBranchExists(name) {
  try {
    execSync(`git ls-remote --exit-code --heads origin ${name}`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function cleanupBranch(name) {
  try { git('checkout main') } catch {}
  try { git(`branch -D ${name}`) } catch {}
}

// ─── Ana Akış ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤖 Fira AI Ticket Processor\n' + '─'.repeat(40))

  // "ai" etiketinin ID'lerini bul
  const { data: tags, error: tagErr } = await supabase
    .from('tags')
    .select('id')
    .eq('name', AI_TAG_NAME)

  if (tagErr) { console.error('Supabase tag hatası:', tagErr); process.exit(1) }
  if (!tags?.length) {
    console.log(`"${AI_TAG_NAME}" etiketi bulunamadı. Önce Fira'da bu etiketi oluşturun.`)
    return
  }

  // Bu etiketle işaretlenmiş ticket ID'lerini bul
  const { data: assignments } = await supabase
    .from('ticket_tag_assignments')
    .select('ticket_id')
    .in('tag_id', tags.map(t => t.id))

  if (!assignments?.length) {
    console.log(`"${AI_TAG_NAME}" etiketli ticket bulunamadı.`)
    return
  }

  // Hedef projedeki bu ticket'ları getir
  const { data: tickets, error: ticketErr } = await supabase
    .from('tickets')
    .select('id, title, description')
    .eq('project_id', TARGET_PROJECT_ID)
    .in('id', assignments.map(a => a.ticket_id))

  if (ticketErr) { console.error('Supabase ticket hatası:', ticketErr); process.exit(1) }
  if (!tickets?.length) {
    console.log('Hedef projede işlenecek ticket yok.')
    return
  }

  console.log(`\n📋 ${tickets.length} ticket bulundu\n`)

  let success = 0, skipped = 0, failed = 0

  for (const ticket of tickets) {
    const branchName = `ai/ticket-${ticket.id.slice(0, 8)}`
    console.log(`\n┌── ${ticket.title}`)
    console.log(`│   ID: ${ticket.id.slice(0, 8)} | Branch: ${branchName}`)

    // Zaten PR açılmış mı?
    if (remoteBranchExists(branchName)) {
      console.log('│   ⏭️  Bu ticket için zaten PR var, atlanıyor.')
      skipped++
      continue
    }

    // Uygulanabilir mi?
    console.log('│   🔍 Uygulanabilirlik analiz ediliyor...')
    const check = await checkFeasibility(ticket)
    console.log(`│   ${check.feasible ? '✅' : '❌'} ${check.reason}`)

    if (!check.feasible) {
      skipped++
      continue
    }

    // Main'e dön, branch oluştur
    try {
      git('checkout main')
      git('pull origin main')
      git(`checkout -b ${branchName}`)
    } catch (err) {
      console.error('│   💥 Branch oluşturulamadı:', err.message)
      failed++
      continue
    }

    // Implement et
    try {
      console.log('│   🏗️  Uygulanıyor...')
      const { writtenFiles, summary, iterations } = await implementTicket(ticket)

      if (writtenFiles.length === 0) {
        console.log(`│   ⚠️  Dosya değişikliği yapılmadı (${iterations} adım). Atlanıyor.`)
        cleanupBranch(branchName)
        skipped++
        continue
      }

      console.log(`│   📝 Değişen dosyalar (${iterations} adım):`)
      writtenFiles.forEach(f => console.log(`│      • ${f}`))

      // Commit & push
      git('add -A')
      git(`commit -m "feat(ai): ${ticket.title.replace(/"/g, "'")}"`)
      git(`push origin ${branchName}`)

      // PR aç
      const prBody = [
        summary,
        '',
        '---',
        `> 🤖 Bu PR Fira AI Ticket Processor tarafından otomatik oluşturuldu.`,
        `> Ticket ID: \`${ticket.id}\``,
      ].join('\n')

      execSync(
        `gh pr create --title "feat(ai): ${ticket.title.replace(/"/g, "'")}" --body "${prBody.replace(/"/g, "'")}" --base main --head ${branchName}`,
        { cwd: REPO_ROOT, encoding: 'utf-8' }
      )

      console.log('└── 🚀 PR oluşturuldu!')
      success++

    } catch (err) {
      console.error('│   💥 Hata:', err.message)
      cleanupBranch(branchName)
      failed++
    }
  }

  // Ana branch'e dön
  try { git('checkout main') } catch {}

  console.log('\n' + '─'.repeat(40))
  console.log(`✅ Tamamlandı — Başarılı: ${success} | Atlandı: ${skipped} | Hatalı: ${failed}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
