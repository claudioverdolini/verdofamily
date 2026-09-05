import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type {
  CalendarEvent,
  Chore,
  Deadline,
  Dish,
  FamilyData,
  FamilyUser,
  MealPlan,
  PageKey,
  PantryItem,
  ShoppingItem,
  Todo,
  UserPrefs
} from './types'
import { initialData } from './data'
import { localDateISO, mergePrefs, migrateData, nextId, normalize } from './utils'

const STORAGE_KEY = 'verdofamily_v3'
const LEGACY_KEYS = ['familyhub_v2', 'familyhub_v1']
const SESSION_KEY = 'verdofamily_session_user'

type StoreValue = {
  data: FamilyData
  authUser: FamilyUser | null
  activePage: PageKey
  setActivePage: (page: PageKey) => void
  login: (name: string, password: string) => { ok: boolean; error?: string }
  logout: () => void
  updateCurrentPrefs: (patch: Partial<UserPrefs>) => void
  updateCurrentProfile: (patch: Partial<FamilyUser>) => void
  addUser: (user: Omit<FamilyUser, 'id' | 'balance' | 'prefs'> & { prefs?: Partial<UserPrefs> }) => void
  updateUser: (id: number, patch: Partial<FamilyUser>) => void
  deleteUser: (id: number) => void
  upsertCalendarEvent: (event: Omit<CalendarEvent, 'id'> & { id?: number }) => void
  deleteCalendarEvent: (id: number) => void
  upsertDeadline: (deadline: Omit<Deadline, 'id' | 'done'> & { id?: number; done?: boolean }) => void
  toggleDeadline: (id: number) => void
  deleteDeadline: (id: number) => void
  addCategory: (name: string) => boolean
  renameCategory: (oldName: string, newName: string) => boolean
  deleteCategory: (name: string) => boolean
  upsertPantryItem: (item: Omit<PantryItem, 'id'> & { id?: number }) => void
  deletePantryItem: (id: number) => void
  changePantryQty: (id: number, delta: number) => void
  addShoppingItem: (item: Omit<ShoppingItem, 'id' | 'taken'>) => void
  toggleShoppingItem: (id: number) => void
  deleteShoppingItem: (id: number) => void
  moveTakenShoppingToPantry: () => void
  importReceiptItems: (items: Array<{ name: string; qty: number; unit: string; category: string }>, removeFromShopping: boolean) => void
  upsertDish: (dish: Omit<Dish, 'id'> & { id?: number }) => void
  deleteDish: (id: number) => void
  upsertMealPlan: (plan: Omit<MealPlan, 'id'> & { id?: number }) => void
  deleteMealPlan: (id: number) => void
  addChore: (chore: Omit<Chore, 'id' | 'done'>) => void
  toggleChore: (id: number) => void
  deleteChore: (id: number) => void
  payUser: (userId: number, amount: number, note?: string) => boolean
  undoTransaction: (id: number) => boolean
  addTodo: (todo: Omit<Todo, 'id' | 'done' | 'createdAt'>) => void
  toggleTodo: (id: number) => void
  deleteTodo: (id: number) => void
  exportData: () => string
  importData: (raw: string) => boolean
  resetData: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<FamilyData>(() => {
    try {
      const current = localStorage.getItem(STORAGE_KEY)
      if (current) return migrateData(JSON.parse(current), deepClone(initialData))
      for (const key of LEGACY_KEYS) {
        const legacy = localStorage.getItem(key)
        if (legacy) return migrateData(JSON.parse(legacy), deepClone(initialData))
      }
    } catch {
      // fall back to defaults
    }
    return deepClone(initialData)
  })

  const [sessionUserId, setSessionUserId] = useState<number | null>(() => {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? Number(raw) || null : null
  })
  const [activePage, setActivePage] = useState<PageKey>('home')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (sessionUserId) sessionStorage.setItem(SESSION_KEY, String(sessionUserId))
    else sessionStorage.removeItem(SESSION_KEY)
  }, [sessionUserId])

  const authUser = useMemo(
    () => data.users.find(u => u.id === sessionUserId) || null,
    [data.users, sessionUserId]
  )

  useEffect(() => {
    if (sessionUserId && !authUser) setSessionUserId(null)
  }, [sessionUserId, authUser])

  function login(name: string, password: string) {
    const clean = name.trim().toLowerCase()
    const user = data.users.find(u => u.name.trim().toLowerCase() === clean && u.password === password)
    if (!user) return { ok: false, error: 'Nome utente o password non corretti.' }
    setSessionUserId(user.id)
    setActivePage('home')
    return { ok: true }
  }

  function logout() {
    setSessionUserId(null)
    setActivePage('home')
  }

  function updateCurrentPrefs(patch: Partial<UserPrefs>) {
    if (!authUser) return
    setData(prev => ({
      ...prev,
      users: prev.users.map(u =>
        u.id === authUser.id ? { ...u, prefs: mergePrefs({ ...u.prefs, ...patch, notifications: { ...u.prefs.notifications, ...(patch.notifications || {}) } }) } : u
      )
    }))
  }

  function updateCurrentProfile(patch: Partial<FamilyUser>) {
    if (!authUser) return
    updateUser(authUser.id, patch)
  }

  function addUser(input: Omit<FamilyUser, 'id' | 'balance' | 'prefs'> & { prefs?: Partial<UserPrefs> }) {
    setData(prev => {
      if (prev.users.some(u => normalize(u.name) === normalize(input.name))) return prev
      return { ...prev, users: [...prev.users, { ...input, id: nextId(prev.users), balance: 0, prefs: mergePrefs(input.prefs) }] }
    })
  }

  function updateUser(id: number, patch: Partial<FamilyUser>) {
    setData(prev => ({ ...prev, users: prev.users.map(u => u.id === id ? { ...u, ...patch, prefs: patch.prefs ? mergePrefs({ ...u.prefs, ...patch.prefs }) : u.prefs } : u) }))
  }

  function deleteUser(id: number) {
    if (authUser?.id === id) return
    setData(prev => prev.users.length <= 1 ? prev : ({ ...prev, users: prev.users.filter(u => u.id !== id) }))
  }

  function upsertCalendarEvent(event: Omit<CalendarEvent, 'id'> & { id?: number }) {
    setData(prev => ({ ...prev, calendarEvents: event.id ? prev.calendarEvents.map(e => e.id === event.id ? { ...e, ...event, id: e.id } : e) : [...prev.calendarEvents, { ...event, id: nextId(prev.calendarEvents) }] }))
  }

  function deleteCalendarEvent(id: number) { setData(prev => ({ ...prev, calendarEvents: prev.calendarEvents.filter(e => e.id !== id) })) }

  function upsertDeadline(deadline: Omit<Deadline, 'id' | 'done'> & { id?: number; done?: boolean }) {
    setData(prev => ({ ...prev, deadlines: deadline.id ? prev.deadlines.map(d => d.id === deadline.id ? { ...d, ...deadline, id: d.id, done: !!deadline.done } : d) : [...prev.deadlines, { ...deadline, id: nextId(prev.deadlines), done: !!deadline.done }] }))
  }

  function toggleDeadline(id: number) { setData(prev => ({ ...prev, deadlines: prev.deadlines.map(d => d.id === id ? { ...d, done: !d.done } : d) })) }
  function deleteDeadline(id: number) { setData(prev => ({ ...prev, deadlines: prev.deadlines.filter(d => d.id !== id) })) }

  function addCategory(name: string) {
    const clean = name.trim()
    if (!clean) return false
    let added = false
    setData(prev => {
      if (prev.categories.some(c => normalize(c) === normalize(clean))) return prev
      added = true
      return { ...prev, categories: [...prev.categories, clean] }
    })
    return added
  }

  function renameCategory(oldName: string, newName: string) {
    const clean = newName.trim()
    if (!clean || oldName === 'Generico') return false
    let renamed = false
    setData(prev => {
      if (prev.categories.some(c => c !== oldName && normalize(c) === normalize(clean))) return prev
      renamed = true
      return { ...prev, categories: prev.categories.map(c => c === oldName ? clean : c), pantry: prev.pantry.map(p => p.category === oldName ? { ...p, category: clean } : p) }
    })
    return renamed
  }

  function deleteCategory(name: string) {
    if (name === 'Generico') return false
    setData(prev => ({ ...prev, categories: prev.categories.filter(c => c !== name), pantry: prev.pantry.map(p => p.category === name ? { ...p, category: 'Generico' } : p) }))
    return true
  }

  function upsertPantryItem(item: Omit<PantryItem, 'id'> & { id?: number }) {
    setData(prev => ({ ...prev, pantry: item.id ? prev.pantry.map(p => p.id === item.id ? { ...p, ...item, id: p.id } : p) : [...prev.pantry, { ...item, id: nextId(prev.pantry) }] }))
  }
  function deletePantryItem(id: number) { setData(prev => ({ ...prev, pantry: prev.pantry.filter(p => p.id !== id) })) }
  function changePantryQty(id: number, delta: number) { setData(prev => ({ ...prev, pantry: prev.pantry.map(p => p.id === id ? { ...p, qty: Math.max(0, Number(p.qty || 0) + delta) } : p) })) }

  function addShoppingItem(item: Omit<ShoppingItem, 'id' | 'taken'>) { setData(prev => ({ ...prev, shopping: [...prev.shopping, { ...item, id: nextId(prev.shopping), taken: false }] })) }
  function toggleShoppingItem(id: number) { setData(prev => ({ ...prev, shopping: prev.shopping.map(s => s.id === id ? { ...s, taken: !s.taken } : s) })) }
  function deleteShoppingItem(id: number) { setData(prev => ({ ...prev, shopping: prev.shopping.filter(s => s.id !== id) })) }

  function mergeIntoPantry(pantry: PantryItem[], items: Array<{ name: string; qty: number; unit: string; category?: string }>) {
    const next = [...pantry]
    for (const item of items) {
      const idx = next.findIndex(p => normalize(p.name) === normalize(item.name) && normalize(p.unit) === normalize(item.unit))
      if (idx >= 0) next[idx] = { ...next[idx], qty: Number(next[idx].qty || 0) + Number(item.qty || 0) }
      else next.push({ id: nextId(next), name: item.name.trim(), qty: Number(item.qty || 0), unit: item.unit || 'pz', category: item.category || 'Generico' })
    }
    return next
  }

  function moveTakenShoppingToPantry() {
    setData(prev => {
      const taken = prev.shopping.filter(s => s.taken)
      if (!taken.length) return prev
      return { ...prev, pantry: mergeIntoPantry(prev.pantry, taken.map(s => ({ name: s.name, qty: s.qty, unit: s.unit, category: s.category || 'Generico' }))), shopping: prev.shopping.filter(s => !s.taken) }
    })
  }

  function importReceiptItems(items: Array<{ name: string; qty: number; unit: string; category: string }>, removeFromShopping: boolean) {
    setData(prev => ({ ...prev, pantry: mergeIntoPantry(prev.pantry, items), shopping: removeFromShopping ? prev.shopping.filter(s => !items.some(i => normalize(i.name) === normalize(s.name))) : prev.shopping }))
  }

  function adjustIngredients(prev: FamilyData, dishId: number, factor: number) {
    const dish = prev.dishes.find(d => d.id === dishId)
    if (!dish) return prev.pantry
    const pantry = [...prev.pantry]
    for (const ing of dish.ingredients) {
      const idx = pantry.findIndex(p => normalize(p.name) === normalize(ing.name))
      const delta = Number(ing.qty || 0) * factor
      if (idx >= 0) pantry[idx] = { ...pantry[idx], qty: Math.max(0, Number(pantry[idx].qty || 0) + delta) }
    }
    return pantry
  }

  function upsertDish(dish: Omit<Dish, 'id'> & { id?: number }) { setData(prev => ({ ...prev, dishes: dish.id ? prev.dishes.map(d => d.id === dish.id ? { ...d, ...dish, id: d.id } : d) : [...prev.dishes, { ...dish, id: nextId(prev.dishes) }] })) }
  function deleteDish(id: number) { setData(prev => ({ ...prev, dishes: prev.dishes.filter(d => d.id !== id), mealPlans: prev.mealPlans.filter(p => p.dishId !== id) })) }

  function upsertMealPlan(plan: Omit<MealPlan, 'id'> & { id?: number }) {
    setData(prev => {
      let pantry = prev.pantry
      if (plan.id) { const old = prev.mealPlans.find(p => p.id === plan.id); if (old) pantry = adjustIngredients({ ...prev, pantry }, old.dishId, +1) }
      pantry = adjustIngredients({ ...prev, pantry }, plan.dishId, -1)
      const mealPlans = plan.id ? prev.mealPlans.map(p => p.id === plan.id ? { ...p, ...plan, id: p.id } : p) : [...prev.mealPlans, { ...plan, id: nextId(prev.mealPlans) }]
      return { ...prev, pantry, mealPlans }
    })
  }

  function deleteMealPlan(id: number) {
    setData(prev => { const plan = prev.mealPlans.find(p => p.id === id); const pantry = plan ? adjustIngredients(prev, plan.dishId, +1) : prev.pantry; return { ...prev, pantry, mealPlans: prev.mealPlans.filter(p => p.id !== id) } })
  }

  function addChore(chore: Omit<Chore, 'id' | 'done'>) { setData(prev => ({ ...prev, chores: [...prev.chores, { ...chore, id: nextId(prev.chores), done: false }] })) }

  function toggleChore(id: number) {
    setData(prev => {
      const chore = prev.chores.find(c => c.id === id)
      if (!chore) return prev
      if (!chore.done) {
        const txId = nextId(prev.transactions)
        return { ...prev, chores: prev.chores.map(c => c.id === id ? { ...c, done: true, creditedTransactionId: txId } : c), users: prev.users.map(u => u.id === chore.userId ? { ...u, balance: Number(u.balance || 0) + Number(chore.amount || 0) } : u), transactions: [...prev.transactions, { id: txId, userId: chore.userId, type: 'credit', amount: Number(chore.amount || 0), date: localDateISO(), note: `Compito: ${chore.title}` }] }
      }
      const txId = chore.creditedTransactionId
      return { ...prev, chores: prev.chores.map(c => c.id === id ? { ...c, done: false, creditedTransactionId: undefined } : c), users: prev.users.map(u => u.id === chore.userId ? { ...u, balance: Math.max(0, Number(u.balance || 0) - Number(chore.amount || 0)) } : u), transactions: txId ? prev.transactions.map(t => t.id === txId ? { ...t, reversed: true } : t) : prev.transactions }
    })
  }

  function deleteChore(id: number) { setData(prev => ({ ...prev, chores: prev.chores.filter(c => c.id !== id) })) }

  function payUser(userId: number, amount: number, note = 'Pagamento paghetta') {
    let ok = false
    setData(prev => { const user = prev.users.find(u => u.id === userId); if (!user || amount <= 0 || amount > Number(user.balance || 0)) return prev; ok = true; return { ...prev, users: prev.users.map(u => u.id === userId ? { ...u, balance: Number(u.balance || 0) - amount } : u), transactions: [...prev.transactions, { id: nextId(prev.transactions), userId, type: 'payment', amount, date: localDateISO(), note }] } })
    return ok
  }

  function undoTransaction(id: number) {
    let ok = false
    setData(prev => { const tx = prev.transactions.find(t => t.id === id); if (!tx || tx.type !== 'payment' || tx.reversed) return prev; ok = true; return { ...prev, users: prev.users.map(u => u.id === tx.userId ? { ...u, balance: Number(u.balance || 0) + Number(tx.amount || 0) } : u), transactions: prev.transactions.map(t => t.id === id ? { ...t, reversed: true } : t) } })
    return ok
  }

  function addTodo(todo: Omit<Todo, 'id' | 'done' | 'createdAt'>) { setData(prev => ({ ...prev, todos: [...prev.todos, { ...todo, id: nextId(prev.todos), done: false, createdAt: localDateISO() }] })) }
  function toggleTodo(id: number) { setData(prev => ({ ...prev, todos: prev.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) })) }
  function deleteTodo(id: number) { setData(prev => ({ ...prev, todos: prev.todos.filter(t => t.id !== id) })) }
  function exportData() { return JSON.stringify(data, null, 2) }
  function importData(raw: string) { try { setData(migrateData(JSON.parse(raw), deepClone(initialData))); return true } catch { return false } }
  function resetData() { setData(deepClone(initialData)); setSessionUserId(null); setActivePage('home') }

  const value: StoreValue = { data, authUser, activePage, setActivePage, login, logout, updateCurrentPrefs, updateCurrentProfile, addUser, updateUser, deleteUser, upsertCalendarEvent, deleteCalendarEvent, upsertDeadline, toggleDeadline, deleteDeadline, addCategory, renameCategory, deleteCategory, upsertPantryItem, deletePantryItem, changePantryQty, addShoppingItem, toggleShoppingItem, deleteShoppingItem, moveTakenShoppingToPantry, importReceiptItems, upsertDish, deleteDish, upsertMealPlan, deleteMealPlan, addChore, toggleChore, deleteChore, payUser, undoTransaction, addTodo, toggleTodo, deleteTodo, exportData, importData, resetData }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useFamily() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useFamily must be used inside FamilyProvider')
  return ctx
}
