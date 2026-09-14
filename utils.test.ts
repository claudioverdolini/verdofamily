import { describe, expect, it } from 'vitest'
import { addDays, cleanReceiptLine, medicineDepletionDate, medicineInventorySummary, medicineTherapyCoverage, migrateData, monthCells, normalize, parseIngredients, parseReceiptLines, similarity, therapyLineRequiredTablets, weekDates } from './utils'
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

  it('calculates the last day covered by medicine stock', () => {
    expect(medicineDepletionDate('2026-09-14', 30, 1, 1)).toBe('2026-10-13')
    expect(medicineDepletionDate('2026-09-14', 30, 1, 2)).toBe('2026-09-28')
    expect(medicineDepletionDate('2026-09-14', 10, 1, 0.5)).toBe('2026-10-03')
  })

  it('checks whether medicine stock covers the prescribed therapy', () => {
    const covered = medicineTherapyCoverage('2026-09-14', '2026-09-28', '2026-09-14', 30, 1, 2)
    expect(covered?.therapyDays).toBe(15)
    expect(covered?.requiredTablets).toBe(30)
    expect(covered?.sufficient).toBe(true)
    expect(covered?.surplus).toBe(0)
    expect(covered?.depletionDate).toBe('2026-09-28')

    const short = medicineTherapyCoverage('2026-09-14', '2026-09-28', '2026-09-14', 20, 1, 2)
    expect(short?.sufficient).toBe(false)
    expect(short?.shortage).toBe(10)
    expect(short?.depletionDate).toBe('2026-09-23')
  })

  it('calculates only the remaining therapy when stock is counted later', () => {
    const result = medicineTherapyCoverage('2026-09-14', '2026-09-28', '2026-09-20', 18, 1, 2)
    expect(result?.therapyDays).toBe(15)
    expect(result?.remainingDays).toBe(9)
    expect(result?.requiredTablets).toBe(18)
    expect(result?.sufficient).toBe(true)
  })
})

describe('shared medicine inventory', () => {
  const medicine: any = {
    id: 10,
    title: 'Farmaco A',
    date: '2027-01-31',
    userId: 0,
    done: false,
    kind: 'medicine',
    defaultPackageSize: 30,
    packages: [
      { id: 1, expiryDate: '2027-01-31', quantity: 30, packageSize: 30 },
      { id: 2, expiryDate: '2027-02-28', quantity: 30, packageSize: 30 }
    ]
  }

  it('sums simultaneous therapies against one shared stock', () => {
    const therapies: any[] = [
      {
        id: 20,
        title: 'Terapia 1',
        date: '2026-09-23',
        userId: 1,
        done: false,
        kind: 'therapy',
        therapyStartDate: '2026-09-14',
        therapyEndDate: '2026-09-23',
        therapyMedicines: [{ id: 1, medicineId: 10, tabletsPerDose: 1, dosesPerDay: 2 }]
      },
      {
        id: 21,
        title: 'Terapia 2',
        date: '2026-09-23',
        userId: 2,
        done: false,
        kind: 'therapy',
        therapyStartDate: '2026-09-14',
        therapyEndDate: '2026-09-23',
        therapyMedicines: [{ id: 1, medicineId: 10, tabletsPerDose: 1, dosesPerDay: 1 }]
      }
    ]
    const summary = medicineInventorySummary(medicine, therapies, '2026-09-14')
    expect(summary.totalStock).toBe(60)
    expect(summary.activeDailyUse).toBe(3)
    expect(summary.knownRemainingDemand).toBe(30)
    expect(summary.shortageKnown).toBe(0)
  })

  it('calculates how many boxes are missing for shared therapies', () => {
    const therapies: any[] = [{
      id: 20,
      title: 'Terapia lunga',
      date: '2026-10-23',
      userId: 1,
      done: false,
      kind: 'therapy',
      therapyStartDate: '2026-09-14',
      therapyEndDate: '2026-10-23',
      therapyMedicines: [{ id: 1, medicineId: 10, tabletsPerDose: 1, dosesPerDay: 2 }]
    }]
    const summary = medicineInventorySummary(medicine, therapies, '2026-09-14')
    expect(summary.knownRemainingDemand).toBe(80)
    expect(summary.shortageKnown).toBe(20)
    expect(summary.packagesToBuy).toBe(1)
  })

  it('calculates tablets required by one therapy line', () => {
    expect(therapyLineRequiredTablets('2026-09-14', '2026-09-20', { tabletsPerDose: 1, dosesPerDay: 2 })).toBe(14)
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
    expect(migrated.version).toBe(4)
  })

  it('separates a legacy medicine from its prescribed therapy without losing data', () => {
    const migrated = migrateData({
      ...initialData,
      deadlines: [{
        id: 7,
        title: 'Farmaco B',
        date: '2027-01-01',
        userId: 1,
        done: false,
        kind: 'medicine',
        tabletCount: 20,
        tabletsPerDose: 1,
        dosesPerDay: 2,
        therapyStartDate: '2026-09-14',
        therapyEndDate: '2026-09-20',
        prescriber: 'Rossi',
        usage: 'Dopo i pasti'
      }]
    }, initialData)
    const medicine = migrated.deadlines.find(item => item.kind === 'medicine')
    const therapy = migrated.deadlines.find(item => item.kind === 'therapy')
    expect(medicine?.packages?.[0].quantity).toBe(20)
    expect(therapy?.legacyMedicineId).toBe(7)
    expect(therapy?.therapyMedicines?.[0].medicineId).toBe(7)
    expect(therapy?.prescriber).toBe('Rossi')
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
