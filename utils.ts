import type { FamilyData, FamilyUser, UserPrefs } from './types'

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

export function migrateData(raw: any, fallback: FamilyData): FamilyData {
  if (!raw || typeof raw !== 'object') return fallback
  const source = raw.data && raw.data.users ? raw.data : raw
  return {
    version: 3,
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
    calendarEvents: Array.isArray(source.calendarEvents) ? source.calendarEvents : [],
    deadlines: Array.isArray(source.deadlines) ? source.deadlines.map((d: any) => ({ ...d, done: !!d.done })) : [],
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