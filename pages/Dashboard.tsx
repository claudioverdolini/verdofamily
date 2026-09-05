import React, { useMemo } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListTodo,
  Plus,
  ReceiptText,
  ShoppingCart,
  Utensils,
  WalletCards
} from 'lucide-react'
import { useFamily } from '../store'
import { Card, CardHeader, EmptyState, ListRow, PageIntro, StatCard } from '../ui'
import { addDays, dayLabel, localDateISO, money, weekDates } from '../utils'

export default function Dashboard() {
  const { data, authUser, setActivePage } = useFamily()
  const today = localDateISO()

  const eventsToday = useMemo(
    () => data.calendarEvents.filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [data.calendarEvents, today]
  )

  const nextDeadlines = useMemo(
    () => data.deadlines
      .filter(d => !d.done && d.date >= today && d.date <= addDays(today, 15))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4),
    [data.deadlines, today]
  )

  const pendingShopping = data.shopping.filter(x => !x.taken)
  const pendingChores = data.chores.filter(x => !x.done)
  const week = weekDates(today)

  const mealByDate = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const plan of data.mealPlans) {
      if (!week.includes(plan.date)) continue
      const dish = data.dishes.find(d => d.id === plan.dishId)
      if (!dish) continue
      map[plan.date] ||= []
      map[plan.date].push(dish.variant ? `${dish.name} · ${dish.variant}` : dish.name)
    }
    return map
  }, [data.mealPlans, data.dishes, week.join('|')])

  const showBalances = authUser?.prefs?.showBalances !== false
  const totalBalance = data.users.reduce((sum, u) => sum + Number(u.balance || 0), 0)

  return (
    <div className="page page--dashboard">
      <PageIntro
        eyebrow={dayLabel(today, true)}
        title={`Ciao ${authUser?.name || ''} 👋`}
        description="Tutto quello che serve alla famiglia, senza cercare in dieci posti diversi."
      />

      <div className="quick-actions" aria-label="Azioni rapide">
        <button onClick={() => setActivePage('calendar')}><CalendarDays size={18} /><span>Nuovo impegno</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('shopping')}><ShoppingCart size={18} /><span>Aggiungi spesa</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('meals')}><Utensils size={18} /><span>Pianifica pasto</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('chores')}><ListTodo size={18} /><span>Nuovo compito</span><Plus size={16} /></button>
      </div>

      <div className="stats-grid">
        <StatCard icon={<Clock3 size={20} />} label="Oggi" value={eventsToday.length} note={eventsToday[0] ? `${eventsToday[0].time || 'Tutto il giorno'} · ${eventsToday[0].title}` : 'Nessun impegno'} onClick={() => setActivePage('calendar')} />
        <StatCard icon={<ShoppingCart size={20} />} label="Da comprare" value={pendingShopping.length} note={pendingShopping[0]?.name || 'Lista vuota'} onClick={() => setActivePage('shopping')} tone="mint" />
        <StatCard icon={<ReceiptText size={20} />} label="Scadenze" value={nextDeadlines.length} note={nextDeadlines[0] ? `${nextDeadlines[0].date.slice(8, 10)}/${nextDeadlines[0].date.slice(5, 7)} · ${nextDeadlines[0].title}` : 'Tutto in ordine'} onClick={() => setActivePage('deadlines')} tone="amber" />
        <StatCard icon={<WalletCards size={20} />} label="Paghette" value={showBalances ? money(totalBalance) : '••••'} note={`${pendingChores.length} compiti da completare`} onClick={() => setActivePage('chores')} tone="violet" />
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-card dashboard-card--wide">
          <CardHeader title="Oggi" subtitle="Impegni ordinati per orario" action={<button className="text-link" onClick={() => setActivePage('calendar')}>Calendario <ChevronRight size={16} /></button>} />
          {eventsToday.length ? (
            <div className="timeline-list">
              {eventsToday.slice(0, 6).map(event => {
                const user = data.users.find(u => u.id === event.userId)
                return <ListRow key={event.id} leading={<span className="time-pill">{event.time || '—'}</span>} title={event.title} subtitle={user?.name || 'Famiglia'} trailing={<ChevronRight size={17} />} onClick={() => setActivePage('calendar')} />
              })}
            </div>
          ) : <EmptyState icon={<CalendarDays size={28} />} title="Giornata libera" text="Nessun impegno previsto per oggi." />}
        </Card>

        <Card className="dashboard-card">
          <CardHeader title="Scadenze vicine" subtitle="Prossimi 15 giorni" action={<button className="text-link" onClick={() => setActivePage('deadlines')}>Tutte <ChevronRight size={16} /></button>} />
          {nextDeadlines.length ? (
            <div className="compact-list">
              {nextDeadlines.map(item => <ListRow key={item.id} leading={<span className="date-chip"><strong>{item.date.slice(8, 10)}</strong><small>{parseInt(item.date.slice(5, 7), 10)}</small></span>} title={item.title} subtitle={data.users.find(u => u.id === item.userId)?.name || 'Famiglia'} />)}
            </div>
          ) : <EmptyState icon={<CheckCircle2 size={28} />} title="Nessuna urgenza" text="Non ci sono scadenze nei prossimi 15 giorni." />}
        </Card>

        <Card className="dashboard-card dashboard-card--full">
          <CardHeader title="Programma settimanale" subtitle="Una vista semplice dei pasti già pianificati" action={<button className="text-link" onClick={() => setActivePage('meals')}>Apri planner <ChevronRight size={16} /></button>} />
          <div className="week-strip">
            {week.map(date => {
              const dishes = mealByDate[date] || []
              return <button key={date} className={`week-day ${date === today ? 'is-today' : ''}`} onClick={() => setActivePage('meals')}><span className="week-day__label">{dayLabel(date)}</span><span className="week-day__count">{dishes.length ? `${dishes.length} ${dishes.length === 1 ? 'pasto' : 'pasti'}` : 'Libero'}</span><span className="week-day__dish">{dishes[0] || '—'}</span></button>
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
