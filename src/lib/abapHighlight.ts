/**
 * ABAP sözdizimi renklendirmesi (#3b5dca6e). highlight.js ABAP dilbilgisi
 * getirmiyor, o yüzden kendimiz yazdık. Yalnız `highlight.ts` alıyor; o da
 * gecikmeli yüklendiği için bu dosya ilk yüklemeye girmez.
 *
 * ABAP'a özgü kurallar:
 * - Büyük/küçük harf fark etmez (`DATA` = `data`).
 * - `*` yalnız satırın ilk sütununda yorum başlatır, başka yerde çarpmadır;
 *   `"` satır sonuna kadar yorumdur.
 * - İşleçlerin iki yanında boşluk zorunlu, yani bitişik `-` bileşen seçicidir:
 *   `ls_msg-type` tek bir ad sayılır, içindeki `type` boyanmaz. `CLASS-METHODS`,
 *   `END-OF-SELECTION` gibi tireli anahtar kelimeler de tek parça tanınır.
 * - Alan adı olarak da kullanılan anahtar kelimeler (`type = 'E'`,
 *   `lt_x[ key = 1 ]`) bir atama/karşılaştırma işlecinden önce geliyorsa ad
 *   sayılır ve boyanmaz.
 */
import type { HLJSApi, Language, Mode } from 'highlight.js'

/**
 * Anahtar kelimeler. Alan ya da değişken adı olarak çok geçen birkaç sözcük
 * (name, text, title, result, out, keys, low, high …) bilerek listede yok.
 */
const KEYWORDS = [
  // tanımlar
  'class', 'endclass', 'definition', 'implementation', 'deferred', 'load', 'public', 'protected',
  'private', 'section', 'final', 'abstract', 'create', 'inheriting', 'friends', 'global', 'local',
  'interface', 'endinterface', 'interfaces', 'aliases',
  'methods', 'class-methods', 'method', 'endmethod', 'redefinition', 'importing', 'exporting',
  'changing', 'returning', 'receiving', 'raising', 'exceptions', 'optional', 'default', 'preferred',
  'parameter', 'events', 'class-events', 'event', 'handler', 'activation',
  'data', 'class-data', 'types', 'constants', 'statics', 'field-symbols', 'field-symbol',
  'parameters', 'select-options', 'ranges', 'tables', 'type-pools', 'type-pool',
  'begin', 'end', 'of', 'occurs', 'include', 'structure', 'type', 'like', 'ref', 'to', 'line',
  'lines', 'table', 'standard', 'sorted', 'hashed', 'index', 'any', 'key', 'unique', 'non-unique',
  'empty', 'components', 'value', 'length', 'decimals', 'read-only', 'initial', 'size', 'header',
  'boxed',
  // program yapısı, olaylar, ekranlar
  'report', 'program', 'function-pool', 'class-pool', 'interface-pool', 'function', 'endfunction',
  'form', 'endform', 'perform', 'using', 'module', 'endmodule', 'chain', 'endchain', 'field',
  'start-of-selection', 'end-of-selection', 'initialization', 'at', 'selection-screen',
  'top-of-page', 'end-of-page', 'load-of-program', 'line-selection', 'user-command', 'block',
  'frame', 'obligatory', 'no-display', 'modif', 'checkbox', 'radiobutton', 'listbox',
  'value-request', 'help-request', 'exit-command', 'output', 'input', 'screen', 'pf-status',
  'titlebar',
  // akış
  'if', 'else', 'elseif', 'endif', 'case', 'when', 'others', 'endcase', 'do', 'enddo', 'times',
  'while', 'endwhile', 'loop', 'endloop', 'endat', 'into', 'assigning', 'reference',
  'transporting', 'where', 'group', 'groups', 'members', 'continue', 'exit', 'return', 'check',
  'leave', 'stop', 'try', 'catch', 'cleanup', 'endtry', 'resume', 'retry', 'raise', 'exception',
  'throw', 'before', 'unwind',
  // yapıcı ifadeler
  'new', 'conv', 'corresponding', 'cast', 'exact', 'reduce', 'filter', 'cond', 'switch', 'let',
  'init', 'next', 'then', 'in', 'for', 'until', 'base', 'mapping', 'except', 'discarding',
  'duplicates', 'deep',
  // veri işlemleri, liste çıktısı
  'append', 'insert', 'modify', 'delete', 'clear', 'free', 'refresh', 'move', 'move-corresponding',
  'sort', 'by', 'ascending', 'descending', 'stable', 'collect', 'read', 'write', 'format',
  'condense', 'concatenate', 'separated', 'split', 'replace', 'translate', 'shift', 'overlay',
  'find', 'search', 'occurrence', 'occurrences', 'all', 'first', 'last', 'regex', 'pcre',
  'ignoring', 'respecting', 'upper', 'lower', 'assign', 'unassign', 'component', 'casting', 'add',
  'subtract', 'multiply', 'divide', 'describe', 'comparing', 'adjacent', 'sum', 'count', 'avg',
  'max', 'min', 'uline', 'skip', 'new-line', 'new-page', 'position', 'no-gap', 'no-zero',
  'no-sign', 'color', 'hotspot', 'intensified', 'inverse', 'reset', 'left-justified',
  'right-justified', 'centered',
  // Open SQL, dosyalar
  'select', 'endselect', 'from', 'single', 'distinct', 'up', 'rows', 'order', 'having', 'join',
  'inner', 'left', 'outer', 'right', 'cross', 'on', 'as', 'union', 'intersect', 'exists',
  'between', 'escape', 'null', 'fields', 'appending', 'entries', 'package', 'connection',
  'bypassing', 'buffer', 'client', 'specified', 'update', 'set', 'values', 'commit', 'rollback',
  'work', 'open', 'close', 'fetch', 'cursor', 'with', 'hierarchy', 'dataset', 'transfer',
  'encoding', 'mode', 'binary',
  // karşılaştırma ve mantık
  'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'co', 'cn', 'ca', 'na', 'cs', 'ns', 'cp', 'np', 'and', 'or',
  'not', 'equiv', 'is', 'bound', 'assigned', 'supplied', 'requested', 'instance', 'div', 'mod',
  'bit-and', 'bit-or', 'bit-xor', 'bit-not',
  // çağrılar ve diğerleri
  'call', 'transaction', 'submit', 'via', 'destination', 'starting', 'task', 'background',
  'message', 'id', 'number', 'display', 'authority-check', 'break-point', 'assert', 'log-point',
  'wait', 'seconds', 'get', 'time', 'stamp', 'date', 'zone', 'convert', 'memory', 'export',
  'import', 'database', 'shared', 'object', 'badi', 'enhancement-point', 'enhancement-section',
  'end-enhancement-section', 'enhancement', 'endenhancement', 'test-seam', 'end-test-seam',
  'test-injection', 'end-test-injection', 'testing', 'risk', 'level', 'duration', 'harmless',
  'dangerous', 'critical', 'short', 'medium', 'long', 'define', 'end-of-definition', 'exec', 'sql',
  'endexec', 'transformation', 'source', 'xml', 'entity', 'entities', 'execute', 'me', 'super',
]

/** Dize şablonundaki biçim seçenekleri: `|{ tarih DATE = USER }|`, `{ x WIDTH = 10 ALIGN = RIGHT }`. */
const FORMAT_OPTIONS = [
  'width', 'align', 'center', 'timestamp', 'timezone', 'iso', 'user', 'environment', 'raw',
  'alpha', 'out', 'sign', 'exponent', 'style', 'currency', 'country', 'pad', 'xsd', 'yes', 'no',
  'simple', 'sign_as_postfix', 'scale_preserving', 'scientific', 'scientific_with_leading_zero',
  'scale_preserving_scientific', 'engineering', 'leftplus', 'leftspace', 'rightplus', 'rightspace',
]

const LITERALS = ['abap_true', 'abap_false', 'abap_undefined', 'space']

/** Yerleşik tipler; tek harfliler (c, i, p …) yalnız TYPE'tan sonra boyanır. */
const TYPES = [
  'string', 'xstring', 'decfloat16', 'decfloat34', 'utclong', 'int1', 'int2', 'int4', 'int8',
  'abap_bool',
]

/** Ad: `/NAMESPACE/` öneki ve RAP'in `%` alanları dahil. */
const NAME = /[a-z_\/%][\w\/%]*/
/** Bileşen zinciriyle ad: `ls_x-comp-sub`, SQL'de `a~field`. */
const PATH = /[a-z_\/%][\w\/%]*(?:[-~][\w\/%]+)*/
/**
 * Yalnız ad başında eşleşen kurallar için başlangıç. Kelime ortasında
 * denemeyi baştan keser; yoksa uzun bir satırda her harften yeniden
 * taranır ve süre karesel büyür.
 */
const AT_NAME = /(?:\b[a-z_]|[\/%])/

export default function abap(hljs: HLJSApi): Language {
  const regex = hljs.regex
  // $pattern metin olarak: highlight.js tipleri RegExp kabul etmiyor.
  const keywords = { $pattern: PATH.source, keyword: KEYWORDS, literal: LITERALS, type: TYPES }

  const LINE_COMMENT: Mode = { scope: 'comment', begin: /^\*/, end: /$/ }
  const END_COMMENT: Mode = { scope: 'comment', begin: /"/, end: /$/ }
  // Tırnaklı metinler satır aşamaz: kapanmayan tırnak satır sonunda biter.
  const TEXT: Mode = { scope: 'string', begin: /'/, end: /'|$/, contains: [{ begin: /''/ }] }
  const BACKQUOTE: Mode = { scope: 'string', begin: /`/, end: /`|$/, contains: [{ begin: /``/ }] }
  const SUBST: Mode = {
    scope: 'subst', begin: /\{/, end: /\}/,
    keywords: { ...keywords, keyword: [...KEYWORDS, ...FORMAT_OPTIONS] },
  }
  const TEMPLATE: Mode = {
    scope: 'string', begin: /\|/, end: /\||$/,
    contains: [{ begin: /\\[\\|{}nrt]/ }, SUBST],
  }
  const PRAGMA: Mode = { scope: 'meta', match: /##\w+(?:\[[^\]\n]*\])*/ }
  const FIELD_SYMBOL: Mode = { scope: 'variable', match: /<[a-z_\/][\w\/]*>(?:-[\w\/%]+)*/ }
  const SYSTEM_FIELD: Mode = { scope: 'built_in', match: /\bsy(?:st)?-[a-z_]\w*/ }
  // Satır başındaki tanım: CLASS lcl_x …, METHOD foo., FORM bar, METHODS baz …
  const DECLARATIONS: Mode[] = [
    { match: [/^[ \t]*/, /class|interface/, /\s+/, NAME], scope: { 2: 'keyword', 4: 'title.class' } },
    {
      match: [/^[ \t]*/, /method|form|function|(?:class-)?methods/, /:?\s+/, /[a-z_\/%][\w\/%~]*/],
      scope: { 2: 'keyword', 4: 'title.function' },
    },
  ]
  const PERFORM: Mode = { match: [/\bperform/, /\s+/, NAME], scope: { 1: 'keyword', 3: 'title.function.invoke' } }
  // TYPE <ad>: TYPE REF TO, TYPE [STANDARD|SORTED|HASHED] TABLE OF, TYPE RANGE OF …
  // Ardından bir anahtar kelime geliyorsa (TRANSPORTING type WHERE) `type` alan adıdır.
  const TYPE_REF: Mode = {
    match: [
      /(?:^|[^\w\/%\-~>])/,
      /type(?:\s+ref\s+to|(?:\s+(?:standard|sorted|hashed))?\s+table\s+of(?:\s+ref\s+to)?|\s+(?:range|line)\s+of)?/,
      /\s+/,
      regex.concat(new RegExp(`(?!(?:${KEYWORDS.join('|')})\\b)`), /[a-z_\/%][\w\/%]*(?:(?:-|~|=>)[\w\/%]+)*/),
    ],
    scope: { 2: 'keyword', 4: 'type' },
  }
  // obj->metot( ), sinif=>metot( ); ardından parantez yoksa öznitelik.
  const METHOD_CALL: Mode = { match: [/->|=>/, /[a-z_\/%][\w\/%~]*(?=\((?:\s|\)))/], scope: { 2: 'title.function.invoke' } }
  const ATTRIBUTE: Mode = { match: [/->|=>/, /[a-z_\/%][\w\/%~]*(?:-[\w\/%]+)*/], scope: { 2: 'property' } }
  // Çağrı ya da tablo ifadesinden sonra bileşen: get( )-type, lt_x[ 1 ]-key, ref->*-comp
  const COMPONENT: Mode = { match: [/[)\]*]/, /-[a-z_\/%][\w\/%]*(?:-[\w\/%]+)*/], scope: { 2: 'property' } }
  // metot( … ) ve yerleşik işlevler; lv_text(3) gibi alt dize erişimi çağrı değildir.
  const CALL: Mode = { scope: 'title.function.invoke', match: regex.concat(AT_NAME, /[\w\/%~]*(?=\((?:\s|\)))/) }
  // Atama/karşılaştırma işlecinden önceki ad: `type = 'E'` içindeki type anahtar kelime değil.
  const OPERAND: Mode = {
    match: regex.concat(
      AT_NAME, /[\w\/%]*(?:[-~][\w\/%]+)*/,
      regex.lookahead(/\s*(?:[-+*\/]|&&)?=(?!>)|\s*(?:<>|<=|>=|\?=)|\s+(?:[<>]|eq|ne|lt|gt|le|ge|is)\s/),
    ),
  }
  // İşaretli tamsayı; TEXT-001 ya da lv_x1 içindeki rakamlar sayı değil.
  const NUMBER: Mode = { match: [/(?:^|[^\w\/%\-])/, /[-+]?\d+\b/], scope: { 2: 'number' } }

  SUBST.contains = [TEXT, BACKQUOTE, TEMPLATE, FIELD_SYMBOL, SYSTEM_FIELD, METHOD_CALL, ATTRIBUTE, COMPONENT, CALL, NUMBER]

  return {
    name: 'ABAP',
    case_insensitive: true,
    keywords,
    contains: [
      LINE_COMMENT, END_COMMENT, TEXT, BACKQUOTE, TEMPLATE, PRAGMA, FIELD_SYMBOL, SYSTEM_FIELD,
      ...DECLARATIONS, PERFORM, TYPE_REF, METHOD_CALL, ATTRIBUTE, COMPONENT, CALL, OPERAND, NUMBER,
    ],
  }
}
