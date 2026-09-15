import type { Deadline, FamilyData, FamilyUser, MedicinePackage, TherapyMedicine, UserPrefs } from './types'

export const MEAL_TYPES = ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Dolce', 'Altro']
export const MEAL_SLOTS = ['Colazione', 'II Colazione', 'Pranzo', 'Merenda', 'Cena']

export function localDateISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseISODate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0)
}

export function addDays(dateStr: string, days: number) {
  const d = parseISODate(dateStr)
  d.setDate(d.getDate() + days)
  return localDateISO(d)
}

export function daysInclusive(startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) return 0
  return Math.round((parseISODate(endDate).getTime() - parseISODate(startDate).getTime()) / 86400000) + 1
}

export function medicineDepletionDate(startDate: string, tabletCount: number, tabletsPerDose: number, dosesPerDay: number) {
  const tablets = Number(tabletCount)
  const perDose = Number(tabletsPerDose)
  const frequency = Number(dosesPerDay)
  if (!startDate || !Number.isFinite(tablets) || !Number.isFinite(perDose) || !Number.isFinite(frequency) || tablets <= 0 || perDose <= 0 || frequency <= 0) return ''
  const dailyUse = perDose * frequency
  const coverageDays = Math.ceil(tablets / dailyUse)
  return addDays(startDate, Math.max(coverageDays - 1, 0))
}

export function medicineTherapyCoverage(
  therapyStartDate: string,
  therapyEndDate: string,
  stockStartDate: string,
  tabletCount: number,
  tabletsPerDose: number,
  dosesPerDay: number
) {
  const perDose = Number(tabletsPerDose)
  const frequency = Number(dosesPerDay)
  if (!therapyStartDate || !therapyEndDate || therapyEndDate < therapyStartDate || !Number.isFinite(perDose) || !Number.isFinite(frequency) || perDose <= 0 || frequency <= 0) return null

  const dailyUse = perDose * frequency
  const therapyDays = daysInclusive(therapyStartDate, therapyEndDate)
  const effectiveStockStart = stockStartDate && stockStartDate > therapyStartDate ? stockStartDate : therapyStartDate
  const remainingDays = effectiveStockStart > therapyEndDate ? 0 : daysInclusive(effectiveStockStart, therapyEndDate)
  const requiredTablets = Math.max(0, Math.ceil((remainingDays * dailyUse) - 1e-9))
  const tablets = Number(tabletCount)
  const hasStock = Number.isFinite(tablets) && tablets > 0
  const depletionDate = hasStock ? medicineDepletionDate(effectiveStockStart, tablets, perDose, frequency) : ''

  return {
    therapyDays,
    remainingDays,
    dailyUse,
    requiredTablets,
    effectiveStockStart,
    depletionDate,
    sufficient: hasStock ? tablets >= requiredTablets : null,
    shortage: hasStock ? Math.max(requiredTablets - tablets, 0) : null,
    surplus: hasStock ? Math.max(tablets - requiredTablets, 0) : null
  }
}

export function therapyDailyUse(line: Pick<TherapyMedicine, 'tabletsPerDose' | 'dosesPerDay'>) {
  const perDose = Number(line.tabletsPerDose)
  const frequency = Number(line.dosesPerDay)
  if (!Number.isFinite(perDose) || !Number.isFinite(frequency) || perDose <= 0 || frequency <= 0) return 0
  return perDose * frequency
}

export function therapyLineRequiredTablets(
  therapyStartDate: string,
  therapyEndDate: string,
  line: Pick<TherapyMedicine, 'tabletsPerDose' | 'dosesPerDay'>,
  fromDate?: string
) {
  const dailyUse = therapyDailyUse(line)
  if (!therapyStartDate || !therapyEndDate || therapyEndDate < therapyStartDate || dailyUse <= 0) return null
  const effectiveStart = fromDate && fromDate > therapyStartDate ? fromDate : therapyStartDate
  if (effectiveStart > therapyEndDate) return 0
  return Math.ceil((daysInclusive(effectiveStart, therapyEndDate) * dailyUse) - 1e-9)
}

function normalizeMedicinePackage(pkg: any, index: number): MedicinePackage {
  const quantity = Number(pkg?.quantity ?? pkg?.tabletCount ?? 0)
  const packageSize = Number(pkg?.packageSize ?? 0)
  return {
    id: Number(pkg?.id) || index + 1,
    expiryDate: pkg?.expiryDate || pkg?.date || '',
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
    packageSize: Number.isFinite(packageSize) && packageSize > 0 ? packageSize : undefined,
    lot: pkg?.lot || '',
    addedAt: pkg?.addedAt || pkg?.stockStartDate || ''
  }
}

function normalizeTherapyMedicine(line: any, index: number): TherapyMedicine {
  return {
    id: Number(line?.id) || index + 1,
    medicineId: Number(line?.medicineId || 0),
    tabletsPerDose: Number(line?.tabletsPerDose || 1),
    dosesPerDay: Number(line?.dosesPerDay || 1),
    usage: line?.usage || ''
  }
}

export function medicineInventorySummary(medicine: Deadline, therapies: Deadline[], asOfDate = localDateISO()) {
  const allPackages = (medicine.packages || []).map(normalizeMedicinePackage)
  const expiredPackages = allPackages.filter(pkg => !!pkg.expiryDate && pkg.expiryDate < asOfDate)
  const usablePackages = allPackages.filter(pkg => pkg.quantity > 0 && (!pkg.expiryDate || pkg.expiryDate >= asOfDate))
  const totalStock = usablePackages.reduce((sum, pkg) => sum + pkg.quantity, 0)
  const earliestExpiry = usablePackages.map(pkg => pkg.expiryDate || '').filter(Boolean).sort()[0] || ''
  const expiringSoonPackages = usablePackages.filter(pkg => pkg.expiryDate && pkg.expiryDate <= addDays(asOfDate, 30)).length
  const linkedTherapies = therapies.filter(therapy => therapy.kind === 'therapy' && !therapy.done && (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === medicine.id))

  let activeDailyUse = 0
  let knownRemainingDemand = 0
  let hasOpenEndedDemand = false
  let latestKnownEnd = asOfDate

  for (const therapy of linkedTherapies) {
    const start = therapy.therapyStartDate || therapy.date || ''
    const end = therapy.therapyEndDate || ''
    if (end && end > latestKnownEnd) latestKnownEnd = end
    for (const line of therapy.therapyMedicines || []) {
      if (Number(line.medicineId) !== medicine.id) continue
      const dailyUse = therapyDailyUse(line)
      if (dailyUse <= 0 || !start) continue
      if (start <= asOfDate && (!end || end >= asOfDate)) activeDailyUse += dailyUse
      if (end) {
        const required = therapyLineRequiredTablets(start, end, line, asOfDate)
        knownRemainingDemand += Number(required || 0)
      } else if (start >= asOfDate || start <= asOfDate) {
        hasOpenEndedDemand = true
      }
    }
  }

  const standardPackageSize = Number(medicine.defaultPackageSize || usablePackages.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || allPackages.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
  const shortageKnown = Math.max(Math.ceil(knownRemainingDemand - totalStock - 1e-9), 0)
  const packagesToBuy = shortageKnown > 0 && standardPackageSize > 0 ? Math.ceil(shortageKnown / standardPackageSize) : 0

  const simulatedPackages = usablePackages
    .map(pkg => ({ ...pkg, remaining: Number(pkg.quantity) }))
    .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'))
  const simulationEnd = hasOpenEndedDemand ? addDays(asOfDate, 1825) : latestKnownEnd
  let shortageDate = ''
  let coverageUntil = ''

  for (let day = asOfDate; day <= simulationEnd && linkedTherapies.length; day = addDays(day, 1)) {
    let demand = 0
    for (const therapy of linkedTherapies) {
      const start = therapy.therapyStartDate || therapy.date || ''
      const end = therapy.therapyEndDate || ''
      if (!start || day < start || (end && day > end)) continue
      for (const line of therapy.therapyMedicines || []) {
        if (Number(line.medicineId) === medicine.id) demand += therapyDailyUse(line)
      }
    }
    if (demand <= 0) continue

    let remainingDemand = demand
    for (const pkg of simulatedPackages) {
      if (remainingDemand <= 1e-9) break
      if (pkg.remaining <= 0) continue
      if (pkg.expiryDate && pkg.expiryDate < day) continue
      const used = Math.min(pkg.remaining, remainingDemand)
      pkg.remaining -= used
      remainingDemand -= used
    }
    if (remainingDemand > 1e-9) {
      shortageDate = day
      coverageUntil = day === asOfDate ? '' : addDays(day, -1)
      break
    }
    coverageUntil = day
  }

  return {
    packageCount: allPackages.length,
    totalStock,
    earliestExpiry,
    expiredPackageCount: expiredPackages.length,
    expiringSoonPackageCount: expiringSoonPackages,
    therapyCount: linkedTherapies.length,
    activeDailyUse,
    knownRemainingDemand: Math.ceil(knownRemainingDemand - 1e-9),
    hasOpenEndedDemand,
    shortageKnown,
    packagesToBuy,
    standardPackageSize,
    shortageDate,
    coverageUntil
  }
}

export function weekDates(dateStr: string) {
  const base = parseISODate(dateStr)
  const day = base.getDay()
  const delta = day === 0 ? -6 : 1 - day
  base.setDate(base.getDate() + delta)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    return localDateISO(d)
  })
}

export function monthCells(dateStr: string) {
  const base = parseISODate(dateStr)
  const first = new Date(base.getFullYear(), base.getMonth(), 1, 12)
  const day = first.getDay()
  const delta = day === 0 ? -6 : 1 - day
  first.setDate(first.getDate() + delta)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first)
    d.setDate(first.getDate() + i)
    return { date: localDateISO(d), inMonth: d.getMonth() === base.getMonth() }
  })
}

export function monthTitle(dateStr: string) {
  return parseISODate(dateStr).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

export function dayLabel(dateStr: string, long = false) {
  return parseISODate(dateStr).toLocaleDateString('it-IT', long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: '2-digit' })
}

export function money(value: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value || 0)
}

export function nextId<T extends { id: number }>(list: T[]) {
  return list.length ? Math.max(...list.map(x => x.id)) + 1 : 1
}

export function normalize(text: string) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function similarity(a: string, b: string) {
  const aa = normalize(a)
  const bb = normalize(b)
  if (!aa || !bb) return 0
  if (aa === bb) return 1
  if (aa.includes(bb) || bb.includes(aa)) return 0.88
  const A = new Set(aa.split(' ').filter(x => x.length > 1))
  const B = new Set(bb.split(' ').filter(x => x.length > 1))
  const intersection = [...A].filter(x => B.has(x)).length
  const union = new Set([...A, ...B]).size || 1
  return intersection / union
}

export function cleanReceiptLine(line: string) {
  let s = (line || '').replace(/\r/g, '').trim()
  if (!s) return ''
  s = s.replace(/^\s*\d+\s*[xX]\s*/, '')
  s = s.replace(/\s+\d{1,5}[\.,]\d{2}\s*[€]?[A-Z]?\s*$/i, '')
  s = s.replace(/\s+[A-Z]\s*$/i, '').trim()
  const n = normalize(s)
  const stop = ['totale', 'subtotale', 'iva', 'pagamento', 'contanti', 'carta', 'resto', 'scontrino', 'documento commerciale', 'data', 'ora', 'cassa']
  if (!/[a-zà-ù]/i.test(s)) return ''
  if (stop.some(x => n === x || n.startsWith(x + ' '))) return ''
  return s.length >= 3 ? s : ''
}

export function parseReceiptLines(text: string) {
  const seen = new Set<string>()
  return (text || '').split(/\r?\n/).map(cleanReceiptLine).filter(Boolean).filter(line => {
    const key = normalize(line)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseIngredients(text: string) {
  if (!text.trim()) return []
  return text.split(';').map(chunk => {
    const [name = '', qty = '', unit = 'pz'] = chunk.split('=').map(x => x.trim())
    return { name, qty: Number(qty) || 0, unit: unit || 'pz' }
  }).filter(x => x.name)
}

export function ingredientsToText(items: Array<{ name: string; qty: number; unit: string }>) {
  return (items || []).map(i => `${i.name}=${i.qty}=${i.unit}`).join(';')
}

export const DEFAULT_PREFS: UserPrefs = {
  theme: 'system',
  accent: '#5B5BD6',
  density: 'comfortable',
  showBalances: true,
  bottomTabs: ['home', 'calendar', 'shopping', 'meals'],
  homeCards: ['today', 'shopping', 'deadlines', 'wallets'],
  notifications: { calendar: true, deadlines: true, chores: true, shopping: false, whatsapp: false }
}

export function mergePrefs(input?: Partial<UserPrefs>): UserPrefs {
  return {
    ...DEFAULT_PREFS,
    ...(input || {}),
    bottomTabs: input?.bottomTabs?.length ? input.bottomTabs : DEFAULT_PREFS.bottomTabs,
    homeCards: input?.homeCards?.length ? input.homeCards : DEFAULT_PREFS.homeCards,
    notifications: { ...DEFAULT_PREFS.notifications, ...(input?.notifications || {}) }
  }
}

function migrateDeadlines(input: any[]): Deadline[] {
  const source = Array.isArray(input) ? input : []
  const existingLegacyLinks = new Set(source.filter(item => item?.kind === 'therapy' && item?.legacyMedicineId).map(item => Number(item.legacyMedicineId)))
  let nextDeadlineId = source.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1
  const result: Deadline[] = []
  const pendingTherapies: Deadline[] = []

  source.forEach((raw: any) => {
    const base = { ...raw, id: Number(raw?.id), done: !!raw?.done }
    if (raw?.kind === 'medicine') {
      const packages = Array.isArray(raw.packages)
        ? raw.packages.map(normalizeMedicinePackage)
        : (raw.tabletCount || raw.date)
          ? [normalizeMedicinePackage({
              id: 1,
              expiryDate: raw.date || '',
              quantity: Number(raw.tabletCount || 0),
              packageSize: Number(raw.tabletCount || 0) || undefined,
              addedAt: raw.stockStartDate || ''
            }, 0)]
          : []
      const expiryDates = packages.map(pkg => pkg.expiryDate || '').filter(Boolean).sort()
      const defaultPackageSize = Number(raw.defaultPackageSize || packages.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || raw.tabletCount || 0) || undefined
      result.push({
        ...base,
        kind: 'medicine',
        date: expiryDates[0] || raw.date || localDateISO(),
        userId: 0,
        defaultPackageSize,
        packages,
        prescriber: undefined,
        usage: undefined,
        therapyStartDate: undefined,
        therapyEndDate: undefined,
        therapyMedicines: undefined,
        stockStartDate: undefined,
        tabletCount: undefined,
        tabletsPerDose: undefined,
        dosesPerDay: undefined
      })

      const shouldCreateLegacyTherapy = !existingLegacyLinks.has(Number(raw.id)) && !!(
        raw.therapyStartDate || raw.therapyEndDate || raw.prescriber || Number(raw.userId || 0) > 0
      )
      if (shouldCreateLegacyTherapy) {
        const therapyStartDate = raw.therapyStartDate || raw.stockStartDate || ''
        const therapyEndDate = raw.therapyEndDate || ''
        pendingTherapies.push({
          id: nextDeadlineId++,
          title: `Terapia ${raw.title || 'medicinale'}`,
          date: therapyEndDate || therapyStartDate || raw.date || localDateISO(),
          userId: Number(raw.userId || 0),
          done: false,
          kind: 'therapy',
          purpose: raw.purpose || '',
          prescriber: raw.prescriber || '',
          notes: '',
          therapyStartDate,
          therapyEndDate,
          therapyMedicines: [{
            id: 1,
            medicineId: Number(raw.id),
            tabletsPerDose: Number(raw.tabletsPerDose || 1),
            dosesPerDay: Number(raw.dosesPerDay || 1),
            usage: raw.usage || ''
          }],
          legacyMedicineId: Number(raw.id)
        })
      }
      return
    }

    if (raw?.kind === 'therapy') {
      result.push({
        ...base,
        kind: 'therapy',
        date: raw.therapyEndDate || raw.therapyStartDate || raw.date || localDateISO(),
        therapyMedicines: Array.isArray(raw.therapyMedicines) ? raw.therapyMedicines.map(normalizeTherapyMedicine) : []
      })
      return
    }

    result.push({ ...base, kind: raw?.kind || 'general' })
  })

  return [...result, ...pendingTherapies]
}

export function migrateData(raw: any, fallback: FamilyData): FamilyData {
  if (!raw || typeof raw !== 'object') return fallback
  const source = raw.data && raw.data.users ? raw.data : raw
  return {
    version: 5,
    users: Array.isArray(source.users) && source.users.length
      ? source.users.map((u: any): FamilyUser => ({
          id: Number(u.id),
          cloudUserId: u.cloudUserId || undefined,
          name: u.name || 'Utente',
          role: u.role || 'adulto',
          password: u.password || '',
          color: u.color || '#5B5BD6',
          avatarUrl: u.avatarUrl || '',
          balance: Number(u.balance || 0),
          prefs: mergePrefs(u.prefs)
        }))
      : fallback.users,
    calendarEvents: Array.isArray(source.calendarEvents) ? source.calendarEvents.map((event: any) => {
      const userId = Number(event?.userId || 0)
      const rawIds = Array.isArray(event?.userIds) ? event.userIds.map(Number).filter((id: number) => id > 0) : []
      const userIds = Array.from(new Set(rawIds.length ? rawIds : (userId ? [userId] : []))) as number[]
      return { ...event, id: Number(event.id), userId: userId || userIds[0] || 0, userIds, audience: event?.audience === 'family' ? 'family' : 'users' }
    }) : [],
    deadlines: migrateDeadlines(source.deadlines),
    categories: Array.isArray(source.categories) && source.categories.length ? source.categories : fallback.categories,
    pantry: Array.isArray(source.pantry) ? source.pantry : [],
    shopping: Array.isArray(source.shopping) ? source.shopping : [],
    dishes: Array.isArray(source.dishes) ? source.dishes : (Array.isArray(source.meals) ? source.meals : fallback.dishes),
    mealPlans: Array.isArray(source.mealPlans) ? source.mealPlans.map((p: any) => ({ ...p, dishId: Number(p.dishId ?? p.mealId) })) : [],
    chores: Array.isArray(source.chores) ? source.chores : [],
    transactions: Array.isArray(source.transactions) ? source.transactions : [],
    todos: Array.isArray(source.todos) ? source.todos.map((t: any) => ({ ...t, createdAt: t.createdAt || localDateISO() })) : []
  }
}
