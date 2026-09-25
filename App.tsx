import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Cloud,
  CloudOff,
  HeartPulse,
  GraduationCap,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  Pin,
  ReceiptText,
  RefreshCw,
  Settings,
  ShoppingBasket,
  Users,
  Utensils,
  WalletCards,
  X
} from 'lucide-react'
import { FamilyProvider, useFamily } from './store'
import type { PageKey } from './types'
import { Avatar, Button, IconButton } from './ui'
import { supabase } from './supabaseClient'
import { localDateISO, pantryExpiryDays, pantryNeedsRestock, routineCompletedOn, routineDueOn } from './utils'
import Dashboard from './pages/Dashboard'
import CalendarPage from './pages/Calendar'
import ShoppingPantryPage from './pages/ShoppingPantry'
import MealsPage from './pages/Meals'
import ChoresPage from './pages/Chores'
import SchoolPage from './pages/School'
import BoardPage from './pages/Board'
import HealthPage from './pages/Health'
import DeadlinesPage from './pages/Deadlines'
import TodosPage from './pages/Todos'
import ReportsPage from './pages/Reports'
import UsersPage from './pages/Users'
import SettingsPage from './pages/Settings'
import VoiceAssistant from './components/VoiceAssistant'
import UserGuide from './components/UserGuide'
import { backgroundCssForPreset } from './backgrounds'

const VISUAL_STYLE_TOKENS: Record<string, { secondary: string; glow: string }> = {
  violet: { secondary: '#A855F7', glow: '#8B5CF6' },
  ocean: { secondary: '#06B6D4', glow: '#38BDF8' },
  emerald: { secondary: '#22C55E', glow: '#34D399' },
  sunset: { secondary: '#F43F5E', glow: '#FB923C' },
  berry: { secondary: '#7C3AED', glow: '#E879F9' },
  coral: { secondary: '#FB7185', glow: '#FDA4AF' },
  midnight: { secondary: '#6366F1', glow: '#818CF8' },
  electric: { secondary: '#8B5CF6', glow: '#60A5FA' },
  custom: { secondary: '', glow: '' }
}

const NAV: Array<{ key: PageKey; label: string; icon: React.ReactNode; group?: string }> = [
  { key: 'home', label: 'Home', icon: <Home size={20} />, group: 'Oggi' },
  { key: 'calendar', label: 'Calendario', icon: <CalendarDays size={20} />, group: 'Oggi' },
  { key: 'shopping', label: 'Spesa & Dispensa', icon: <ShoppingBasket size={20} />, group: 'Casa' },
  { key: 'meals', label: 'Pasti', icon: <Utensils size={20} />, group: 'Casa' },
  { key: 'chores', label: 'Compiti & Paghette', icon: <WalletCards size={20} />, group: 'Famiglia' },
  { key: 'school', label: 'Scuola', icon: <GraduationCap size={20} />, group: 'Famiglia' },
  { key: 'board', label: 'Bacheca', icon: <Pin size={20} />, group: 'Famiglia' },
  { key: 'health', label: 'Salute', icon: <HeartPulse size={20} />, group: 'Famiglia' },
  { key: 'deadlines', label: 'Scadenze', icon: <ReceiptText size={20} />, group: 'Famiglia' },
  { key: 'todos', label: 'Da fare', icon: <CheckSquare2 size={20} />, group: 'Famiglia' },
  { key: 'reports', label: 'Report', icon: <BarChart3 size={20} />, group: 'Gestione' },
  { key: 'users', label: 'Membri', icon: <Users size={20} />, group: 'Gestione' },
  { key: 'settings', label: 'Impostazioni', icon: <Settings size={20} />, group: 'Gestione' }
]

function PageRenderer() {
  const { activePage } = useFamily()
  switch (activePage) {
    case 'calendar': return <CalendarPage />
    case 'shopping': return <ShoppingPantryPage />
    case 'meals': return <MealsPage />
    case 'chores': return <ChoresPage />
    case 'school': return <SchoolPage />
    case 'board': return <BoardPage />
    case 'health': return <HealthPage />
    case 'deadlines': return <DeadlinesPage />
    case 'todos': return <TodosPage />
    case 'reports': return <ReportsPage />
    case 'users': return <UsersPage />
    case 'settings': return <SettingsPage />
    default: return <Dashboard />
  }
}

function LoadingScreen() {
  return <div className="login-screen login-screen--loading">
    <div className="cloud-loader">
      <div className="brand-mark brand-mark--lg"><span>V</span></div>
      <div className="cloud-loader__ring" />
      <strong>VerdoFamily</strong>
      <span>Sincronizzazione in corso…</span>
    </div>
  </div>
}

function LoginScreen() {
  const { data, login, signUp, cloudEnabled, cloudLoading } = useFamily()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')
    setMessage('')
    setNeedsVerification(false)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await signUp(identifier, password, displayName)
        if (!result.ok) setError(result.error || 'Registrazione non riuscita.')
        else if (result.needsEmailConfirmation) {
          setNeedsVerification(true)
          setMessage('Account creato. Controlla la tua email e conferma l’indirizzo, poi torna qui per accedere.')
        }
      } else {
        const result = await login(identifier, password)
        if (!result.ok) {
          const rawError = result.error || 'Accesso non riuscito.'
          const unverified = /email.*(not confirmed|not verified)|confirm.*email/i.test(rawError)
          setNeedsVerification(unverified)
          setError(unverified ? 'La tua email non è ancora verificata. Puoi farti inviare un nuovo link di conferma.' : rawError)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    const email = identifier.trim()
    setError('')
    setMessage('')
    if (!email || !email.includes('@')) {
      setError('Inserisci prima l’email dell’account da verificare.')
      return
    }
    if (!supabase) {
      setError('Connessione cloud non configurata.')
      return
    }
    setBusy(true)
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/` }
      })
      if (resendError) {
        const text = resendError.message || 'Invio non riuscito.'
        setError(/rate limit|security purposes/i.test(text)
          ? 'Hai richiesto troppe email in poco tempo. Attendi qualche minuto e riprova.'
          : text)
        return
      }
      setNeedsVerification(true)
      setMessage('Nuova email di verifica inviata. Usa solo il link più recente e controlla anche Spam/Posta indesiderata.')
    } finally {
      setBusy(false)
    }
  }

  function switchMode(nextMode: 'login' | 'signup') {
    setMode(nextMode)
    setError('')
    setMessage('')
    setNeedsVerification(false)
  }

  return <div className="login-screen">
    <div className="login-visual">
      <div className="brand-mark brand-mark--lg"><span>V</span></div>
      <div className="login-visual__copy"><span className="eyebrow eyebrow--light">VerdoFamily</span><h1>La famiglia, organizzata bene.</h1><p>Calendario, spesa, pasti, compiti e paghette in un’unica app sincronizzata su tutti i dispositivi.</p></div>
      <div className="login-bubbles"><span>📅</span><span>🛒</span><span>🍝</span><span>💰</span></div>
    </div>
    <div className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>{cloudEnabled ? 'Cloud Family Hub' : 'Family Hub'}</span></div></div>
        <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>Accedi</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Registrati</button></div>
        <div className="login-copy"><h2>{mode === 'login' ? 'Bentornato' : 'Crea il tuo account'}</h2><p>{mode === 'login' ? 'Usa email e password per ritrovare la tua famiglia su ogni dispositivo.' : 'Ti servirà un’email per il recupero e la sincronizzazione sicura.'}</p></div>
        {mode === 'signup' ? <label className="field"><span className="field__label">Nome</span><input autoFocus autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Es. Claudio" /></label> : null}
        <label className="field"><span className="field__label">{cloudEnabled ? 'Email' : (mode === 'login' ? 'Email o utente locale' : 'Email')}</span><input autoFocus={mode === 'login'} type={cloudEnabled || mode === 'signup' ? 'email' : 'text'} autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder={cloudEnabled ? 'nome@email.it' : 'Nome utente'} /></label>
        <label className="field"><span className="field__label">Password</span><input type="password" minLength={mode === 'signup' ? 10 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" />{mode === 'signup' ? <small className="field__hint">Almeno 10 caratteri.</small> : null}</label>
        {error ? <div className="login-error">{error}</div> : null}
        {message ? <div className="callout callout--success">{message}</div> : null}
        <Button type="submit" className="login-submit" disabled={busy || cloudLoading}>{busy || cloudLoading ? 'Attendi…' : (mode === 'login' ? 'Accedi' : 'Crea account')} {!busy && !cloudLoading ? <ChevronRight size={18} /> : null}</Button>
        {cloudEnabled && needsVerification ? <Button type="button" variant="soft" className="login-submit" disabled={busy || cloudLoading} onClick={resendVerification}><RefreshCw size={16} /> Reinvia email di verifica</Button> : null}
        {!cloudEnabled && mode === 'login' ? <div className="demo-access"><div className="login-users"><span>Profili locali disponibili</span><div>{data.users.filter(u => u.password).map(user => <button type="button" key={user.id} onClick={() => { setIdentifier(user.name); setPassword(user.password || '') }}><Avatar user={user} size="sm" /><span>{user.name}</span></button>)}</div></div></div> : null}
      </form>
    </div>
  </div>
}

function FamilySetupScreen() {
  const { cloudEmail, cloudLoading, createCloudFamily, joinCloudFamily, logout } = useFamily()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('Famiglia Verdolini')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = mode === 'create' ? await createCloudFamily(familyName, false) : await joinCloudFamily(code)
      if (!result.ok) setError(result.error || 'Operazione non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="family-setup-screen">
    <div className="family-setup-card">
      <div className="login-brand"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>{cloudEmail}</span></div></div>
      <div className="setup-hero"><Cloud size={28} /><h2>Collega il tuo account a una famiglia</h2><p>Crea una nuova famiglia oppure entra in quella esistente usando il codice di invito.</p></div>
      <div className="auth-tabs"><button type="button" className={mode === 'create' ? 'is-active' : ''} onClick={() => setMode('create')}>Crea famiglia</button><button type="button" className={mode === 'join' ? 'is-active' : ''} onClick={() => setMode('join')}>Usa un codice</button></div>
      <form onSubmit={submit} className="setup-form">
        {mode === 'create' ? <label className="field"><span className="field__label">Nome famiglia</span><input autoFocus maxLength={100} value={familyName} onChange={e => setFamilyName(e.target.value)} placeholder="Es. Famiglia Verdolini" /></label> : <label className="field"><span className="field__label">Codice famiglia</span><input autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ES. A1B2C3D4E5F6A7B8" maxLength={16} /></label>}
        {error ? <div className="login-error">{error}</div> : null}
        <Button type="submit" disabled={busy || cloudLoading}>{busy || cloudLoading ? 'Attendi…' : (mode === 'create' ? 'Crea e sincronizza' : 'Entra nella famiglia')}</Button>
      </form>
      <button className="setup-logout" onClick={() => logout()}><LogOut size={16} /> Esci dall’account</button>
    </div>
  </div>
}

function SyncIndicator() {
  const { cloudAuthenticated, cloudStatus, syncNow } = useFamily()
  if (!cloudAuthenticated) return <span className="sync-indicator sync-indicator--offline" title="Dati locali"><CloudOff size={14} /><span>Locale</span></span>
  const label = cloudStatus === 'saving' ? 'Salvataggio…' : cloudStatus === 'conflict' ? 'Aggiornamento…' : cloudStatus === 'error' ? 'Errore sync' : 'Sincronizzato'
  return <button className={`sync-indicator sync-indicator--${cloudStatus}`} onClick={() => syncNow()} title="Sincronizzazione cloud"><Cloud size={14} /><span>{label}</span>{cloudStatus === 'saving' ? <RefreshCw size={12} className="spin" /> : null}</button>
}


type AppNotification = {
  id: string
  title: string
  detail: string
  page: PageKey
  createdAt: string
  priority: number
  kind: 'event' | 'deadline' | 'chore' | 'school' | 'board' | 'stock' | 'approval' | 'system' | 'update'
  label?: string
}

function NotificationCenter() {
  const { data, authUser, familyId, activePage, setActivePage, cloudStatus, updateCurrentPrefs } = useFamily()
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [liveUpdates, setLiveUpdates] = useState<AppNotification[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const previousHashes = useRef<Record<string, string> | null>(null)

  const noticeKey = `verdofamily_notice_feed_${familyId || 'local'}_${authUser?.id || 'guest'}`
  const readIds = authUser?.prefs?.notificationCenterReadIds || []

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(noticeKey) || '[]')
      const cutoff = Date.now() - (14 * 86400000)
      setLiveUpdates(Array.isArray(saved) ? saved.filter((item: AppNotification) => new Date(item.createdAt).getTime() >= cutoff).slice(0, 40) : [])
    } catch {
      setLiveUpdates([])
    }
    previousHashes.current = null
  }, [noticeKey])

  useEffect(() => {
    try {
      localStorage.setItem(noticeKey, JSON.stringify(liveUpdates.slice(0, 40)))
    } catch {}
  }, [noticeKey, liveUpdates])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const changeHashes = useMemo(() => ({
    calendar: JSON.stringify(data.calendarEvents),
    shopping: JSON.stringify(data.shopping),
    meals: JSON.stringify(data.mealPlans),
    chores: JSON.stringify(data.chores),
    deadlines: JSON.stringify(data.deadlines),
    todos: JSON.stringify(data.todos),
    routines: JSON.stringify([data.routines, data.routineCompletions]),
    school: JSON.stringify([data.schoolSubjects, data.schoolTimetable, data.schoolItems]),
    board: JSON.stringify(data.boardPosts),
    inventory: JSON.stringify([data.pantry, data.pantryMovements])
  }), [data.calendarEvents, data.shopping, data.mealPlans, data.chores, data.deadlines, data.todos, data.routines, data.routineCompletions, data.schoolSubjects, data.schoolTimetable, data.schoolItems, data.boardPosts, data.pantry, data.pantryMovements])

  useEffect(() => {
    if (!previousHashes.current) {
      previousHashes.current = changeHashes
      return
    }

    const sources: Array<{ key: keyof typeof changeHashes; title: string; detail: string; page: PageKey }> = [
      { key: 'calendar', title: 'Calendario aggiornato', detail: 'Ci sono novità negli impegni della famiglia.', page: 'calendar' },
      { key: 'shopping', title: 'Lista spesa aggiornata', detail: 'La lista della spesa è stata modificata.', page: 'shopping' },
      { key: 'meals', title: 'Programma pasti aggiornato', detail: 'È cambiata la pianificazione dei pasti.', page: 'meals' },
      { key: 'chores', title: 'Compiti aggiornati', detail: 'Sono cambiati compiti o paghette.', page: 'chores' },
      { key: 'deadlines', title: 'Scadenze aggiornate', detail: 'Lo scadenziario familiare è stato modificato.', page: 'deadlines' },
      { key: 'todos', title: 'Da fare aggiornati', detail: 'La lista delle attività è stata modificata.', page: 'todos' },
      { key: 'routines', title: 'Routine aggiornate', detail: 'Sono cambiate le attività ricorrenti della famiglia.', page: 'todos' },
      { key: 'school', title: 'Scuola aggiornata', detail: 'Ci sono novità su compiti, verifiche, materiale o orario.', page: 'school' },
      { key: 'board', title: 'Bacheca aggiornata', detail: 'È stato pubblicato o modificato un contenuto per la famiglia.', page: 'board' },
      { key: 'inventory', title: 'Inventario aggiornato', detail: 'Sono cambiate scorte, quantità o scadenze.', page: 'shopping' }
    ]

    const createdAt = new Date().toISOString()
    const newItems = sources
      .filter(source => previousHashes.current?.[source.key] !== changeHashes[source.key] && activePage !== source.page)
      .map((source, index): AppNotification => ({
        id: `update-${source.key}-${Date.now()}-${index}`,
        title: source.title,
        detail: source.detail,
        page: source.page,
        createdAt,
        priority: 45,
        kind: 'update',
        label: 'Aggiornamento'
      }))

    previousHashes.current = changeHashes
    if (newItems.length) setLiveUpdates(prev => [...newItems, ...prev].slice(0, 40))
  }, [changeHashes, activePage])

  const notifications = useMemo(() => {
    if (!authUser) return [] as AppNotification[]

    const now = new Date(nowTick)
    const today = localDateISO(now)
    const items: AppNotification[] = [...liveUpdates]
    const belongsToUser = (userId?: number) => !userId || userId === authUser.id

    if (authUser.role !== 'bimbo') {
      for (const request of data.approvalRequests || []) {
        const child = data.users.find(user => user.id === request.requestedByUserId)
        const kindLabel = request.kind === 'shopping'
          ? 'Spesa'
          : request.kind === 'school'
            ? 'Scuola'
            : request.kind === 'deadline'
              ? 'Scadenza'
              : request.kind === 'calendar'
                ? 'Calendario'
                : 'Da fare'
        items.push({
          id: `approval-${request.id}`,
          title: `${child?.name || 'Un ragazzo'} chiede una conferma`,
          detail: `${kindLabel} · ${request.summary}`,
          page: 'home',
          createdAt: request.createdAt,
          priority: 96,
          kind: 'approval',
          label: 'Da confermare'
        })
      }
    }

    if (authUser.prefs?.notifications?.board !== false) {
      for (const post of data.boardPosts) {
        const visibleToUser = post.authorUserId === authUser.id || post.audience === 'family' || (post.userIds || []).includes(authUser.id)
        if (!visibleToUser || post.authorUserId === authUser.id) continue
        if (post.type === 'reminder' && post.dueDate) {
          const diffDays = Math.round((new Date(`${post.dueDate}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
          if (diffDays < 0 || diffDays > 1) continue
          items.push({
            id: `board-reminder-${post.id}-${today}`,
            title: post.title || post.body.slice(0, 70) || 'Promemoria bacheca',
            detail: diffDays === 0 ? 'Promemoria della bacheca per oggi' : 'Promemoria della bacheca per domani',
            page: 'board',
            createdAt: `${today}T07:05:00`,
            priority: diffDays === 0 ? 83 : 70,
            kind: 'board',
            label: diffDays === 0 ? 'Oggi' : 'Domani'
          })
          continue
        }
        if (post.pinned && post.updatedAt.slice(0, 10) === today) {
          items.push({
            id: `board-pinned-${post.id}-${post.updatedAt}`,
            title: post.title || post.body.slice(0, 70) || 'Nuovo contenuto fissato',
            detail: 'Nuovo contenuto fissato sulla bacheca familiare',
            page: 'board',
            createdAt: post.updatedAt,
            priority: 62,
            kind: 'board',
            label: 'Bacheca'
          })
        }
      }
    }

    for (const event of data.calendarEvents) {
      if (event.date !== today) continue
      const ids = event.userIds?.length ? event.userIds : (event.userId ? [event.userId] : [])
      if (event.audience !== 'family' && ids.length && !ids.includes(authUser.id)) continue

      if (!event.time) {
        items.push({
          id: `event-${event.id}-${event.date}-all-day`,
          title: event.title,
          detail: 'Impegno previsto per oggi',
          page: 'calendar',
          createdAt: `${today}T00:01:00`,
          priority: 65,
          kind: 'event',
          label: 'Oggi'
        })
        continue
      }

      const [hour, minute] = event.time.split(':').map(Number)
      const start = new Date(now)
      start.setHours(hour || 0, minute || 0, 0, 0)
      const diffMinutes = Math.round((start.getTime() - now.getTime()) / 60000)
      if (diffMinutes > 30 || diffMinutes < -180) continue

      let detail = ''
      let label = ''
      let priority = 80
      if (diffMinutes > 1) {
        detail = `Inizia alle ${event.time}`
        label = `Tra ${diffMinutes} min`
        priority = 82
      } else if (diffMinutes >= -10) {
        detail = `Orario ${event.time}`
        label = 'Ora'
        priority = 95
      } else {
        const ago = Math.abs(diffMinutes)
        detail = `Previsto alle ${event.time}`
        label = `Da ${ago} min`
        priority = 76
      }

      items.push({
        id: `event-${event.id}-${event.date}-${event.time}`,
        title: event.title,
        detail,
        page: 'calendar',
        createdAt: start.toISOString(),
        priority,
        kind: 'event',
        label
      })
    }

    for (const deadline of data.deadlines) {
      if (deadline.done || !deadline.date || !belongsToUser(deadline.userId)) continue
      if (deadline.kind === 'medicine' || deadline.kind === 'therapy') continue

      const diffDays = Math.round((new Date(`${deadline.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
      const reminders = Array.isArray(deadline.reminderDays) ? deadline.reminderDays.map(Number) : [90, 30, 7]
      const isHealth = deadline.kind === 'visit' || deadline.kind === 'health-record'

      if (diffDays > 0 && !reminders.includes(diffDays)) continue

      const daysLate = Math.max(0, -diffDays)
      const detail = daysLate
        ? `Scadenza superata da ${daysLate} ${daysLate === 1 ? 'giorno' : 'giorni'}`
        : diffDays === 0
          ? 'Scade oggi'
          : `Scade tra ${diffDays} ${diffDays === 1 ? 'giorno' : 'giorni'}`

      items.push({
        id: `deadline-${deadline.id}-${today}-${diffDays}`,
        title: deadline.title,
        detail,
        page: isHealth ? 'health' : 'deadlines',
        createdAt: `${today}T07:00:00`,
        priority: daysLate ? 92 : diffDays === 0 ? 86 : diffDays <= 7 ? 78 : diffDays <= 30 ? 68 : 60,
        kind: 'deadline',
        label: daysLate ? 'Scaduta' : diffDays === 0 ? 'Oggi' : `Tra ${diffDays}g`
      })
    }

    if (authUser.role !== 'bimbo') {
      const tomorrow = localDateISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12))
    if (authUser.prefs?.notifications?.school !== false) for (const schoolItem of data.schoolItems) {
      if (schoolItem.done || (schoolItem.date !== today && schoolItem.date !== tomorrow)) continue
      if (authUser.role === 'bimbo' && schoolItem.userId !== authUser.id) continue
      const student = data.users.find(user => user.id === schoolItem.userId)
      const isTomorrow = schoolItem.date === tomorrow
      items.push({
        id: `school-${schoolItem.id}-${schoolItem.date}`,
        title: schoolItem.title,
        detail: `${student?.name || 'Scuola'} · ${isTomorrow ? 'da preparare per domani' : 'previsto per oggi'}`,
        page: 'school',
        createdAt: `${today}T07:10:00`,
        priority: isTomorrow ? 69 : 81,
        kind: 'school',
        label: isTomorrow ? 'Domani' : 'Oggi'
      })
    }

    for (const routine of data.routines) {
      if (!routineDueOn(routine, today) || routineCompletedOn(data.routineCompletions, routine.id, today)) continue
      if (routine.userId !== authUser.id) continue
      items.push({
        id: `routine-${routine.id}-${today}`,
        title: routine.title,
        detail: 'Routine prevista per oggi',
        page: 'todos',
        createdAt: `${today}T07:15:00`,
        priority: 72,
        kind: 'chore',
        label: 'Routine'
      })
    }

    for (const chore of data.chores) {
        if (chore.done || chore.completionStatus !== 'pending') continue
        const child = data.users.find(user => user.id === chore.userId)
        items.push({
          id: `chore-approval-${chore.id}-${chore.completedAt || today}`,
          title: `${child?.name || 'Un ragazzo'} ha completato: ${chore.title}`,
          detail: `Verifica il compito e conferma per accreditare ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(chore.amount || 0))}.`,
          page: 'chores',
          createdAt: chore.completedAt || new Date(nowTick).toISOString(),
          priority: 94,
          kind: 'chore',
          label: 'Da confermare'
        })
      }
    }

    for (const chore of data.chores) {
      if (chore.done || chore.completionStatus === 'pending' || !chore.deadline || chore.deadline > today || chore.userId !== authUser.id) continue
      items.push({
        id: `chore-${chore.id}-${today}`,
        title: chore.title,
        detail: chore.deadline < today ? 'Compito ancora da completare' : 'Compito previsto per oggi',
        page: 'chores',
        createdAt: `${today}T07:30:00`,
        priority: chore.deadline < today ? 84 : 74,
        kind: 'chore',
        label: chore.deadline < today ? 'In ritardo' : 'Oggi'
      })
    }

    if (authUser.prefs?.notifications?.shopping !== false) {
      const lowStock = data.pantry.filter(item => pantryNeedsRestock(item, data.pantryMovements, today))
      const expiring = data.pantry
        .map(item => ({ item, days: pantryExpiryDays(item, today) }))
        .filter(entry => entry.days !== null && entry.days <= 3)

      if (lowStock.length) {
        items.push({
          id: `stock-${today}`,
          title: lowStock.length === 1 ? `${lowStock[0].name} da reintegrare` : `${lowStock.length} prodotti da reintegrare`,
          detail: lowStock.length === 1 ? 'Scorta minima o consumo previsto: controlla l’inventario.' : 'Controlla i suggerimenti automatici dell’inventario.',
          page: 'shopping',
          createdAt: `${today}T08:00:00`,
          priority: 58,
          kind: 'stock',
          label: 'Scorte'
        })
      }

      if (expiring.length) {
        items.push({
          id: `expiry-${today}`,
          title: expiring.length === 1 ? `${expiring[0].item.name} da consumare` : `${expiring.length} prodotti in scadenza`,
          detail: expiring.some(entry => Number(entry.days) < 0) ? 'Ci sono prodotti già scaduti o molto vicini alla scadenza.' : 'Controlla i prodotti da consumare nei prossimi giorni.',
          page: 'shopping',
          createdAt: `${today}T08:05:00`,
          priority: expiring.some(entry => Number(entry.days) < 0) ? 76 : 63,
          kind: 'stock',
          label: 'Scadenze'
        })
      }
    }

    if (cloudStatus === 'error') {
      items.push({
        id: `system-sync-${today}`,
        title: 'Sincronizzazione da controllare',
        detail: 'VerdoFamily non è riuscito a sincronizzare correttamente i dati.',
        page: 'settings',
        createdAt: new Date(nowTick).toISOString(),
        priority: 100,
        kind: 'system',
        label: 'Sistema'
      })
    }

    const unique = new Map<string, AppNotification>()
    for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item)
    return [...unique.values()]
      .sort((a, b) => b.priority - a.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 60)
  }, [authUser, data, liveUpdates, cloudStatus, nowTick])

  const unread = notifications.filter(item => !readIds.includes(item.id))
  const visible = onlyUnread ? unread : notifications

  function saveReadIds(ids: string[]) {
    const merged = Array.from(new Set([...readIds, ...ids])).slice(-300)
    updateCurrentPrefs({ notificationCenterReadIds: merged })
  }

  function markRead(id: string) {
    if (!readIds.includes(id)) saveReadIds([id])
  }

  function openNotification(item: AppNotification) {
    markRead(item.id)
    setOpen(false)
    setActivePage(item.page)
  }

  function formatWhen(item: AppNotification) {
    if (item.label) return item.label
    const date = new Date(item.createdAt)
    if (Number.isNaN(date.getTime())) return ''
    if (localDateISO(date) === localDateISO()) return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
  }

  function iconFor(item: AppNotification) {
    if (item.kind === 'event') return <CalendarDays size={17} />
    if (item.kind === 'deadline') return <ReceiptText size={17} />
    if (item.kind === 'chore') return <CheckSquare2 size={17} />
    if (item.kind === 'school') return <GraduationCap size={17} />
    if (item.kind === 'board') return <Pin size={17} />
    if (item.kind === 'stock') return <ShoppingBasket size={17} />
    if (item.kind === 'approval') return <CheckSquare2 size={17} />
    if (item.kind === 'system') return <CloudOff size={17} />
    return <RefreshCw size={17} />
  }

  return <div className="notification-center" ref={rootRef}>
    <div className="notification-bell-wrap">
      <IconButton label="Notifiche" onClick={() => setOpen(value => !value)}><Bell size={19} /></IconButton>
      {unread.length ? <span className="notification-badge">{unread.length > 99 ? '99+' : unread.length}</span> : null}
    </div>

    {open ? <div className="notification-panel">
      <div className="notification-panel__head">
        <div><strong>Notifiche</strong><span>{unread.length ? `${unread.length} non ${unread.length === 1 ? 'letta' : 'lette'}` : 'Tutto sotto controllo'}</span></div>
        <IconButton label="Chiudi notifiche" onClick={() => setOpen(false)}><X size={18} /></IconButton>
      </div>

      <div className="notification-panel__toolbar">
        <div className="notification-filter">
          <button className={!onlyUnread ? 'is-active' : ''} onClick={() => setOnlyUnread(false)}>Tutte</button>
          <button className={onlyUnread ? 'is-active' : ''} onClick={() => setOnlyUnread(true)}>Non lette</button>
        </div>
        {unread.length ? <button className="notification-mark-all" onClick={() => saveReadIds(unread.map(item => item.id))}>Segna tutte lette</button> : null}
      </div>

      <div className="notification-list">
        {visible.length ? visible.map(item => {
          const isUnread = !readIds.includes(item.id)
          return <button key={item.id} className={`notification-item ${isUnread ? 'is-unread' : ''}`} onClick={() => openNotification(item)}>
            <span className={`notification-item__icon notification-item__icon--${item.kind}`}>{iconFor(item)}</span>
            <span className="notification-item__copy">
              <span className="notification-item__title">{item.title}</span>
              <span className="notification-item__detail">{item.detail}</span>
            </span>
            <span className="notification-item__meta">{formatWhen(item)}{isUnread ? <i /> : null}</span>
          </button>
        }) : <div className="notification-empty"><Bell size={25} /><strong>Nessuna notifica</strong><span>Gli impegni e gli aggiornamenti compariranno qui quando diventano rilevanti.</span></div>}
      </div>
    </div> : null}
  </div>
}

function AppShell() {
  const { authUser, activePage, setActivePage, logout, cloudAuthenticated, cloudLoading, needsFamilySetup, familyName } = useFamily()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const contentRef = useRef<HTMLElement>(null)

  const prefs = authUser?.prefs
  const menuOverlayOpen = drawerOpen || moreOpen

  function setContentInteractionLocked(locked: boolean) {
    const content = contentRef.current
    if (!content) return
    if (locked) {
      content.style.setProperty('overflow', 'hidden', 'important')
      content.style.setProperty('touch-action', 'none', 'important')
      content.style.setProperty('overscroll-behavior', 'none', 'important')
    } else {
      content.style.removeProperty('overflow')
      content.style.removeProperty('touch-action')
      content.style.removeProperty('overscroll-behavior')
    }
  }

  useLayoutEffect(() => {
    setContentInteractionLocked(menuOverlayOpen)
    return () => {
      if (menuOverlayOpen) setContentInteractionLocked(false)
    }
  }, [menuOverlayOpen])

  function openDrawerNow() {
    setContentInteractionLocked(true)
    setMoreOpen(false)
    setDrawerOpen(true)
  }

  function openMoreNow() {
    setContentInteractionLocked(true)
    setDrawerOpen(false)
    setMoreOpen(true)
  }

  function closeMenus() {
    setContentInteractionLocked(false)
    setDrawerOpen(false)
    setMoreOpen(false)
  }

  useEffect(() => {
    if (!prefs) return
    const root = document.documentElement
    const accent = prefs.accent || '#635BFF'
    const style = VISUAL_STYLE_TOKENS[prefs.visualStyle || 'violet'] || VISUAL_STYLE_TOKENS.custom
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent2', style.secondary || accent)
    root.style.setProperty('--accent-glow', style.glow || accent)
    const backgroundPreset = prefs.backgroundPreset || 'none'
    const backgroundColor = /^#[0-9a-f]{6}$/i.test(String(prefs.backgroundColor || ''))
      ? String(prefs.backgroundColor)
      : '#EEF6FF'
    const wallpaper = backgroundPreset === 'color'
      ? `linear-gradient(${backgroundColor}, ${backgroundColor})`
      : backgroundPreset === 'custom' && prefs.backgroundImage
        ? `url("${prefs.backgroundImage}")`
        : backgroundCssForPreset(backgroundPreset)
    root.style.setProperty('--app-wallpaper', wallpaper)
    root.style.setProperty('--wallpaper-strength', backgroundPreset === 'color'
      ? '1'
      : String(Math.max(0.08, Math.min(0.60, Number(prefs.backgroundStrength || 24) / 100))))
    root.style.setProperty('--wallpaper-blur', `${Math.max(0, Math.min(12, Number(prefs.backgroundBlur || 0)))}px`)
    root.dataset.wallpaper = wallpaper && wallpaper !== 'none' ? 'on' : 'off'
    root.dataset.visualStyle = prefs.visualStyle || 'violet'
    root.dataset.density = prefs.density || 'comfortable'
    const apply = () => {
      const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', apply)
    return () => mq?.removeEventListener?.('change', apply)
  }, [prefs?.accent, prefs?.visualStyle, prefs?.theme, prefs?.density, prefs?.backgroundPreset, prefs?.backgroundColor, prefs?.backgroundImage, prefs?.backgroundStrength, prefs?.backgroundBlur])

  useEffect(() => {
    const reset = () => contentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    reset()
    const frame = window.requestAnimationFrame(reset)
    return () => window.cancelAnimationFrame(frame)
  }, [activePage])

  const bottomTabs = useMemo(() => (prefs?.bottomTabs?.length ? prefs.bottomTabs : ['home', 'calendar', 'shopping', 'meals']).slice(0, 4), [prefs?.bottomTabs])
  const current = NAV.find(n => n.key === activePage)
  const moreGroups = useMemo(() => ['Oggi', 'Casa', 'Famiglia', 'Gestione']
    .map(group => ({
      group,
      items: NAV.filter(item => item.group === group && !bottomTabs.includes(item.key))
    }))
    .filter(section => section.items.length), [bottomTabs])

  function navigate(page: PageKey) {
    setActivePage(page)
    closeMenus()
  }

  if (cloudLoading && cloudAuthenticated && !authUser && !needsFamilySetup) return <LoadingScreen />
  if (cloudAuthenticated && needsFamilySetup) return <FamilySetupScreen />
  if (!authUser) return <LoginScreen />

  return <div className={`app-shell ${drawerOpen ? 'is-drawer-open' : ''} ${menuOverlayOpen ? 'is-menu-open' : ''}`}>
    <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`}>
      <div className="sidebar__head"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>{familyName || 'Family Hub'}</span></div><IconButton className="sidebar-close" label="Chiudi menu" onClick={closeMenus}><X size={20} /></IconButton></div>
      <nav className="sidebar__nav">{NAV.map((item, index) => <React.Fragment key={item.key}>{item.group && NAV[index - 1]?.group !== item.group ? <div className="nav-group-label">{item.group}</div> : null}<button className={activePage === item.key ? 'is-active' : ''} onClick={() => navigate(item.key)}><span data-page={item.key}>{item.icon}</span><strong>{item.label}</strong></button></React.Fragment>)}</nav>
      <div className="sidebar__footer"><SyncIndicator /><button className="sidebar-guide-btn" onClick={() => setGuideOpen(true)}><HelpCircle size={18} /><span><strong>Guida</strong><small>Scopri tutte le funzioni</small></span><ChevronRight size={17} /></button><button className="profile-chip" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span><strong>{authUser.name}</strong><small>{authUser.role}</small></span><ChevronRight size={17} /></button><button className="logout-btn" onClick={() => logout()}><LogOut size={18} /> Esci</button></div>
    </aside>

    {drawerOpen ? <button className="scrim" aria-label="Chiudi menu" onClick={closeMenus} /> : null}

    <div className="app-main">
      <header className="topbar"><div className="topbar__left"><IconButton className="mobile-menu-btn" label="Menu" onClick={openDrawerNow}><Menu size={21} /></IconButton><div><span>{current?.label || 'VerdoFamily'}</span><small>{familyName || 'Family Hub'}</small></div></div><div className="topbar__right"><SyncIndicator /><IconButton className="topbar-help" label="Guida" onClick={() => setGuideOpen(true)}><HelpCircle size={20} /></IconButton><NotificationCenter /><button className="topbar-profile" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span>{authUser.name}</span></button></div></header>
      <main className="content" ref={contentRef}><PageRenderer /></main>
    </div>

    <nav className="bottom-nav" aria-label="Navigazione mobile">{bottomTabs.map(key => { const item = NAV.find(n => n.key === key); if (!item) return null; return <button key={key} className={activePage === key ? 'is-active' : ''} onClick={() => navigate(key)}><span data-page={item.key}>{item.icon}</span><small>{item.label.replace(' & Dispensa','').replace('Compiti & Paghette','Paghette')}</small></button> })}<button className={bottomTabs.includes(activePage) ? '' : 'is-active'} onClick={openMoreNow}><span data-page="more"><MoreHorizontal size={20} /></span><small>Altro</small></button></nav>

    <VoiceAssistant />
    <UserGuide open={guideOpen} onClose={() => setGuideOpen(false)} currentPage={activePage} onNavigate={navigate} />

    {moreOpen ? <div className="mobile-more-layer" onMouseDown={e => { if (e.target === e.currentTarget) closeMenus() }}><div className="mobile-more"><div className="mobile-more__handle" /><div className="mobile-more__head"><strong>Altre sezioni</strong><IconButton label="Chiudi" onClick={closeMenus}><X size={20} /></IconButton></div><div className="mobile-more__status"><SyncIndicator /></div><div className="mobile-more__sections">{moreGroups.map(section => <section className="mobile-more__section" key={section.group}><div className="mobile-more__section-title">{section.group}</div><div className="mobile-more__grid">{section.items.map(item => <button key={item.key} onClick={() => navigate(item.key)} className={activePage === item.key ? 'is-active' : ''}><span data-page={item.key}>{item.icon}</span><strong>{item.label}</strong></button>)}</div></section>)}</div><button className="mobile-more__guide" onClick={() => { closeMenus(); setGuideOpen(true) }}><HelpCircle size={18} /><span><strong>Guida VerdoFamily</strong><small>Scopri tutte le funzioni</small></span><ChevronRight size={17} /></button><button className="mobile-more__logout" onClick={() => logout()}><LogOut size={18} /> Esci</button></div></div> : null}
  </div>
}

export default function App() {
  return <FamilyProvider><AppShell /></FamilyProvider>
}
