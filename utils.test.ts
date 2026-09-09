import { describe, expect, it } from 'vitest'
import { addDays, cleanReceiptLine, migrateData, monthCells, normalize, parseIngredients, parseReceiptLines, similarity, weekDates } from './utils'
import { initialData } from './data'

describe('date helpers', () => {
  it('returns seven days starting on Monday', () => {
    const week = weekDates('2026-09-06')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-08-31')
    expect(week[6]).toBe('2026-09-06')
  })

  it('builds a 42-cell month grid', () => {
    expect(monthCells('2026-09-06')).toHaveLength(42)
  })

  it('adds days without UTC drift', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
  })
})

describe('receipt parsing', () => {
  it('removes price tails and headers', () => {
    expect(cleanReceiptLine('LATTE INTERO 1,79')).toBe('LATTE INTERO')
    expect(cleanReceiptLine('TOTALE 23,45')).toBe('')
  })

  it('deduplicates receipt lines', () => {
    expect(parseReceiptLines('PANE 1,20\nPANE 1,20\nLATTE 1,50')).toEqual(['PANE', 'LATTE'])
  })

  it('finds useful product similarities', () => {
    expect(similarity('LATTE UHT INTERO', 'Latte intero')).toBeGreaterThan(0.2)
  })
})

describe('data migration', () => {
  it('migrates legacy meals to dishes', () => {
    const migrated = migrateData({ users: initialData.users, meals: [{ id: 9, name: 'Riso', type: 'Primo', variant: '', ingredients: [] }] }, initialData)
    expect(migrated.dishes[0].name).toBe('Riso')
    expect(migrated.version).toBe(3)
  })

  it('preserves linked cloud user ids', () => {
    const migrated = migrateData({
      ...initialData,
      users: [{ ...initialData.users[0], cloudUserId: '11111111-2222-3333-4444-555555555555' }]
    }, initialData)
    expect(migrated.users[0].cloudUserId).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('parses ingredients safely', () => {
    expect(parseIngredients('Pasta=80=g;Uova=2=pz')).toEqual([
      { name: 'Pasta', qty: 80, unit: 'g' },
      { name: 'Uova', qty: 2, unit: 'pz' }
    ])
  })

  it('normalizes accents and punctuation', () => {
    expect(normalize('Caffè, Latte!')).toBe('caffe latte')
  })
})
