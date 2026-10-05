import { describe, expect, it } from 'vitest'
import { canHighlight, tokenize } from './highlight'

/** Boyanan parçalar: [sınıf, metin]; `hljs-title function_ invoke__` → `title.function.invoke`. */
const painted = (code: string) =>
  tokenize(code, 'abap')
    .filter((t) => t.className)
    .map((t) => [t.className!.replace(/^hljs-/, '').split(' ').map((s) => s.replace(/_+$/, '')).join('.'), t.text])

const of = (code: string, kind: string) => painted(code).filter(([k]) => k === kind).map(([, text]) => text)

describe('ABAP renklendirmesi', () => {
  it('ABAP renklendirilebilir diller arasında', () => {
    expect(canHighlight('abap')).toBe(true)
  })

  it('anahtar kelimeleri büyük/küçük harf ayırmadan tanır, tireli olanları tek parça sayar', () => {
    expect(of('DATA lv_x TYPE i.', 'keyword')).toEqual(['DATA', 'TYPE'])
    expect(of('data lv_x type i.', 'keyword')).toEqual(['data', 'type'])
    expect(of('CLASS-METHODS run. END-OF-SELECTION.', 'keyword')).toContain('CLASS-METHODS')
    expect(of('END-OF-SELECTION.', 'keyword')).toEqual(['END-OF-SELECTION'])
  })

  it('yıldız yalnız ilk sütunda yorumdur, başka yerde çarpmadır', () => {
    expect(of('* toplam\nlv_y = lv_x * 2.', 'comment')).toEqual(['* toplam'])
    expect(of('lv_y = lv_x * 2.', 'number')).toEqual(['2'])
    expect(of('  * girintili', 'comment')).toEqual([])
  })

  it('tırnak işareti satır sonuna kadar yorum; metnin içindeki tırnak yorum değil', () => {
    const code = `lv = 'a"b'. " açıklama`
    expect(of(code, 'string')).toEqual([`'a"b'`])
    expect(of(code, 'comment')).toEqual(['" açıklama'])
  })

  it('metinlerde çift tırnak kaçışı; kapanmayan metin satır sonunda biter', () => {
    expect(of(`lv = 'It''s'.`, 'string')).toEqual([`'It''s'`])
    expect(of('lv = `a``b`.', 'string')).toEqual(['`a``b`'])
    const open = painted(`lv = 'yarım\nlv2 = 1.`)
    expect(open).toContainEqual(['string', `'yarım`])
    expect(open).toContainEqual(['number', '1'])
  })

  it('dize şablonu: gömülü ifade kod gibi, biçim seçenekleri ve kaçışlar doğru', () => {
    const code = 'rv = |Merhaba { lv_name WIDTH = 10 } \\| son|.'
    expect(of(code, 'keyword')).toEqual(['WIDTH'])
    expect(of(code, 'number')).toEqual(['10'])
    expect(of(code, 'string').join('')).toBe('|Merhaba  \\| son|')
  })

  it('bileşen ve işleç öncesi ad anahtar kelime diye boyanmaz', () => {
    expect(of(`ls_msg-type = 'E'.`, 'keyword')).toEqual([])
    expect(of(`LOOP AT lt_msg WHERE type = 'E' AND id = 'X'.`, 'keyword')).toEqual(['LOOP', 'AT', 'WHERE', 'AND'])
    expect(of('SELECT title, status FROM ztasks INTO TABLE @DATA(lt_tasks).', 'keyword')).toEqual(['SELECT', 'FROM', 'INTO', 'TABLE', 'DATA'])
    expect(of('lv = lt_msg[ 1 ]-type.', 'keyword')).toEqual([])
    expect(of('lv = lo->get( )-key.', 'keyword')).toEqual([])
    expect(of('<ls_line>-type = 1.', 'variable')).toEqual(['<ls_line>-type'])
    expect(of('<ls_line>-type = 1.', 'keyword')).toEqual([])
  })

  it('sistem alanları', () => {
    expect(of('IF sy-subrc <> 0.', 'built_in')).toEqual(['sy-subrc'])
    expect(of('lv = syst-datum.', 'built_in')).toEqual(['syst-datum'])
  })

  it('TYPE sonrası tip adı; alan adı olan type tip boyatmaz', () => {
    const table = 'DATA lt TYPE STANDARD TABLE OF bapiret2 WITH EMPTY KEY.'
    expect(of(table, 'keyword')).toContain('TYPE STANDARD TABLE OF')
    expect(of(table, 'type')).toEqual(['bapiret2'])
    expect(of('DATA lo TYPE REF TO zcl_foo.', 'type')).toEqual(['zcl_foo'])
    expect(of('DATA lv TYPE c LENGTH 10.', 'type')).toEqual(['c'])
    expect(of('MODIFY lt FROM ls TRANSPORTING type WHERE id = 1.', 'type')).toEqual([])
    expect(of('FIELD-SYMBOLS <fs> TYPE any.', 'type')).toEqual([])
  })

  it('metot çağrıları; alt dize erişimi çağrı değil', () => {
    expect(of('lo_alv->display( ).', 'title.function.invoke')).toEqual(['display'])
    expect(of('lo_alv->display( ).', 'keyword')).toEqual([])
    expect(of('lv = lines( lt ).', 'title.function.invoke')).toEqual(['lines'])
    expect(of('lv = zcl_x=>create( ).', 'title.function.invoke')).toEqual(['create'])
    expect(of('lv = zcl_x=>gc_value.', 'keyword')).toEqual([])
    expect(of('lv = lv_text(3).', 'title.function.invoke')).toEqual([])
    expect(of('lv = lv_text(3).', 'number')).toEqual(['3'])
  })

  it('sınıf, metot ve form adları', () => {
    expect(of('CLASS lcl_app DEFINITION FINAL.', 'title.class')).toEqual(['lcl_app'])
    expect(of('  METHOD run.', 'title.function')).toEqual(['run'])
    expect(of('    METHODS: process.', 'title.function')).toEqual(['process'])
    expect(of('    METHODS: process.', 'keyword')).toEqual(['METHODS'])
    expect(of('FORM do_it USING lv.', 'title.function')).toEqual(['do_it'])
    expect(of('PERFORM do_it USING lv.', 'title.function.invoke')).toEqual(['do_it'])
    expect(of('CALL METHOD lo->run.', 'title.function')).toEqual([])
  })

  it('sayılar, sabitler, pragmalar', () => {
    expect(of('lv = -1 + TEXT-001.', 'number')).toEqual(['-1'])
    expect(of('lv = lv1 + 2.', 'number')).toEqual(['2'])
    expect(of('lv = abap_true.', 'literal')).toEqual(['abap_true'])
    expect(of(`MESSAGE 'x' TYPE 'E' ##NO_TEXT.`, 'meta')).toEqual(['##NO_TEXT'])
  })

  it('uzun satırlarda takılmaz', () => {
    const start = performance.now()
    tokenize('a'.repeat(20000) + ' ' + 'x-'.repeat(2000) + ' = 1.', 'abap')
    expect(performance.now() - start).toBeLessThan(1500)
  })
})
