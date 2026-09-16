from pathlib import Path

p = Path('App.tsx')
s = p.read_text()
old = '''const NAV: Array<{ key: PageKey; label: string; icon: React.ReactNode; group?: string }> = [
  { key: 'home', label: 'Home', icon: <Home size={20} /> },
  { key: 'calendar', label: 'Calendario', icon: <CalendarDays size={20} /> },
  { key: 'shopping', label: 'Spesa & Dispensa', icon: <ShoppingBasket size={20} /> },
  { key: 'meals', label: 'Pasti', icon: <Utensils size={20} /> },
  { key: 'chores', label: 'Compiti & Paghette', icon: <WalletCards size={20} /> },
  { key: 'health', label: 'Salute', icon: <HeartPulse size={20} /> },
  { key: 'deadlines', label: 'Scadenze', icon: <ReceiptText size={20} /> },
  { key: 'todos', label: 'ToDo List', icon: <CheckSquare2 size={20} /> },
  { key: 'users', label: 'Utenti', icon: <Users size={20} />, group: 'Gestione' },
  { key: 'settings', label: 'Impostazioni', icon: <Settings size={20} />, group: 'Gestione' }
]'''
new = '''const NAV: Array<{ key: PageKey; label: string; icon: React.ReactNode; group?: string }> = [
  { key: 'home', label: 'Home', icon: <Home size={20} />, group: 'Oggi' },
  { key: 'calendar', label: 'Calendario', icon: <CalendarDays size={20} />, group: 'Oggi' },
  { key: 'shopping', label: 'Spesa & Dispensa', icon: <ShoppingBasket size={20} />, group: 'Casa' },
  { key: 'meals', label: 'Pasti', icon: <Utensils size={20} />, group: 'Casa' },
  { key: 'chores', label: 'Compiti & Paghette', icon: <WalletCards size={20} />, group: 'Famiglia' },
  { key: 'health', label: 'Salute', icon: <HeartPulse size={20} />, group: 'Famiglia' },
  { key: 'deadlines', label: 'Scadenze', icon: <ReceiptText size={20} />, group: 'Famiglia' },
  { key: 'todos', label: 'Da fare', icon: <CheckSquare2 size={20} />, group: 'Famiglia' },
  { key: 'users', label: 'Membri', icon: <Users size={20} />, group: 'Gestione' },
  { key: 'settings', label: 'Impostazioni', icon: <Settings size={20} />, group: 'Gestione' }
]'''
if old not in s:
    raise SystemExit('NAV block not found')
p.write_text(s.replace(old, new))
