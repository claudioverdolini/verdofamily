import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { isSupabaseConfigured, supabase } from './supabaseClient'

const STORAGE_KEY = 'verdofamily_v3'
const LEGACY_KEYS = ['familyhub_v2', 'familyhub_v1']
const SESSION_KEY = 'verdofamily_session_user'

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

function loadCachedData(): FamilyData {
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
  return { ...value, users: value.users.map(user => ({ ...user, password: '' })) }
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
  const [activePage, setActivePage] = useState<PageKey>('home')

  const revisionRef = useRef(0)
  const familyIdRef = useRef<string | null>(null)
  const suppressNextPushRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const realtimeChannelRef = useRef<any>(null)
  const currentCloudUserRef = useRef<any>(null)

  familyIdRef.current = familyId

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

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

  async function readFamilyDocument(targetFamilyId: string, profile: any, role: string) {
    if (!supabase) return
    const [{ data: family }, { data: document, error }] = await Promise.all([
      supabase.from('families').select('id,name').eq('id', targetFamilyId).single(),
      supabase.from('family_documents').select('family_id,data,revision,updated_at,updated_by').eq('family_id', targetFamilyId).single()
    ])
    if (error) throw error
    const raw = document?.data && Object.keys(document.data).length ? document.data : deepClone(initialData)
    const linked = linkCloudIdentity(migrateData(raw, deepClone(initialData)), profile, role)
    suppressNextPushRef.current = true
    revisionRef.current = Number(document?.revision || 0)
    setFamilyId(targetFamilyId)
    setFamilyName(family?.name || 'Famiglia')
    setNeedsFamilySetup(false)
    setData(linked)
    setCloudStatus('synced')
  }

  function stopRealtime() {
    if (supabase && realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }
  }

  function startRealtime(targetFamilyId: string) {
    if (!supabase) return
    stopRealtime()
    realtimeChannelRef.current = supabase
      .channel(`family-document-${targetFamilyId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'family_documents', filter: `family_id=eq.${targetFamilyId}` }, async (payload: any) => {
        const row = payload?.new
        if (!row || Number(row.revision || 0) <= revisionRef.current) return
        revisionRef.current = Number(row.revision || 0)
        const user = currentCloudUserRef.current
        const profile = user ? await fetchProfile(user.id) : null
        const { data: membership } = user ? await supabase.from('family_members').select('role').eq('family_id', targetFamilyId).eq('user_id', user.id).maybeSingle() : { data: null }
        const remote = migrateData(row.data, deepClone(initialData))
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
      startRealtime(membership.family_id)
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
        setCloudUserId(null)
        setCloudEmail('')
        setFamilyId(null)
        setFamilyName('')
        setNeedsFamilySetup(false)
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
    const { data: newRevision, error } = await supabase.rpc('save_family_document', {
      p_family_id: familyIdRef.current,
      p_data: cloudSafeData(snapshot),
      p_expected_revision: expected
    })
    if (!error) {
      revisionRef.current = Number(newRevision || expected + 1)
      setCloudStatus('synced')
      return
    }
    if (String(error.message || '').includes('revision_conflict')) {
      setCloudStatus('conflict')
      const { data: remote } = await supabase.from('family_documents').select('data,revision').eq('family_id', familyIdRef.current).single()
      if (remote) {
        revisionRef.current = Number(remote.revision || 0)
        suppressNextPushRef.current = true
        setData(migrateData(remote.data, deepClone(initialData)))
      }
      return
    }
    console.error('save_family_document', error)
    setCloudStatus('error')
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
    if (supabase && clean.includes('@')) {
      setCloudLoading(true)
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password })
      if (error) {
        setCloudLoading(false)
        return { ok: false, error: error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message }
      }
      setActivePage('home')
      return { ok: true }
    }
    const local = data.users.find(u => normalize(u.name) === normalize(clean) && u.password === password)
    if (!local) return { ok: false, error: clean.includes('@') ? 'Email o password non corretti.' : 'Nome utente o password non corretti.' }
    setCloudUserId(null)
    setSessionUserId(local.id)
    setActivePage('home')
    return { ok: true }
  }

  async function signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, error: 'Connessione cloud non configurata.' }
    if (!displayName.trim()) return { ok: false, error: 'Inserisci il tuo nome.' }
    if (password.length < 6) return { ok: false, error: 'La password deve avere almeno 6 caratteri.' }
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
    setCloudUserId(null)
    setSessionUserId(null)
    setFamilyId(null)
    setFamilyName('')
    setNeedsFamilySetup(false)
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
      startRealtime(createdId)
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
      startRealtime(joinedId)
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
      if (plan.id) {
        const old = prev.mealPlans.find(p => p.id === plan.id)
        if (old) pantry = adjustIngredients({ ...prev, pantry }, old.dishId, +1)
      }
      pantry = adjustIngredients({ ...prev, pantry }, plan.dishId, -1)
      const mealPlans = plan.id ? prev.mealPlans.map(p => p.id === plan.id ? { ...p, ...plan, id: p.id } : p) : [...prev.mealPlans, { ...plan, id: nextId(prev.mealPlans) }]
      return { ...prev, pantry, mealPlans }
    })
  }

  function deleteMealPlan(id: number) {
    setData(prev => {
      const plan = prev.mealPlans.find(p => p.id === id)
      const pantry = plan ? adjustIngredients(prev, plan.dishId, +1) : prev.pantry
      return { ...prev, pantry, mealPlans: prev.mealPlans.filter(p => p.id !== id) }
    })
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
    setData(prev => {
      const user = prev.users.find(u => u.id === userId)
      if (!user || amount <= 0 || amount > Number(user.balance || 0)) return prev
      ok = true
      return { ...prev, users: prev.users.map(u => u.id === userId ? { ...u, balance: Number(u.balance || 0) - amount } : u), transactions: [...prev.transactions, { id: nextId(prev.transactions), userId, type: 'payment', amount, date: localDateISO(), note }] }
    })
    return ok
  }

  function undoTransaction(id: number) {
    let ok = false
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id)
      if (!tx || tx.type !== 'payment' || tx.reversed) return prev
      ok = true
      return { ...prev, users: prev.users.map(u => u.id === tx.userId ? { ...u, balance: Number(u.balance || 0) + Number(tx.amount || 0) } : u), transactions: prev.transactions.map(t => t.id === id ? { ...t, reversed: true } : t) }
    })
    return ok
  }

  function addTodo(todo: Omit<Todo, 'id' | 'done' | 'createdAt'>) { setData(prev => ({ ...prev, todos: [...prev.todos, { ...todo, id: nextId(prev.todos), done: false, createdAt: localDateISO() }] })) }
  function toggleTodo(id: number) { setData(prev => ({ ...prev, todos: prev.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) })) }
  function deleteTodo(id: number) { setData(prev => ({ ...prev, todos: prev.todos.filter(t => t.id !== id) })) }

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
    addChore, toggleChore, deleteChore, payUser, undoTransaction,
    addTodo, toggleTodo, deleteTodo,
    exportData, importData, resetData
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useFamily() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useFamily must be used inside FamilyProvider')
  return ctx
}
