import React, { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  ReceiptText,
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

function LoginScreen() {
  const { data, login } = useFamily()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const result = login(name, password)
    if (!result.ok) setError(result.error || 'Accesso non riuscito.')
  }

  function quickUser(user: any) {
    setName(user.name)
    setPassword('')
    setError('')
  }

  return <div className="login-screen">
    <div className="login-visual">
      <div className="brand-mark brand-mark--lg"><span>V</span></div>
      <div className="login-visual__copy"><span className="eyebrow eyebrow--light">VerdoFamily</span><h1>La famiglia, organizzata bene.</h1><p>Calendario, spesa, pasti, compiti e paghette in un’unica app semplice da usare ogni giorno.</p></div>
      <div className="login-bubbles"><span>📅</span><span>🛒</span><span>🍝</span><span>💰</span></div>
    </div>
    <div className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>Family Hub</span></div></div>
        <div className="login-copy"><h2>Bentornato</h2><p>Accedi al tuo profilo personale.</p></div>
        <label className="field"><span className="field__label">Nome utente</span><input autoFocus autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder="Il tuo nome" /></label>
        <label className="field"><span className="field__label">Password</span><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" /></label>
        {error ? <div className="login-error">{error}</div> : null}
        <Button type="submit" className="login-submit">Accedi <ChevronRight size={18} /></Button>
        <div className="login-users"><span>Profili disponibili</span><div>{data.users.map(user => <button type="button" key={user.id} onClick={() => quickUser(user)} className={name === user.name ? 'is-selected' : ''}><Avatar user={user} size="sm" /><span>{user.name}</span></button>)}</div></div>
      </form>
    </div>
  </div>
}

function AppShell() {
  const { authUser, activePage, setActivePage, logout } = useFamily()
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

  if (!authUser) return <LoginScreen />

  return <div className="app-shell">
    <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`}>
      <div className="sidebar__head"><div className="brand-mark"><span>V</span></div><div><strong>VerdoFamily</strong><span>Family Hub</span></div><IconButton className="sidebar-close" label="Chiudi menu" onClick={() => setDrawerOpen(false)}><X size={20} /></IconButton></div>
      <nav className="sidebar__nav">{NAV.map((item, index) => <React.Fragment key={item.key}>{item.group && NAV[index - 1]?.group !== item.group ? <div className="nav-group-label">{item.group}</div> : null}<button className={activePage === item.key ? 'is-active' : ''} onClick={() => navigate(item.key)}><span>{item.icon}</span><strong>{item.label}</strong></button></React.Fragment>)}</nav>
      <div className="sidebar__footer"><button className="profile-chip" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span><strong>{authUser.name}</strong><small>{authUser.role}</small></span><ChevronRight size={17} /></button><button className="logout-btn" onClick={logout}><LogOut size={18} /> Esci</button></div>
    </aside>

    {drawerOpen ? <button className="scrim" aria-label="Chiudi menu" onClick={() => setDrawerOpen(false)} /> : null}

    <div className="app-main">
      <header className="topbar"><div className="topbar__left"><IconButton className="mobile-menu-btn" label="Menu" onClick={() => setDrawerOpen(true)}><Menu size={21} /></IconButton><div><span>{current?.label || 'VerdoFamily'}</span><small>Family Hub</small></div></div><div className="topbar__right"><IconButton label="Notifiche"><Bell size={19} /></IconButton><button className="topbar-profile" onClick={() => navigate('settings')}><Avatar user={authUser} size="sm" /><span>{authUser.name}</span></button></div></header>
      <main className="content"><PageRenderer /></main>
    </div>

    <nav className="bottom-nav" aria-label="Navigazione mobile">{bottomTabs.map(key => { const item = NAV.find(n => n.key === key); if (!item) return null; return <button key={key} className={activePage === key ? 'is-active' : ''} onClick={() => navigate(key)}><span>{item.icon}</span><small>{item.label.replace(' & Dispensa','').replace('Compiti & Paghette','Paghette')}</small></button> })}<button className={bottomTabs.includes(activePage) ? '' : 'is-active'} onClick={() => setMoreOpen(true)}><span><MoreHorizontal size={20} /></span><small>Altro</small></button></nav>

    {moreOpen ? <div className="mobile-more-layer" onMouseDown={e => { if (e.target === e.currentTarget) setMoreOpen(false) }}><div className="mobile-more"><div className="mobile-more__handle" /><div className="mobile-more__head"><strong>Altre sezioni</strong><IconButton label="Chiudi" onClick={() => setMoreOpen(false)}><X size={20} /></IconButton></div><div className="mobile-more__grid">{NAV.filter(n => !bottomTabs.includes(n.key)).map(item => <button key={item.key} onClick={() => navigate(item.key)} className={activePage === item.key ? 'is-active' : ''}><span>{item.icon}</span><strong>{item.label}</strong></button>)}</div><button className="mobile-more__logout" onClick={logout}><LogOut size={18} /> Esci</button></div></div> : null}
  </div>
}

export default function App() {
  return <FamilyProvider><AppShell /></FamilyProvider>
}
