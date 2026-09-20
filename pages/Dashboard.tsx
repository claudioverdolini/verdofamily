import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  HeartPulse,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GraduationCap,
  ListTodo,
  Pin,
  Plus,
  ReceiptText,
  ShoppingBasket,
  ShoppingCart,
  Users,
  Utensils,
  WalletCards
} from 'lucide-react'
import { useFamily } from '../store'
import { Card, CardHeader, EmptyState, ListRow } from '../ui'
import { addDays, dayLabel, localDateISO, money, pantryExpiryDays, pantryNeedsRestock, routineCompletedOn, routineDueOn, weekDates } from '../utils'
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

  const upcomingHealth = useMemo(
    () => data.deadlines
      .filter(d => ['visit', 'therapy', 'medicine', 'health-record'].includes(d.kind || ''))
      .filter(d => !d.done && d.date >= today)
      .filter(d => authUser?.role !== 'bimbo' || d.userId === authUser.id || d.userId === 0)
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
      .slice(0, 3),
    [data.deadlines, authUser?.id, authUser?.role, today]
  )

  const tomorrow = addDays(today, 1)
  const schoolTomorrow = data.schoolItems
    .filter(item => !item.done && item.date === tomorrow)
    .filter(item => authUser?.role !== 'bimbo' || item.userId === authUser.id)
  const schoolTomorrowLessons = data.schoolTimetable
    .filter(entry => entry.weekday === (() => { const day = new Date(`${tomorrow}T12:00:00`).getDay(); return day === 0 ? 7 : day })())
    .filter(entry => authUser?.role !== 'bimbo' || entry.userId === authUser.id)

  const boardVisible = data.boardPosts
    .filter(post => post.authorUserId === authUser?.id || post.audience === 'family' || (post.userIds || []).includes(authUser?.id || 0))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const pinnedBoard = boardVisible.filter(post => post.pinned)
  const boardDueSoon = boardVisible.filter(post => post.type === 'reminder' && post.dueDate && post.dueDate >= today && post.dueDate <= tomorrow)

  const pendingShopping = data.shopping.filter(x => !x.taken)
  const shoppingPreview = pendingShopping.slice(0, 4)
  const pendingChores = data.chores.filter(x => !x.done)
  const choresAwaitingApproval = data.chores.filter(x => !x.done && x.completionStatus === 'pending')
  const choresStillToDo = pendingChores.filter(x => x.completionStatus !== 'pending')
  const pendingTodos = data.todos.filter(x => !x.done)
  const dueRoutinesToday = data.routines.filter(routine =>
    routineDueOn(routine, today) && !routineCompletedOn(data.routineCompletions, routine.id, today)
  )
  const lowStock = data.pantry.filter(item => pantryNeedsRestock(item, data.pantryMovements, today))
  const expiringInventory = data.pantry
    .map(item => ({ item, days: pantryExpiryDays(item, today) }))
    .filter(entry => entry.days !== null && entry.days <= 3)

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

  const routinesByDate = useMemo(() => {
    const map: Record<string, typeof data.routines> = {}
    for (const date of week) map[date] = []
    for (const date of week) {
      map[date] = data.routines.filter(routine =>
        routineDueOn(routine, date) && !routineCompletedOn(data.routineCompletions, routine.id, date)
      )
    }
    return map
  }, [data.routines, data.routineCompletions, week.join('|')])

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
  const visibleHomeCards = new Set(authUser?.prefs?.homeCards?.length
    ? authUser.prefs.homeCards
    : ['today', 'shopping', 'meals', 'school', 'board', 'deadlines'])
  const showWidget = (key: string) => visibleHomeCards.has(key as any)

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
    const userRoutines = week.flatMap(date => (routinesByDate[date] || []).filter(item => item.userId === user.id))
    const userChores = pendingChores.filter(item => item.userId === user.id)
    const userDeadlines = data.deadlines
      .filter(item => !item.done && item.userId === user.id && item.date >= today && item.date <= weekEnd && item.kind !== 'medicine' && item.kind !== 'therapy')
      .sort((a, b) => a.date.localeCompare(b.date))
    return { user, weekEvents, userTodos, userRoutines, userChores, userDeadlines }
  }), [data.users, data.calendarEvents, data.deadlines, pendingTodos, pendingChores, routinesByDate, week.join('|'), today, weekEnd])

  const familyAlerts = [
    pendingShopping.length ? { label: `${pendingShopping.length} articoli da comprare`, page: 'shopping' as const } : null,
    lowStock.length ? { label: `${lowStock.length} prodotti da reintegrare`, page: 'shopping' as const } : null,
    expiringInventory.length ? { label: `${expiringInventory.length} prodotti in scadenza`, page: 'shopping' as const } : null,
    nextDeadlines.length ? { label: `${nextDeadlines.length} scadenze nei prossimi 15 giorni`, page: 'deadlines' as const } : null,
    pendingTodos.length ? { label: `${pendingTodos.length} promemoria aperti`, page: 'todos' as const } : null,
    dueRoutinesToday.length ? { label: `${dueRoutinesToday.length} routine da fare oggi`, page: 'todos' as const } : null,
    schoolTomorrow.length ? { label: `${schoolTomorrow.length} cose di scuola da preparare per domani`, page: 'school' as const } : null,
    boardDueSoon.length ? { label: `${boardDueSoon.length} promemoria in bacheca tra oggi e domani`, page: 'board' as const } : null,
    authUser?.role !== 'bimbo' && choresAwaitingApproval.length ? { label: `${choresAwaitingApproval.length} compiti da confermare`, page: 'chores' as const } : null
  ].filter(Boolean) as Array<{ label: string; page: any }>

  return (
    <div className="page page--dashboard command-center">
      <section className="familywall-hero">
        <div className="familywall-hero__copy">
          <span className="familywall-hero__date">{dayLabel(today, true)}</span>
          <h1>Ciao {authUser?.name || ''} <span aria-hidden="true">👋</span></h1>
          <p>Quello che serve alla famiglia, subito.</p>
        </div>
        <div className="home-view-switch" role="tablist" aria-label="Vista Home">
          <button className={homeView === 'today' ? 'is-active' : ''} onClick={() => setHomeView('today')}>Oggi</button>
          <button className={homeView === 'week' ? 'is-active' : ''} onClick={() => setHomeView('week')}>Settimana</button>
          <button className={homeView === 'family' ? 'is-active' : ''} onClick={() => setHomeView('family')}>Famiglia</button>
        </div>
      </section>

      <div className="home-quick-actions" aria-label="Azioni rapide">
        <button className="home-quick-action home-quick-action--calendar" onClick={() => setActivePage('calendar')}><span><CalendarDays size={20} /></span><strong>Impegno</strong><Plus size={16} /></button>
        <button className="home-quick-action home-quick-action--shopping" onClick={() => setActivePage('shopping')}><span><ShoppingCart size={20} /></span><strong>Spesa</strong><Plus size={16} /></button>
        <button className="home-quick-action home-quick-action--meals" onClick={() => setActivePage('meals')}><span><Utensils size={20} /></span><strong>Pasto</strong><Plus size={16} /></button>
        <button className="home-quick-action home-quick-action--todos" onClick={() => setActivePage('todos')}><span><ListTodo size={20} /></span><strong>Da fare</strong><Plus size={16} /></button>
      </div>

      {homeView === 'today' ? <>
        <div className="home-glance" aria-label="Riepilogo rapido">
          <button className="home-glance__item home-glance__item--calendar" onClick={() => setActivePage('calendar')}>
            <span className="home-glance__icon"><Clock3 size={19} /></span>
            <span><small>Oggi</small><strong>{eventsToday.length} {eventsToday.length === 1 ? 'impegno' : 'impegni'}</strong></span>
          </button>
          <button className="home-glance__item home-glance__item--shopping" onClick={() => setActivePage('shopping')}>
            <span className="home-glance__icon"><ShoppingCart size={19} /></span>
            <span><small>Spesa</small><strong>{pendingShopping.length} da comprare</strong></span>
          </button>
          <button className="home-glance__item home-glance__item--deadlines" onClick={() => setActivePage('deadlines')}>
            <span className="home-glance__icon"><ReceiptText size={19} /></span>
            <span><small>Scadenze</small><strong>{nextDeadlines.length} prossime</strong></span>
          </button>
          <button className="home-glance__item home-glance__item--chores" onClick={() => setActivePage('chores')}>
            <span className="home-glance__icon"><WalletCards size={19} /></span>
            <span><small>Paghette</small><strong>{showBalances ? money(totalBalance) : '••••'}</strong></span>
          </button>
        </div>

        <div className="command-grid command-grid--today">
          {showWidget('today') ? <Card className="command-panel home-widget home-widget--calendar command-panel--agenda">
            <div className="home-widget__head">
              <span className="home-widget__icon"><CalendarDays size={20} /></span>
              <div><small>Calendario</small><strong>Agenda di oggi</strong></div>
              <span className="home-widget__count">{eventsToday.length}</span>
              <button aria-label="Apri calendario" onClick={() => setActivePage('calendar')}><ChevronRight size={19} /></button>
            </div>
            {eventsToday.length ? <div className="timeline-list">
              {eventsToday.slice(0, 3).map(event => <ListRow key={event.id} leading={<span className="time-pill">{event.time || '—'}</span>} title={event.title} subtitle={participantNames(event)} trailing={<ChevronRight size={17} />} onClick={() => setActivePage('calendar')} />)}
              {eventsToday.length > 3 ? <button className="home-widget__more" onClick={() => setActivePage('calendar')}>+{eventsToday.length - 3} altri impegni</button> : null}
            </div> : <EmptyState icon={<CalendarDays size={28} />} title="Giornata libera" text="Nessun impegno previsto per oggi." />}
          </Card> : null}

          {showWidget('shopping') ? <Card className="command-panel home-widget home-widget--shopping">
            <div className="home-widget__head">
              <span className="home-widget__icon"><ShoppingBasket size={20} /></span>
              <div><small>Spesa</small><strong>Lista da comprare</strong></div>
              <span className="home-widget__count">{pendingShopping.length}</span>
              <button aria-label="Apri lista spesa" onClick={() => setActivePage('shopping')}><ChevronRight size={19} /></button>
            </div>
            {shoppingPreview.length ? <>
              <div className="home-widget__chips">
                {shoppingPreview.map(item => <button key={item.id} onClick={() => setActivePage('shopping')}><span>{item.name}</span><small>{item.qty} {item.unit}</small></button>)}
              </div>
              <div className="home-widget__footer">
                <span>{lowStock.length ? `${lowStock.length} da reintegrare` : 'Dispensa sotto controllo'}</span>
                {pendingShopping.length > shoppingPreview.length ? <strong>+{pendingShopping.length - shoppingPreview.length}</strong> : null}
              </div>
            </> : <EmptyState icon={<ShoppingCart size={28} />} title="Lista vuota" text="Non ci sono articoli da comprare." />}
          </Card> : null}

          {showWidget('meals') ? <Card className="command-panel home-widget home-widget--meals">
            <div className="home-widget__head">
              <span className="home-widget__icon"><Utensils size={20} /></span>
              <div><small>Pasti</small><strong>Oggi a tavola</strong></div>
              <span className="home-widget__count">{(mealByDate[today] || []).length}</span>
              <button aria-label="Apri pasti" onClick={() => setActivePage('meals')}><ChevronRight size={19} /></button>
            </div>
            {(mealByDate[today] || []).length ? <div className="home-meal-preview">{mealByDate[today].map((meal, index) =>
              <button key={`${meal.slot}-${index}`} onClick={() => setActivePage('meals')}>
                <span>{meal.slot}</span><strong>{meal.name}</strong>
              </button>)}</div>
              : <EmptyState icon={<Utensils size={28} />} title="Pasti non pianificati" text="Aggiungi pranzo e cena dal planner." />}
          </Card> : null}

          {showWidget('school') ? <Card className="command-panel home-widget home-widget--school">
            <div className="home-widget__head">
              <span className="home-widget__icon"><GraduationCap size={20} /></span>
              <div><small>Scuola</small><strong>Domani</strong></div>
              <span className="home-widget__count">{schoolTomorrow.length || schoolTomorrowLessons.length}</span>
              <button aria-label="Apri scuola" onClick={() => setActivePage('school')}><ChevronRight size={19} /></button>
            </div>
            {schoolTomorrow.length || schoolTomorrowLessons.length ? <div className="command-simple-list">
              {schoolTomorrow.slice(0, 2).map(item => <button key={`school-${item.id}`} onClick={() => setActivePage('school')}><GraduationCap size={17} /><span><strong>{item.title}</strong><small>{data.users.find(u => u.id === item.userId)?.name || 'Scuola'}</small></span></button>)}
              {schoolTomorrow.length === 0 && schoolTomorrowLessons.length ? <button onClick={() => setActivePage('school')}><GraduationCap size={17} /><span><strong>{schoolTomorrowLessons.length} lezioni previste</strong><small>Controlla orario e zaino</small></span></button> : null}
            </div> : <EmptyState icon={<GraduationCap size={28} />} title="Niente da preparare" text="Nessun impegno scolastico per domani." />}
          </Card> : null}

          {showWidget('board') ? <Card className="command-panel home-widget home-widget--board command-panel--board">
            <div className="home-widget__head">
              <span className="home-widget__icon"><Pin size={20} /></span>
              <div><small>Bacheca</small><strong>In evidenza</strong></div>
              <span className="home-widget__count">{pinnedBoard.length || boardDueSoon.length}</span>
              <button aria-label="Apri bacheca" onClick={() => setActivePage('board')}><ChevronRight size={19} /></button>
            </div>
            {pinnedBoard.length ? <div className="home-board-list">
              {pinnedBoard.slice(0, 2).map(post => <button key={post.id} onClick={() => setActivePage('board')}>
                <Pin size={16} />
                <span><strong>{post.title || post.body.slice(0, 55) || 'Contenuto fissato'}</strong><small>{post.body && post.title ? post.body.slice(0, 80) : post.type === 'reminder' && post.dueDate ? `Promemoria · ${shortDate(post.dueDate)}` : 'Bacheca familiare'}</small></span>
                <ChevronRight size={15} />
              </button>)}
            </div> : boardDueSoon.length ? <div className="home-board-list">
              {boardDueSoon.slice(0, 2).map(post => <button key={post.id} onClick={() => setActivePage('board')}>
                <Pin size={16} /><span><strong>{post.title || post.body.slice(0, 55) || 'Promemoria'}</strong><small>{post.dueDate ? `Per ${shortDate(post.dueDate)}` : 'Bacheca familiare'}</small></span><ChevronRight size={15} />
              </button>)}
            </div> : <EmptyState icon={<Pin size={28} />} title="Niente in evidenza" text="Fissa un messaggio per ritrovarlo subito qui." />}
          </Card> : null}

          {showWidget('deadlines') ? <Card className="command-panel home-widget home-widget--deadlines">
            <div className="home-widget__head">
              <span className="home-widget__icon"><ReceiptText size={20} /></span>
              <div><small>Scadenze</small><strong>Prossime</strong></div>
              <span className="home-widget__count">{nextDeadlines.length}</span>
              <button aria-label="Apri scadenze" onClick={() => setActivePage('deadlines')}><ChevronRight size={19} /></button>
            </div>
            {nextDeadlines.length ? <div className="home-deadline-list">
              {nextDeadlines.slice(0, 3).map(item => <button key={item.id} onClick={() => setActivePage('deadlines')}>
                <span className="home-date-chip"><strong>{item.date.slice(8,10)}</strong><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('it-IT',{month:'short'}).replace('.','')}</small></span>
                <span><strong>{item.title}</strong><small>{data.users.find(u => u.id === item.userId)?.name || 'Famiglia'}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </div> : <EmptyState icon={<ReceiptText size={28} />} title="Nessuna scadenza vicina" text="Non risultano scadenze nei prossimi 15 giorni." />}
          </Card> : null}

          {showWidget('todos') ? <Card className="command-panel home-widget home-widget--todos">
            <div className="home-widget__head">
              <span className="home-widget__icon"><ListTodo size={20} /></span>
              <div><small>Da fare</small><strong>Attività aperte</strong></div>
              <span className="home-widget__count">{pendingTodos.length + dueRoutinesToday.length}</span>
              <button aria-label="Apri da fare" onClick={() => setActivePage('todos')}><ChevronRight size={19} /></button>
            </div>
            {pendingTodos.length || dueRoutinesToday.length || pendingChores.length ? <div className="command-simple-list">
              {dueRoutinesToday.slice(0, 1).map(item => <button key={`routine-${item.id}`} onClick={() => setActivePage('todos')}><ListTodo size={17} /><span><strong>{item.title}</strong><small>Routine · {data.users.find(u => u.id === item.userId)?.name || 'Famiglia'}</small></span></button>)}
              {pendingTodos.slice(0, 2).map(item => <button key={`todo-${item.id}`} onClick={() => setActivePage('todos')}><ListTodo size={17} /><span><strong>{item.title}</strong><small>{data.users.find(u => u.id === item.userId)?.name || 'Famiglia'}</small></span></button>)}
            </div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Tutto fatto" text="Non risultano attività aperte." />}
          </Card> : null}

          {showWidget('wallets') ? <Card className="command-panel home-widget home-widget--wallets">
            <div className="home-widget__head">
              <span className="home-widget__icon"><WalletCards size={20} /></span>
              <div><small>Paghette</small><strong>Situazione</strong></div>
              <span className="home-widget__count">{choresAwaitingApproval.length}</span>
              <button aria-label="Apri paghette" onClick={() => setActivePage('chores')}><ChevronRight size={19} /></button>
            </div>
            <button className="home-wallet-summary" onClick={() => setActivePage('chores')}>
              <span><small>Saldo famiglia</small><strong>{showBalances ? money(totalBalance) : '••••'}</strong></span>
              <span><small>Da fare</small><strong>{choresStillToDo.length}</strong></span>
              <span><small>Da confermare</small><strong>{choresAwaitingApproval.length}</strong></span>
            </button>
          </Card> : null}

          {showWidget('health') ? <Card className="command-panel home-widget home-widget--health">
            <div className="home-widget__head">
              <span className="home-widget__icon"><HeartPulse size={20} /></span>
              <div><small>Salute</small><strong>Prossimi promemoria</strong></div>
              <span className="home-widget__count">{upcomingHealth.length}</span>
              <button aria-label="Apri salute" onClick={() => setActivePage('health')}><ChevronRight size={19} /></button>
            </div>
            {upcomingHealth.length ? <div className="home-deadline-list">
              {upcomingHealth.slice(0, 2).map(item => <button key={item.id} onClick={() => setActivePage('health')}>
                <span className="home-date-chip"><strong>{item.date.slice(8,10)}</strong><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('it-IT',{month:'short'}).replace('.','')}</small></span>
                <span><strong>{item.title}</strong><small>{item.time || (item.kind === 'therapy' ? 'Terapia' : item.kind === 'medicine' ? 'Farmaco' : 'Salute')}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </div> : <EmptyState icon={<HeartPulse size={28} />} title="Nessun promemoria vicino" text="Non risultano attività salute future." />}
          </Card> : null}

          <Card className="command-panel home-widget home-widget--alerts command-panel--alerts">
            <div className="home-widget__head">
              <span className="home-widget__icon"><AlertTriangle size={20} /></span>
              <div><small>Sistema</small><strong>Avvisi</strong></div>
              <span className="home-widget__count">{familyAlerts.length}</span>
            </div>
            {familyAlerts.length ? <div className="command-alerts">{familyAlerts.slice(0, 5).map((alert, index) => <button key={index} onClick={() => setActivePage(alert.page)}><AlertTriangle size={17} /><span>{alert.label}</span><ChevronRight size={16} /></button>)}</div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Nessun avviso" text="La situazione della famiglia è sotto controllo." />}
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
            const routines = routinesByDate[date] || []
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
              {(chores.length || routines.length || deadlines.length) ? <div className="week-command-day__flags">
                {routines.length ? <button onClick={() => setActivePage('todos')}><ListTodo size={14} /> {routines.length} routine</button> : null}
                {chores.length ? <button onClick={() => setActivePage('chores')}><ListTodo size={14} /> {chores.length} compiti</button> : null}
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
          {familyCards.map(({ user, weekEvents, userTodos, userRoutines, userChores, userDeadlines }) => <Card key={user.id} className="family-member-card">
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
              <button onClick={() => setActivePage('todos')}><strong>{userTodos.length + userRoutines.length}</strong><small>da fare</small></button>
              <button onClick={() => setActivePage('chores')}><strong>{userChores.length}</strong><small>compiti</small></button>
              <button onClick={() => setActivePage('deadlines')}><strong>{userDeadlines.length}</strong><small>scadenze</small></button>
            </div>
          </Card>)}
        </div>
      </div> : null}
    </div>
  )
}
