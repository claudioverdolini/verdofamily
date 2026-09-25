import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApprovalRequest,
  ApprovalRequestKind,
  BoardAttachment,
  BoardPost,
  CalendarEvent,
  Chore,
  Deadline,
  Dish,
  ExpenseRecord,
  PurchaseEvidence,
  FamilyData,
  FamilyUser,
  MealPlan,
  PageKey,
  RecurringChore,
  RecurringExpense,
  Routine,
  PantryLocation,
  PantryMovement,
  SchoolItem,
  SchoolSubject,
  SchoolTimetableEntry,
  PantryItem,
  ShoppingItem,
  Todo,
  UserPrefs
} from './types'
import { initialData } from './data'
import { localDateISO, materializeRecurringChores, mergePrefs, migrateData, nextId, normalize } from './utils'
import { isExpenseCategory, isExpenseSubcategory, subcategoryBelongsToCategory } from './expenseCategories'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import type { PushTopics } from './pushNotifications'

const STORAGE_KEY = 'verdofamily_v3'
const LEGACY_KEYS = ['familyhub_v2', 'familyhub_v1']
const SESSION_KEY = 'verdofamily_session_user'
const HEALTH_KINDS = new Set(['medicine', 'therapy', 'visit', 'health-record'])

function isHealthDeadline(item: Partial<Deadline>) {
  return HEALTH_KINDS.has(String(item.kind || ''))
}

function mergeHealthDeadlines(base: FamilyData, healthItems: Deadline[]) {
  return {
    ...base,
    deadlines: [
      ...base.deadlines.filter(item => !isHealthDeadline(item)),
      ...(Array.isArray(healthItems) ? healthItems : [])
    ]
  }
}

function mergeFinanceData(base: FamilyData, finance: any): FamilyData {
  if (!finance) return base
  const wallets = Array.isArray(finance.wallets) ? finance.wallets : []
  const balances = new Map(wallets.map((wallet: any) => [Number(wallet.userId), Number(wallet.balance || 0)]))
  return {
    ...base,
    users: base.users.map(user => balances.has(user.id) ? { ...user, balance: Number(balances.get(user.id) || 0) } : user),
    chores: Array.isArray(finance.chores) ? finance.chores : base.chores,
    recurringChores: Array.isArray(finance.recurringChores) ? finance.recurringChores : base.recurringChores,
    transactions: Array.isArray(finance.transactions) ? finance.transactions : base.transactions
  }
}

function financeHash(value: FamilyData) {
  return JSON.stringify({
    users: value.users.map(user => ({
      id: user.id,
      cloudUserId: user.cloudUserId || '',
      name: user.name,
      role: user.role,
      balance: Number(user.balance || 0)
    })),
    chores: value.chores,
    recurringChores: value.recurringChores,
    transactions: value.transactions
  })
}

function mergeSchoolData(base: FamilyData, school: any): FamilyData {
  if (!school) return base
  return {
    ...base,
    schoolSubjects: Array.isArray(school.schoolSubjects) ? school.schoolSubjects : base.schoolSubjects,
    schoolTimetable: Array.isArray(school.schoolTimetable) ? school.schoolTimetable : base.schoolTimetable,
    schoolItems: Array.isArray(school.schoolItems) ? school.schoolItems : base.schoolItems
  }
}

function schoolHash(value: FamilyData) {
  return JSON.stringify({
    schoolSubjects: value.schoolSubjects,
    schoolTimetable: value.schoolTimetable,
    schoolItems: value.schoolItems
  })
}

function healthHash(value: FamilyData) {
  return JSON.stringify(value.deadlines.filter(item => isHealthDeadline(item)))
}

type PushCategory = keyof PushTopics

const PAGE_KEYS: PageKey[] = ['home', 'calendar', 'shopping', 'meals', 'chores', 'school', 'board', 'health', 'deadlines', 'todos', 'reports', 'users', 'settings']

function pushCategoryHashes(value: FamilyData): Record<PushCategory, string> {
  return {
    calendar: JSON.stringify(value.calendarEvents || []),
    deadlines: JSON.stringify(value.deadlines || []),
    chores: JSON.stringify([value.chores || [], value.recurringChores || [], value.transactions || []]),
    school: JSON.stringify([value.schoolSubjects || [], value.schoolTimetable || [], value.schoolItems || []]),
    board: JSON.stringify(value.boardPosts || []),
    shopping: JSON.stringify([value.shopping || [], value.pantry || [], value.pantryMovements || []])
  }
}

type CloudStatus = 'offline' | 'connecting' | 'synced' | 'saving' | 'conflict' | 'error'
type AuthResult = { ok: boolean; error?: string; needsEmailConfirmation?: boolean }

type StoreValue = {
  data: FamilyData
  authUser: FamilyUser | null
  activePage: PageKey
  setActivePage: (page: PageKey) => void
  login: (identifier: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>
  logout: () => Promise<void>
  cloudEnabled: boolean
  cloudAuthenticated: boolean
  cloudLoading: boolean
  cloudStatus: CloudStatus
  cloudEmail: string
  familyId: string | null
  familyName: string
  needsFamilySetup: boolean
  createCloudFamily: (name: string, useLocalData?: boolean) => Promise<AuthResult>
  joinCloudFamily: (code: string) => Promise<AuthResult>
  createFamilyInvite: (role?: 'adult' | 'child') => Promise<{ ok: boolean; code?: string; error?: string }>
  syncNow: () => Promise<void>
  updateCurrentPrefs: (patch: Partial<UserPrefs> | ((current: UserPrefs) => Partial<UserPrefs>)) => void
  updateCurrentProfile: (patch: Partial<FamilyUser>) => void
  setAssistantName: (name: string) => void
  addUser: (user: Omit<FamilyUser, 'id' | 'balance' | 'prefs'> & { prefs?: Partial<UserPrefs> }) => void
  updateUser: (id: number, patch: Partial<FamilyUser>) => void
  deleteUser: (id: number) => void
  approveApprovalRequest: (id: string) => void
  rejectApprovalRequest: (id: string) => void
  upsertCalendarEvent: (event: Omit<CalendarEvent, 'id'> & { id?: number }) => void
  deleteCalendarEvent: (id: number) => void
  upsertDeadline: (deadline: Omit<Deadline, 'id' | 'done'> & { id?: number; done?: boolean }) => void
  toggleDeadline: (id: number) => void
  deleteDeadline: (id: number) => void
  addCategory: (name: string) => boolean
  renameCategory: (oldName: string, newName: string) => boolean
  deleteCategory: (name: string) => Promise<boolean>
  upsertPantryItem: (item: Omit<PantryItem, 'id'> & { id?: number }) => void
  deletePantryItem: (id: number) => void
  changePantryQty: (id: number, delta: number) => void
  reconcilePantryItems: (items: Array<{ name: string; brand?: string; variant?: string; packageSize?: string; barcode?: string; qty: number; unit: string; category?: string; location?: PantryLocation; expiryDate?: string; packageState?: PantryItem['packageState']; remainingQty?: number; remainingUnit?: string; residualPercent?: number; residualSource?: PantryItem['residualSource']; productInfo?: PantryItem['productInfo'] }>, defaultLocation?: PantryLocation) => void
  addShoppingItem: (item: Omit<ShoppingItem, 'id' | 'taken'>) => void
  toggleShoppingItem: (id: number) => void
  deleteShoppingItem: (id: number) => void
  moveTakenShoppingToPantry: (location?: PantryLocation) => void
  importReceiptItems: (items: Array<{ name: string; brand?: string; variant?: string; packageSize?: string; barcode?: string; qty: number; unit: string; category: string; location?: PantryLocation; expiryDate?: string; packageState?: PantryItem['packageState']; remainingQty?: number; remainingUnit?: string; residualPercent?: number; residualSource?: PantryItem['residualSource']; productInfo?: PantryItem['productInfo'] }>, removeFromShopping: boolean, defaultLocation?: PantryLocation) => void
  upsertDish: (dish: Omit<Dish, 'id'> & { id?: number }) => void
  deleteDish: (id: number) => void
  upsertMealPlan: (plan: Omit<MealPlan, 'id'> & { id?: number }) => void
  deleteMealPlan: (id: number) => void
  addChore: (chore: Omit<Chore, 'id' | 'done'>) => void
  toggleChore: (id: number) => void
  approveChore: (id: number) => void
  rejectChore: (id: number) => void
  deleteChore: (id: number) => void
  upsertRecurringChore: (chore: Omit<RecurringChore, 'id'> & { id?: number }) => void
  toggleRecurringChore: (id: number) => void
  deleteRecurringChore: (id: number) => void
  payUser: (userId: number, amount: number, note?: string) => boolean
  undoTransaction: (id: number) => boolean
  addTodo: (todo: Omit<Todo, 'id' | 'done' | 'createdAt'>) => void
  toggleTodo: (id: number) => void
  deleteTodo: (id: number) => void
  upsertRoutine: (routine: Omit<Routine, 'id'> & { id?: number }) => void
  toggleRoutineActive: (id: number) => void
  deleteRoutine: (id: number) => void
  completeRoutine: (id: number, date?: string) => void
  undoRoutineCompletion: (routineId: number, date: string) => void
  upsertSchoolSubject: (subject: Omit<SchoolSubject, 'id'> & { id?: number }) => void
  deleteSchoolSubject: (id: number) => void
  upsertSchoolTimetableEntry: (entry: Omit<SchoolTimetableEntry, 'id'> & { id?: number }) => void
  deleteSchoolTimetableEntry: (id: number) => void
  upsertSchoolItem: (item: Omit<SchoolItem, 'id' | 'done' | 'createdAt'> & { id?: number; done?: boolean; createdAt?: string }) => void
  toggleSchoolItem: (id: number) => void
  deleteSchoolItem: (id: number) => void
  upsertBoardPost: (post: Omit<BoardPost, 'id' | 'createdAt' | 'updatedAt' | 'attachments' | 'authorUserId'> & { id?: string; attachments?: BoardAttachment[] }) => string
  toggleBoardPin: (id: string) => void
  deleteBoardPost: (id: string) => void
  addBoardAttachment: (postId: string, attachment: BoardAttachment) => void
  removeBoardAttachment: (postId: string, attachmentId: string) => void
  upsertExpense: (expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }) => string
  importExpenses: (expenses: Array<Omit<ExpenseRecord, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }>) => { imported: number; duplicates: number }
  deleteExpense: (id: string) => Promise<void>
  upsertPurchaseEvidence: (evidence: Omit<PurchaseEvidence, 'id' | 'importedAt'> & { id?: string; importedAt?: string }) => string
  importPurchaseEvidence: (evidence: Array<Omit<PurchaseEvidence, 'id' | 'importedAt'> & { id?: string; importedAt?: string }>) => { imported: number; duplicates: number }
  reconcilePurchaseEvidence: () => { matched: number; review: number }
  requestAmazonMailSync: () => { ok: boolean; error?: string }
  upsertRecurringExpense: (expense: Omit<RecurringExpense, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }) => string
  deleteRecurringExpense: (id: string) => Promise<void>
  materializeRecurringExpenses: (referenceDate?: string) => number
  restoreRecycleItem: (id: string, payload: any) => Promise<boolean>
  recoverConflictDraft: (id: string, snapshot: any) => Promise<boolean>
  exportData: () => string
  importData: (raw: string) => boolean
  resetData: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function confirmDeletion(target: string, detail?: string) {
  if (typeof window === 'undefined') return true
  const extra = detail ? '\n\n' + detail : ''
  return window.confirm('Confermi di voler eliminare ' + target + '?' + extra)
}

function recurringExpenseDates(rule: Pick<RecurringExpense, 'frequency' | 'startDate' | 'endDate'>, referenceDate: string) {
  const start = new Date(`${rule.startDate}T12:00:00`)
  const reference = new Date(`${referenceDate}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(reference.getTime()) || start > reference) return [] as string[]
  const end = rule.endDate ? new Date(`${rule.endDate}T12:00:00`) : reference
  const limit = end < reference ? end : reference
  const result: string[] = []
  const originalDay = start.getDate()
  const originalMonth = start.getMonth()
  const originalYear = start.getFullYear()

  for (let index = 0; index < 600; index += 1) {
    let candidate: Date
    if (rule.frequency === 'weekly') {
      candidate = new Date(start)
      candidate.setDate(start.getDate() + index * 7)
    } else if (rule.frequency === 'yearly') {
      const year = originalYear + index
      const lastDay = new Date(year, originalMonth + 1, 0, 12).getDate()
      candidate = new Date(year, originalMonth, Math.min(originalDay, lastDay), 12)
    } else {
      const monthBase = new Date(originalYear, originalMonth + index, 1, 12)
      const lastDay = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0, 12).getDate()
      candidate = new Date(monthBase.getFullYear(), monthBase.getMonth(), Math.min(originalDay, lastDay), 12)
    }
    if (candidate > limit) break
    result.push(localDateISO(candidate))
  }
  return result
}

function loadCachedData(): FamilyData {
  // In cloud/production mode the family document must never be persisted
  // as a browser-local authentication fallback. The authoritative copy is
  // loaded only after Supabase Auth succeeds.
  if (isSupabaseConfigured) return deepClone(initialData)

  try {
    const current = localStorage.getItem(STORAGE_KEY)
    if (current) return migrateData(JSON.parse(current), deepClone(initialData))
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key)
      if (legacy) return migrateData(JSON.parse(legacy), deepClone(initialData))
    }
  } catch {
    // fall through to defaults
  }
  return deepClone(initialData)
}

function dbRoleToApp(role?: string): FamilyUser['role'] {
  if (role === 'admin') return 'admin'
  if (role === 'child') return 'bimbo'
  return 'adulto'
}

function cloudSafeData(value: FamilyData): FamilyData {
  return {
    ...value,
    storageModel: 'normalized-v2',
    users: value.users.map(user => ({ ...user, password: '', balance: 0 })),
    deadlines: value.deadlines.filter(item => !isHealthDeadline(item)),
    chores: [],
    recurringChores: [],
    transactions: [],
    schoolSubjects: [],
    schoolTimetable: [],
    schoolItems: []
  }
}

function profileToUser(profile: any, memberRole: string, existing?: FamilyUser): FamilyUser {
  return {
    id: existing?.id || 1,
    cloudUserId: profile?.id || existing?.cloudUserId,
    name: profile?.display_name || existing?.name || 'Utente',
    role: dbRoleToApp(memberRole),
    password: '',
    color: profile?.color || existing?.color || '#5B5BD6',
    avatarUrl: profile?.avatar_url || existing?.avatarUrl || '',
    balance: Number(existing?.balance || 0),
    prefs: mergePrefs(existing?.prefs)
  }
}

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<FamilyData>(() => loadCachedData())
  const localSeedRef = useRef<FamilyData>(deepClone(data))
  const [sessionUserId, setSessionUserId] = useState<number | null>(() => {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? Number(raw) || null : null
  })
  const [cloudUserId, setCloudUserId] = useState<string | null>(null)
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudLoading, setCloudLoading] = useState(isSupabaseConfigured)
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(isSupabaseConfigured ? 'connecting' : 'offline')
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState('')
  const [needsFamilySetup, setNeedsFamilySetup] = useState(false)
  const [activePage, setActivePage] = useState<PageKey>(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('googleCalendar')) return 'settings'
    const requested = params.get('page') as PageKey | null
    return requested && PAGE_KEYS.includes(requested) ? requested : 'home'
  })

  const revisionRef = useRef(0)
  const dataRef = useRef<FamilyData>(data)
  const familyIdRef = useRef<string | null>(null)
  const syncInFlightRef = useRef(false)
  const writeInFlightRef = useRef(false)
  const pendingSyncSnapshotRef = useRef<FamilyData | null>(null)
  const deferredRemoteRefreshRef = useRef(false)
  const suppressNextPushRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const realtimeChannelRef = useRef<any>(null)
  const childSyncTimerRef = useRef<number | null>(null)
  const currentCloudUserRef = useRef<any>(null)
  const calendarSyncHashRef = useRef('')
  const healthSyncHashRef = useRef('')
  const financeSyncHashRef = useRef('')
  const schoolSyncHashRef = useRef('')
  const familySyncHashRef = useRef('')
  const lastSyncedSnapshotRef = useRef<FamilyData | null>(null)
  const remoteRefreshInFlightRef = useRef(false)
  const pushCategoryHashesRef = useRef<Record<PushCategory, string> | null>(null)

  familyIdRef.current = familyId
  dataRef.current = data

  useEffect(() => {
    if (isSupabaseConfigured) {
      // Remove legacy full-family browser caches. Cloud mode keeps the live
      // document in memory and reloads it after authenticated startup.
      localStorage.removeItem(STORAGE_KEY)
      for (const key of LEGACY_KEYS) localStorage.removeItem(key)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    const ensureToday = () => setData(prev => {
      const current = cloudUserId
        ? prev.users.find(user => user.cloudUserId === cloudUserId)
        : prev.users.find(user => user.id === sessionUserId)
      if (isSupabaseConfigured && current?.role === 'bimbo') return prev
      return materializeRecurringChores(prev, localDateISO())
    })
    ensureToday()
    const timer = window.setInterval(ensureToday, 60_000)
    return () => window.clearInterval(timer)
  }, [data.recurringChores, cloudUserId, sessionUserId])

  useEffect(() => {
    if (sessionUserId) sessionStorage.setItem(SESSION_KEY, String(sessionUserId))
    else sessionStorage.removeItem(SESSION_KEY)
  }, [sessionUserId])

  const authUser = useMemo(() => {
    if (cloudUserId) return data.users.find(u => u.cloudUserId === cloudUserId) || null
    return data.users.find(u => u.id === sessionUserId) || null
  }, [data.users, sessionUserId, cloudUserId])

  useEffect(() => {
    if (!authUser || authUser.role === 'bimbo') return
    materializeRecurringExpenses(localDateISO())
    const timer = window.setInterval(() => materializeRecurringExpenses(localDateISO()), 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [authUser?.id, data.recurringExpenses])

  useEffect(() => {
    if (!cloudUserId && sessionUserId && !authUser) setSessionUserId(null)
  }, [sessionUserId, authUser, cloudUserId])

  async function fetchProfile(userId: string) {
    if (!supabase) return null
    const { data: profile } = await supabase.from('profiles').select('id,display_name,username,avatar_url,color').eq('id', userId).maybeSingle()
    return profile
  }

  function linkCloudIdentity(base: FamilyData, profile: any, role: string): FamilyData {
    const safe = migrateData(base, deepClone(initialData))
    const byCloud = safe.users.find(u => u.cloudUserId === profile?.id)
    const byName = !byCloud ? safe.users.find(u => !u.cloudUserId && normalize(u.name) === normalize(profile?.display_name || '')) : undefined
    const existing = byCloud || byName
    const linked = profileToUser(profile, role, existing)
    if (existing) {
      linked.id = existing.id
      return { ...safe, users: safe.users.map(u => u.id === existing.id ? linked : u) }
    }
    linked.id = nextId(safe.users)
    return { ...safe, users: [...safe.users, linked] }
  }

  async function callFamilyGateway(action: 'read' | 'save', targetFamilyId: string, extra: Record<string, any> = {}) {
    if (!supabase) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('family-document-gateway', {
      body: { action, familyId: targetFamilyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Gateway famiglia non disponibile.')
    if (!result?.ok && result?.error !== 'revision_conflict') throw new Error(result?.error || 'Operazione famiglia non autorizzata.')
    return result
  }

  async function callHealthGateway(action: 'read' | 'sync', targetFamilyId: string, extra: Record<string, any> = {}) {
    if (!supabase) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('health-data-gateway', {
      body: { action, familyId: targetFamilyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Archivio salute non disponibile.')
    if (!result?.ok) throw new Error(result?.error || 'Operazione salute non autorizzata.')
    return result
  }

  async function callFinanceGateway(action: 'read' | 'sync', targetFamilyId: string, extra: Record<string, any> = {}) {
    if (!supabase) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('finance-data-gateway', {
      body: { action, familyId: targetFamilyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Archivio paghette non disponibile.')
    if (!result?.ok) throw new Error(result?.error || 'Operazione paghette non autorizzata.')
    return result
  }

  async function callSchoolGateway(action: 'read' | 'sync', targetFamilyId: string, extra: Record<string, any> = {}) {
    if (!supabase) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('school-data-gateway', {
      body: { action, familyId: targetFamilyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Archivio scuola non disponibile.')
    if (!result?.ok) throw new Error(result?.error || 'Operazione scuola non autorizzata.')
    return result
  }

  function hasUnsyncedChanges(snapshot: FamilyData) {
    return JSON.stringify(cloudSafeData(snapshot)) !== familySyncHashRef.current
      || financeHash(snapshot) !== financeSyncHashRef.current
      || schoolHash(snapshot) !== schoolSyncHashRef.current
      || healthHash(snapshot) !== healthSyncHashRef.current
  }

  function remoteRefreshMustWait() {
    return syncInFlightRef.current
      || writeInFlightRef.current
      || pendingSyncSnapshotRef.current !== null
      || hasUnsyncedChanges(dataRef.current)
  }

  function rebaseUnsyncedLocalChanges(remote: FamilyData): FamilyData {
    const base = lastSyncedSnapshotRef.current
    const local = dataRef.current
    if (!base || !hasUnsyncedChanges(local)) return remote

    const merged = deepClone(remote)
    const keys: Array<keyof FamilyData> = [
      'assistantName',
      'users',
      'calendarEvents',
      'deadlines',
      'categories',
      'pantry',
      'pantryMovements',
      'shopping',
      'dishes',
      'mealPlans',
      'chores',
      'recurringChores',
      'transactions',
      'todos',
      'routines',
      'routineCompletions',
      'schoolSubjects',
      'schoolTimetable',
      'schoolItems',
      'boardPosts',
      'approvalRequests',
      'expenses',
      'recurringExpenses'
    ]

    for (const key of keys) {
      if (JSON.stringify(base[key] ?? null) !== JSON.stringify(local[key] ?? null)) {
        ;(merged as any)[key] = deepClone((local as any)[key])
      }
    }
    return merged
  }

  async function archiveDeletedItem(module: string, label: string, payload: any) {
    if (!supabase || !familyIdRef.current || !cloudUserId) return true
    try {
      const { error } = await supabase.rpc('archive_family_deleted_item', {
        p_family_id: familyIdRef.current,
        p_module: module,
        p_label: label,
        p_payload: payload
      })
      if (error) throw error
      return true
    } catch (error) {
      console.error('archive deleted item', error)
      if (typeof window !== 'undefined') {
        window.alert('Non sono riuscito a mettere l’elemento nel Cestino. Per sicurezza non è stato eliminato. Riprova tra poco.')
      }
      return false
    }
  }

  async function saveConflictDraft(snapshot: FamilyData, baseRevision: number, remoteRevision: number) {
    if (!supabase || !familyIdRef.current) return false
    try {
      const { error } = await supabase.rpc('save_family_conflict_draft', {
        p_family_id: familyIdRef.current,
        p_base_revision: baseRevision,
        p_remote_revision: remoteRevision,
        p_data: snapshot
      })
      if (error) throw error
      return true
    } catch (error) {
      console.error('save conflict draft', error)
      return false
    }
  }

  async function readFamilyDocument(targetFamilyId: string, profile: any, role: string) {
    if (!supabase) return
    const [result, healthResult, financeResult, schoolResult] = await Promise.all([
      callFamilyGateway('read', targetFamilyId),
      callHealthGateway('read', targetFamilyId).catch(error => {
        console.warn('health-data-gateway read fallback', error)
        return null
      }),
      callFinanceGateway('read', targetFamilyId).catch(error => {
        console.warn('finance-data-gateway read fallback', error)
        return null
      }),
      callSchoolGateway('read', targetFamilyId).catch(error => {
        console.warn('school-data-gateway read fallback', error)
        return null
      })
    ])
    const raw = result?.data && Object.keys(result.data).length ? result.data : deepClone(initialData)
    let migrated = migrateData(raw, deepClone(initialData))
    if (healthResult?.items) {
      migrated = mergeHealthDeadlines(migrated, healthResult.items)
      healthSyncHashRef.current = JSON.stringify(healthResult.items)
    }
    if (financeResult) migrated = mergeFinanceData(migrated, financeResult)
    if (schoolResult) migrated = mergeSchoolData(migrated, schoolResult)
    const linked = linkCloudIdentity(migrated, profile, result?.role || role)
    financeSyncHashRef.current = financeHash(linked)
    schoolSyncHashRef.current = schoolHash(linked)
    familySyncHashRef.current = JSON.stringify(cloudSafeData(linked))
    calendarSyncHashRef.current = JSON.stringify(linked.calendarEvents || [])
    pushCategoryHashesRef.current = pushCategoryHashes(linked)
    lastSyncedSnapshotRef.current = deepClone(linked)
    suppressNextPushRef.current = true
    revisionRef.current = Number(result?.revision || 0)
    setFamilyId(targetFamilyId)
    setFamilyName(result?.family?.name || 'Famiglia')
    setNeedsFamilySetup(false)
    setData(linked)
    setCloudStatus('synced')
  }

  function stopRealtime() {
    if (supabase && realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }
    if (childSyncTimerRef.current) {
      window.clearInterval(childSyncTimerRef.current)
      childSyncTimerRef.current = null
    }
  }

  async function refreshChildSnapshot(targetFamilyId: string) {
    if (!supabase || remoteRefreshInFlightRef.current) return
    if (remoteRefreshMustWait()) {
      deferredRemoteRefreshRef.current = true
      return
    }

    remoteRefreshInFlightRef.current = true
    try {
      const [result, healthResult, financeResult, schoolResult] = await Promise.all([
        callFamilyGateway('read', targetFamilyId),
        callHealthGateway('read', targetFamilyId).catch(() => null),
        callFinanceGateway('read', targetFamilyId).catch(() => null),
        callSchoolGateway('read', targetFamilyId).catch(() => null)
      ])
      if (!result?.ok) return

      // A local interaction may have happened while the network request was in flight.
      // Never replace it with an older cloud snapshot; wait until the pending save ends.
      if (remoteRefreshMustWait()) {
        deferredRemoteRefreshRef.current = true
        return
      }

      const remoteRevision = Number(result.revision || 0)
      if (remoteRevision < revisionRef.current) return

      const user = currentCloudUserRef.current
      const profile = user ? await fetchProfile(user.id) : null
      let remote = migrateData(result.data, deepClone(initialData))
      if (healthResult?.items) {
        remote = mergeHealthDeadlines(remote, healthResult.items)
        healthSyncHashRef.current = JSON.stringify(healthResult.items)
      }
      if (financeResult) remote = mergeFinanceData(remote, financeResult)
      if (schoolResult) remote = mergeSchoolData(remote, schoolResult)
      const linked = user
        ? linkCloudIdentity(remote, profile || { id: user.id, display_name: user.email?.split('@')[0] }, result.role || 'child')
        : remote

      revisionRef.current = Math.max(revisionRef.current, remoteRevision)
      financeSyncHashRef.current = financeHash(linked)
      schoolSyncHashRef.current = schoolHash(linked)
      healthSyncHashRef.current = healthHash(linked)
      familySyncHashRef.current = JSON.stringify(cloudSafeData(linked))
      pushCategoryHashesRef.current = pushCategoryHashes(linked)
      lastSyncedSnapshotRef.current = deepClone(linked)
      suppressNextPushRef.current = true
      setData(linked)
      setCloudStatus('synced')
    } catch (error) {
      console.warn('refreshChildSnapshot', error)
    } finally {
      remoteRefreshInFlightRef.current = false
    }
  }

  function startRealtime(targetFamilyId: string, role = 'adult') {
    if (!supabase) return
    stopRealtime()
    childSyncTimerRef.current = window.setInterval(() => void refreshChildSnapshot(targetFamilyId), 15_000)
    if (role === 'child') return
    realtimeChannelRef.current = supabase
      .channel(`family-document-${targetFamilyId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'family_documents', filter: `family_id=eq.${targetFamilyId}` }, async (payload: any) => {
        const row = payload?.new
        const remoteRevision = Number(row?.revision || 0)
        if (!row || remoteRevision <= revisionRef.current) return

        const activeUser = currentCloudUserRef.current
        const isOwnWriteEcho = !!activeUser?.id && String(row?.updated_by || '') === String(activeUser.id)
        if ((syncInFlightRef.current || writeInFlightRef.current) && isOwnWriteEcho) return
        if (syncInFlightRef.current || writeInFlightRef.current) {
          deferredRemoteRefreshRef.current = true
          return
        }

        const localSnapshot = dataRef.current
        const hadUnsyncedChanges = hasUnsyncedChanges(localSnapshot)
        if (hadUnsyncedChanges) {
          await saveConflictDraft(localSnapshot, revisionRef.current, remoteRevision)
        }
        revisionRef.current = remoteRevision
        const user = currentCloudUserRef.current
        const profile = user ? await fetchProfile(user.id) : null
        const { data: membership } = user ? await supabase.from('family_members').select('role').eq('family_id', targetFamilyId).eq('user_id', user.id).maybeSingle() : { data: null }
        let remote = migrateData(row.data, deepClone(initialData))
        const [healthResult, financeResult, schoolResult] = await Promise.all([
          callHealthGateway('read', targetFamilyId).catch(() => null),
          callFinanceGateway('read', targetFamilyId).catch(() => null),
          callSchoolGateway('read', targetFamilyId).catch(() => null)
        ])
        if (healthResult?.items) {
          remote = mergeHealthDeadlines(remote, healthResult.items)
          healthSyncHashRef.current = JSON.stringify(healthResult.items)
        }
        if (financeResult) remote = mergeFinanceData(remote, financeResult)
        if (schoolResult) remote = mergeSchoolData(remote, schoolResult)
        const linked = user ? linkCloudIdentity(remote, profile || { id: user.id, display_name: user.email?.split('@')[0] }, membership?.role || 'adult') : remote
        financeSyncHashRef.current = financeHash(linked)
        schoolSyncHashRef.current = schoolHash(linked)
        healthSyncHashRef.current = healthHash(linked)
        familySyncHashRef.current = JSON.stringify(cloudSafeData(linked))
        pushCategoryHashesRef.current = pushCategoryHashes(linked)
        lastSyncedSnapshotRef.current = deepClone(linked)

        const rebased = hadUnsyncedChanges ? rebaseUnsyncedLocalChanges(linked) : linked
        suppressNextPushRef.current = !hadUnsyncedChanges
        setData(rebased)
        setCloudStatus(hadUnsyncedChanges ? 'saving' : 'synced')
      })
      .subscribe()
  }

  async function loadCloudContext(user: any) {
    if (!supabase || !user) return
    setCloudLoading(true)
    setCloudStatus('connecting')
    currentCloudUserRef.current = user
    setCloudUserId(user.id)
    setCloudEmail(user.email || '')
    setSessionUserId(null)
    try {
      const profile = await fetchProfile(user.id) || { id: user.id, display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Utente' }
      const { data: memberships, error } = await supabase.from('family_members').select('family_id,role,prefs').eq('user_id', user.id).limit(1)
      if (error) throw error
      const membership = memberships?.[0]
      if (!membership) {
        stopRealtime()
        setFamilyId(null)
        setFamilyName('')
        setNeedsFamilySetup(true)
        const standalone = linkCloudIdentity(deepClone(initialData), profile, 'admin')
        suppressNextPushRef.current = true
        setData({ ...standalone, users: standalone.users.filter(u => u.cloudUserId === user.id) })
        setCloudStatus('synced')
        return
      }
      await readFamilyDocument(membership.family_id, profile, membership.role)
      startRealtime(membership.family_id, membership.role)
    } catch (error) {
      console.error('loadCloudContext', error)
      setCloudStatus('error')
    } finally {
      setCloudLoading(false)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setCloudLoading(false)
      setCloudStatus('offline')
      return
    }
    let mounted = true
    supabase.auth.getSession().then(({ data: result }) => {
      if (!mounted) return
      const user = result.session?.user
      if (user) loadCloudContext(user)
      else {
        setCloudLoading(false)
        setCloudStatus('offline')
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) loadCloudContext(session.user)
      else {
        stopRealtime()
        currentCloudUserRef.current = null
        revisionRef.current = 0
        lastSyncedSnapshotRef.current = null
        suppressNextPushRef.current = true
        setCloudUserId(null)
        setCloudEmail('')
        setFamilyId(null)
        setFamilyName('')
        setNeedsFamilySetup(false)
        setData(deepClone(initialData))
        setCloudLoading(false)
        setCloudStatus('offline')
      }
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
      stopRealtime()
    }
  }, [])

  async function performPushDocument(snapshot: FamilyData): Promise<boolean> {
    if (!supabase || !familyIdRef.current || !cloudUserId) return false

    const nextPushHashes = pushCategoryHashes(snapshot)
    const publishPushUpdates = () => { pushCategoryHashesRef.current = nextPushHashes }
    const expected = revisionRef.current

    const familyPayload = cloudSafeData(snapshot)
    const nextFamilyHash = JSON.stringify(familyPayload)
    const nextFinanceHash = financeHash(snapshot)
    const nextSchoolHash = schoolHash(snapshot)
    const nextHealthHash = healthHash(snapshot)

    const familyChanged = nextFamilyHash !== familySyncHashRef.current
    const financeChanged = nextFinanceHash !== financeSyncHashRef.current
    const schoolChanged = nextSchoolHash !== schoolSyncHashRef.current
    const healthChanged = authUser?.role !== 'bimbo' && nextHealthHash !== healthSyncHashRef.current

    if (!familyChanged && !financeChanged && !schoolChanged && !healthChanged) {
      setCloudStatus('synced')
      publishPushUpdates()
      return true
    }

    setCloudStatus('saving')
    let financeResult: any = null
    let schoolResult: any = null
    let writeRevision = expected

    try {
      // Global optimistic lock FIRST. This also triggers the automatic
      // full snapshot backup before any normalized module is changed.
      writeInFlightRef.current = true
      const result = await callFamilyGateway('save', familyIdRef.current, {
        data: familyPayload,
        expectedRevision: expected
      })

      if (result?.error === 'revision_conflict') {
        const remoteRevision = Number(result.revision || expected)
        const conflictSnapshot = pendingSyncSnapshotRef.current || snapshot
        pendingSyncSnapshotRef.current = null
        await saveConflictDraft(conflictSnapshot, expected, remoteRevision)
        revisionRef.current = remoteRevision
        writeInFlightRef.current = false
        setCloudStatus('conflict')

        if (result.data) {
          suppressNextPushRef.current = true
          let remote = migrateData(result.data, deepClone(initialData))
          const [healthResult, financeRemote, schoolRemote] = await Promise.all([
            callHealthGateway('read', familyIdRef.current).catch(() => null),
            callFinanceGateway('read', familyIdRef.current).catch(() => null),
            callSchoolGateway('read', familyIdRef.current).catch(() => null)
          ])
          if (healthResult?.items) remote = mergeHealthDeadlines(remote, healthResult.items)
          if (financeRemote) remote = mergeFinanceData(remote, financeRemote)
          if (schoolRemote) remote = mergeSchoolData(remote, schoolRemote)
          healthSyncHashRef.current = healthHash(remote)
          financeSyncHashRef.current = financeHash(remote)
          schoolSyncHashRef.current = schoolHash(remote)
          familySyncHashRef.current = JSON.stringify(cloudSafeData(remote))
          pushCategoryHashesRef.current = pushCategoryHashes(remote)
          lastSyncedSnapshotRef.current = deepClone(remote)
          setData(remote)
        }
        return false
      }

      if (!result?.ok) throw new Error(result?.error || 'Salvataggio non autorizzato.')

      writeRevision = Number(result.revision || expected + 1)
      revisionRef.current = writeRevision
      familySyncHashRef.current = nextFamilyHash
      writeInFlightRef.current = false

      // Normalized modules use the new revision as a fencing token.
      // A newer device save invalidates this token and blocks stale writes.
      if (financeChanged) {
        financeResult = await callFinanceGateway('sync', familyIdRef.current, {
          data: snapshot,
          expectedRevision: writeRevision
        })
        const normalizedFinance = mergeFinanceData(snapshot, financeResult)
        financeSyncHashRef.current = financeHash(normalizedFinance)
      }

      if (schoolChanged) {
        schoolResult = await callSchoolGateway('sync', familyIdRef.current, {
          data: snapshot,
          expectedRevision: writeRevision
        })
        const normalizedSchool = mergeSchoolData(snapshot, schoolResult)
        schoolSyncHashRef.current = schoolHash(normalizedSchool)
      }

      if (healthChanged) {
        const healthResult = await callHealthGateway('sync', familyIdRef.current, {
          data: snapshot,
          expectedRevision: writeRevision
        })
        healthSyncHashRef.current = JSON.stringify(healthResult?.items || snapshot.deadlines.filter(item => isHealthDeadline(item)))
      }

      if (result.normalized && result.data) {
        suppressNextPushRef.current = true
        let familyOnly = migrateData(result.data, deepClone(initialData))
        familyOnly = mergeHealthDeadlines(familyOnly, snapshot.deadlines.filter(item => isHealthDeadline(item)))
        familyOnly = mergeFinanceData(familyOnly, financeResult || {
          wallets: snapshot.users.map(user => ({ userId: user.id, balance: user.balance })),
          chores: snapshot.chores,
          recurringChores: snapshot.recurringChores,
          transactions: snapshot.transactions
        })
        familyOnly = mergeSchoolData(familyOnly, schoolResult || {
          schoolSubjects: snapshot.schoolSubjects,
          schoolTimetable: snapshot.schoolTimetable,
          schoolItems: snapshot.schoolItems
        })
        setData(familyOnly)
      }

      const savedSnapshot = result.normalized && result.data
        ? dataRef.current
        : snapshot
      lastSyncedSnapshotRef.current = deepClone(savedSnapshot)

      setCloudStatus('synced')
      const calendarHash = JSON.stringify(snapshot.calendarEvents || [])
      if (calendarHash !== calendarSyncHashRef.current) {
        calendarSyncHashRef.current = calendarHash
        void supabase.functions.invoke('google-calendar-sync', {
          body: { action: 'sync-all', familyId: familyIdRef.current }
        }).then(({ error }) => {
          if (error) console.warn('Google Calendar sync deferred:', error.message)
        })
      }
      publishPushUpdates()
      return true
    } catch (error: any) {
      writeInFlightRef.current = false
      const message = String(error?.message || '')
      if (message.includes('expected_revision_conflict')) {
        let remoteRevision = revisionRef.current
        try {
          const latest = await callFamilyGateway('read', familyIdRef.current)
          remoteRevision = Number(latest?.revision || remoteRevision)
        } catch {}
        await saveConflictDraft(pendingSyncSnapshotRef.current || snapshot, expected, remoteRevision)
        pendingSyncSnapshotRef.current = null
        revisionRef.current = remoteRevision
        deferredRemoteRefreshRef.current = true
        setCloudStatus('conflict')
      } else {
        console.error('family-document-gateway save', error)
        setCloudStatus('error')
      }
      return false
    }
  }

  async function pushDocument(snapshot: FamilyData): Promise<boolean> {
    if (!supabase || !familyIdRef.current || !cloudUserId) return false
    if (syncInFlightRef.current) {
      pendingSyncSnapshotRef.current = deepClone(snapshot)
      return false
    }

    syncInFlightRef.current = true
    let ok = false
    try {
      ok = await performPushDocument(snapshot)
      return ok
    } finally {
      syncInFlightRef.current = false
      const pending = pendingSyncSnapshotRef.current
      pendingSyncSnapshotRef.current = null

      if (pending && ok) {
        // Preserve rapid consecutive taps: write the newest local snapshot first.
        // A deferred remote refresh can safely run only after this queue is empty.
        void pushDocument(pending)
      } else if (deferredRemoteRefreshRef.current && ok) {
        deferredRemoteRefreshRef.current = false
        void refreshChildSnapshot(familyIdRef.current)
      } else if (!ok) {
        // Never overwrite an unsaved local interaction after a failed save.
        deferredRemoteRefreshRef.current = false
      }
    }
  }

  useEffect(() => {
    if (!supabase || !cloudUserId || !familyId || cloudLoading) return
    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false
      return
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => pushDocument(data), 350)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [data, cloudUserId, familyId, cloudLoading])

  async function login(identifier: string, password: string): Promise<AuthResult> {
    const clean = identifier.trim()
    if (supabase) {
      if (!clean.includes('@')) return { ok: false, error: 'Inserisci l’email del tuo account VerdoFamily.' }
      setCloudLoading(true)
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password })
      if (error) {
        setCloudLoading(false)
        return { ok: false, error: error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message }
      }
      setActivePage('home')
      return { ok: true }
    }

    // Local profiles are available only in explicitly offline/dev builds.
    const local = data.users.find(u => normalize(u.name) === normalize(clean) && u.password === password)
    if (!local) return { ok: false, error: 'Nome utente o password non corretti.' }
    setCloudUserId(null)
    setSessionUserId(local.id)
    setActivePage('home')
    return { ok: true }
  }

  async function signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, error: 'Connessione cloud non configurata.' }
    if (!displayName.trim()) return { ok: false, error: 'Inserisci il tuo nome.' }
    if (password.length < 10) return { ok: false, error: 'La password deve avere almeno 10 caratteri.' }
    setCloudLoading(true)
    const { data: result, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } }
    })
    setCloudLoading(false)
    if (error) return { ok: false, error: error.message }
    if (!result.session) return { ok: true, needsEmailConfirmation: true }
    return { ok: true }
  }

  async function logout() {
    if (supabase && cloudUserId) await supabase.auth.signOut()
    stopRealtime()
    revisionRef.current = 0
    lastSyncedSnapshotRef.current = null
    pushCategoryHashesRef.current = null
    suppressNextPushRef.current = true
    setCloudUserId(null)
    setSessionUserId(null)
    setFamilyId(null)
    setFamilyName('')
    setNeedsFamilySetup(false)
    if (isSupabaseConfigured) setData(deepClone(initialData))
    setActivePage('home')
  }

  async function createCloudFamily(name: string, useLocalData = false): Promise<AuthResult> {
    if (!supabase || !currentCloudUserRef.current) return { ok: false, error: 'Devi prima accedere.' }
    if (!name.trim()) return { ok: false, error: 'Inserisci il nome della famiglia.' }
    setCloudLoading(true)
    try {
      const user = currentCloudUserRef.current
      const profile = await fetchProfile(user.id) || { id: user.id, display_name: user.user_metadata?.display_name || user.email?.split('@')[0] }
      const { data: createdId, error } = await supabase.rpc('create_family', { p_name: name.trim() })
      if (error) throw error
      let seed = useLocalData ? migrateData(localSeedRef.current, deepClone(initialData)) : deepClone(initialData)
      seed = linkCloudIdentity(seed, profile, 'admin')
      if (!useLocalData) seed = { ...seed, users: seed.users.filter(u => u.cloudUserId === user.id) }
      const { data: revision, error: bootstrapError } = await supabase.rpc('bootstrap_family_document', { p_family_id: createdId, p_data: cloudSafeData(seed) })
      if (bootstrapError) throw bootstrapError
      const [financeResult, schoolResult] = await Promise.all([
        callFinanceGateway('sync', createdId, { data: seed }),
        callSchoolGateway('sync', createdId, { data: seed })
      ])
      seed = mergeFinanceData(seed, financeResult)
      seed = mergeSchoolData(seed, schoolResult)
      financeSyncHashRef.current = financeHash(seed)
      schoolSyncHashRef.current = schoolHash(seed)
      familySyncHashRef.current = JSON.stringify(cloudSafeData(seed))
      pushCategoryHashesRef.current = pushCategoryHashes(seed)
      lastSyncedSnapshotRef.current = deepClone(seed)
      revisionRef.current = Number(revision || 1)
      suppressNextPushRef.current = true
      setData(seed)
      setFamilyId(createdId)
      setFamilyName(name.trim())
      setNeedsFamilySetup(false)
      startRealtime(createdId, 'admin')
      setCloudStatus('synced')
      return { ok: true }
    } catch (error: any) {
      console.error('createCloudFamily', error)
      setCloudStatus('error')
      return { ok: false, error: error?.message || 'Impossibile creare la famiglia.' }
    } finally {
      setCloudLoading(false)
    }
  }

  async function joinCloudFamily(code: string): Promise<AuthResult> {
    if (!supabase || !currentCloudUserRef.current) return { ok: false, error: 'Devi prima accedere.' }
    if (!code.trim()) return { ok: false, error: 'Inserisci il codice famiglia.' }
    setCloudLoading(true)
    try {
      const user = currentCloudUserRef.current
      const { data: joinedId, error } = await supabase.rpc('join_family_by_code', { p_code: code.trim().toUpperCase() })
      if (error) throw error
      const profile = await fetchProfile(user.id) || { id: user.id, display_name: user.user_metadata?.display_name || user.email?.split('@')[0] }
      const { data: membership } = await supabase.from('family_members').select('role').eq('family_id', joinedId).eq('user_id', user.id).single()
      await readFamilyDocument(joinedId, profile, membership?.role || 'adult')
      startRealtime(joinedId, membership?.role || 'adult')
      setNeedsFamilySetup(false)
      return { ok: true }
    } catch (error: any) {
      console.error('joinCloudFamily', error)
      return { ok: false, error: String(error?.message || '').includes('invite_invalid_or_expired') ? 'Codice non valido o scaduto.' : (error?.message || 'Impossibile entrare nella famiglia.') }
    } finally {
      setCloudLoading(false)
    }
  }

  async function createFamilyInvite(role: 'adult' | 'child' = 'adult') {
    if (!supabase || !familyId) return { ok: false, error: 'Famiglia non disponibile.' }
    const { data: code, error } = await supabase.rpc('create_family_invite', {
      p_family_id: familyId,
      p_role: role,
      p_email: null,
      p_expires_hours: 168,
      p_max_uses: 1
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, code: String(code || '') }
  }

  async function syncNow() {
    if (familyId) await pushDocument(data)
  }

  function updateCurrentPrefs(patch: Partial<UserPrefs> | ((current: UserPrefs) => Partial<UserPrefs>)) {
    if (!authUser) return
    setData(prev => ({
      ...prev,
      users: prev.users.map(u => {
        if (u.id !== authUser.id) return u
        const current = mergePrefs(u.prefs)
        const resolved = typeof patch === 'function' ? patch(current) : patch
        return {
          ...u,
          prefs: mergePrefs({
            ...current,
            ...resolved,
            notifications: { ...current.notifications, ...(resolved.notifications || {}) }
          })
        }
      })
    }))
  }

  function updateCurrentProfile(patch: Partial<FamilyUser>) {
    if (!authUser) return
    updateUser(authUser.id, patch)
    if (supabase && cloudUserId) {
      const profilePatch: any = {}
      if (patch.name !== undefined) profilePatch.display_name = patch.name
      if (patch.avatarUrl !== undefined) profilePatch.avatar_url = patch.avatarUrl
      if (patch.color !== undefined) profilePatch.color = patch.color
      if (Object.keys(profilePatch).length) supabase.from('profiles').update(profilePatch).eq('id', cloudUserId).then(() => {})
    }
  }

  function setAssistantName(name: string) {
    if (!authUser || authUser.role === 'bimbo') return
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 24) || 'Verdo'
    setData(prev => ({ ...prev, assistantName: clean }))
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

  async function deleteUser(id: number) {
    if (authUser?.id === id) return
    const user = data.users.find(item => item.id === id)
    if (!user || data.users.length <= 1) return
    if (!confirmDeletion('il profilo “' + (user.name || 'selezionato') + '”')) return
    if (!await archiveDeletedItem('users', user.name || 'Profilo', { kind: 'user', item: user })) return
    setData(prev => prev.users.length <= 1 ? prev : ({ ...prev, users: prev.users.filter(u => u.id !== id) }))
  }

  function childApprovalRequest(kind: ApprovalRequestKind, action: ApprovalRequest['action'], payload: Record<string, any>, summary: string) {
    if (!authUser || authUser.role !== 'bimbo') return false
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      kind,
      action,
      requestedByUserId: authUser.id,
      createdAt: new Date().toISOString(),
      summary: String(summary || 'Richiesta').trim().slice(0, 240) || 'Richiesta',
      payload: JSON.parse(JSON.stringify(payload || {}))
    }
    setData(prev => ({ ...prev, approvalRequests: [...(prev.approvalRequests || []), request] }))
    return true
  }

  function approveApprovalRequest(id: string) {
    if (!authUser || authUser.role === 'bimbo') return
    setData(prev => {
      const request = (prev.approvalRequests || []).find(item => item.id === id)
      if (!request) return prev
      const payload: any = request.payload || {}
      let next = prev

      if (request.kind === 'shopping') {
        if (request.action === 'delete') {
          next = { ...next, shopping: next.shopping.filter(item => item.id !== Number(payload.id)) }
        } else {
          const name = String(payload.name || '').trim()
          const qty = Math.max(0, Number(payload.qty || 1))
          const unit = String(payload.unit || 'pz')
          if (name) {
            const existing = next.shopping.find(item => !item.taken && normalize(item.name) === normalize(name) && normalize(item.unit) === normalize(unit))
            next = existing
              ? { ...next, shopping: next.shopping.map(item => item.id === existing.id ? { ...item, qty: Number(item.qty || 0) + qty } : item) }
              : { ...next, shopping: [...next.shopping, { id: nextId(next.shopping), name, qty, unit, taken: false, category: payload.category || undefined }] }
          }
        }
      }

      if (request.kind === 'school') {
        if (request.action === 'delete') {
          next = { ...next, schoolItems: next.schoolItems.filter(item => item.id !== Number(payload.id)) }
        } else {
          const clean: SchoolItem = {
            id: request.action === 'update' && Number(payload.id) > 0 ? Number(payload.id) : nextId(next.schoolItems),
            userId: Number(payload.userId || request.requestedByUserId),
            type: payload.type,
            title: String(payload.title || '').trim(),
            date: payload.date || localDateISO(),
            subjectId: payload.subjectId ? Number(payload.subjectId) : undefined,
            notes: payload.notes ? String(payload.notes).trim() : undefined,
            amount: payload.amount === undefined || payload.amount === null ? undefined : Math.max(0, Number(payload.amount) || 0),
            done: !!payload.done,
            createdAt: payload.createdAt || localDateISO()
          }
          if (clean.title) {
            const exists = next.schoolItems.some(item => item.id === clean.id)
            next = { ...next, schoolItems: exists ? next.schoolItems.map(item => item.id === clean.id ? clean : item) : [...next.schoolItems, clean] }
          }
        }
      }

      if (request.kind === 'deadline') {
        if (request.action === 'delete') {
          next = { ...next, deadlines: next.deadlines.filter(item => item.id !== Number(payload.id)) }
        } else {
          const idValue = request.action === 'update' && Number(payload.id) > 0 ? Number(payload.id) : nextId(next.deadlines)
          const clean: Deadline = {
            ...payload,
            id: idValue,
            userId: Number(payload.userId || request.requestedByUserId),
            title: String(payload.title || '').trim(),
            date: payload.date || localDateISO(),
            kind: 'general',
            done: !!payload.done,
            category: payload.category || 'other',
            reminderDays: Array.from(new Set((Array.isArray(payload.reminderDays) ? payload.reminderDays : [90, 30, 7]).map(Number))).sort((a: number, b: number) => b - a),
            repeatYearly: payload.repeatYearly === true,
            notes: payload.notes ? String(payload.notes).trim() : ''
          }
          if (clean.title) {
            const exists = next.deadlines.some(item => item.id === clean.id)
            next = { ...next, deadlines: exists ? next.deadlines.map(item => item.id === clean.id ? clean : item) : [...next.deadlines, clean] }
          }
        }
      }

      if (request.kind === 'calendar') {
        if (request.action === 'delete') {
          next = { ...next, calendarEvents: next.calendarEvents.filter(item => item.id !== Number(payload.id)) }
        } else {
          const idValue = request.action === 'update' && Number(payload.id) > 0 ? Number(payload.id) : nextId(next.calendarEvents)
          const userIds = Array.from(new Set((Array.isArray(payload.userIds) ? payload.userIds : [payload.userId || request.requestedByUserId]).map(Number).filter((value: number) => value > 0)))
          const clean: CalendarEvent = {
            ...payload,
            id: idValue,
            title: String(payload.title || '').trim(),
            date: payload.date || localDateISO(),
            time: payload.time || '',
            userId: Number(userIds[0] || request.requestedByUserId),
            userIds,
            audience: payload.audience === 'family' ? 'family' : 'users'
          }
          if (clean.title) {
            const exists = next.calendarEvents.some(item => item.id === clean.id)
            next = { ...next, calendarEvents: exists ? next.calendarEvents.map(item => item.id === clean.id ? clean : item) : [...next.calendarEvents, clean] }
          }
        }
      }

      if (request.kind === 'todo') {
        if (request.action === 'delete') {
          next = { ...next, todos: next.todos.filter(item => item.id !== Number(payload.id)) }
        } else {
          const idValue = request.action === 'update' && Number(payload.id) > 0 ? Number(payload.id) : nextId(next.todos)
          const clean: Todo = {
            id: idValue,
            title: String(payload.title || '').trim(),
            userId: Number(payload.userId || request.requestedByUserId),
            done: !!payload.done,
            createdAt: payload.createdAt || localDateISO()
          }
          if (clean.title) {
            const exists = next.todos.some(item => item.id === clean.id)
            next = { ...next, todos: exists ? next.todos.map(item => item.id === clean.id ? clean : item) : [...next.todos, clean] }
          }
        }
      }

      return { ...next, approvalRequests: (next.approvalRequests || []).filter(item => item.id !== id) }
    })
  }

  function rejectApprovalRequest(id: string) {
    if (!authUser || authUser.role === 'bimbo') return
    setData(prev => ({ ...prev, approvalRequests: (prev.approvalRequests || []).filter(item => item.id !== id) }))
  }

  function upsertCalendarEvent(event: Omit<CalendarEvent, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('calendar', event.id ? 'update' : 'create', event as any, `${event.id ? 'Modifica' : 'Nuovo impegno'}: ${event.title || 'Calendario'} · ${event.date || ''}`)
      return
    }
    setData(prev => {
      if (!event.id) return { ...prev, calendarEvents: [...prev.calendarEvents, { ...event, id: nextId(prev.calendarEvents) }] }
      const exists = prev.calendarEvents.some(e => e.id === event.id)
      return { ...prev, calendarEvents: exists ? prev.calendarEvents.map(e => e.id === event.id ? { ...e, ...event, id: e.id } : e) : [...prev.calendarEvents, { ...event, id: event.id }] }
    })
  }
  async function deleteCalendarEvent(id: number) {
    const event = data.calendarEvents.find(item => item.id === id)
    if (!event) return
    if (!confirmDeletion('l’impegno “' + (event.title || 'selezionato') + '”')) return
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('calendar', 'delete', { id: event.id, title: event.title, date: event.date }, `Elimina impegno: ${event.title}`)
      return
    }
    if (!await archiveDeletedItem('calendar', event.title || 'Impegno', { kind: 'calendarEvent', item: event })) return
    setData(prev => ({ ...prev, calendarEvents: prev.calendarEvents.filter(e => e.id !== id) }))
  }

  function upsertDeadline(deadline: Omit<Deadline, 'id' | 'done'> & { id?: number; done?: boolean }) {
    if (authUser?.role === 'bimbo') {
      if (isHealthDeadline(deadline)) return
      childApprovalRequest('deadline', deadline.id ? 'update' : 'create', { ...deadline, userId: authUser.id }, `${deadline.id ? 'Modifica' : 'Nuova scadenza'}: ${deadline.title || 'Scadenza'} · ${deadline.date || ''}`)
      return
    }
    setData(prev => ({ ...prev, deadlines: deadline.id ? prev.deadlines.map(d => d.id === deadline.id ? { ...d, ...deadline, id: d.id, done: !!deadline.done } : d) : [...prev.deadlines, { ...deadline, id: nextId(prev.deadlines), done: !!deadline.done }] }))
  }
  function toggleDeadline(id: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({
      ...prev,
      deadlines: prev.deadlines.map(d => {
        if (d.id !== id) return d
        if (!d.done && d.kind === 'general' && d.repeatYearly) {
          const [year, month, day] = d.date.split('-').map(Number)
          const nextYear = year + 1
          const lastDay = new Date(nextYear, month, 0, 12).getDate()
          const nextDate = localDateISO(new Date(nextYear, month - 1, Math.min(day, lastDay), 12))
          return {
            ...d,
            date: nextDate,
            done: false,
            lastCompletedDate: d.date,
            lastCompletedAt: new Date().toISOString()
          }
        }
        return { ...d, done: !d.done }
      })
    }))
  }
  async function deleteDeadline(id: number) {
    const deadline = data.deadlines.find(item => item.id === id)
    if (!deadline) return
    if (authUser?.role === 'bimbo' && isHealthDeadline(deadline)) return
    if (!confirmDeletion('la scadenza “' + (deadline.title || 'selezionata') + '”')) return
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('deadline', 'delete', { id: deadline.id, title: deadline.title, date: deadline.date }, `Elimina scadenza: ${deadline.title}`)
      return
    }
    const module = isHealthDeadline(deadline) ? 'health' : 'deadlines'
    if (!await archiveDeletedItem(module, deadline.title || 'Scadenza', { kind: 'deadline', item: deadline })) return
    setData(prev => ({ ...prev, deadlines: prev.deadlines.filter(d => d.id !== id) }))
  }

  function addCategory(name: string) {
    if (authUser?.role === 'bimbo') return false
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
    if (authUser?.role === 'bimbo') return false
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

  async function deleteCategory(name: string) {
    if (authUser?.role === 'bimbo') return false
    if (name === 'Generico') return false
    if (!confirmDeletion('la categoria “' + name + '”', 'I prodotti associati verranno spostati nella categoria Generico.')) return false
    const affectedPantry = data.pantry.filter(item => item.category === name)
    if (!await archiveDeletedItem('shopping', 'Categoria ' + name, { kind: 'category', item: name, affectedPantry })) return false
    setData(prev => ({ ...prev, categories: prev.categories.filter(c => c !== name), pantry: prev.pantry.map(p => p.category === name ? { ...p, category: 'Generico' } : p) }))
    return true
  }

  function movement(movements: PantryMovement[], pantryItemId: number, delta: number, reason: PantryMovement['reason']): PantryMovement[] {
    if (!delta) return movements
    return [...movements, {
      id: nextId(movements),
      pantryItemId,
      delta,
      date: localDateISO(),
      createdAt: new Date().toISOString(),
      reason
    }]
  }

  function upsertPantryItem(item: Omit<PantryItem, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      if (item.id) {
        const old = prev.pantry.find(p => p.id === item.id)
        if (!old) return prev
        const clean = {
          ...old,
          ...item,
          id: old.id,
          brand: String(item.brand || item.productInfo?.brand || '').trim().slice(0, 120) || undefined,
          variant: String(item.variant || '').trim().slice(0, 120) || undefined,
          packageSize: String(item.packageSize || item.productInfo?.packageQuantity || '').trim().slice(0, 100) || undefined,
          barcode: /^\d{8,14}$/.test(String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, ''))
            ? String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
            : undefined,
          qty: Math.max(0, Number(item.qty || 0)),
          minQty: Math.max(0, Number(item.minQty || 0)),
          location: item.location || 'pantry' as PantryLocation,
          expiryDate: item.expiryDate || undefined,
          autoRestock: item.autoRestock !== false,
          packageState: item.packageState === 'opened' ? 'opened' : 'sealed',
          remainingQty: item.packageState === 'opened' && Number.isFinite(Number(item.remainingQty)) ? Math.max(0, Number(item.remainingQty)) : undefined,
          remainingUnit: item.packageState === 'opened' ? (item.remainingUnit || undefined) : undefined,
          residualPercent: item.packageState === 'opened' && Number.isFinite(Number(item.residualPercent)) ? Math.max(0, Math.min(100, Number(item.residualPercent))) : undefined,
          residualSource: item.packageState === 'opened' && ['manual','photo'].includes(String(item.residualSource || '')) ? item.residualSource : undefined
        }
        const delta = Number(clean.qty || 0) - Number(old.qty || 0)
        return {
          ...prev,
          pantry: prev.pantry.map(p => p.id === item.id ? clean : p),
          pantryMovements: movement(prev.pantryMovements, old.id, delta, 'adjustment')
        }
      }

      const id = nextId(prev.pantry)
      const clean: PantryItem = {
        ...item,
        id,
        name: item.name.trim(),
        brand: String(item.brand || item.productInfo?.brand || '').trim().slice(0, 120) || undefined,
        variant: String(item.variant || '').trim().slice(0, 120) || undefined,
        packageSize: String(item.packageSize || item.productInfo?.packageQuantity || '').trim().slice(0, 100) || undefined,
        barcode: /^\d{8,14}$/.test(String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, ''))
          ? String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
          : undefined,
        qty: Math.max(0, Number(item.qty || 0)),
        minQty: Math.max(0, Number(item.minQty || 0)),
        location: item.location || 'pantry',
        expiryDate: item.expiryDate || undefined,
        autoRestock: item.autoRestock !== false,
        packageState: item.packageState === 'opened' ? 'opened' : 'sealed',
        remainingQty: item.packageState === 'opened' && Number.isFinite(Number(item.remainingQty)) ? Math.max(0, Number(item.remainingQty)) : undefined,
        remainingUnit: item.packageState === 'opened' ? (item.remainingUnit || undefined) : undefined,
        residualPercent: item.packageState === 'opened' && Number.isFinite(Number(item.residualPercent)) ? Math.max(0, Math.min(100, Number(item.residualPercent))) : undefined,
        residualSource: item.packageState === 'opened' && ['manual','photo'].includes(String(item.residualSource || '')) ? item.residualSource : undefined
      }
      const incomingBarcode = String(clean.barcode || clean.productInfo?.barcode || '').replace(/\D/g, '')
      const incomingBrand = normalize(clean.brand || clean.productInfo?.brand || '')
      const existing = prev.pantry.find(current => {
        const currentBarcode = String(current.barcode || current.productInfo?.barcode || '').replace(/\D/g, '')
        const sameSku = !!incomingBarcode && !!currentBarcode && incomingBarcode === currentBarcode
        const sameNamedProduct = normalize(current.name) === normalize(clean.name)
          && (!incomingBrand || !normalize(current.brand || current.productInfo?.brand || '') || incomingBrand === normalize(current.brand || current.productInfo?.brand || ''))
        return (sameSku || sameNamedProduct)
          && normalize(current.unit) === normalize(clean.unit)
          && (current.location || 'pantry') === (clean.location || 'pantry')
          && (current.expiryDate || '') === (clean.expiryDate || '')
          && (current.packageState || 'sealed') === (clean.packageState || 'sealed')
      })

      if (existing) {
        const addedQty = Number(clean.qty || 0)
        const merged: PantryItem = {
          ...existing,
          qty: Number(existing.qty || 0) + addedQty,
          category: clean.category || existing.category,
          minQty: Math.max(Number(existing.minQty || 0), Number(clean.minQty || 0)),
          autoRestock: clean.autoRestock !== false,
          brand: clean.brand || existing.brand,
          variant: clean.variant || existing.variant,
          packageSize: clean.packageSize || existing.packageSize,
          barcode: clean.barcode || existing.barcode,
          productInfo: clean.productInfo || existing.productInfo,
          remainingQty: clean.packageState === 'opened' ? clean.remainingQty : existing.remainingQty,
          remainingUnit: clean.packageState === 'opened' ? clean.remainingUnit : existing.remainingUnit,
          residualPercent: clean.packageState === 'opened' ? clean.residualPercent : existing.residualPercent,
          residualSource: clean.packageState === 'opened' ? clean.residualSource : existing.residualSource
        }
        return {
          ...prev,
          pantry: prev.pantry.map(row => row.id === existing.id ? merged : row),
          pantryMovements: movement(prev.pantryMovements, existing.id, addedQty, 'adjustment')
        }
      }

      return {
        ...prev,
        pantry: [...prev.pantry, clean],
        pantryMovements: movement(prev.pantryMovements, id, Number(clean.qty || 0), 'adjustment')
      }
    })
  }

  async function deletePantryItem(id: number) {
    if (authUser?.role === 'bimbo') return
    const item = data.pantry.find(entry => entry.id === id)
    if (!item) return
    if (!confirmDeletion('“' + item.name + '” dalla dispensa', 'Verrà eliminata anche la cronologia dei movimenti associati.')) return
    const movements = data.pantryMovements.filter(m => m.pantryItemId === id)
    if (!await archiveDeletedItem('shopping', item.name, { kind: 'pantryItem', item, movements })) return
    setData(prev => ({
      ...prev,
      pantry: prev.pantry.filter(p => p.id !== id),
      pantryMovements: prev.pantryMovements.filter(m => m.pantryItemId !== id)
    }))
  }

  function changePantryQty(id: number, delta: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      const target = prev.pantry.find(p => p.id === id)
      if (!target) return prev
      const current = Number(target.qty || 0)
      const nextQty = Math.max(0, current + Number(delta || 0))
      const actualDelta = nextQty - current
      if (!actualDelta) return prev
      return {
        ...prev,
        pantry: prev.pantry.map(p => p.id === id
          ? {
              ...p,
              qty: nextQty,
              ...(nextQty <= 0 ? {
                packageState: 'sealed' as const,
                remainingQty: undefined,
                remainingUnit: undefined,
                residualPercent: undefined,
                residualSource: undefined
              } : {})
            }
          : p),
        pantryMovements: movement(prev.pantryMovements, id, actualDelta, 'manual')
      }
    })
  }

  function reconcilePantryItems(
    items: Array<{ name: string; brand?: string; variant?: string; packageSize?: string; barcode?: string; qty: number; unit: string; category?: string; location?: PantryLocation; expiryDate?: string; packageState?: PantryItem['packageState']; remainingQty?: number; remainingUnit?: string; residualPercent?: number; residualSource?: PantryItem['residualSource']; productInfo?: PantryItem['productInfo'] }>,
    defaultLocation: PantryLocation = 'pantry'
  ) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      let pantry = [...prev.pantry]
      let pantryMovements = [...prev.pantryMovements]

      for (const raw of items) {
        const name = String(raw.name || '').trim()
        if (!name) continue
        const unit = raw.unit || 'pz'
        const location = raw.location || defaultLocation
        const observedQty = Math.max(0, Number(raw.qty || 0))
        const incomingBarcode = String(raw.barcode || raw.productInfo?.barcode || '').replace(/\D/g, '')
        const incomingName = normalize(name)

        const matches = pantry
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => {
            const currentBarcode = String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
            const sameSku = !!incomingBarcode && !!currentBarcode && incomingBarcode === currentBarcode
            const sameName = normalize(item.name) === incomingName
            return (sameSku || sameName)
              && normalize(item.unit) === normalize(unit)
              && (item.location || 'pantry') === location
          })
          .sort((a, b) => (a.item.expiryDate || '9999-12-31').localeCompare(b.item.expiryDate || '9999-12-31'))

        if (!matches.length) {
          const id = nextId(pantry)
          const clean: PantryItem = {
            id,
            name,
            brand: String(raw.brand || raw.productInfo?.brand || '').trim().slice(0, 120) || undefined,
            variant: String(raw.variant || '').trim().slice(0, 120) || undefined,
            packageSize: String(raw.packageSize || raw.productInfo?.packageQuantity || '').trim().slice(0, 100) || undefined,
            barcode: /^\d{8,14}$/.test(incomingBarcode) ? incomingBarcode : undefined,
            qty: observedQty,
            unit,
            category: raw.category || 'Generico',
            minQty: 0,
            location,
            expiryDate: raw.expiryDate || undefined,
            autoRestock: true,
            packageState: raw.packageState === 'opened' ? 'opened' : 'sealed',
            remainingQty: raw.packageState === 'opened' && Number.isFinite(Number(raw.remainingQty)) ? Math.max(0, Number(raw.remainingQty)) : undefined,
            remainingUnit: raw.packageState === 'opened' ? raw.remainingUnit : undefined,
            residualPercent: raw.packageState === 'opened' && Number.isFinite(Number(raw.residualPercent)) ? Math.max(0, Math.min(100, Number(raw.residualPercent))) : undefined,
            residualSource: raw.packageState === 'opened' ? raw.residualSource : undefined,
            productInfo: raw.productInfo
          }
          pantry.push(clean)
          pantryMovements = movement(pantryMovements, id, observedQty, 'adjustment')
          continue
        }

        const currentTotal = matches.reduce((sum, row) => sum + Math.max(0, Number(pantry[row.index]?.qty || 0)), 0)
        let delta = observedQty - currentTotal

        const primaryIndex = matches[0].index
        const primary = pantry[primaryIndex]
        pantry[primaryIndex] = {
          ...primary,
          brand: String(raw.brand || raw.productInfo?.brand || primary.brand || '').trim().slice(0, 120) || undefined,
          variant: String(raw.variant || primary.variant || '').trim().slice(0, 120) || undefined,
          packageSize: String(raw.packageSize || raw.productInfo?.packageQuantity || primary.packageSize || '').trim().slice(0, 100) || undefined,
          barcode: /^\d{8,14}$/.test(incomingBarcode) ? incomingBarcode : primary.barcode,
          category: raw.category || primary.category,
          productInfo: raw.productInfo || primary.productInfo,
          packageState: raw.packageState || primary.packageState || 'sealed',
          remainingQty: raw.packageState === 'opened' ? raw.remainingQty : raw.packageState === 'sealed' ? undefined : primary.remainingQty,
          remainingUnit: raw.packageState === 'opened' ? raw.remainingUnit : raw.packageState === 'sealed' ? undefined : primary.remainingUnit,
          residualPercent: raw.packageState === 'opened' ? raw.residualPercent : raw.packageState === 'sealed' ? undefined : primary.residualPercent,
          residualSource: raw.packageState === 'opened' ? raw.residualSource : raw.packageState === 'sealed' ? undefined : primary.residualSource
        }

        if (delta < 0) {
          let toRemove = Math.abs(delta)
          for (const row of matches) {
            if (toRemove <= 0) break
            const current = pantry[row.index]
            const currentQty = Math.max(0, Number(current.qty || 0))
            const decrease = Math.min(currentQty, toRemove)
            if (!decrease) continue
            const nextQty = currentQty - decrease
            pantry[row.index] = {
              ...current,
              qty: nextQty,
              ...(nextQty <= 0 ? {
                packageState: 'sealed' as const,
                remainingQty: undefined,
                remainingUnit: undefined,
                residualPercent: undefined,
                residualSource: undefined
              } : {})
            }
            pantryMovements = movement(pantryMovements, current.id, -decrease, 'adjustment')
            toRemove -= decrease
          }
        } else if (delta > 0) {
          const current = pantry[primaryIndex]
          pantry[primaryIndex] = { ...current, qty: Math.max(0, Number(current.qty || 0)) + delta }
          pantryMovements = movement(pantryMovements, current.id, delta, 'adjustment')
        }
      }

      return { ...prev, pantry, pantryMovements }
    })
  }

  function addShoppingItem(item: Omit<ShoppingItem, 'id' | 'taken'>) {
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('shopping', 'create', item as any, `Aggiungi alla spesa: ${item.name} · ${item.qty} ${item.unit}`)
      return
    }
    setData(prev => ({ ...prev, shopping: [...prev.shopping, { ...item, id: nextId(prev.shopping), taken: false }] }))
  }
  function toggleShoppingItem(id: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({ ...prev, shopping: prev.shopping.map(s => s.id === id ? { ...s, taken: !s.taken } : s) }))
  }
  async function deleteShoppingItem(id: number) {
    const item = data.shopping.find(entry => entry.id === id)
    if (!item) return
    if (!confirmDeletion('“' + item.name + '” dalla lista della spesa')) return
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('shopping', 'delete', { id: item.id, name: item.name }, `Rimuovi dalla spesa: ${item.name}`)
      return
    }
    if (!await archiveDeletedItem('shopping', item.name, { kind: 'shoppingItem', item })) return
    setData(prev => ({ ...prev, shopping: prev.shopping.filter(s => s.id !== id) }))
  }

  function mergeIntoPantry(
    pantry: PantryItem[],
    movements: PantryMovement[],
    items: Array<{ name: string; brand?: string; variant?: string; packageSize?: string; barcode?: string; qty: number; unit: string; category?: string; location?: PantryLocation; expiryDate?: string; packageState?: PantryItem['packageState']; remainingQty?: number; remainingUnit?: string; residualPercent?: number; residualSource?: PantryItem['residualSource']; productInfo?: PantryItem['productInfo'] }>,
    reason: PantryMovement['reason'],
    defaultLocation: PantryLocation = 'pantry'
  ) {
    const next = [...pantry]
    let nextMovements = [...movements]
    for (const item of items) {
      const location = item.location || defaultLocation
      const expiryDate = item.expiryDate || undefined
      const incomingBrand = normalize(item.brand || item.productInfo?.brand || '')
      const incomingBarcode = String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
      const idx = next.findIndex(p => {
        const currentBrand = normalize(p.brand || p.productInfo?.brand || '')
        const currentBarcode = String(p.barcode || p.productInfo?.barcode || '').replace(/\D/g, '')
        const sameSku = !!incomingBarcode && !!currentBarcode && incomingBarcode === currentBarcode
        const sameNamedProduct = normalize(p.name) === normalize(item.name)
          && (!incomingBrand || !currentBrand || incomingBrand === currentBrand)
        return (sameSku || sameNamedProduct)
          && normalize(p.unit) === normalize(item.unit)
          && (p.location || 'pantry') === location
          && (p.expiryDate || '') === (expiryDate || '')
          && (p.packageState || 'sealed') === (item.packageState || 'sealed')
      })
      const qty = Math.max(0, Number(item.qty || 0))
      if (idx >= 0) {
        const current = next[idx]
        const incomingInfo = item.productInfo
        const currentInfo = current.productInfo
        const productInfo = incomingInfo && (!currentInfo || Number(incomingInfo.confidence || 0) >= Number(currentInfo.confidence || 0))
          ? incomingInfo
          : currentInfo
        next[idx] = {
          ...current,
          qty: Number(current.qty || 0) + qty,
          brand: String(item.brand || productInfo?.brand || current.brand || '').trim().slice(0, 120) || undefined,
          variant: String(item.variant || current.variant || '').trim().slice(0, 120) || undefined,
          packageSize: String(item.packageSize || productInfo?.packageQuantity || current.packageSize || '').trim().slice(0, 100) || undefined,
          barcode: /^\d{8,14}$/.test(String(item.barcode || productInfo?.barcode || current.barcode || '').replace(/\D/g, ''))
            ? String(item.barcode || productInfo?.barcode || current.barcode || '').replace(/\D/g, '')
            : undefined,
          productInfo,
          packageState: item.packageState || current.packageState || 'sealed',
          remainingQty: item.packageState === 'opened' ? item.remainingQty : current.remainingQty,
          remainingUnit: item.packageState === 'opened' ? item.remainingUnit : current.remainingUnit,
          residualPercent: item.packageState === 'opened' ? item.residualPercent : current.residualPercent,
          residualSource: item.packageState === 'opened' ? item.residualSource : current.residualSource
        }
        nextMovements = movement(nextMovements, current.id, qty, reason)
      } else {
        const id = nextId(next)
        next.push({
          id,
          name: item.name.trim(),
          brand: String(item.brand || item.productInfo?.brand || '').trim().slice(0, 120) || undefined,
          variant: String(item.variant || '').trim().slice(0, 120) || undefined,
          packageSize: String(item.packageSize || item.productInfo?.packageQuantity || '').trim().slice(0, 100) || undefined,
          barcode: /^\d{8,14}$/.test(String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, ''))
            ? String(item.barcode || item.productInfo?.barcode || '').replace(/\D/g, '')
            : undefined,
          qty,
          unit: item.unit || 'pz',
          category: item.category || 'Generico',
          minQty: 0,
          location,
          expiryDate,
          autoRestock: true,
          packageState: item.packageState || 'sealed',
          remainingQty: item.packageState === 'opened' ? item.remainingQty : undefined,
          remainingUnit: item.packageState === 'opened' ? item.remainingUnit : undefined,
          residualPercent: item.packageState === 'opened' ? item.residualPercent : undefined,
          residualSource: item.packageState === 'opened' ? item.residualSource : undefined,
          productInfo: item.productInfo
        })
        nextMovements = movement(nextMovements, id, qty, reason)
      }
    }
    return { pantry: next, pantryMovements: nextMovements }
  }

  function moveTakenShoppingToPantry(location: PantryLocation = 'pantry') {
    if (authUser?.role === 'bimbo') return
    const count = data.shopping.filter(item => item.taken).length
    if (!count) return
    const target = count === 1 ? 'l’articolo acquistato dalla lista della spesa' : 'i ' + count + ' articoli acquistati dalla lista della spesa'
    if (!confirmDeletion(target, 'Gli articoli verranno prima aggiunti alla dispensa.')) return
    setData(prev => {
      const taken = prev.shopping.filter(s => s.taken)
      if (!taken.length) return prev
      const merged = mergeIntoPantry(
        prev.pantry,
        prev.pantryMovements,
        taken.map(s => ({ name: s.name, qty: s.qty, unit: s.unit, category: s.category || 'Generico', location })),
        'purchase',
        location
      )
      return { ...prev, ...merged, shopping: prev.shopping.filter(s => !s.taken) }
    })
  }

  function importReceiptItems(
    items: Array<{ name: string; brand?: string; variant?: string; packageSize?: string; barcode?: string; qty: number; unit: string; category: string; location?: PantryLocation; expiryDate?: string; packageState?: PantryItem['packageState']; remainingQty?: number; remainingUnit?: string; residualPercent?: number; residualSource?: PantryItem['residualSource']; productInfo?: PantryItem['productInfo'] }>,
    removeFromShopping: boolean,
    defaultLocation: PantryLocation = 'pantry'
  ) {
    if (authUser?.role === 'bimbo') return
    if (removeFromShopping) {
      const matching = data.shopping.filter(s => items.some(i => normalize(i.name) === normalize(s.name))).length
      if (matching) {
        const target = matching === 1 ? 'l’articolo corrispondente dalla lista della spesa' : 'i ' + matching + ' articoli corrispondenti dalla lista della spesa'
        if (!confirmDeletion(target, 'I prodotti riconosciuti resteranno caricati in dispensa.')) return
      }
    }
    setData(prev => {
      const merged = mergeIntoPantry(prev.pantry, prev.pantryMovements, items, 'import', defaultLocation)
      return {
        ...prev,
        ...merged,
        shopping: removeFromShopping ? prev.shopping.filter(s => !items.some(i => normalize(i.name) === normalize(s.name))) : prev.shopping
      }
    })
  }

  function adjustIngredients(prev: FamilyData, dishId: number, factor: number) {
    const dish = prev.dishes.find(d => d.id === dishId)
    if (!dish) return { pantry: prev.pantry, pantryMovements: prev.pantryMovements }
    const pantry = [...prev.pantry]
    let pantryMovements = [...prev.pantryMovements]
    for (const ing of dish.ingredients) {
      const candidates = pantry
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => normalize(item.name) === normalize(ing.name))
        .sort((a, b) => {
          const expiryA = a.item.expiryDate || '9999-12-31'
          const expiryB = b.item.expiryDate || '9999-12-31'
          return expiryA.localeCompare(expiryB)
        })
      if (!candidates.length) continue
      const target = candidates[0]
      const requestedDelta = Number(ing.qty || 0) * factor
      const current = Number(target.item.qty || 0)
      const nextQty = Math.max(0, current + requestedDelta)
      const actualDelta = nextQty - current
      pantry[target.index] = { ...target.item, qty: nextQty }
      pantryMovements = movement(pantryMovements, target.item.id, actualDelta, 'meal')
    }
    return { pantry, pantryMovements }
  }

  function upsertDish(dish: Omit<Dish, 'id'> & { id?: number }) { setData(prev => ({ ...prev, dishes: dish.id ? prev.dishes.map(d => d.id === dish.id ? { ...d, ...dish, id: d.id } : d) : [...prev.dishes, { ...dish, id: nextId(prev.dishes) }] })) }
  async function deleteDish(id: number) {
    const dish = data.dishes.find(item => item.id === id)
    if (!dish) return
    if (!confirmDeletion('il piatto “' + dish.name + '”', 'Verranno eliminate anche le pianificazioni pasto collegate.')) return
    const mealPlans = data.mealPlans.filter(p => p.dishId === id)
    if (!await archiveDeletedItem('meals', dish.name, { kind: 'dish', item: dish, mealPlans })) return
    setData(prev => ({ ...prev, dishes: prev.dishes.filter(d => d.id !== id), mealPlans: prev.mealPlans.filter(p => p.dishId !== id) }))
  }

  function upsertMealPlan(plan: Omit<MealPlan, 'id'> & { id?: number }) {
    setData(prev => {
      let pantry = prev.pantry
      if (plan.id) {
        const old = prev.mealPlans.find(p => p.id === plan.id)
        if (old) {
          const restored = adjustIngredients({ ...prev, pantry }, old.dishId, +1)
          pantry = restored.pantry
          prev = { ...prev, pantryMovements: restored.pantryMovements }
        }
      }
      const consumed = adjustIngredients({ ...prev, pantry }, plan.dishId, -1)
      pantry = consumed.pantry
      const mealPlans = plan.id ? prev.mealPlans.map(p => p.id === plan.id ? { ...p, ...plan, id: p.id } : p) : [...prev.mealPlans, { ...plan, id: nextId(prev.mealPlans) }]
      return { ...prev, pantry, pantryMovements: consumed.pantryMovements, mealPlans }
    })
  }

  async function deleteMealPlan(id: number) {
    const plan = data.mealPlans.find(p => p.id === id)
    if (!plan) return
    const dish = data.dishes.find(d => d.id === plan.dishId)
    if (!confirmDeletion('questa pianificazione del pasto')) return
    if (!await archiveDeletedItem('meals', dish?.name || 'Pasto pianificato', { kind: 'mealPlan', item: plan })) return
    setData(prev => {
      const current = prev.mealPlans.find(p => p.id === id)
      const restored = current ? adjustIngredients(prev, current.dishId, +1) : { pantry: prev.pantry, pantryMovements: prev.pantryMovements }
      return { ...prev, pantry: restored.pantry, pantryMovements: restored.pantryMovements, mealPlans: prev.mealPlans.filter(p => p.id !== id) }
    })
  }

  function addChore(chore: Omit<Chore, 'id' | 'done'>) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({
      ...prev,
      chores: [...prev.chores, {
        ...chore,
        id: nextId(prev.chores),
        done: false,
        completionStatus: 'open'
      }]
    }))
  }

  function upsertRecurringChore(chore: Omit<RecurringChore, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      const userIds = Array.from(new Set(
        (Array.isArray(chore.userIds) && chore.userIds.length ? chore.userIds : [chore.userId])
          .map(Number)
          .filter(id => id > 0 && prev.users.some(user => user.id === id))
      ))
      const clean: RecurringChore = {
        id: chore.id || nextId(prev.recurringChores),
        title: chore.title.trim(),
        userId: userIds[0] || 0,
        userIds,
        amount: Math.max(0, Number(chore.amount) || 0),
        weekdays: Array.from(new Set((chore.weekdays || []).map(Number).filter(day => day >= 1 && day <= 7))).sort(),
        active: chore.active !== false,
        startDate: chore.startDate || localDateISO(),
        endDate: chore.endDate || undefined
      }
      if (!clean.title || !clean.weekdays.length || !clean.userIds?.length) return prev

      let next: FamilyData = {
        ...prev,
        recurringChores: chore.id
          ? prev.recurringChores.map(item => item.id === chore.id ? clean : item)
          : [...prev.recurringChores, clean]
      }

      const today = localDateISO()
      const selected = new Set(clean.userIds)
      next = {
        ...next,
        chores: next.chores
          .filter(item => !(
            item.recurringChoreId === clean.id
            && item.deadline === today
            && !item.done
            && (item.completionStatus || 'open') === 'open'
            && !selected.has(Number(item.userId))
          ))
          .map(item =>
            item.recurringChoreId === clean.id
            && item.deadline === today
            && !item.done
            && selected.has(Number(item.userId))
              ? { ...item, title: clean.title, amount: clean.amount }
              : item
          )
      }
      return materializeRecurringChores(next, today)
    })
  }

  function toggleRecurringChore(id: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({
      ...prev,
      recurringChores: prev.recurringChores.map(item => item.id === id ? { ...item, active: !item.active } : item)
    }))
  }

  async function deleteRecurringChore(id: number) {
    if (authUser?.role === 'bimbo') return
    const chore = data.recurringChores.find(item => item.id === id)
    if (!chore) return
    if (!confirmDeletion('il compito ricorrente “' + chore.title + '”')) return
    if (!await archiveDeletedItem('chores', chore.title, { kind: 'recurringChore', item: chore })) return
    setData(prev => ({ ...prev, recurringChores: prev.recurringChores.filter(item => item.id !== id) }))
  }

  function approveChoreState(prev: FamilyData, chore: Chore, approverId: number) {
    if (chore.done) return prev
    const txId = nextId(prev.transactions)
    const now = new Date().toISOString()
    return {
      ...prev,
      chores: prev.chores.map(c => c.id === chore.id ? {
        ...c,
        done: true,
        completionStatus: 'approved',
        completedAt: c.completedAt || now,
        completedByUserId: c.completedByUserId || chore.userId,
        approvedAt: now,
        approvedByUserId: approverId,
        creditedTransactionId: txId
      } : c),
      users: prev.users.map(u => u.id === chore.userId
        ? { ...u, balance: Number(u.balance || 0) + Number(chore.amount || 0) }
        : u),
      transactions: [...prev.transactions, {
        id: txId,
        userId: chore.userId,
        type: 'credit' as const,
        amount: Number(chore.amount || 0),
        date: localDateISO(),
        note: `Compito approvato: ${chore.title}`
      }]
    }
  }

  function toggleChore(id: number) {
    if (!authUser) return
    setData(prev => {
      const chore = prev.chores.find(c => c.id === id)
      if (!chore) return prev
      const status = chore.done ? 'approved' : (chore.completionStatus || 'open')

      if (authUser.role === 'bimbo') {
        if (chore.userId !== authUser.id || chore.done) return prev
        if (status === 'pending') {
          if (chore.completedByUserId && chore.completedByUserId !== authUser.id) return prev
          return {
            ...prev,
            chores: prev.chores.map(c => c.id === id ? {
              ...c,
              completionStatus: 'open',
              completedAt: undefined,
              completedByUserId: undefined
            } : c)
          }
        }
        return {
          ...prev,
          chores: prev.chores.map(c => c.id === id ? {
            ...c,
            completionStatus: 'pending',
            completedAt: new Date().toISOString(),
            completedByUserId: authUser.id
          } : c)
        }
      }

      if (!chore.done) return approveChoreState(prev, chore, authUser.id)

      const txId = chore.creditedTransactionId
      return {
        ...prev,
        chores: prev.chores.map(c => c.id === id ? {
          ...c,
          done: false,
          completionStatus: 'open',
          completedAt: undefined,
          completedByUserId: undefined,
          approvedAt: undefined,
          approvedByUserId: undefined,
          creditedTransactionId: undefined
        } : c),
        users: prev.users.map(u => u.id === chore.userId
          ? { ...u, balance: Math.max(0, Number(u.balance || 0) - Number(chore.amount || 0)) }
          : u),
        transactions: txId
          ? prev.transactions.map(t => t.id === txId ? { ...t, reversed: true } : t)
          : prev.transactions
      }
    })
  }

  function approveChore(id: number) {
    if (!authUser || authUser.role === 'bimbo') return
    setData(prev => {
      const chore = prev.chores.find(c => c.id === id)
      if (!chore || chore.done) return prev
      return approveChoreState(prev, chore, authUser.id)
    })
  }

  function rejectChore(id: number) {
    if (!authUser || authUser.role === 'bimbo') return
    setData(prev => {
      const chore = prev.chores.find(c => c.id === id)
      if (!chore || chore.done || chore.completionStatus !== 'pending') return prev
      return {
        ...prev,
        chores: prev.chores.map(c => c.id === id ? {
          ...c,
          completionStatus: 'open',
          completedAt: undefined,
          completedByUserId: undefined
        } : c)
      }
    })
  }

  async function deleteChore(id: number) {
    if (authUser?.role === 'bimbo') return
    const chore = data.chores.find(item => item.id === id)
    if (!chore) return
    if (!confirmDeletion('il compito “' + chore.title + '”')) return
    if (!await archiveDeletedItem('chores', chore.title, { kind: 'chore', item: chore })) return
    setData(prev => ({ ...prev, chores: prev.chores.filter(c => c.id !== id) }))
  }

  function payUser(userId: number, amount: number, note = 'Pagamento paghetta') {
    if (authUser?.role === 'bimbo') return false
    let ok = false
    setData(prev => {
      const user = prev.users.find(u => u.id === userId)
      if (!user || amount <= 0 || amount > Number(user.balance || 0)) return prev
      ok = true
      return { ...prev, users: prev.users.map(u => u.id === userId ? { ...u, balance: Number(u.balance || 0) - amount } : u), transactions: [...prev.transactions, { id: nextId(prev.transactions), userId, type: 'payment', amount, date: localDateISO(), note }] }
    })
    return ok
  }

  function undoTransaction(id: number) {
    if (authUser?.role === 'bimbo') return false
    let ok = false
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id)
      if (!tx || tx.type !== 'payment' || tx.reversed) return prev
      ok = true
      return { ...prev, users: prev.users.map(u => u.id === tx.userId ? { ...u, balance: Number(u.balance || 0) + Number(tx.amount || 0) } : u), transactions: prev.transactions.map(t => t.id === id ? { ...t, reversed: true } : t) }
    })
    return ok
  }

  function addTodo(todo: Omit<Todo, 'id' | 'done' | 'createdAt'>) {
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('todo', 'create', { ...todo, userId: authUser.id }, `Nuovo promemoria: ${todo.title}`)
      return
    }
    setData(prev => ({ ...prev, todos: [...prev.todos, { ...todo, id: nextId(prev.todos), done: false, createdAt: localDateISO() }] }))
  }

  function toggleTodo(id: number) {
    setData(prev => ({ ...prev, todos: prev.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  async function deleteTodo(id: number) {
    const todo = data.todos.find(item => item.id === id)
    if (!todo) return
    if (!confirmDeletion('“' + todo.title + '” dai Da fare')) return
    if (authUser?.role === 'bimbo') {
      childApprovalRequest('todo', 'delete', { id: todo.id, title: todo.title }, `Elimina promemoria: ${todo.title}`)
      return
    }
    if (!await archiveDeletedItem('todos', todo.title, { kind: 'todo', item: todo })) return
    setData(prev => ({ ...prev, todos: prev.todos.filter(t => t.id !== id) }))
  }

  function upsertRoutine(routine: Omit<Routine, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      const clean: Routine = {
        id: routine.id || nextId(prev.routines),
        title: routine.title.trim(),
        userId: Number(routine.userId),
        frequency: routine.frequency,
        startDate: routine.startDate || localDateISO(),
        endDate: routine.endDate || undefined,
        active: routine.active !== false,
        notes: routine.notes?.trim() || ''
      }
      if (!clean.title) return prev
      return {
        ...prev,
        routines: routine.id
          ? prev.routines.map(item => item.id === routine.id ? clean : item)
          : [...prev.routines, clean]
      }
    })
  }

  function toggleRoutineActive(id: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({
      ...prev,
      routines: prev.routines.map(item => item.id === id ? { ...item, active: !item.active } : item)
    }))
  }

  async function deleteRoutine(id: number) {
    if (authUser?.role === 'bimbo') return
    const routine = data.routines.find(item => item.id === id)
    if (!routine) return
    if (!confirmDeletion('la routine “' + routine.title + '”', 'Verranno eliminati anche i completamenti registrati.')) return
    const completions = data.routineCompletions.filter(item => item.routineId === id)
    if (!await archiveDeletedItem('todos', routine.title, { kind: 'routine', item: routine, completions })) return
    setData(prev => ({
      ...prev,
      routines: prev.routines.filter(item => item.id !== id),
      routineCompletions: prev.routineCompletions.filter(item => item.routineId !== id)
    }))
  }

  function completeRoutine(id: number, date = localDateISO()) {
    if (!authUser) return
    setData(prev => {
      const routine = prev.routines.find(item => item.id === id)
      if (!routine) return prev
      if (authUser.role === 'bimbo' && routine.userId !== authUser.id) return prev
      if (prev.routineCompletions.some(item => item.routineId === id && item.date === date)) return prev
      return {
        ...prev,
        routineCompletions: [...prev.routineCompletions, {
          id: nextId(prev.routineCompletions),
          routineId: id,
          userId: routine.userId,
          date,
          completedAt: new Date().toISOString(),
          completedByUserId: authUser.id
        }]
      }
    })
  }

  function undoRoutineCompletion(routineId: number, date: string) {
    if (!authUser) return
    const routine = data.routines.find(item => item.id === routineId)
    if (!confirmDeletion('il completamento di “' + (routine?.title || 'questa routine') + '” del ' + date)) return
    setData(prev => {
      const routine = prev.routines.find(item => item.id === routineId)
      if (!routine) return prev
      if (authUser.role === 'bimbo' && routine.userId !== authUser.id) return prev
      return {
        ...prev,
        routineCompletions: prev.routineCompletions.filter(item => !(item.routineId === routineId && item.date === date))
      }
    })
  }

  function upsertSchoolSubject(subject: Omit<SchoolSubject, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      const clean: SchoolSubject = {
        id: subject.id || nextId(prev.schoolSubjects),
        name: subject.name.trim(),
        shortName: subject.shortName?.trim() || undefined
      }
      if (!clean.name) return prev
      return {
        ...prev,
        schoolSubjects: subject.id
          ? prev.schoolSubjects.map(item => item.id === subject.id ? clean : item)
          : [...prev.schoolSubjects, clean]
      }
    })
  }

  async function deleteSchoolSubject(id: number) {
    if (authUser?.role === 'bimbo') return
    const subject = data.schoolSubjects.find(item => item.id === id)
    if (!subject) return
    if (!confirmDeletion('la materia “' + subject.name + '”', 'Verranno rimossi anche gli orari collegati; gli impegni resteranno senza materia associata.')) return
    const timetable = data.schoolTimetable.filter(item => item.subjectId === id)
    const affectedItems = data.schoolItems.filter(item => item.subjectId === id)
    if (!await archiveDeletedItem('school', subject.name, { kind: 'schoolSubject', item: subject, timetable, affectedItems })) return
    setData(prev => ({
      ...prev,
      schoolSubjects: prev.schoolSubjects.filter(item => item.id !== id),
      schoolTimetable: prev.schoolTimetable.filter(item => item.subjectId !== id),
      schoolItems: prev.schoolItems.map(item => item.subjectId === id ? { ...item, subjectId: undefined } : item)
    }))
  }

  function upsertSchoolTimetableEntry(entry: Omit<SchoolTimetableEntry, 'id'> & { id?: number }) {
    if (authUser?.role === 'bimbo') return
    setData(prev => {
      const clean: SchoolTimetableEntry = {
        id: entry.id || nextId(prev.schoolTimetable),
        userId: Number(entry.userId),
        weekday: Math.min(7, Math.max(1, Number(entry.weekday || 1))),
        order: Math.max(1, Number(entry.order || 1)),
        subjectId: Number(entry.subjectId),
        startTime: entry.startTime || undefined,
        endTime: entry.endTime || undefined,
        room: entry.room?.trim() || undefined,
        notes: entry.notes?.trim() || undefined
      }
      return {
        ...prev,
        schoolTimetable: entry.id
          ? prev.schoolTimetable.map(item => item.id === entry.id ? clean : item)
          : [...prev.schoolTimetable, clean]
      }
    })
  }

  async function deleteSchoolTimetableEntry(id: number) {
    if (authUser?.role === 'bimbo') return
    const entry = data.schoolTimetable.find(item => item.id === id)
    if (!entry) return
    if (!confirmDeletion('questa lezione dall’orario scolastico')) return
    if (!await archiveDeletedItem('school', 'Lezione orario', { kind: 'schoolTimetable', item: entry })) return
    setData(prev => ({ ...prev, schoolTimetable: prev.schoolTimetable.filter(item => item.id !== id) }))
  }

  function upsertSchoolItem(item: Omit<SchoolItem, 'id' | 'done' | 'createdAt'> & { id?: number; done?: boolean; createdAt?: string }) {
    if (authUser?.role === 'bimbo') {
      if (Number(item.userId) !== authUser.id) return
      childApprovalRequest('school', item.id ? 'update' : 'create', { ...item, userId: authUser.id }, `${item.id ? 'Modifica scuola' : 'Nuova attività scuola'}: ${item.title || 'Attività'} · ${item.date || ''}`)
      return
    }
    setData(prev => {
      const clean: SchoolItem = {
        id: item.id || nextId(prev.schoolItems),
        userId: Number(item.userId),
        type: item.type,
        title: item.title.trim(),
        date: item.date || localDateISO(),
        subjectId: item.subjectId ? Number(item.subjectId) : undefined,
        notes: item.notes?.trim() || undefined,
        amount: item.amount === undefined || item.amount === null ? undefined : Math.max(0, Number(item.amount) || 0),
        done: !!item.done,
        createdAt: item.createdAt || localDateISO()
      }
      if (!clean.title) return prev
      return {
        ...prev,
        schoolItems: item.id
          ? prev.schoolItems.map(existing => existing.id === item.id ? clean : existing)
          : [...prev.schoolItems, clean]
      }
    })
  }

  function toggleSchoolItem(id: number) {
    if (!authUser) return
    setData(prev => {
      const target = prev.schoolItems.find(item => item.id === id)
      if (!target) return prev
      if (authUser.role === 'bimbo' && target.userId !== authUser.id) return prev
      return { ...prev, schoolItems: prev.schoolItems.map(item => item.id === id ? { ...item, done: !item.done } : item) }
    })
  }

  async function deleteSchoolItem(id: number) {
    if (!authUser) return
    const target = data.schoolItems.find(item => item.id === id)
    if (!target) return
    if (authUser.role === 'bimbo' && target.userId !== authUser.id) return
    if (!confirmDeletion('l’impegno scolastico “' + target.title + '”')) return
    if (authUser.role === 'bimbo') {
      childApprovalRequest('school', 'delete', { id: target.id, title: target.title, date: target.date, userId: target.userId }, `Elimina attività scuola: ${target.title}`)
      return
    }
    if (!await archiveDeletedItem('school', target.title, { kind: 'schoolItem', item: target })) return
    setData(prev => ({ ...prev, schoolItems: prev.schoolItems.filter(item => item.id !== id) }))
  }

  function upsertBoardPost(post: Omit<BoardPost, 'id' | 'createdAt' | 'updatedAt' | 'attachments' | 'authorUserId'> & { id?: string; attachments?: BoardAttachment[] }) {
    if (!authUser) return ''
    const id = post.id || crypto.randomUUID()
    const now = new Date().toISOString()
    setData(prev => {
      const existing = prev.boardPosts.find(item => item.id === id)
      if (existing && authUser.role === 'bimbo' && existing.authorUserId !== authUser.id) return prev
      const clean: BoardPost = {
        id,
        type: post.type,
        title: post.title.trim(),
        body: post.body.trim(),
        authorUserId: existing?.authorUserId || authUser.id,
        audience: post.audience === 'users' ? 'users' : 'family',
        userIds: post.audience === 'users' ? Array.from(new Set((post.userIds || []).map(Number).filter(userId => userId > 0))) : [],
        pinned: authUser.role === 'bimbo' ? (existing?.pinned || false) : post.pinned === true,
        dueDate: post.dueDate || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        attachments: post.attachments || existing?.attachments || []
      }
      if (!clean.title && !clean.body && !clean.attachments.length) return prev
      return {
        ...prev,
        boardPosts: existing
          ? prev.boardPosts.map(item => item.id === id ? clean : item)
          : [clean, ...prev.boardPosts]
      }
    })
    return id
  }

  function toggleBoardPin(id: string) {
    if (!authUser || authUser.role === 'bimbo') return
    setData(prev => ({
      ...prev,
      boardPosts: prev.boardPosts.map(item => item.id === id ? { ...item, pinned: !item.pinned, updatedAt: new Date().toISOString() } : item)
    }))
  }

  async function deleteBoardPost(id: string) {
    if (!authUser) return
    const post = data.boardPosts.find(item => item.id === id)
    if (!post) return
    if (authUser.role === 'bimbo' && post.authorUserId !== authUser.id) return
    if (!confirmDeletion('il contenuto “' + (post.title || post.body.slice(0, 40) || 'selezionato') + '” dalla bacheca')) return
    if (!await archiveDeletedItem('board', post.title || 'Contenuto bacheca', { kind: 'boardPost', item: post })) return
    setData(prev => ({ ...prev, boardPosts: prev.boardPosts.filter(item => item.id !== id) }))
  }

  function upsertExpense(expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }) {
    if (!authUser || authUser.role === 'bimbo') return ''
    const existingBySource = !expense.id && expense.sourceRef
      ? dataRef.current.expenses.find(item => item.sourceRef === expense.sourceRef)
      : undefined
    if (existingBySource) return existingBySource.id

    const id = expense.id || crypto.randomUUID()
    const now = new Date().toISOString()
    setData(prev => {
      const existing = prev.expenses.find(item => item.id === id)
      const clean: ExpenseRecord = {
        id,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(expense.date || '')) ? expense.date : localDateISO(),
        merchant: String(expense.merchant || 'Spesa').trim().slice(0, 160) || 'Spesa',
        total: Math.max(0, Number(expense.total) || 0),
        category: isExpenseCategory(expense.category) ? expense.category : 'other',
        subcategory: isExpenseCategory(expense.category) && isExpenseSubcategory(expense.subcategory) && subcategoryBelongsToCategory(expense.subcategory, expense.category) ? expense.subcategory : undefined,
        source: ['receipt','manual','voice','recurring','bank','paypal'].includes(String(expense.source)) ? expense.source : 'manual',
        sourceRef: expense.sourceRef ? String(expense.sourceRef).slice(0, 200) : undefined,
        flow: expense.flow === 'refund' ? 'refund' : 'expense',
        movementKind: ['purchase','fee','tax','bill','loan','cash','investment','card_settlement','transfer','paypal_repayment','refund','other'].includes(String(expense.movementKind)) ? expense.movementKind : (expense.flow === 'refund' ? 'refund' : 'purchase'),
        includeInStats: expense.includeInStats !== false,
        evidenceRefs: Array.from(new Set((expense.evidenceRefs || existing?.evidenceRefs || []).map(value => String(value || '').trim()).filter(Boolean))).slice(0, 20),
        createdAt: existing?.createdAt || expense.createdAt || now,
        createdByUserId: existing?.createdByUserId || expense.createdByUserId || authUser.id,
        notes: expense.notes?.trim().slice(0, 2000) || undefined,
        items: Array.isArray(expense.items) ? expense.items.map(item => ({
          id: String(item.id || crypto.randomUUID()),
          name: String(item.name || 'Articolo').trim().slice(0, 200) || 'Articolo',
          qty: Math.max(0, Number(item.qty) || 0),
          unit: String(item.unit || 'pz').slice(0, 20),
          unitPrice: Number.isFinite(Number(item.unitPrice)) ? Math.max(0, Number(item.unitPrice)) : undefined,
          totalPrice: Number.isFinite(Number(item.totalPrice)) ? Math.max(0, Number(item.totalPrice)) : undefined,
          category: item.category ? String(item.category).slice(0, 100) : undefined
        })) : []
      }
      if (clean.total <= 0) return prev
      return {
        ...prev,
        expenses: existing
          ? prev.expenses.map(item => item.id === id ? clean : item)
          : [clean, ...prev.expenses]
      }
    })
    return id
  }

  async function deleteExpense(id: string) {
    if (!authUser || authUser.role === 'bimbo') return
    const expense = data.expenses.find(item => item.id === id)
    if (!expense) return
    if (!confirmDeletion('la spesa “' + expense.merchant + '” del ' + expense.date)) return
    if (!await archiveDeletedItem('reports', expense.merchant + ' · ' + expense.date, { kind: 'expense', item: expense })) return
    setData(prev => ({ ...prev, expenses: prev.expenses.filter(item => item.id !== id) }))
  }

  function importExpenses(expenses: Array<Omit<ExpenseRecord, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }>) {
    if (!authUser || authUser.role === 'bimbo') return { imported: 0, duplicates: expenses.length }
    const existingRefs = new Set(dataRef.current.expenses.map(item => item.sourceRef).filter(Boolean))
    const seenRefs = new Set(existingRefs)
    const now = new Date().toISOString()
    let duplicates = 0
    const cleanRows: ExpenseRecord[] = []

    for (const expense of expenses) {
      const sourceRef = expense.sourceRef ? String(expense.sourceRef).slice(0, 200) : undefined
      if (sourceRef && seenRefs.has(sourceRef)) {
        duplicates += 1
        continue
      }
      const total = Math.max(0, Number(expense.total) || 0)
      if (total <= 0) continue
      const row: ExpenseRecord = {
        id: expense.id || crypto.randomUUID(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(expense.date || '')) ? expense.date : localDateISO(),
        merchant: String(expense.merchant || 'Spesa').trim().slice(0, 160) || 'Spesa',
        total,
        category: isExpenseCategory(expense.category) ? expense.category : 'other',
        subcategory: isExpenseCategory(expense.category) && isExpenseSubcategory(expense.subcategory) && subcategoryBelongsToCategory(expense.subcategory, expense.category) ? expense.subcategory : undefined,
        source: ['receipt','manual','voice','recurring','bank','paypal'].includes(String(expense.source)) ? expense.source : 'manual',
        sourceRef,
        flow: expense.flow === 'refund' ? 'refund' : 'expense',
        movementKind: ['purchase','fee','tax','bill','loan','cash','investment','card_settlement','transfer','paypal_repayment','refund','other'].includes(String(expense.movementKind)) ? expense.movementKind : (expense.flow === 'refund' ? 'refund' : 'purchase'),
        includeInStats: expense.includeInStats !== false,
        evidenceRefs: Array.from(new Set((expense.evidenceRefs || []).map(value => String(value || '').trim()).filter(Boolean))).slice(0, 20),
        createdAt: expense.createdAt || now,
        createdByUserId: expense.createdByUserId || authUser.id,
        notes: expense.notes?.trim().slice(0, 2000) || undefined,
        items: Array.isArray(expense.items) ? expense.items.map(item => ({
          id: String(item.id || crypto.randomUUID()),
          name: String(item.name || 'Articolo').trim().slice(0, 200) || 'Articolo',
          qty: Math.max(0, Number(item.qty) || 0),
          unit: String(item.unit || 'pz').slice(0, 20),
          unitPrice: Number.isFinite(Number(item.unitPrice)) ? Math.max(0, Number(item.unitPrice)) : undefined,
          totalPrice: Number.isFinite(Number(item.totalPrice)) ? Math.max(0, Number(item.totalPrice)) : undefined,
          category: item.category ? String(item.category).slice(0, 100) : undefined
        })) : []
      }
      cleanRows.push(row)
      if (sourceRef) seenRefs.add(sourceRef)
    }

    if (cleanRows.length) setData(prev => ({ ...prev, expenses: [...cleanRows, ...prev.expenses] }))
    return { imported: cleanRows.length, duplicates }
  }

  function cleanPurchaseEvidence(input: Omit<PurchaseEvidence, 'id' | 'importedAt'> & { id?: string; importedAt?: string }, existing?: PurchaseEvidence): PurchaseEvidence | null {
    const total = Math.max(0, Number(input.total) || 0)
    const externalId = String(input.externalId || '').trim().slice(0, 120)
    if (!externalId || total <= 0) return null
    return {
      id: input.id || existing?.id || crypto.randomUUID(),
      source: 'amazon_email',
      externalId,
      merchant: String(input.merchant || 'Amazon.it').trim().slice(0, 160) || 'Amazon.it',
      orderDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.orderDate || '')) ? String(input.orderDate) : localDateISO(),
      total,
      items: Array.isArray(input.items) ? input.items.map(item => ({
        id: String(item.id || crypto.randomUUID()),
        name: String(item.name || 'Articolo').trim().slice(0, 260) || 'Articolo',
        qty: Math.max(0, Number(item.qty) || 0),
        unitPrice: Number.isFinite(Number(item.unitPrice)) ? Math.max(0, Number(item.unitPrice)) : undefined,
        totalPrice: Number.isFinite(Number(item.totalPrice)) ? Math.max(0, Number(item.totalPrice)) : undefined,
        category: isExpenseCategory(item.category) ? item.category : undefined,
        subcategory: isExpenseCategory(item.category) && isExpenseSubcategory(item.subcategory) && subcategoryBelongsToCategory(item.subcategory, item.category) ? item.subcategory : undefined
      })).filter(item => item.qty > 0) : [],
      status: input.status === 'matched' || input.status === 'review' ? input.status : 'unmatched',
      matchedExpenseId: input.matchedExpenseId ? String(input.matchedExpenseId) : undefined,
      matchConfidence: Number.isFinite(Number(input.matchConfidence)) ? Math.max(0, Math.min(1, Number(input.matchConfidence))) : undefined,
      importedAt: existing?.importedAt || input.importedAt || new Date().toISOString(),
      notes: input.notes?.trim().slice(0, 1200) || undefined
    }
  }

  function upsertPurchaseEvidence(evidence: Omit<PurchaseEvidence, 'id' | 'importedAt'> & { id?: string; importedAt?: string }) {
    if (!authUser || authUser.role === 'bimbo') return ''
    const existing = dataRef.current.purchaseEvidence.find(item => item.id === evidence.id || (item.source === 'amazon_email' && item.externalId === evidence.externalId))
    const clean = cleanPurchaseEvidence(evidence, existing)
    if (!clean) return ''
    setData(prev => ({
      ...prev,
      purchaseEvidence: existing
        ? prev.purchaseEvidence.map(item => item.id === existing.id ? clean : item)
        : [clean, ...prev.purchaseEvidence]
    }))
    return clean.id
  }

  function importPurchaseEvidence(rows: Array<Omit<PurchaseEvidence, 'id' | 'importedAt'> & { id?: string; importedAt?: string }>) {
    if (!authUser || authUser.role === 'bimbo') return { imported: 0, duplicates: rows.length }
    const existingKeys = new Set(dataRef.current.purchaseEvidence.map(item => item.source + ':' + item.externalId))
    const seen = new Set(existingKeys)
    const cleanRows: PurchaseEvidence[] = []
    let duplicates = 0
    for (const row of rows) {
      const key = 'amazon_email:' + String(row.externalId || '').trim()
      if (seen.has(key)) {
        duplicates += 1
        continue
      }
      const clean = cleanPurchaseEvidence(row)
      if (!clean) continue
      cleanRows.push(clean)
      seen.add(key)
    }
    if (cleanRows.length) setData(prev => ({ ...prev, purchaseEvidence: [...cleanRows, ...prev.purchaseEvidence] }))
    return { imported: cleanRows.length, duplicates }
  }

  function evidenceDaysBetween(left: string, right: string) {
    const a = new Date(left + 'T12:00:00').getTime()
    const b = new Date(right + 'T12:00:00').getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 999
    return Math.abs(Math.round((a - b) / 86400000))
  }

  function dominantEvidenceCategory(items: PurchaseEvidence['items']) {
    const totals = new Map<string, number>()
    for (const item of items) {
      if (!item.category) continue
      const amount = Number(item.totalPrice ?? ((item.unitPrice || 0) * Math.max(1, Number(item.qty || 1))))
      totals.set(item.category, (totals.get(item.category) || 0) + Math.max(0, amount))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as ExpenseRecord['category'] | undefined
  }

  function dominantEvidenceSubcategory(items: PurchaseEvidence['items']) {
    const totals = new Map<string, number>()
    for (const item of items) {
      if (!item.subcategory) continue
      const amount = Number(item.totalPrice ?? ((item.unitPrice || 0) * Math.max(1, Number(item.qty || 1))))
      totals.set(item.subcategory, (totals.get(item.subcategory) || 0) + Math.max(0, amount))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as ExpenseRecord['subcategory'] | undefined
  }

  function reconcilePurchaseEvidence() {
    if (!authUser || authUser.role === 'bimbo') return { matched: 0, review: 0 }
    let matched = 0
    let review = 0
    setData(prev => {
      let expenses = prev.expenses.map(item => ({ ...item, evidenceRefs: Array.isArray(item.evidenceRefs) ? [...item.evidenceRefs] : [] }))
      const evidence = prev.purchaseEvidence.map(item => {
        if (item.status === 'matched' && item.matchedExpenseId && expenses.some(expense => expense.id === item.matchedExpenseId)) return item

        const candidates = expenses
          .filter(expense => (expense.flow || 'expense') === 'expense')
          .map(expense => {
            const amountDiff = Math.abs(Number(expense.total || 0) - Number(item.total || 0))
            const days = evidenceDaysBetween(expense.date, item.orderDate)
            const merchant = normalize(expense.merchant)
            const amazonMerchant = /amazon/.test(merchant)
            const exactAmount = amountDiff <= .02
            let score = 0
            if (exactAmount) score += 70
            else if (amountDiff <= Math.max(.5, item.total * .02)) score += 30
            if (days === 0) score += 20
            else if (days <= 2) score += 14
            else if (days <= 5) score += 8
            else if (days <= 8) score += 3
            if (amazonMerchant) score += 20
            return { expense, score, exactAmount, days, amazonMerchant }
          })
          .filter(candidate => candidate.score >= 70)
          .sort((a, b) => b.score - a.score)

        const best = candidates[0]
        if (!best) return { ...item, status: 'unmatched' as const, matchedExpenseId: undefined, matchConfidence: undefined }

        const autoMatch = best.exactAmount && best.days <= 8 && best.amazonMerchant
        if (!autoMatch) {
          review += 1
          return {
            ...item,
            status: 'review' as const,
            matchedExpenseId: best.expense.id,
            matchConfidence: Math.min(.89, best.score / 110)
          }
        }

        const category = dominantEvidenceCategory(item.items)
        const subcategory = dominantEvidenceSubcategory(item.items)
        expenses = expenses.map(expense => expense.id === best.expense.id ? {
          ...expense,
          merchant: /amazon/i.test(expense.merchant) ? expense.merchant : 'Amazon.it',
          category: category || expense.category,
          subcategory: subcategory || (category && category !== expense.category ? undefined : expense.subcategory),
          evidenceRefs: Array.from(new Set([...(expense.evidenceRefs || []), item.id])),
          items: item.items.map(row => ({
            id: row.id,
            name: row.name,
            qty: row.qty,
            unit: 'pz',
            unitPrice: row.unitPrice,
            totalPrice: row.totalPrice,
            category: row.category,
            subcategory: row.subcategory
          })),
          notes: [expense.notes, 'Dettaglio Amazon ordine ' + item.externalId].filter(Boolean).join(' · ').slice(0, 2000)
        } : expense)
        matched += 1
        return {
          ...item,
          status: 'matched' as const,
          matchedExpenseId: best.expense.id,
          matchConfidence: 1
        }
      })
      return { ...prev, expenses, purchaseEvidence: evidence }
    })
    return { matched, review }
  }

  function requestAmazonMailSync() {
    if (!authUser || authUser.role === 'bimbo') return { ok: false, error: 'Solo un adulto può richiedere il controllo della casella Amazon.' }
    const now = new Date().toISOString()
    const current = dataRef.current.amazonMailSync
    if (current?.status === 'pending' && current.lastRequestedAt) {
      const age = Date.now() - new Date(current.lastRequestedAt).getTime()
      if (Number.isFinite(age) && age >= 0 && age < 5 * 60 * 1000) {
        return { ok: true }
      }
    }
    setData(prev => ({
      ...prev,
      amazonMailSync: {
        ...(prev.amazonMailSync || { enabled: true, status: 'idle' }),
        enabled: true,
        status: 'pending',
        lastRequestedAt: now,
        requestedByUserId: authUser.id,
        lastError: undefined
      }
    }))
    return { ok: true }
  }

  function upsertRecurringExpense(expense: Omit<RecurringExpense, 'id' | 'createdAt' | 'createdByUserId'> & { id?: string; createdAt?: string; createdByUserId?: number }) {
    if (!authUser || authUser.role === 'bimbo') return ''
    const id = expense.id || crypto.randomUUID()
    const now = new Date().toISOString()
    const clean: RecurringExpense = {
      id,
      merchant: String(expense.merchant || 'Spesa ricorrente').trim().slice(0, 160) || 'Spesa ricorrente',
      amount: Math.max(0, Number(expense.amount) || 0),
      category: isExpenseCategory(expense.category) ? expense.category : 'other',
      subcategory: isExpenseCategory(expense.category) && isExpenseSubcategory(expense.subcategory) && subcategoryBelongsToCategory(expense.subcategory, expense.category) ? expense.subcategory : undefined,
      frequency: ['weekly','monthly','yearly'].includes(String(expense.frequency)) ? expense.frequency : 'monthly',
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(expense.startDate || '')) ? expense.startDate : localDateISO(),
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(expense.endDate || '')) ? expense.endDate : undefined,
      active: expense.active !== false,
      notes: expense.notes?.trim().slice(0, 1000) || undefined,
      createdAt: expense.createdAt || now,
      createdByUserId: expense.createdByUserId || authUser.id
    }
    if (clean.amount <= 0) return ''
    setData(prev => ({
      ...prev,
      recurringExpenses: prev.recurringExpenses.some(item => item.id === id)
        ? prev.recurringExpenses.map(item => item.id === id ? { ...clean, createdAt: item.createdAt, createdByUserId: item.createdByUserId } : item)
        : [clean, ...prev.recurringExpenses]
    }))
    return id
  }

  async function deleteRecurringExpense(id: string) {
    if (!authUser || authUser.role === 'bimbo') return
    const item = data.recurringExpenses.find(rule => rule.id === id)
    if (!item) return
    if (!confirmDeletion('la spesa ricorrente “' + item.merchant + '”', 'Le spese già generate restano nel Report.')) return
    if (!await archiveDeletedItem('reports', 'Ricorrenza · ' + item.merchant, { kind: 'recurringExpense', item })) return
    setData(prev => ({ ...prev, recurringExpenses: prev.recurringExpenses.filter(rule => rule.id !== id) }))
  }

  function materializeRecurringExpenses(referenceDate = localDateISO()) {
    if (!authUser || authUser.role === 'bimbo') return 0
    const current = dataRef.current
    const existingRefs = new Set(current.expenses.map(item => item.sourceRef).filter(Boolean))
    const generated: ExpenseRecord[] = []
    const now = new Date().toISOString()

    for (const rule of current.recurringExpenses || []) {
      if (!rule.active || rule.amount <= 0) continue
      for (const date of recurringExpenseDates(rule, referenceDate)) {
        const sourceRef = `recurring:${rule.id}:${date}`
        if (existingRefs.has(sourceRef)) continue
        existingRefs.add(sourceRef)
        generated.push({
          id: crypto.randomUUID(),
          date,
          merchant: rule.merchant,
          total: rule.amount,
          category: rule.category,
          subcategory: rule.subcategory,
          source: 'recurring',
          sourceRef,
          flow: 'expense',
          movementKind: 'bill',
          includeInStats: true,
          createdAt: now,
          createdByUserId: authUser.id,
          notes: rule.notes || undefined,
          items: []
        })
      }
    }

    if (generated.length) setData(prev => ({ ...prev, expenses: [...generated, ...prev.expenses] }))
    return generated.length
  }

  function addBoardAttachment(postId: string, attachment: BoardAttachment) {
    if (!authUser) return
    setData(prev => {
      const post = prev.boardPosts.find(item => item.id === postId)
      if (!post) return prev
      if (authUser.role === 'bimbo' && post.authorUserId !== authUser.id) return prev
      return {
        ...prev,
        boardPosts: prev.boardPosts.map(item => item.id === postId
          ? { ...item, type: item.type === 'note' && !item.body && !item.title ? 'photo' : item.type, attachments: [...item.attachments, attachment], updatedAt: new Date().toISOString() }
          : item)
      }
    })
  }

  function removeBoardAttachment(postId: string, attachmentId: string) {
    if (!authUser) return
    setData(prev => {
      const post = prev.boardPosts.find(item => item.id === postId)
      if (!post) return prev
      if (authUser.role === 'bimbo' && post.authorUserId !== authUser.id) return prev
      return {
        ...prev,
        boardPosts: prev.boardPosts.map(item => item.id === postId
          ? { ...item, attachments: item.attachments.filter(attachment => attachment.id !== attachmentId), updatedAt: new Date().toISOString() }
          : item)
      }
    })
  }

  function applyRecyclePayload(base: FamilyData, payload: any): { next: FamilyData; applied: boolean } {
    const kind = String(payload?.kind || '')
    const item = payload?.item
    let next = deepClone(base)

    const addUnique = (list: any[], value: any) => {
      if (!value || value.id === undefined || list.some(existing => String(existing.id) === String(value.id))) return { list, added: false }
      return { list: [...list, value], added: true }
    }

    if (kind === 'user') {
      const result = addUnique(next.users, item)
      return { next: { ...next, users: result.list }, applied: result.added }
    }
    if (kind === 'calendarEvent') {
      const result = addUnique(next.calendarEvents, item)
      return { next: { ...next, calendarEvents: result.list }, applied: result.added }
    }
    if (kind === 'deadline') {
      const result = addUnique(next.deadlines, item)
      return { next: { ...next, deadlines: result.list }, applied: result.added }
    }
    if (kind === 'pantryItem') {
      const result = addUnique(next.pantry, item)
      if (!result.added) return { next, applied: false }
      let movements = [...next.pantryMovements]
      for (const movementItem of Array.isArray(payload?.movements) ? payload.movements : []) {
        if (!movements.some(existing => String(existing.id) === String(movementItem.id))) movements.push(movementItem)
      }
      return { next: { ...next, pantry: result.list, pantryMovements: movements }, applied: true }
    }
    if (kind === 'shoppingItem') {
      const result = addUnique(next.shopping, item)
      return { next: { ...next, shopping: result.list }, applied: result.added }
    }
    if (kind === 'dish') {
      const result = addUnique(next.dishes, item)
      if (!result.added) return { next, applied: false }
      let plans = [...next.mealPlans]
      for (const plan of Array.isArray(payload?.mealPlans) ? payload.mealPlans : []) {
        if (!plans.some(existing => String(existing.id) === String(plan.id))) plans.push(plan)
      }
      return { next: { ...next, dishes: result.list, mealPlans: plans }, applied: true }
    }
    if (kind === 'mealPlan') {
      if (!item || next.mealPlans.some(plan => String(plan.id) === String(item.id))) return { next, applied: false }
      if (!next.dishes.some(dish => Number(dish.id) === Number(item.dishId))) return { next, applied: false }
      const consumed = adjustIngredients(next, Number(item.dishId), -1)
      return {
        next: { ...next, pantry: consumed.pantry, pantryMovements: consumed.pantryMovements, mealPlans: [...next.mealPlans, item] },
        applied: true
      }
    }
    if (kind === 'chore') {
      const result = addUnique(next.chores, item)
      return { next: { ...next, chores: result.list }, applied: result.added }
    }
    if (kind === 'recurringChore') {
      const result = addUnique(next.recurringChores, item)
      return { next: { ...next, recurringChores: result.list }, applied: result.added }
    }
    if (kind === 'todo') {
      const result = addUnique(next.todos, item)
      return { next: { ...next, todos: result.list }, applied: result.added }
    }
    if (kind === 'routine') {
      const result = addUnique(next.routines, item)
      if (!result.added) return { next, applied: false }
      let completions = [...next.routineCompletions]
      for (const completion of Array.isArray(payload?.completions) ? payload.completions : []) {
        if (!completions.some(existing => String(existing.id) === String(completion.id))) completions.push(completion)
      }
      return { next: { ...next, routines: result.list, routineCompletions: completions }, applied: true }
    }
    if (kind === 'schoolSubject') {
      const result = addUnique(next.schoolSubjects, item)
      if (!result.added) return { next, applied: false }
      let timetable = [...next.schoolTimetable]
      for (const entry of Array.isArray(payload?.timetable) ? payload.timetable : []) {
        if (!timetable.some(existing => String(existing.id) === String(entry.id))) timetable.push(entry)
      }
      const affectedIds = new Set((Array.isArray(payload?.affectedItems) ? payload.affectedItems : []).map((entry: any) => String(entry.id)))
      const schoolItems = next.schoolItems.map(existing =>
        affectedIds.has(String(existing.id)) ? { ...existing, subjectId: Number(item.id) } : existing
      )
      return { next: { ...next, schoolSubjects: result.list, schoolTimetable: timetable, schoolItems }, applied: true }
    }
    if (kind === 'schoolTimetable') {
      const result = addUnique(next.schoolTimetable, item)
      return { next: { ...next, schoolTimetable: result.list }, applied: result.added }
    }
    if (kind === 'schoolItem') {
      const result = addUnique(next.schoolItems, item)
      return { next: { ...next, schoolItems: result.list }, applied: result.added }
    }
    if (kind === 'boardPost') {
      const result = addUnique(next.boardPosts, item)
      return { next: { ...next, boardPosts: result.list }, applied: result.added }
    }
    if (kind === 'expense') {
      const result = addUnique(next.expenses, item)
      return { next: { ...next, expenses: result.list }, applied: result.added }
    }
    if (kind === 'recurringExpense') {
      const result = addUnique(next.recurringExpenses, item)
      return { next: { ...next, recurringExpenses: result.list }, applied: result.added }
    }
    if (kind === 'category') {
      const category = String(item || '').trim()
      if (!category || next.categories.some(existing => normalize(existing) === normalize(category))) return { next, applied: false }
      const affectedIds = new Set((Array.isArray(payload?.affectedPantry) ? payload.affectedPantry : []).map((entry: any) => String(entry.id)))
      return {
        next: {
          ...next,
          categories: [...next.categories, category],
          pantry: next.pantry.map(entry => affectedIds.has(String(entry.id)) ? { ...entry, category } : entry)
        },
        applied: true
      }
    }
    return { next, applied: false }
  }

  async function restoreRecycleItem(id: string, payload: any) {
    if (!authUser || authUser.role === 'bimbo') return false
    if (syncInFlightRef.current) {
      window.alert('È in corso una sincronizzazione. Attendi qualche secondo e riprova.')
      return false
    }
    const { next, applied } = applyRecyclePayload(dataRef.current, payload)
    if (!applied) {
      window.alert('Non posso ripristinare automaticamente questo elemento perché esiste già un elemento con lo stesso identificativo o manca un dato collegato.')
      return false
    }

    suppressNextPushRef.current = true
    setData(next)

    if (supabase && familyIdRef.current && cloudUserId) {
      const ok = await pushDocument(next)
      if (!ok) {
        await refreshChildSnapshot(familyIdRef.current)
        return false
      }
      const { error } = await supabase.rpc('mark_family_recycle_restored', { p_id: id })
      if (error) {
        console.error('mark recycle restored', error)
        window.alert('Il dato è stato ripristinato, ma non sono riuscito ad aggiornare il Cestino. Potrebbe comparire ancora nell’elenco.')
      }
    }
    return true
  }

  async function recoverConflictDraft(id: string, snapshot: any) {
    if (!authUser || authUser.role === 'bimbo' || !supabase || !familyIdRef.current || !cloudUserId) return false
    if (syncInFlightRef.current) {
      window.alert('È in corso una sincronizzazione. Attendi qualche secondo e riprova.')
      return false
    }

    const { error: backupError } = await supabase.rpc('create_family_backup', {
      p_family_id: familyIdRef.current,
      p_reason: 'before_conflict_recovery'
    })
    if (backupError) {
      console.error('pre conflict recovery backup', backupError)
      window.alert('Non riesco a creare il backup di sicurezza. La bozza non è stata applicata.')
      return false
    }

    const next = migrateData(snapshot, deepClone(initialData))
    suppressNextPushRef.current = true
    setData(next)
    const ok = await pushDocument(next)
    if (!ok) {
      await refreshChildSnapshot(familyIdRef.current)
      return false
    }

    const { error } = await supabase.rpc('mark_family_conflict_resolved', { p_id: id })
    if (error) console.error('mark conflict resolved', error)
    return true
  }

  function exportData() { return JSON.stringify(data, null, 2) }
  function importData(raw: string) {
    try {
      setData(migrateData(JSON.parse(raw), deepClone(initialData)))
      return true
    } catch {
      return false
    }
  }

  async function resetData() {
    if (!confirmDeletion('tutti i dati locali e ripristinare i dati demo', 'Questa operazione sostituisce completamente i dati presenti sul dispositivo.')) return
    if (supabase && familyIdRef.current && cloudUserId) {
      const { error } = await supabase.rpc('create_family_backup', {
        p_family_id: familyIdRef.current,
        p_reason: 'before_reset_to_demo'
      })
      if (error) {
        window.alert('Non riesco a creare il backup di sicurezza. Per sicurezza il ripristino ai dati demo è stato annullato.')
        return
      }
    }
    setData(deepClone(initialData))
    setSessionUserId(null)
    setActivePage('home')
  }

  const value: StoreValue = {
    data, authUser, activePage, setActivePage,
    login, signUp, logout,
    cloudEnabled: isSupabaseConfigured,
    cloudAuthenticated: Boolean(cloudUserId),
    cloudLoading, cloudStatus, cloudEmail, familyId, familyName, needsFamilySetup,
    createCloudFamily, joinCloudFamily, createFamilyInvite, syncNow,
    updateCurrentPrefs, updateCurrentProfile, setAssistantName,
    addUser, updateUser, deleteUser,
    approveApprovalRequest, rejectApprovalRequest,
    upsertCalendarEvent, deleteCalendarEvent,
    upsertDeadline, toggleDeadline, deleteDeadline,
    addCategory, renameCategory, deleteCategory,
    upsertPantryItem, deletePantryItem, changePantryQty, reconcilePantryItems,
    addShoppingItem, toggleShoppingItem, deleteShoppingItem, moveTakenShoppingToPantry, importReceiptItems,
    upsertDish, deleteDish, upsertMealPlan, deleteMealPlan,
    addChore, toggleChore, approveChore, rejectChore, deleteChore, upsertRecurringChore, toggleRecurringChore, deleteRecurringChore, payUser, undoTransaction,
    addTodo, toggleTodo, deleteTodo,
    upsertRoutine, toggleRoutineActive, deleteRoutine, completeRoutine, undoRoutineCompletion,
    upsertSchoolSubject, deleteSchoolSubject, upsertSchoolTimetableEntry, deleteSchoolTimetableEntry, upsertSchoolItem, toggleSchoolItem, deleteSchoolItem,
    upsertBoardPost, toggleBoardPin, deleteBoardPost, addBoardAttachment, removeBoardAttachment,
    upsertExpense, importExpenses, deleteExpense,
    upsertPurchaseEvidence, importPurchaseEvidence, reconcilePurchaseEvidence, requestAmazonMailSync,
    upsertRecurringExpense, deleteRecurringExpense, materializeRecurringExpenses,
    restoreRecycleItem, recoverConflictDraft,
    exportData, importData, resetData
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useFamily() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useFamily must be used inside FamilyProvider')
  return ctx
}
