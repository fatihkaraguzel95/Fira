/**
 * Sözdizimi renklendirmesi (#58789618) — **yalnız gerektiğinde** yüklenir.
 *
 * Bu modül hiçbir yerden doğrudan import edilmiyor: kod bloğu görülünce
 * `import('./highlight')` ile çağrılıyor, yani highlight.js paketi panoyu her
 * açışta inen pakete girmiyor, ayrı bir parça olarak yalnız kod okuyana iniyor.
 *
 * Dil listesi `CODE_LANGUAGES` ile aynı kümeden seçildi; hepsini (`common`)
 * almak parçayı iki katına çıkarıyordu. ABAP highlight.js ile gelmiyor;
 * dilbilgisi bizim (`abapHighlight.ts`, #3b5dca6e).
 */
import { createLowlight } from 'lowlight'
import abap from './abapHighlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export const lowlight = createLowlight({
  abap, bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, markdown,
  php, python, ruby, rust, sql, swift, typescript, xml, yaml,
})
// HTML = xml; markdown'un kısa adı da kabul edilsin.
lowlight.register('html', xml)
lowlight.register('md', markdown)
lowlight.register('ts', typescript)
lowlight.register('js', javascript)
lowlight.register('py', python)
lowlight.register('sh', bash)

/** Bu dil renklendirilebiliyor mu (yoksa düz metin olarak kalır). */
export const canHighlight = (lang: string | null | undefined): boolean =>
  !!lang && lang !== 'text' && lowlight.registered(lang)

export interface Token { text: string; className: string | null }

/**
 * Renklendirilmiş kodu düz bir jeton dizisine indirger: hem ProseMirror
 * süslemeleri hem de okuma görünümü aynı listeyi kullanıyor, böylece iki taraf
 * birbirinden ayrı düşmüyor.
 */
export function tokenize(code: string, lang: string): Token[] {
  const out: Token[] = []
  let tree
  try {
    tree = lowlight.highlight(lang, code)
  } catch {
    return [{ text: code, className: null }]
  }
  const walk = (nodes: unknown[], className: string | null) => {
    for (const raw of nodes) {
      const node = raw as { type?: string; value?: string; children?: unknown[]; properties?: { className?: string[] } }
      if (node.type === 'text') out.push({ text: node.value ?? '', className })
      else if (node.type === 'element') {
        const own = node.properties?.className?.join(' ') ?? null
        walk(node.children ?? [], own ?? className)
      }
    }
  }
  walk(tree.children ?? [], null)
  return out
}
