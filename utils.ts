import type { BoardPost, CalendarEvent, Deadline, FamilyData, FamilyUser, MedicinePackage, PantryItem, PantryMovement, RecurringChore, Routine, RoutineCompletion, SchoolItem, SchoolSubject, SchoolTimetableEntry, TherapyMedicine, UserPrefs } from './types'

export const MEAL_TYPES = ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Dolce', 'Altro']
export const MEAL_SLOTS = ['Colazione', 'II Colazione', 'Pranzo', 'Merenda', 'Cena']

export async function imageFileToAvatarDataUrl(file: File, size = 320) {
  if (!file.type.startsWith('image/')) throw new Error('Seleziona un file immagine.')
  if (file.size > 12 * 1024 * 1024) throw new Error('La foto è troppo grande. Massimo 12 MB.')

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Impossibile leggere la foto.'))
      img.src = objectUrl
    })

    const side = Math.min(image.naturalWidth, image.naturalHeight)
    if (!side) throw new Error('Foto non valida.')
    const sx = Math.max(0, (image.naturalWidth - side) / 2)
    const sy = Math.max(0, (image.naturalHeight - side) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Impossibile elaborare la foto.')

    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size)
    const webp = canvas.toDataURL('image/webp', .82)
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', .84)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function imageFileToBackgroundDataUrl(file: File, maxSide = 1600) {
  if (!file.type.startsWith('image/')) throw new Error('Seleziona un file immagine.')
  if (file.size > 12 * 1024 * 1024) throw new Error('La foto è troppo grande. Massimo 12 MB.')

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Impossibile leggere la foto.'))
      img.src = objectUrl
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Foto non valida.')

    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Impossibile elaborare la foto.')

    ctx.drawImage(image, 0, 0, width, height)
    let dataUrl = canvas.toDataURL('image/webp', .72)
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', .72)

    if (dataUrl.length > 1_150_000) {
      const retryScale = Math.min(1, 1280 / Math.max(width, height))
      const retry = document.createElement('canvas')
      retry.width = Math.max(1, Math.round(width * retryScale))
      retry.height = Math.max(1, Math.round(height * retryScale))
      const retryCtx = retry.getContext('2d')
      if (!retryCtx) throw new Error('Impossibile comprimere la foto.')
      retryCtx.drawImage(canvas, 0, 0, retry.width, retry.height)
      dataUrl = retry.toDataURL('image/webp', .62)
      if (!dataUrl.startsWith('data:image/webp')) dataUrl = retry.toDataURL('image/jpeg', .64)
    }

    if (dataUrl.length > 1_200_000) throw new Error('La foto resta troppo pesante anche dopo la compressione. Prova con un’immagine più piccola.')
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

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

export function calendarEventOccursOn(event: CalendarEvent, date: string) {
  if (!event?.date || !date || date < event.date) return false
  if (event.recurrenceEndDate && date > event.recurrenceEndDate) return false
  const recurrence = event.recurrence || 'none'
  if (recurrence === 'none') return date === event.date

  const start = parseISODate(event.date)
  const target = parseISODate(date)
  const diffDays = Math.round((target.getTime() - start.getTime()) / 86400000)
  if (diffDays < 0) return false

  if (recurrence === 'daily') return true
  if (recurrence === 'weekly') return diffDays % 7 === 0
  if (recurrence === 'biweekly') return diffDays % 14 === 0
  if (recurrence === 'monthly') return target.getDate() === start.getDate()
  if (recurrence === 'yearly') return target.getMonth() === start.getMonth() && target.getDate() === start.getDate()
  return date === event.date
}

export function calendarOccurrencesBetween(events: CalendarEvent[], startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) return [] as CalendarEvent[]
  const days = Math.min(3660, Math.max(0, daysInclusive(startDate, endDate)))
  const occurrences: CalendarEvent[] = []
  for (let index = 0; index < days; index += 1) {
    const date = addDays(startDate, index)
    for (const event of events || []) {
      if (!calendarEventOccursOn(event, date)) continue
      occurrences.push({ ...event, date })
    }
  }
  return occurrences
}

export function daysInclusive(startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) return 0
  return Math.round((parseISODate(endDate).getTime() - parseISODate(startDate).getTime()) / 86400000) + 1
}


export function pantryAverageDailyUse(itemId: number, movements: PantryMovement[], asOfDate = localDateISO(), lookbackDays = 30) {
  const fromDate = addDays(asOfDate, -Math.max(1, lookbackDays) + 1)
  const relevant = (movements || []).filter(movement =>
    Number(movement.pantryItemId) === Number(itemId) &&
    movement.date >= fromDate &&
    movement.date <= asOfDate
  )
  const manualConsumed = relevant
    .filter(movement => movement.reason === 'manual' && Number(movement.delta || 0) < 0)
    .reduce((sum, movement) => sum + Math.abs(Number(movement.delta || 0)), 0)
  const mealNet = relevant
    .filter(movement => movement.reason === 'meal')
    .reduce((sum, movement) => sum + Number(movement.delta || 0), 0)
  const consumed = manualConsumed + Math.max(0, -mealNet)
  return consumed > 0 ? consumed / Math.max(1, lookbackDays) : 0
}

export function pantryDaysRemaining(item: PantryItem, movements: PantryMovement[], asOfDate = localDateISO()) {
  const daily = pantryAverageDailyUse(item.id, movements, asOfDate)
  if (daily <= 0) return null
  return Math.max(0, Number(item.qty || 0) / daily)
}

export function pantryExpiryDays(item: PantryItem, asOfDate = localDateISO()) {
  if (!item.expiryDate) return null
  return Math.round((parseISODate(item.expiryDate).getTime() - parseISODate(asOfDate).getTime()) / 86400000)
}

export function pantryNeedsRestock(item: PantryItem, movements: PantryMovement[], asOfDate = localDateISO()) {
  const low = Number(item.minQty || 0) > 0 && Number(item.qty || 0) <= Number(item.minQty || 0)
  const daysRemaining = pantryDaysRemaining(item, movements, asOfDate)
  const projected = item.autoRestock !== false && daysRemaining !== null && daysRemaining <= 7
  return low || projected
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


export function isoWeekday(dateStr: string) {
  const day = parseISODate(dateStr).getDay()
  return day === 0 ? 7 : day
}

export function recurringChoreDueOn(chore: RecurringChore, dateStr: string) {
  if (!chore.active) return false
  if (chore.startDate && dateStr < chore.startDate) return false
  if (chore.endDate && dateStr > chore.endDate) return false
  const weekdays = Array.isArray(chore.weekdays) ? chore.weekdays.map(Number) : []
  return weekdays.includes(isoWeekday(dateStr))
}

export function materializeRecurringChores(data: FamilyData, dateStr = localDateISO()): FamilyData {
  const templates = Array.isArray(data.recurringChores) ? data.recurringChores : []
  if (!templates.length) return data

  let chores = data.chores
  let changed = false

  for (const template of templates) {
    if (!recurringChoreDueOn(template, dateStr)) continue
    const assigneeIds = Array.from(new Set(
      (Array.isArray(template.userIds) && template.userIds.length ? template.userIds : [template.userId])
        .map(Number)
        .filter(id => id > 0)
    ))

    for (const userId of assigneeIds) {
      const alreadyExists = chores.some(chore =>
        Number(chore.recurringChoreId || 0) === Number(template.id)
        && chore.deadline === dateStr
        && Number(chore.userId) === userId
      )
      if (alreadyExists) continue

      chores = [...chores, {
        id: nextId(chores),
        title: template.title,
        deadline: dateStr,
        userId,
        amount: Math.max(0, Number(template.amount) || 0),
        done: false,
        completionStatus: 'open',
        recurringChoreId: Number(template.id)
      }]
      changed = true
    }
  }

  return changed ? { ...data, chores } : data
}


function daysBetween(startDate: string, endDate: string) {
  return Math.round((parseISODate(endDate).getTime() - parseISODate(startDate).getTime()) / 86400000)
}

function monthDiff(startDate: string, dateStr: string) {
  const start = parseISODate(startDate)
  const date = parseISODate(dateStr)
  return (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth())
}

function clampedRoutineDate(year: number, monthIndex: number, preferredDay: number) {
  const lastDay = new Date(year, monthIndex + 1, 0, 12).getDate()
  return localDateISO(new Date(year, monthIndex, Math.min(preferredDay, lastDay), 12))
}

export function routineDueOn(routine: Routine, dateStr: string) {
  if (!routine?.active || !routine.startDate || dateStr < routine.startDate) return false
  if (routine.endDate && dateStr > routine.endDate) return false

  const start = parseISODate(routine.startDate)
  const date = parseISODate(dateStr)

  if (routine.frequency === 'daily') return true

  if (routine.frequency === 'weekly' || routine.frequency === 'fortnightly') {
    const diff = daysBetween(routine.startDate, dateStr)
    const interval = routine.frequency === 'weekly' ? 7 : 14
    return diff >= 0 && diff % interval === 0
  }

  const months = monthDiff(routine.startDate, dateStr)
  const preferredDay = start.getDate()
  if (months < 0) return false

  if (routine.frequency === 'monthly') {
    return dateStr === clampedRoutineDate(date.getFullYear(), date.getMonth(), preferredDay)
  }

  if (routine.frequency === 'semiannual') {
    return months % 6 === 0 && dateStr === clampedRoutineDate(date.getFullYear(), date.getMonth(), preferredDay)
  }

  if (routine.frequency === 'yearly') {
    return date.getMonth() === start.getMonth() &&
      dateStr === clampedRoutineDate(date.getFullYear(), start.getMonth(), preferredDay)
  }

  return false
}

export function routineCompletedOn(completions: RoutineCompletion[], routineId: number, dateStr: string) {
  return (completions || []).some(item => Number(item.routineId) === Number(routineId) && item.date === dateStr)
}

export function nextRoutineDueDate(routine: Routine, fromDate = localDateISO()) {
  const start = routine.startDate && routine.startDate > fromDate ? routine.startDate : fromDate
  for (let i = 0; i <= 740; i++) {
    const date = addDays(start, i)
    if (routineDueOn(routine, date)) return date
    if (routine.endDate && date > routine.endDate) break
  }
  return ''
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
  accent: '#635BFF',
  visualStyle: 'violet',
  backgroundPreset: 'none',
  backgroundColor: '#EEF6FF',
  backgroundImage: undefined,
  backgroundStrength: 24,
  backgroundBlur: 0,
  density: 'comfortable',
  showBalances: true,
  bottomTabs: ['home', 'calendar', 'shopping', 'meals'],
  homeCards: ['today', 'shopping', 'meals', 'school', 'board', 'deadlines'],
  notificationDetail: 'full',
  notifications: { calendar: true, deadlines: true, chores: true, school: true, board: true, shopping: false, whatsapp: false }
}

function visualStyleFromAccent(accent?: string) {
  const key = String(accent || '').toUpperCase()
  const known: Record<string, UserPrefs['visualStyle']> = {
    '#5B5BD6': 'violet',
    '#635BFF': 'violet',
    '#0284C7': 'ocean',
    '#059669': 'emerald',
    '#F97316': 'sunset',
    '#EA580C': 'sunset',
    '#C026D3': 'berry',
    '#E11D48': 'coral',
    '#334155': 'midnight',
    '#2563EB': 'electric'
  }
  return known[key] || 'custom'
}

function normalizeHomeCards(input?: UserPrefs['homeCards']) {
  const current = Array.isArray(input) ? input : []
  const legacyDefault = ['today', 'shopping', 'deadlines', 'wallets']
  const isUntouchedLegacyDefault = current.length === legacyDefault.length
    && legacyDefault.every(key => current.includes(key as any))
  if (isUntouchedLegacyDefault) return DEFAULT_PREFS.homeCards
  return current.length ? current : DEFAULT_PREFS.homeCards
}

export function mergePrefs(input?: Partial<UserPrefs>): UserPrefs {
  const allowedBackgrounds = ['none','color','aurora','sky','sand','forest','sunset','night','lavender','custom']
  const rawBackgroundImage = String(input?.backgroundImage || '')
  const backgroundImage = /^data:image\/(?:webp|jpeg|png);base64,/i.test(rawBackgroundImage) && rawBackgroundImage.length <= 1_200_000
    ? rawBackgroundImage
    : undefined
  const requestedPreset = allowedBackgrounds.includes(String(input?.backgroundPreset || ''))
    ? input?.backgroundPreset
    : DEFAULT_PREFS.backgroundPreset
  const backgroundPreset = requestedPreset === 'custom' && !backgroundImage ? 'none' : requestedPreset
  const rawBackgroundColor = String(input?.backgroundColor || '')
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(rawBackgroundColor)
    ? rawBackgroundColor.toUpperCase()
    : DEFAULT_PREFS.backgroundColor

  return {
    ...DEFAULT_PREFS,
    ...(input || {}),
    visualStyle: input?.visualStyle || visualStyleFromAccent(input?.accent) || DEFAULT_PREFS.visualStyle,
    backgroundPreset,
    backgroundColor,
    backgroundImage,
    backgroundStrength: Math.max(8, Math.min(60, Number(input?.backgroundStrength ?? DEFAULT_PREFS.backgroundStrength) || DEFAULT_PREFS.backgroundStrength)),
    backgroundBlur: Math.max(0, Math.min(12, Number(input?.backgroundBlur ?? DEFAULT_PREFS.backgroundBlur) || 0)),
    bottomTabs: input?.bottomTabs?.length ? input.bottomTabs : DEFAULT_PREFS.bottomTabs,
    homeCards: normalizeHomeCards(input?.homeCards),
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

    if (!raw?.kind || raw.kind === 'general') {
      const allowedCategories = ['documents','insurance','car','subscriptions','school','holidays','birthdays','home','other']
      const reminderDays = Array.from(new Set(
        (Array.isArray(raw.reminderDays) ? raw.reminderDays : [90, 30, 7])
          .map(Number)
          .filter((value: number) => Number.isFinite(value) && value >= 0 && value <= 3650)
      )).sort((a, b) => b - a)
      result.push({
        ...base,
        kind: 'general',
        category: allowedCategories.includes(String(raw.category)) ? raw.category : 'other',
        reminderDays: reminderDays.length ? reminderDays : [90, 30, 7],
        repeatYearly: raw.repeatYearly === true,
        lastCompletedAt: raw.lastCompletedAt || undefined,
        lastCompletedDate: raw.lastCompletedDate || undefined,
        notes: raw.notes || ''
      })
      return
    }

    result.push({ ...base, kind: raw.kind })
  })

  return [...result, ...pendingTherapies]
}

export function migrateData(raw: any, fallback: FamilyData): FamilyData {
  if (!raw || typeof raw !== 'object') return fallback
  const source = raw.data && raw.data.users ? raw.data : raw
  return {
    version: 21,
    storageModel: source.storageModel === 'normalized-v2'
      ? 'normalized-v2'
      : source.storageModel === 'normalized-v1'
        ? 'normalized-v1'
        : undefined,
    assistantName: String(source.assistantName || fallback.assistantName || 'Verdo').trim().slice(0, 24) || 'Verdo',
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
      const recurrence = ['none','daily','weekly','biweekly','monthly','yearly'].includes(String(event?.recurrence || ''))
        ? event.recurrence
        : 'none'
      const recurrenceEndDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event?.recurrenceEndDate || ''))
        && String(event.recurrenceEndDate) >= String(event.date || '')
        ? String(event.recurrenceEndDate)
        : undefined
      return {
        ...event,
        id: Number(event.id),
        userId: userId || userIds[0] || 0,
        userIds,
        audience: event?.audience === 'family' ? 'family' : 'users',
        recurrence,
        recurrenceEndDate
      }
    }) : [],
    deadlines: migrateDeadlines(source.deadlines),
    categories: Array.isArray(source.categories) && source.categories.length ? source.categories : fallback.categories,
    pantry: Array.isArray(source.pantry) ? source.pantry.map((item: any): PantryItem => ({
      id: Number(item.id),
      name: String(item.name || 'Prodotto'),
      brand: String(item.brand || item.productInfo?.brand || '').trim().slice(0, 120) || undefined,
      variant: String(item.variant || '').trim().slice(0, 120) || undefined,
      packageSize: String(item.packageSize || item.productInfo?.packageQuantity || '').trim().slice(0, 100) || undefined,
      barcode: /^\d{8,14}$/.test(String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, ''))
        ? String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
        : undefined,
      qty: Math.max(0, Number(item.qty || 0)),
      unit: item.unit || 'pz',
      category: item.category || 'Generico',
      minQty: item.minQty === undefined || item.minQty === null ? 0 : Math.max(0, Number(item.minQty) || 0),
      location: ['pantry','fridge','freezer'].includes(String(item.location)) ? item.location : 'pantry',
      expiryDate: item.expiryDate || undefined,
      autoRestock: item.autoRestock !== false,
      packageState: item.packageState === 'opened' ? 'opened' : 'sealed',
      remainingQty: item.packageState === 'opened' && Number.isFinite(Number(item.remainingQty)) ? Math.max(0, Number(item.remainingQty)) : undefined,
      remainingUnit: item.packageState === 'opened' && item.remainingUnit ? String(item.remainingUnit) : undefined,
      residualPercent: item.packageState === 'opened' && Number.isFinite(Number(item.residualPercent)) ? Math.max(0, Math.min(100, Number(item.residualPercent))) : undefined,
      residualSource: item.packageState === 'opened' && ['manual','photo'].includes(String(item.residualSource || '')) ? item.residualSource : undefined,
      productInfo: item.productInfo && typeof item.productInfo === 'object' ? {
        source: 'openfoodfacts',
        sourceUrl: /^https?:\/\//i.test(String(item.productInfo.sourceUrl || '')) ? String(item.productInfo.sourceUrl) : undefined,
        retrievedAt: item.productInfo.retrievedAt || new Date().toISOString(),
        confidence: Math.max(0, Math.min(1, Number(item.productInfo.confidence) || 0)),
        barcode: /^\d{8,14}$/.test(String(item.productInfo.barcode || '')) ? String(item.productInfo.barcode) : undefined,
        displayName: item.productInfo.displayName ? String(item.productInfo.displayName).slice(0, 200) : undefined,
        brand: item.productInfo.brand ? String(item.productInfo.brand).slice(0, 160) : undefined,
        imageUrl: /^https?:\/\//i.test(String(item.productInfo.imageUrl || '')) ? String(item.productInfo.imageUrl) : undefined,
        packageQuantity: item.productInfo.packageQuantity ? String(item.productInfo.packageQuantity).slice(0, 100) : undefined,
        ingredients: item.productInfo.ingredients ? String(item.productInfo.ingredients).slice(0, 4000) : undefined,
        allergens: Array.isArray(item.productInfo.allergens) ? item.productInfo.allergens.map(String).slice(0, 20) : [],
        categories: Array.isArray(item.productInfo.categories) ? item.productInfo.categories.map(String).slice(0, 20) : [],
        labels: Array.isArray(item.productInfo.labels) ? item.productInfo.labels.map(String).slice(0, 20) : [],
        nutriScore: item.productInfo.nutriScore ? String(item.productInfo.nutriScore).slice(0, 4) : undefined,
        novaGroup: item.productInfo.novaGroup === undefined ? undefined : Number(item.productInfo.novaGroup),
        ecoScore: item.productInfo.ecoScore ? String(item.productInfo.ecoScore).slice(0, 4) : undefined,
        nutriments: item.productInfo.nutriments && typeof item.productInfo.nutriments === 'object' ? {
          energyKcal100g: Number.isFinite(Number(item.productInfo.nutriments.energyKcal100g)) ? Number(item.productInfo.nutriments.energyKcal100g) : undefined,
          fat100g: Number.isFinite(Number(item.productInfo.nutriments.fat100g)) ? Number(item.productInfo.nutriments.fat100g) : undefined,
          saturatedFat100g: Number.isFinite(Number(item.productInfo.nutriments.saturatedFat100g)) ? Number(item.productInfo.nutriments.saturatedFat100g) : undefined,
          carbohydrates100g: Number.isFinite(Number(item.productInfo.nutriments.carbohydrates100g)) ? Number(item.productInfo.nutriments.carbohydrates100g) : undefined,
          sugars100g: Number.isFinite(Number(item.productInfo.nutriments.sugars100g)) ? Number(item.productInfo.nutriments.sugars100g) : undefined,
          fiber100g: Number.isFinite(Number(item.productInfo.nutriments.fiber100g)) ? Number(item.productInfo.nutriments.fiber100g) : undefined,
          proteins100g: Number.isFinite(Number(item.productInfo.nutriments.proteins100g)) ? Number(item.productInfo.nutriments.proteins100g) : undefined,
          salt100g: Number.isFinite(Number(item.productInfo.nutriments.salt100g)) ? Number(item.productInfo.nutriments.salt100g) : undefined
        } : undefined
      } : undefined
    })) : [],
    pantryMovements: Array.isArray(source.pantryMovements) ? source.pantryMovements.map((movement: any): PantryMovement => ({
      id: Number(movement.id),
      pantryItemId: Number(movement.pantryItemId || 0),
      delta: Number(movement.delta || 0),
      date: movement.date || localDateISO(),
      createdAt: movement.createdAt || new Date().toISOString(),
      reason: ['manual','purchase','meal','import','adjustment'].includes(String(movement.reason)) ? movement.reason : 'manual'
    })) : [],
    shopping: Array.isArray(source.shopping) ? source.shopping : [],
    dishes: (Array.isArray(source.dishes) ? source.dishes : (Array.isArray(source.meals) ? source.meals : fallback.dishes)).map((dish: any) => ({
      ...dish,
      id: Number(dish.id),
      name: String(dish.name || 'Piatto'),
      type: String(dish.type || 'Altro'),
      variant: String(dish.variant || ''),
      ingredients: Array.isArray(dish.ingredients) ? dish.ingredients.map((ing: any) => ({
        name: String(ing?.name || ''),
        qty: Math.max(0, Number(ing?.qty || 0)),
        unit: String(ing?.unit || 'pz')
      })).filter((ing: any) => ing.name) : [],
      prepMinutes: dish.prepMinutes === undefined || dish.prepMinutes === null ? undefined : Math.max(0, Number(dish.prepMinutes) || 0),
      preferredByUserIds: Array.from(new Set((Array.isArray(dish.preferredByUserIds) ? dish.preferredByUserIds : []).map(Number).filter((id: number) => id > 0))),
      sourceUrl: /^https?:\/\//i.test(String(dish.sourceUrl || '')) ? String(dish.sourceUrl).trim() : undefined,
      sourceLabel: dish.sourceLabel ? String(dish.sourceLabel).trim().slice(0, 80) : undefined,
      notes: dish.notes ? String(dish.notes).trim().slice(0, 2000) : undefined
    })),
    mealPlans: Array.isArray(source.mealPlans) ? source.mealPlans.map((p: any) => ({ ...p, dishId: Number(p.dishId ?? p.mealId) })) : [],
    chores: Array.isArray(source.chores) ? source.chores.map((chore: any) => ({
      ...chore,
      id: Number(chore.id),
      userId: Number(chore.userId),
      amount: Math.max(0, Number(chore.amount) || 0),
      done: !!chore.done,
      completionStatus: chore.done
        ? 'approved'
        : (chore.completionStatus === 'pending' ? 'pending' : 'open'),
      completedAt: chore.completedAt || undefined,
      completedByUserId: chore.completedByUserId ? Number(chore.completedByUserId) : undefined,
      approvedAt: chore.approvedAt || undefined,
      approvedByUserId: chore.approvedByUserId ? Number(chore.approvedByUserId) : undefined,
      recurringChoreId: chore.recurringChoreId ? Number(chore.recurringChoreId) : undefined
    })) : [],
    recurringChores: Array.isArray(source.recurringChores) ? source.recurringChores.map((chore: any): RecurringChore => {
      const legacyUserId = Number(chore.userId || 0)
      const userIds = Array.from(new Set(
        (Array.isArray(chore.userIds) && chore.userIds.length ? chore.userIds : [legacyUserId])
          .map(Number)
          .filter((id: number) => id > 0)
      ))
      return {
        id: Number(chore.id),
        title: String(chore.title || 'Compito ricorrente'),
        userId: userIds[0] || legacyUserId,
        userIds,
        amount: Math.max(0, Number(chore.amount) || 0),
        weekdays: Array.from(new Set((Array.isArray(chore.weekdays) ? chore.weekdays : [1, 2, 3, 4, 5, 6, 7]).map(Number).filter((day: number) => day >= 1 && day <= 7))).sort(),
        active: chore.active !== false,
        startDate: chore.startDate || localDateISO(),
        endDate: chore.endDate || undefined
      }
    }) : [],
    transactions: Array.isArray(source.transactions) ? source.transactions : [],
    todos: Array.isArray(source.todos) ? source.todos.map((t: any) => ({ ...t, createdAt: t.createdAt || localDateISO() })) : [],
    routines: Array.isArray(source.routines) ? source.routines.map((routine: any): Routine => ({
      id: Number(routine.id),
      title: String(routine.title || 'Routine'),
      userId: Number(routine.userId || 0),
      frequency: ['daily','weekly','fortnightly','monthly','semiannual','yearly'].includes(String(routine.frequency))
        ? routine.frequency
        : 'weekly',
      startDate: routine.startDate || localDateISO(),
      endDate: routine.endDate || undefined,
      active: routine.active !== false,
      notes: routine.notes || ''
    })) : [],
    routineCompletions: Array.isArray(source.routineCompletions) ? source.routineCompletions.map((item: any): RoutineCompletion => ({
      id: Number(item.id),
      routineId: Number(item.routineId),
      userId: Number(item.userId || 0),
      date: item.date || localDateISO(),
      completedAt: item.completedAt || new Date().toISOString(),
      completedByUserId: Number(item.completedByUserId || item.userId || 0)
    })) : [],
    schoolSubjects: Array.isArray(source.schoolSubjects) ? source.schoolSubjects.map((item: any): SchoolSubject => ({
      id: Number(item.id),
      name: String(item.name || 'Materia'),
      shortName: item.shortName || undefined
    })) : [],
    schoolTimetable: Array.isArray(source.schoolTimetable) ? source.schoolTimetable.map((item: any): SchoolTimetableEntry => ({
      id: Number(item.id),
      userId: Number(item.userId || 0),
      weekday: Math.min(7, Math.max(1, Number(item.weekday || 1))),
      order: Math.max(1, Number(item.order || 1)),
      subjectId: Number(item.subjectId || 0),
      startTime: item.startTime || undefined,
      endTime: item.endTime || undefined,
      room: item.room || undefined,
      notes: item.notes || undefined
    })) : [],
    schoolItems: Array.isArray(source.schoolItems) ? source.schoolItems.map((item: any): SchoolItem => ({
      id: Number(item.id),
      userId: Number(item.userId || 0),
      type: ['homework','test','oral','material','circular','permission','trip','payment'].includes(String(item.type)) ? item.type : 'homework',
      title: String(item.title || 'Attività scuola'),
      date: item.date || localDateISO(),
      subjectId: item.subjectId ? Number(item.subjectId) : undefined,
      notes: item.notes || undefined,
      amount: item.amount === undefined || item.amount === null ? undefined : Math.max(0, Number(item.amount) || 0),
      done: !!item.done,
      createdAt: item.createdAt || localDateISO()
    })) : [],
    boardPosts: Array.isArray(source.boardPosts) ? source.boardPosts.map((item: any): BoardPost => ({
      id: String(item.id || crypto.randomUUID()),
      type: ['note','message','reminder','photo'].includes(String(item.type)) ? item.type : 'note',
      title: String(item.title || ''),
      body: String(item.body || ''),
      authorUserId: Number(item.authorUserId || 0),
      audience: item.audience === 'users' ? 'users' : 'family',
      userIds: Array.from(new Set((Array.isArray(item.userIds) ? item.userIds : []).map(Number).filter((id: number) => id > 0))),
      pinned: item.pinned === true,
      dueDate: item.dueDate || undefined,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      attachments: Array.isArray(item.attachments) ? item.attachments.map((attachment: any) => ({
        id: String(attachment.id || crypto.randomUUID()),
        name: String(attachment.name || 'foto'),
        path: String(attachment.path || ''),
        mimeType: attachment.mimeType || undefined,
        size: attachment.size === undefined ? undefined : Number(attachment.size || 0),
        createdAt: attachment.createdAt || new Date().toISOString()
      })).filter((attachment: any) => attachment.path) : []
    })) : [],
    expenses: Array.isArray(source.expenses) ? source.expenses.map((item: any) => ({
      id: String(item.id || crypto.randomUUID()),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? String(item.date) : localDateISO(),
      merchant: String(item.merchant || 'Spesa').trim().slice(0, 160) || 'Spesa',
      total: Math.max(0, Number(item.total) || 0),
      category: ['groceries','home','transport','health','school','bills','leisure','clothing','other'].includes(String(item.category)) ? item.category : 'other',
      source: ['receipt','manual','voice','recurring','bank'].includes(String(item.source)) ? item.source : 'manual',
      sourceRef: item.sourceRef ? String(item.sourceRef).slice(0, 200) : undefined,
      createdAt: item.createdAt || new Date().toISOString(),
      createdByUserId: Number(item.createdByUserId || 0) || undefined,
      notes: item.notes ? String(item.notes).slice(0, 2000) : undefined,
      items: Array.isArray(item.items) ? item.items.map((row: any) => ({
        id: String(row.id || crypto.randomUUID()),
        name: String(row.name || 'Articolo').trim().slice(0, 200) || 'Articolo',
        qty: Math.max(0, Number(row.qty) || 0),
        unit: String(row.unit || 'pz').slice(0, 20),
        unitPrice: Number.isFinite(Number(row.unitPrice)) ? Math.max(0, Number(row.unitPrice)) : undefined,
        totalPrice: Number.isFinite(Number(row.totalPrice)) ? Math.max(0, Number(row.totalPrice)) : undefined,
        category: row.category ? String(row.category).slice(0, 100) : undefined
      })) : []
    })).filter((item: any) => item.total > 0) : [],
    recurringExpenses: Array.isArray(source.recurringExpenses) ? source.recurringExpenses.map((item: any) => ({
      id: String(item.id || crypto.randomUUID()),
      merchant: String(item.merchant || 'Spesa ricorrente').trim().slice(0, 160) || 'Spesa ricorrente',
      amount: Math.max(0, Number(item.amount) || 0),
      category: ['groceries','home','transport','health','school','bills','leisure','clothing','other'].includes(String(item.category)) ? item.category : 'other',
      frequency: ['weekly','monthly','yearly'].includes(String(item.frequency)) ? item.frequency : 'monthly',
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.startDate || '')) ? String(item.startDate) : localDateISO(),
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.endDate || '')) ? String(item.endDate) : undefined,
      active: item.active !== false,
      notes: item.notes ? String(item.notes).slice(0, 1000) : undefined,
      createdAt: item.createdAt || new Date().toISOString(),
      createdByUserId: Number(item.createdByUserId || 0) || undefined
    })).filter((item: any) => item.amount > 0) : []
  }
}
