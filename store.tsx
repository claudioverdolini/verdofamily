import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BoardAttachment,
  BoardPost,
  CalendarEvent,
  Chore,
  Deadline,
  Dish,
  FamilyData,
  FamilyUser,
  MealPlan,
  PageKey,
  RecurringChore,
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
import { isSupabaseConfigured, supabase } from './supabaseClient'

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
  moveTakenShoppingToPantry: (location?: PantryLocation) => void
  importReceiptItems: (items: Array<{ name: string; qty: number; unit: string; category: string; location?: PantryLocation; expiryDate?: string }>, removeFromShopping: boolean, defaultLocation?: PantryLocation) => void
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
  exportData: () => string
  importData: (raw: string) => boolean
  resetData: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
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
    users: value.users.map(user => ({ ...user, password: '' })),
    deadlines: value.deadlines.filter(item => !isHealthDeadline(item))
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
  const [activePage, setActivePage] = useState<PageKey>(() => new URLSearchParams(window.location.search).has('googleCalendar') ? 'settings' : 'home')

  const revisionRef = useRef(0)
  const familyIdRef = useRef<string | null>(null)
  const suppressNextPushRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const realtimeChannelRef = useRef<any>(null)
  const childSyncTimerRef = useRef<number | null>(null)
  const currentCloudUserRef = useRef<any>(null)
  const calendarSyncHashRef = useRef('')
  const healthSyncHashRef = useRef('')

  familyIdRef.current = familyId

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
    const ensureToday = () => setData(prev => materializeRecurringChores(prev, localDateISO()))
    ensureToday()
    const timer = window.setInterval(ensureToday, 60_000)
    return () => window.clearInterval(timer)
  }, [data.recurringChores])

  useEffect(() => {
    if (sessionUserId) sessionStorage.setItem(SESSION_KEY, String(sessionUserId))
    else sessionStorage.removeItem(SESSION_KEY)
  }, [sessionUserId])

  const authUser = useMemo(() => {
    if (cloudUserId) return data.users.find(u => u.cloudUserId === cloudUserId) || null
    return data.users.find(u => u.id === sessionUserId) || null
  }, [data.users, sessionUserId, cloudUserId])

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

  async function readFamilyDocument(targetFamilyId: string, profile: any, role: string) {
    if (!supabase) return
    const [result, healthResult] = await Promise.all([
      callFamilyGateway('read', targetFamilyId),
      callHealthGateway('read', targetFamilyId).catch(error => {
        console.warn('health-data-gateway read fallback', error)
        return null
      })
    ])
    const raw = result?.data && Object.keys(result.data).length ? result.data : deepClone(initialData)
    let migrated = migrateData(raw, deepClone(initialData))
    if (healthResult?.items) {
      migrated = mergeHealthDeadlines(migrated, healthResult.items)
      healthSyncHashRef.current = JSON.stringify(healthResult.items)
    }
    const linked = linkCloudIdentity(migrated, profile, result?.role || role)
    calendarSyncHashRef.current = JSON.stringify(linked.calendarEvents || [])
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
    if (!supabase) return
    try {
      const result = await callFamilyGateway('read', targetFamilyId)
      if (!result?.ok || Number(result.revision || 0) <= revisionRef.current) return
      const user = currentCloudUserRef.current
      const profile = user ? await fetchProfile(user.id) : null
      let remote = migrateData(result.data, deepClone(initialData))
      const healthResult = await callHealthGateway('read', targetFamilyId).catch(() => null)
      if (healthResult?.items) {
        remote = mergeHealthDeadlines(remote, healthResult.items)
        healthSyncHashRef.current = JSON.stringify(healthResult.items)
      }
      const linked = user
        ? linkCloudIdentity(remote, profile || { id: user.id, display_name: user.email?.split('@')[0] }, result.role || 'child')
        : remote
      revisionRef.current = Number(result.revision || 0)
      suppressNextPushRef.current = true
      setData(linked)
      setCloudStatus('synced')
    } catch (error) {
      console.warn('refreshChildSnapshot', error)
    }
  }

  function startRealtime(targetFamilyId: string, role = 'adult') {
    if (!supabase) return
    stopRealtime()
    if (role === 'child') {
      childSyncTimerRef.current = window.setInterval(() => void refreshChildSnapshot(targetFamilyId), 15_000)
      return
    }
    realtimeChannelRef.current = supabase
      .channel(`family-document-${targetFamilyId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'family_documents', filter: `family_id=eq.${targetFamilyId}` }, async (payload: any) => {
        const row = payload?.new
        if (!row || Number(row.revision || 0) <= revisionRef.current) return
        revisionRef.current = Number(row.revision || 0)
        const user = currentCloudUserRef.current
        const profile = user ? await fetchProfile(user.id) : null
        const { data: membership } = user ? await supabase.from('family_members').select('role').eq('family_id', targetFamilyId).eq('user_id', user.id).maybeSingle() : { data: null }
        let remote = migrateData(row.data, deepClone(initialData))
        const healthResult = await callHealthGateway('read', targetFamilyId).catch(() => null)
        if (healthResult?.items) {
          remote = mergeHealthDeadlines(remote, healthResult.items)
          healthSyncHashRef.current = JSON.stringify(healthResult.items)
        }
        const linked = user ? linkCloudIdentity(remote, profile || { id: user.id, display_name: user.email?.split('@')[0] }, membership?.role || 'adult') : remote
        suppressNextPushRef.current = true
        setData(linked)
        setCloudStatus('synced')
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

  async function pushDocument(snapshot: FamilyData) {
    if (!supabase || !familyIdRef.current || !cloudUserId) return
    setCloudStatus('saving')
    const expected = revisionRef.current
    try {
      if (authUser?.role !== 'bimbo') {
        const healthItems = snapshot.deadlines.filter(item => isHealthDeadline(item))
        const healthHash = JSON.stringify(healthItems)
        if (healthHash !== healthSyncHashRef.current) {
          const healthResult = await callHealthGateway('sync', familyIdRef.current, { data: snapshot })
          healthSyncHashRef.current = JSON.stringify(healthResult?.items || healthItems)
        }
      }

      const result = await callFamilyGateway('save', familyIdRef.current, {
        data: cloudSafeData(snapshot),
        expectedRevision: expected
      })

      if (result?.ok) {
        revisionRef.current = Number(result.revision || expected + 1)
        if (result.normalized && result.data) {
          suppressNextPushRef.current = true
          const familyOnly = migrateData(result.data, deepClone(initialData))
          setData(mergeHealthDeadlines(familyOnly, snapshot.deadlines.filter(item => isHealthDeadline(item))))
        }
        setCloudStatus('synced')
        const calendarHash = JSON.stringify(snapshot.calendarEvents || [])
        if (calendarHash !== calendarSyncHashRef.current) {
          calendarSyncHashRef.current = calendarHash
          void supabase.functions.invoke('google-calendar-sync', { body: { action: 'sync-all', familyId: familyIdRef.current } }).then(({ error }) => {
            if (error) console.warn('Google Calendar sync deferred:', error.message)
          })
        }
        return
      }

      if (result?.error === 'revision_conflict') {
        setCloudStatus('conflict')
        revisionRef.current = Number(result.revision || expected)
        if (result.data) {
          suppressNextPushRef.current = true
          let remote = migrateData(result.data, deepClone(initialData))
          const healthResult = await callHealthGateway('read', familyIdRef.current).catch(() => null)
          if (healthResult?.items) {
            remote = mergeHealthDeadlines(remote, healthResult.items)
            healthSyncHashRef.current = JSON.stringify(healthResult.items)
          }
          setData(remote)
        }
        return
      }

      throw new Error(result?.error || 'Salvataggio non autorizzato.')
    } catch (error) {
      console.error('family-document-gateway save', error)
      setCloudStatus('error')
    }
  }

  useEffect(() => {
    if (!supabase || !cloudUserId || !familyId || cloudLoading) return
    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false
      return
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => pushDocument(data), 650)
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

  function updateCurrentPrefs(patch: Partial<UserPrefs>) {
    if (!authUser) return
    setData(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === authUser.id ? { ...u, prefs: mergePrefs({ ...u.prefs, ...patch, notifications: { ...u.prefs.notifications, ...(patch.notifications || {}) } }) } : u)
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
    setData(prev => {
      if (!event.id) return { ...prev, calendarEvents: [...prev.calendarEvents, { ...event, id: nextId(prev.calendarEvents) }] }
      const exists = prev.calendarEvents.some(e => e.id === event.id)
      return { ...prev, calendarEvents: exists ? prev.calendarEvents.map(e => e.id === event.id ? { ...e, ...event, id: e.id } : e) : [...prev.calendarEvents, { ...event, id: event.id }] }
    })
  }
  function deleteCalendarEvent(id: number) { setData(prev => ({ ...prev, calendarEvents: prev.calendarEvents.filter(e => e.id !== id) })) }

  function upsertDeadline(deadline: Omit<Deadline, 'id' | 'done'> & { id?: number; done?: boolean }) {
    if (authUser?.role === 'bimbo' && isHealthDeadline(deadline)) return
    setData(prev => ({ ...prev, deadlines: deadline.id ? prev.deadlines.map(d => d.id === deadline.id ? { ...d, ...deadline, id: d.id, done: !!deadline.done } : d) : [...prev.deadlines, { ...deadline, id: nextId(prev.deadlines), done: !!deadline.done }] }))
  }
  function toggleDeadline(id: number) {
    if (authUser?.role === 'bimbo' && isHealthDeadline(data.deadlines.find(item => item.id === id) || {})) return
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
  function deleteDeadline(id: number) {
    if (authUser?.role === 'bimbo' && isHealthDeadline(data.deadlines.find(item => item.id === id) || {})) return
    setData(prev => ({ ...prev, deadlines: prev.deadlines.filter(d => d.id !== id) }))
  }

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
    setData(prev => {
      if (item.id) {
        const old = prev.pantry.find(p => p.id === item.id)
        if (!old) return prev
        const clean = {
          ...old,
          ...item,
          id: old.id,
          qty: Math.max(0, Number(item.qty || 0)),
          minQty: Math.max(0, Number(item.minQty || 0)),
          location: item.location || 'pantry' as PantryLocation,
          expiryDate: item.expiryDate || undefined,
          autoRestock: item.autoRestock !== false
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
        qty: Math.max(0, Number(item.qty || 0)),
        minQty: Math.max(0, Number(item.minQty || 0)),
        location: item.location || 'pantry',
        expiryDate: item.expiryDate || undefined,
        autoRestock: item.autoRestock !== false
      }
      return {
        ...prev,
        pantry: [...prev.pantry, clean],
        pantryMovements: movement(prev.pantryMovements, id, Number(clean.qty || 0), 'adjustment')
      }
    })
  }

  function deletePantryItem(id: number) {
    setData(prev => ({
      ...prev,
      pantry: prev.pantry.filter(p => p.id !== id),
      pantryMovements: prev.pantryMovements.filter(m => m.pantryItemId !== id)
    }))
  }

  function changePantryQty(id: number, delta: number) {
    setData(prev => {
      const target = prev.pantry.find(p => p.id === id)
      if (!target) return prev
      const current = Number(target.qty || 0)
      const nextQty = Math.max(0, current + Number(delta || 0))
      const actualDelta = nextQty - current
      if (!actualDelta) return prev
      return {
        ...prev,
        pantry: prev.pantry.map(p => p.id === id ? { ...p, qty: nextQty } : p),
        pantryMovements: movement(prev.pantryMovements, id, actualDelta, 'manual')
      }
    })
  }

  function addShoppingItem(item: Omit<ShoppingItem, 'id' | 'taken'>) { setData(prev => ({ ...prev, shopping: [...prev.shopping, { ...item, id: nextId(prev.shopping), taken: false }] })) }
  function toggleShoppingItem(id: number) { setData(prev => ({ ...prev, shopping: prev.shopping.map(s => s.id === id ? { ...s, taken: !s.taken } : s) })) }
  function deleteShoppingItem(id: number) { setData(prev => ({ ...prev, shopping: prev.shopping.filter(s => s.id !== id) })) }

  function mergeIntoPantry(
    pantry: PantryItem[],
    movements: PantryMovement[],
    items: Array<{ name: string; qty: number; unit: string; category?: string; location?: PantryLocation; expiryDate?: string }>,
    reason: PantryMovement['reason'],
    defaultLocation: PantryLocation = 'pantry'
  ) {
    const next = [...pantry]
    let nextMovements = [...movements]
    for (const item of items) {
      const location = item.location || defaultLocation
      const expiryDate = item.expiryDate || undefined
      const idx = next.findIndex(p =>
        normalize(p.name) === normalize(item.name) &&
        normalize(p.unit) === normalize(item.unit) &&
        (p.location || 'pantry') === location &&
        (p.expiryDate || '') === (expiryDate || '')
      )
      const qty = Math.max(0, Number(item.qty || 0))
      if (idx >= 0) {
        const current = next[idx]
        next[idx] = { ...current, qty: Number(current.qty || 0) + qty }
        nextMovements = movement(nextMovements, current.id, qty, reason)
      } else {
        const id = nextId(next)
        next.push({
          id,
          name: item.name.trim(),
          qty,
          unit: item.unit || 'pz',
          category: item.category || 'Generico',
          minQty: 0,
          location,
          expiryDate,
          autoRestock: true
        })
        nextMovements = movement(nextMovements, id, qty, reason)
      }
    }
    return { pantry: next, pantryMovements: nextMovements }
  }

  function moveTakenShoppingToPantry(location: PantryLocation = 'pantry') {
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
    items: Array<{ name: string; qty: number; unit: string; category: string; location?: PantryLocation; expiryDate?: string }>,
    removeFromShopping: boolean,
    defaultLocation: PantryLocation = 'pantry'
  ) {
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
  function deleteDish(id: number) { setData(prev => ({ ...prev, dishes: prev.dishes.filter(d => d.id !== id), mealPlans: prev.mealPlans.filter(p => p.dishId !== id) })) }

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

  function deleteMealPlan(id: number) {
    setData(prev => {
      const plan = prev.mealPlans.find(p => p.id === id)
      const restored = plan ? adjustIngredients(prev, plan.dishId, +1) : { pantry: prev.pantry, pantryMovements: prev.pantryMovements }
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
      const clean: RecurringChore = {
        id: chore.id || nextId(prev.recurringChores),
        title: chore.title.trim(),
        userId: Number(chore.userId),
        amount: Math.max(0, Number(chore.amount) || 0),
        weekdays: Array.from(new Set((chore.weekdays || []).map(Number).filter(day => day >= 1 && day <= 7))).sort(),
        active: chore.active !== false,
        startDate: chore.startDate || localDateISO(),
        endDate: chore.endDate || undefined
      }
      if (!clean.title || !clean.weekdays.length) return prev

      let next: FamilyData = {
        ...prev,
        recurringChores: chore.id
          ? prev.recurringChores.map(item => item.id === chore.id ? clean : item)
          : [...prev.recurringChores, clean]
      }

      const today = localDateISO()
      next = {
        ...next,
        chores: next.chores.map(item =>
          item.recurringChoreId === clean.id && item.deadline === today && !item.done
            ? { ...item, title: clean.title, userId: clean.userId, amount: clean.amount }
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

  function deleteRecurringChore(id: number) {
    if (authUser?.role === 'bimbo') return
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

  function deleteChore(id: number) {
    if (authUser?.role === 'bimbo') return
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
    setData(prev => ({ ...prev, todos: [...prev.todos, { ...todo, id: nextId(prev.todos), done: false, createdAt: localDateISO() }] }))
  }

  function toggleTodo(id: number) {
    setData(prev => ({ ...prev, todos: prev.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  function deleteTodo(id: number) {
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

  function deleteRoutine(id: number) {
    if (authUser?.role === 'bimbo') return
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

  function deleteSchoolSubject(id: number) {
    if (authUser?.role === 'bimbo') return
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

  function deleteSchoolTimetableEntry(id: number) {
    if (authUser?.role === 'bimbo') return
    setData(prev => ({ ...prev, schoolTimetable: prev.schoolTimetable.filter(item => item.id !== id) }))
  }

  function upsertSchoolItem(item: Omit<SchoolItem, 'id' | 'done' | 'createdAt'> & { id?: number; done?: boolean; createdAt?: string }) {
    if (authUser?.role === 'bimbo' && Number(item.userId) !== authUser.id) return
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

  function deleteSchoolItem(id: number) {
    if (!authUser) return
    setData(prev => {
      const target = prev.schoolItems.find(item => item.id === id)
      if (!target) return prev
      if (authUser.role === 'bimbo' && target.userId !== authUser.id) return prev
      return { ...prev, schoolItems: prev.schoolItems.filter(item => item.id !== id) }
    })
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

  function deleteBoardPost(id: string) {
    if (!authUser) return
    setData(prev => {
      const post = prev.boardPosts.find(item => item.id === id)
      if (!post) return prev
      if (authUser.role === 'bimbo' && post.authorUserId !== authUser.id) return prev
      return { ...prev, boardPosts: prev.boardPosts.filter(item => item.id !== id) }
    })
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

  function exportData() { return JSON.stringify(data, null, 2) }
  function importData(raw: string) {
    try {
      setData(migrateData(JSON.parse(raw), deepClone(initialData)))
      return true
    } catch {
      return false
    }
  }

  function resetData() {
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
    updateCurrentPrefs, updateCurrentProfile,
    addUser, updateUser, deleteUser,
    upsertCalendarEvent, deleteCalendarEvent,
    upsertDeadline, toggleDeadline, deleteDeadline,
    addCategory, renameCategory, deleteCategory,
    upsertPantryItem, deletePantryItem, changePantryQty,
    addShoppingItem, toggleShoppingItem, deleteShoppingItem, moveTakenShoppingToPantry, importReceiptItems,
    upsertDish, deleteDish, upsertMealPlan, deleteMealPlan,
    addChore, toggleChore, approveChore, rejectChore, deleteChore, upsertRecurringChore, toggleRecurringChore, deleteRecurringChore, payUser, undoTransaction,
    addTodo, toggleTodo, deleteTodo,
    upsertRoutine, toggleRoutineActive, deleteRoutine, completeRoutine, undoRoutineCompletion,
    upsertSchoolSubject, deleteSchoolSubject, upsertSchoolTimetableEntry, deleteSchoolTimetableEntry, upsertSchoolItem, toggleSchoolItem, deleteSchoolItem,
    upsertBoardPost, toggleBoardPin, deleteBoardPost, addBoardAttachment, removeBoardAttachment,
    exportData, importData, resetData
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useFamily() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useFamily must be used inside FamilyProvider')
  return ctx
}
