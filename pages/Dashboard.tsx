import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListTodo,
  Plus,
  ReceiptText,
  ShoppingCart,
  Users,
  Utensils,
  WalletCards
} from 'lucide-react'
import { useFamily } from '../store'
import { Card, CardHeader, EmptyState, ListRow, PageIntro, StatCard } from '../ui'
import { addDays, dayLabel, localDateISO, money, weekDates } from '../utils'
import './dashboard-command-center.css'

type HomeView = 'today' | 'week' | 'family'

function shortDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export default function Dashboard() {
  const { data, authUser, setActivePage } = useFamily()
  const [homeView, setHomeView] = useState<HomeView>('today')
  const today = localDateISO()
  const week = weekDates(today)
  const weekEnd = week[week.length - 1] || addDays(today, 6)

  const eventsToday = useMemo(
    () => data.calendarEvents.filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [data.calendarEvents, today]
  )

  const nextDeadlines = useMemo(
    () => data.deadlines
      .filter(d => d.kind !== 'medicine' && d.kind !== 'therapy' && !d.done && d.date >= today && d.date <= addDays(today, 15))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5),
    [data.deadlines, today]
  )

  const pendingShopping = data.shopping.filter(x => !x.taken)
  const pendingChores = data.chores.filter(x => !x.done)
  const pendingTodos = data.todos.filter(x => !x.done)
  const lowStock = data.pantry.filter(x => Number(x.minQty || 0) > 0 && Number(x.qty || 0) <= Number(x.minQty || 0))

  const eventsByDate = useMemo(() => {
    const map: Record<string, typeof data.calendarEvents> = {}
    for (const date of week) map[date] = []
    for (const event of data.calendarEvents) {
      if (!map[event.date]) continue
      map[event.date].push(event)
    }
    Object.values(map).forEach(items => items.sort((a, b) => (a.time || '').localeCompare(b.time || '')))
    return map
  }, [data.calendarEvents, week.join('|')])

  const mealByDate = useMemo(() => {
    const map: Record<string, Array<{ name: string; slot: string; userId: number }>> = {}
    for (const date of week) map[date] = []
    for (const plan of data.mealPlans) {
      if (!map[plan.date]) continue
      const dish = data.dishes.find(d => d.id === plan.dishId)
      if (!dish) continue
      map[plan.date].push({
        name: dish.variant ? `${dish.name} · ${dish.variant}` : dish.name,
        slot: plan.slot,
        userId: plan.userId
      })
    }
    return map
  }, [data.mealPlans, data.dishes, week.join('|')])

  const deadlinesByDate = useMemo(() => {
    const map: Record<string, typeof data.deadlines> = {}
    for (const date of week) map[date] = []
    for (const deadline of data.deadlines) {
      if (!deadline.done && map[deadline.date] && deadline.kind !== 'medicine' && deadline.kind !== 'therapy') map[deadline.date].push(deadline)
    }
    return map
  }, [data.deadlines, week.join('|')])

  const choresByDate = useMemo(() => {
    const map: Record<string, typeof data.chores> = {}
    for (const date of week) map[date] = []
    for (const chore of data.chores) {
      if (!chore.done && map[chore.deadline]) map[chore.deadline].push(chore)
    }
    return map
  }, [data.chores, week.join('|')])

  const showBalances = authUser?.prefs?.showBalances !== false
  const totalBalance = data.users.reduce((sum, u) => sum + Number(u.balance || 0), 0)

  function participantNames(event: any) {
    if (event.audience === 'family') return 'Famiglia'
    const ids: number[] = event.userIds?.length ? event.userIds : [event.userId]
    const names = ids.map(id => data.users.find(user => user.id === id)?.name).filter(Boolean)
    return names.join(', ') || 'Famiglia'
  }

  function eventForUser(event: any, userId: number) {
    if (event.audience === 'family') return true
    const ids: number[] = event.userIds?.length ? event.userIds : [event.userId]
    return ids.includes(userId)
  }

  const familyCards = useMemo(() => data.users.map(user => {
    const weekEvents = data.calendarEvents
      .filter(event => event.date >= today && event.date <= weekEnd && eventForUser(event, user.id))
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
    const userTodos = pendingTodos.filter(item => item.userId === user.id)
    const userChores = pendingChores.filter(item => item.userId === user.id)
    const userDeadlines = data.deadlines
      .filter(item => !item.done && item.userId === user.id && item.date >= today && item.date <= weekEnd && item.kind !== 'medicine' && item.kind !== 'therapy')
      .sort((a, b) => a.date.localeCompare(b.date))
    return { user, weekEvents, userTodos, userChores, userDeadlines }
  }), [data.users, data.calendarEvents, data.deadlines, pendingTodos, pendingChores, today, weekEnd])

  const familyAlerts = [
    pendingShopping.length ? { label: `${pendingShopping.length} articoli da comprare`, page: 'shopping' as const } : null,
    lowStock.length ? { label: `${lowStock.length} prodotti sotto scorta`, page: 'shopping' as const } : null,
    nextDeadlines.length ? { label: `${nextDeadlines.length} scadenze nei prossimi 15 giorni`, page: 'deadlines' as const } : null,
    pendingTodos.length ? { label: `${pendingTodos.length} cose da fare aperte`, page: 'todos' as const } : null
  ].filter(Boolean) as Array<{ label: string; page: any }>

  return (
    <div className="page page--dashboard command-center">
      <div className="command-center__topline">
        <PageIntro
          eyebrow={dayLabel(today, true)}
          title={`Ciao ${authUser?.name || ''} 👋`}
          description="Il centro operativo della famiglia: oggi, settimana e situazione di tutti in un solo posto."
        />
        <div className="home-view-switch" role="tablist" aria-label="Vista Home">
          <button className={homeView === 'today' ? 'is-active' : ''} onClick={() => setHomeView('today')}>Oggi</button>
          <button className={homeView === 'week' ? 'is-active' : ''} onClick={() => setHomeView('week')}>Settimana</button>
          <button className={homeView === 'family' ? 'is-active' : ''} onClick={() => setHomeView('family')}>Famiglia</button>
        </div>
      </div>

      <div className="quick-actions" aria-label="Azioni rapide">
        <button onClick={() => setActivePage('calendar')}><CalendarDays size={18} /><span>Nuovo impegno</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('shopping')}><ShoppingCart size={18} /><span>Aggiungi spesa</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('meals')}><Utensils size={18} /><span>Pianifica pasto</span><Plus size={16} /></button>
        <button onClick={() => setActivePage('todos')}><ListTodo size={18} /><span>Da fare</span><Plus size={16} /></button>
      </div>

      {homeView === 'today' ? <>
        <div className="stats-grid command-stats">
          <StatCard icon={<Clock3 size={20} />} label="Impegni oggi" value={eventsToday.length} note={eventsToday[0] ? `${eventsToday[0].time || 'Tutto il giorno'} · ${eventsToday[0].title}` : 'Nessun impegno'} onClick={() => setActivePage('calendar')} />
          <StatCard icon={<ShoppingCart size={20} />} label="Da comprare" value={pendingShopping.length} note={pendingShopping[0]?.name || 'Lista vuota'} onClick={() => setActivePage('shopping')} tone="mint" />
          <StatCard icon={<ReceiptText size={20} />} label="Scadenze" value={nextDeadlines.length} note={nextDeadlines[0] ? `${shortDate(nextDeadlines[0].date)} · ${nextDeadlines[0].title}` : 'Tutto in ordine'} onClick={() => setActivePage('deadlines')} tone="amber" />
          <StatCard icon={<WalletCards size={20} />} label="Paghette" value={showBalances ? money(totalBalance) : '••••'} note={`${pendingChores.length} compiti da completare`} onClick={() => setActivePage('chores')} tone="violet" />
        </div>

        <div className="command-grid command-grid--today">
          <Card className="command-panel command-panel--agenda">
            <CardHeader title="Agenda di oggi" subtitle="Tutti gli impegni in ordine" action={<button className="text-link" onClick={() => setActivePage('calendar')}>Calendario <ChevronRight size={16} /></button>} />
            {eventsToday.length ? <div className="timeline-list">
              {eventsToday.slice(0, 7).map(event => <ListRow key={event.id} leading={<span className="time-pill">{event.time || '—'}</span>} title={event.title} subtitle={participantNames(event)} trailing={<ChevronRight size={17} />} onClick={() => setActivePage('calendar')} />)}
            </div> : <EmptyState icon={<CalendarDays size={28} />} title="Giornata libera" text="Nessun impegno previsto per oggi." />}
          </Card>

          <Card className="command-panel">
            <CardHeader title="Pasti di oggi" subtitle="Pranzo e cena pianificati" action={<button className="text-link" onClick={() => setActivePage('meals')}>Pasti <ChevronRight size={16} /></button>} />
            {(mealByDate[today] || []).length ? <div className="command-simple-list">{mealByDate[today].map((meal, index) => <button key={`${meal.slot}-${index}`} onClick={() => setActivePage('meals')}><Utensils size={17} /><span><strong>{meal.slot}</strong><small>{meal.name}</small></span></button>)}</div> : <EmptyState icon={<Utensils size={28} />} title="Pasti non pianificati" text="Puoi aggiungere pranzo e cena dal planner pasti." />}
          </Card>

          <Card className="command-panel">
            <CardHeader title="Da fare" subtitle="Attività ancora aperte" action={<button className="text-link" onClick={() => setActivePage('todos')}>Tutte <ChevronRight size={16} /></button>} />
            {pendingTodos.length || pendingChores.length ? <div className="command-simple-list">
              {pendingTodos.slice(0, 3).map(item => <button key={`todo-${item.id}`} onClick={() => setActivePage('todos')}><ListTodo size={17} /><span><strong>{item.title}</strong><small>{data.users.find(u => u.id === item.userId)?.name || 'Famiglia'}</small></span></button>)}
              {pendingChores.slice(0, 2).map(item => <button key={`chore-${item.id}`} onClick={() => setActivePage('chores')}><CheckCircle2 size={17} /><span><strong>{item.title}</strong><small>{data.users.find(u => u.id === item.userId)?.name || 'Famiglia'} · entro {shortDate(item.deadline)}</small></span></button>)}
            </div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Tutto fatto" text="Non risultano attività aperte." />}
          </Card>

          <Card className="command-panel command-panel--alerts">
            <CardHeader title="Avvisi" subtitle="Quello che richiede attenzione" />
            {familyAlerts.length ? <div className="command-alerts">{familyAlerts.map((alert, index) => <button key={index} onClick={() => setActivePage(alert.page)}><AlertTriangle size={17} /><span>{alert.label}</span><ChevronRight size={16} /></button>)}</div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Nessun avviso" text="La situazione della famiglia è sotto controllo." />}
          </Card>
        </div>
      </> : null}

      {homeView === 'week' ? <div className="week-command-view">
        <div className="week-command-heading">
          <div><span className="eyebrow">Planner familiare</span><h2>La settimana in un colpo d’occhio</h2><p>Agenda, pasti, attività e scadenze raccolti giorno per giorno.</p></div>
          <button className="week-command-heading__calendar" onClick={() => setActivePage('calendar')}><CalendarDays size={18} /> Apri calendario</button>
        </div>
        <div className="week-command-grid">
          {week.map(date => {
            const events = eventsByDate[date] || []
            const meals = mealByDate[date] || []
            const deadlines = deadlinesByDate[date] || []
            const chores = choresByDate[date] || []
            return <section key={date} className={`week-command-day ${date === today ? 'is-today' : ''}`}>
              <header><span>{dayLabel(date)}</span><strong>{date.slice(8, 10)}</strong>{date === today ? <small>Oggi</small> : null}</header>
              <div className="week-command-day__section">
                <label><CalendarDays size={15} /> Agenda</label>
                {events.length ? events.slice(0, 3).map(event => <button key={event.id} onClick={() => setActivePage('calendar')}><span>{event.time || '—'}</span><strong>{event.title}</strong></button>) : <em>Nessun impegno</em>}
                {events.length > 3 ? <small>+{events.length - 3} altri</small> : null}
              </div>
              <div className="week-command-day__section">
                <label><Utensils size={15} /> Pasti</label>
                {meals.length ? meals.slice(0, 2).map((meal, index) => <button key={`${meal.slot}-${index}`} onClick={() => setActivePage('meals')}><span>{meal.slot}</span><strong>{meal.name}</strong></button>) : <em>Da pianificare</em>}
              </div>
              {(chores.length || deadlines.length) ? <div className="week-command-day__flags">
                {chores.length ? <button onClick={() => setActivePage('chores')}><ListTodo size={14} /> {chores.length} attività</button> : null}
                {deadlines.length ? <button onClick={() => setActivePage('deadlines')}><ReceiptText size={14} /> {deadlines.length} scadenze</button> : null}
              </div> : null}
            </section>
          })}
        </div>
        <div className="week-command-footer">
          <button onClick={() => setActivePage('shopping')}><ShoppingCart size={18} /><span><strong>{pendingShopping.length}</strong><small>da comprare</small></span></button>
          <button onClick={() => setActivePage('todos')}><ListTodo size={18} /><span><strong>{pendingTodos.length}</strong><small>da fare</small></span></button>
          <button onClick={() => setActivePage('deadlines')}><ReceiptText size={18} /><span><strong>{nextDeadlines.length}</strong><small>scadenze vicine</small></span></button>
          <button onClick={() => setActivePage('shopping')}><AlertTriangle size={18} /><span><strong>{lowStock.length}</strong><small>sotto scorta</small></span></button>
        </div>
      </div> : null}

      {homeView === 'family' ? <div className="family-command-view">
        <div className="week-command-heading">
          <div><span className="eyebrow">Famiglia</span><h2>Chi deve fare cosa</h2><p>Una vista rapida degli impegni e delle attività di ogni membro.</p></div>
          <button className="week-command-heading__calendar" onClick={() => setActivePage('users')}><Users size={18} /> Membri</button>
        </div>
        <div className="family-command-grid">
          {familyCards.map(({ user, weekEvents, userTodos, userChores, userDeadlines }) => <Card key={user.id} className="family-member-card">
            <div className="family-member-card__head">
              <span className="family-member-dot" style={{ background: user.color }} />
              <div><strong>{user.name}</strong><small>{user.role}</small></div>
              <span className="family-member-card__count">{weekEvents.length} impegni</span>
            </div>
            <div className="family-member-card__next">
              <label>Prossimo impegno</label>
              {weekEvents[0] ? <button onClick={() => setActivePage('calendar')}><CalendarDays size={16} /><span><strong>{weekEvents[0].title}</strong><small>{shortDate(weekEvents[0].date)} · {weekEvents[0].time || 'tutto il giorno'}</small></span></button> : <span className="family-member-card__empty">Nessun impegno questa settimana</span>}
            </div>
            <div className="family-member-card__metrics">
              <button onClick={() => setActivePage('todos')}><strong>{userTodos.length}</strong><small>da fare</small></button>
              <button onClick={() => setActivePage('chores')}><strong>{userChores.length}</strong><small>compiti</small></button>
              <button onClick={() => setActivePage('deadlines')}><strong>{userDeadlines.length}</strong><small>scadenze</small></button>
            </div>
          </Card>)}
        </div>
      </div> : null}
    </div>
  )
}
