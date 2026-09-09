import React, { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Cloud,
  CloudOff,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
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
import Dashboard from './pages/Dashboard'
import CalendarPage from './pages/Calendar'
import ShoppingPantryPage from './pages/ShoppingPantry'
import MealsPage from './pages/Meals'
import ChoresPage from './pages/Chores'
import DeadlinesPage from './pages/Deadlines'
import TodosPage from './pages/Todos'
import UsersPage from './pages/Users'
import SettingsPage from './pages/Settings'

const NAV: Array<{ key: PageKey; label: string; icon: React.ReactNode; group?: string }> = [
  { key: 'home', label: 'Home', icon: <Home size={20} /> },
  { key: 'calendar', label: 'Calendario', icon: <CalendarDays size={20} /> },
  { key: 'shopping', label: 'Spesa & Dispensa', icon: <ShoppingBasket size={20} /> },
  { key: 'meals', label: 'Pasti', icon: <Utensils size={20} /> },
  { key: 'chores', label: 'Compiti & Paghette', icon: <WalletCards size={20} /> },
  { key: 'deadlines', label: 'Scadenze', icon: <ReceiptText size={20} /> },
  { key: 'todos', label: 'ToDo List', icon: <CheckSquare2 size={20} /> },
  { key: 'users', label: 'Utenti', icon: <Users size={20} />, group: 'Gestione' },
  { key: 'settings', label: 'Impostazioni', icon: <Settings size={20} />, group: 'Gestione' }
]

function PageRenderer() {
  const { activePage } = useFamily()
  switch (activePage) {
    case 'calendar': return <CalendarPage />
    case 'shopping': return <ShoppingPantryPage />
    case 'meals': return <MealsPage />
    case 'chores': return <ChoresPage />
    case 'deadlines': return <DeadlinesPage />
    case 'todos': return <TodosPage />
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
  const [showDemo, setShowDemo] = useState(false)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await signUp(identifier, password, displayName)
        if (!result.ok) setError(result.error || 'Registrazione non riuscita.')
        else if (result.needsEmailConfirmation) setMessage('Account creato. Controlla la tua email e conferma l’indirizzo, poi torna qui per accedere.')
      } else {
        const result = await login(identifier, password)
        if (!result.ok) setError(result.error || 'Accesso non riuscito.')
      }
    } finally {
      setBusy(false)
    }
  }

  function useDemo(user: any) {
    setMode('login')
    setIdentifier(user.name)
    setPassword(user.password || '')
    setError('')
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
        <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); setMessage('') }}>Accedi</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Registrati</button></div>
        <div className="login-copy"><h2>{mode === 'login' ? 'Bentornato' : 'Crea il tuo account'}</h2><p>{mode === 'login' ? 'Usa email e password per ritrovare la tua famiglia su ogni dispositivo.' : 'Ti servirà un’email per il recupero e la sincronizzazione sicura.'}</p></div>
        {mode === 'signup' ? <label className="field"><span className="field__label">Nome</span><input autoFocus autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Es. Claudio" /></label> : null}
        <label className="field"><span className="field__label">{mode === 'login' && !identifier.includes('@') ? 'Email o utente demo' : 'Email'}</span><input autoFocus={mode === 'login'} type={mode === 'signup' ? 'email' : 'text'} autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="nome@email.it" /></label>
        <label className="field"><span className="field__label">Password</span><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" /></label>
        {error ? <div className="login-error">{error}</div> : null}
        {message ? <div className="callout callout--success">{message}</div> : null}
        <Button type="submit" className="login-submit" disabled={busy || cloudLoading}>{busy || cloudLoading ? 'Attendi…' : (mode === 'login' ? 'Accedi' : 'Crea account')} {!busy && !cloudLoading ? <ChevronRight size={18} /> : null}</Button>
        {mode === 'login' ? <div className="demo-access"><button type="button" className="text-link" onClick={() => setShowDemo(v => !v)}>{showDemo ? 'Nascondi accesso demo' : 'Accesso demo locale'}</button>{showDemo ? <div className="login-users"><span>Profili locali di prova</span><div>{data.users.filter(u => u.password).map(user => <button type="button" key={user.id} onClick={() => useDemo(user)}><Avatar user={user} size="sm" /><span>{user.name}</span></button>)}</div></div> : null}</div> : null}
      </form>
    </div>
  </div>
}

function FamilySetupScreen() {
  const { cloudEmail, cloudLoading, createCloudFamily, joinCloudFamily, logout } = useFamily()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('Famiglia Verdolini')
  const [code, setCode] = useState('')
  const [importLocal, setImportLocal] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = mode === 'create' ? await createCloudFamily(familyName, importLocal) : await joinCloudFamily(code)
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
        {mode === 'create' ? <><label className="field"><span className="field__label">Nome famiglia</span><input autoFocus value={familyName} onChange={e => setFamilyName(e.target.value)} placeholder="Es. Famiglia Verdolini" /></label><label className="toggle-row toggle-row--boxed"><input type="checkbox" checked={importLocal} onChange={e => setImportLocal(e.target.checked)} /><span><strong>Importa i dati già presenti su questo dispositivo</strong><small>Calendario, spesa, pasti, paghette e profili locali verranno portati nel cloud.</small></span></label></> : <label className="field"><span className="field__label">Codice famiglia</span><input autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ES. A1B2C3D4" maxLength={12} /></label>}
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

function AppShell() {
  const { authUser, activePage, setActivePage, logout, cloudAuthenticated, cloudLoading, needsFamilySetup, familyName } = useFamily()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const prefs = authUser?.prefs

  useEffect(() => {
    if (!prefs) return
    const root = document.documentElement
    root.style.setProperty('--accent', prefs.accent || '#5B5BD6')
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
  }, [prefs?.accent, prefs?.theme, prefs?.density])

  const bottomTabs = useMemo(() => (prefs?.bottomTabs?.length ? prefs.bottomTabs : ['home', 'calendar', 'shopping', 'meals']).slice(0, 4), [prefs?.bottomTabs])
  const current = NAV.find(n => n.key === activePage)

  function navigate(page: PageKey) {
    setActivePage(page)
    setDrawerOpen(false)
    setMoreOpen(false)
  }

  if (cloudLoading && cloudAuthenticated && !authUser && !needsFamilySetup) return <LoadingScreen />
  if (cloudAuthenticated && needsFamilySetup) return <FamilySetupScreen />
  if (!authUser) return <LoginScreen />

  return <div className="app-shell">
    <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`}>
      <div className="sidebar__head"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>{familyName || 'Family Hub'}</span></div><IconButton className="sidebar-close" label="Chiudi menu" onClick={() => setDrawerOpen(false)}><X size={20} /></IconButton></div>
      <nav className="sidebar__nav">{NAV.map((item, index) => <React.Fragment key={item.key}>{item.group && NAV[index - 1]?.group !== item.group ? <div className="nav-group-label">{item.group}</div> : null}<button className={activePage === item.key ? 'is-active' : ''} onClick={() => navigate(item.key)}><span>{item.icon}</span><strong>{item.label}</strong></button></React.Fragment>)}</nav>
      <div className="sidebar__footer"><SyncIndicator /><button className="profile-chip" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span><strong>{authUser.name}</strong><small>{authUser.role}</small></span><ChevronRight size={17} /></button><button className="logout-btn" onClick={() => logout()}><LogOut size={18} /> Esci</button></div>
    </aside>

    {drawerOpen ? <button className="scrim" aria-label="Chiudi menu" onClick={() => setDrawerOpen(false)} /> : null}

    <div className="app-main">
      <header className="topbar"><div className="topbar__left"><IconButton className="mobile-menu-btn" label="Menu" onClick={() => setDrawerOpen(true)}><Menu size={21} /></IconButton><div><span>{current?.label || 'VerdoFamily'}</span><small>{familyName || 'Family Hub'}</small></div></div><div className="topbar__right"><SyncIndicator /><IconButton label="Notifiche"><Bell size={19} /></IconButton><button className="topbar-profile" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span>{authUser.name}</span></button></div></header>
      <main className="content"><PageRenderer /></main>
    </div>

    <nav className="bottom-nav" aria-label="Navigazione mobile">{bottomTabs.map(key => { const item = NAV.find(n => n.key === key); if (!item) return null; return <button key={key} className={activePage === key ? 'is-active' : ''} onClick={() => navigate(key)}><span>{item.icon}</span><small>{item.label.replace(' & Dispensa','').replace('Compiti & Paghette','Paghette')}</small></button> })}<button className={bottomTabs.includes(activePage) ? '' : 'is-active'} onClick={() => setMoreOpen(true)}><span><MoreHorizontal size={20} /></span><small>Altro</small></button></nav>

    {moreOpen ? <div className="mobile-more-layer" onMouseDown={e => { if (e.target === e.currentTarget) setMoreOpen(false) }}><div className="mobile-more"><div className="mobile-more__handle" /><div className="mobile-more__head"><strong>Altre sezioni</strong><IconButton label="Chiudi" onClick={() => setMoreOpen(false)}><X size={20} /></IconButton></div><div className="mobile-more__status"><SyncIndicator /></div><div className="mobile-more__grid">{NAV.filter(n => !bottomTabs.includes(n.key)).map(item => <button key={item.key} onClick={() => navigate(item.key)} className={activePage === item.key ? 'is-active' : ''}><span>{item.icon}</span><strong>{item.label}</strong></button>)}</div><button className="mobile-more__logout" onClick={() => logout()}><LogOut size={18} /> Esci</button></div></div> : null}
  </div>
}

export default function App() {
  return <FamilyProvider><AppShell /></FamilyProvider>
}
