import React, { useMemo, useState } from 'react'
import { CalendarClock, Check, History, Pencil, Plus, Repeat2, RotateCcw, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { dayLabel, localDateISO, nextRoutineDueDate, routineCompletedOn, routineDueOn } from '../utils'
import type { RoutineFrequency } from '../types'

const FREQUENCIES: Array<{ value: RoutineFrequency; label: string }> = [
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'fortnightly', label: 'Ogni 2 settimane' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'semiannual', label: 'Ogni 6 mesi' },
  { value: 'yearly', label: 'Ogni anno' }
]

function frequencyLabel(value: RoutineFrequency) {
  return FREQUENCIES.find(item => item.value === value)?.label || 'Ricorrente'
}

export default function TodosPage() {
  const {
    data,
    authUser,
    addTodo,
    toggleTodo,
    deleteTodo,
    upsertRoutine,
    toggleRoutineActive,
    deleteRoutine,
    completeRoutine,
    undoRoutineCompletion
  } = useFamily()

  const today = localDateISO()
  const isChild = authUser?.role === 'bimbo'
  const [view, setView] = useState<'today' | 'routines' | 'archive'>('today')
  const [title, setTitle] = useState('')
  const [userId, setUserId] = useState(authUser?.id || data.users[0]?.id || 1)
  const [routineEditing, setRoutineEditing] = useState<any>(null)

  const openTodos = useMemo(
    () => data.todos.filter(item => !item.done).sort((a, b) => b.id - a.id),
    [data.todos]
  )

  const dueRoutines = useMemo(
    () => data.routines
      .filter(routine => routineDueOn(routine, today))
      .filter(routine => !isChild || routine.userId === authUser?.id)
      .sort((a, b) => a.userId - b.userId || a.title.localeCompare(b.title)),
    [data.routines, today, isChild, authUser?.id]
  )

  const dueOpenCount = dueRoutines.filter(routine => !routineCompletedOn(data.routineCompletions, routine.id, today)).length
  const visibleRoutines = data.routines
    .filter(routine => !isChild || routine.userId === authUser?.id)
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title))

  const archiveEntries = useMemo(() => {
    const todoEntries = data.todos
      .filter(item => item.done)
      .map(item => ({
        key: `todo-${item.id}`,
        kind: 'todo' as const,
        title: item.title,
        userId: item.userId,
        date: item.createdAt,
        item
      }))

    const routineEntries = data.routineCompletions
      .filter(item => !isChild || item.userId === authUser?.id)
      .map(item => {
        const routine = data.routines.find(r => r.id === item.routineId)
        return {
          key: `routine-${item.id}`,
          kind: 'routine' as const,
          title: routine?.title || 'Routine eliminata',
          userId: item.userId,
          date: item.date,
          item,
          routine
        }
      })

    return [...todoEntries, ...routineEntries]
      .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key))
  }, [data.todos, data.routineCompletions, data.routines, isChild, authUser?.id])

  function submit() {
    if (!title.trim()) return
    addTodo({ title: title.trim(), userId: Number(userId) })
    setTitle('')
  }

  function openRoutine(item?: any) {
    if (isChild) return
    setRoutineEditing(item
      ? { ...item }
      : {
          title: '',
          userId: data.users[0]?.id || 1,
          frequency: 'weekly' as RoutineFrequency,
          startDate: today,
          endDate: '',
          active: true,
          notes: ''
        })
  }

  function saveRoutine() {
    if (isChild || !routineEditing?.title?.trim()) return
    upsertRoutine({
      id: routineEditing.id,
      title: routineEditing.title.trim(),
      userId: Number(routineEditing.userId),
      frequency: routineEditing.frequency,
      startDate: routineEditing.startDate || today,
      endDate: routineEditing.endDate || undefined,
      active: routineEditing.active !== false,
      notes: routineEditing.notes || ''
    })
    setRoutineEditing(null)
  }

  const todayTotal = openTodos.length + dueOpenCount
  const tabs = [
    { value: 'today', label: `Oggi · ${todayTotal}` },
    { value: 'routines', label: `Routine · ${visibleRoutines.filter(routine => routine.active).length}` },
    { value: 'archive', label: `Archivio · ${archiveEntries.length}` }
  ]

  return <div className="page">
    <PageIntro
      eyebrow="Organizzazione quotidiana"
      title="Da fare & routine"
      description={isChild
        ? 'Qui trovi i tuoi promemoria e le routine che ti sono state assegnate.'
        : 'Promemoria veloci e attività ricorrenti della famiglia, senza duplicare ogni volta le stesse cose.'}
      actions={!isChild && view === 'routines'
        ? <Button icon={<Repeat2 size={18} />} onClick={() => openRoutine()}>Nuova routine</Button>
        : null}
    />

    <div className="page-tabs-wrap">
      <Segmented value={view} onChange={setView} options={tabs} />
    </div>

    {view === 'today' ? <>
      <Card className="todo-compose-card">
        <div className="todo-compose">
          <input
            autoComplete="off"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Aggiungi un promemoria…"
          />
          <select value={userId} onChange={e => setUserId(Number(e.target.value))}>
            {(isChild && authUser ? [authUser] : data.users).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <Button icon={<Plus size={17} />} onClick={submit}>Aggiungi</Button>
        </div>
      </Card>

      <div className="todo-routine-grid">
        <Card>
          <CardHeader
            title="Routine di oggi"
            subtitle={dueOpenCount ? `${dueOpenCount} ancora da completare` : 'Tutto completato'}
          />
          {dueRoutines.length ? <div className="check-list">
            {dueRoutines.map(routine => {
              const done = routineCompletedOn(data.routineCompletions, routine.id, today)
              const user = data.users.find(item => item.id === routine.userId)
              return <div key={routine.id} className={`check-item routine-due-item ${done ? 'is-done' : ''}`}>
                <button
                  className="check-item__check"
                  onClick={() => done ? undoRoutineCompletion(routine.id, today) : completeRoutine(routine.id, today)}
                  title={done ? 'Segna nuovamente da fare' : 'Segna come completata'}
                >
                  {done ? <Check size={16} /> : null}
                </button>
                <button
                  className="check-item__copy"
                  onClick={() => done ? undoRoutineCompletion(routine.id, today) : completeRoutine(routine.id, today)}
                >
                  <strong>{routine.title}</strong>
                  <span><Avatar user={user} size="xs" /> {user?.name} · {frequencyLabel(routine.frequency)}</span>
                  {routine.notes ? <small>{routine.notes}</small> : null}
                </button>
                <Badge tone={done ? 'success' : 'neutral'}>{done ? 'Fatta' : 'Oggi'}</Badge>
              </div>
            })}
          </div> : <EmptyState
            icon={<Repeat2 size={28} />}
            title="Nessuna routine oggi"
            text="Non ci sono attività ricorrenti previste per oggi."
          />}
        </Card>

        <Card>
          <CardHeader title="Promemoria aperti" subtitle={openTodos.length ? `${openTodos.length} da fare` : 'Nessun promemoria'} />
          {openTodos.length ? <div className="check-list">
            {openTodos.map(item => {
              const user = data.users.find(u => u.id === item.userId)
              return <div key={item.id} className="check-item">
                <button className="check-item__check" onClick={() => toggleTodo(item.id)} />
                <button className="check-item__copy" onClick={() => toggleTodo(item.id)}>
                  <strong>{item.title}</strong>
                  <span><Avatar user={user} size="xs" /> {user?.name} · {item.createdAt}</span>
                </button>
                <IconButton label="Elimina" onClick={() => deleteTodo(item.id)}><Trash2 size={17} /></IconButton>
              </div>
            })}
          </div> : <EmptyState title="Tutto fatto" text="Nessun promemoria aperto." />}
        </Card>
      </div>
    </> : null}

    {view === 'routines' ? <Card>
      <CardHeader
        title={isChild ? 'Le mie routine' : 'Routine familiari'}
        subtitle={isChild ? 'Attività ricorrenti assegnate a te' : 'Una sola regola, tutte le ricorrenze calcolate automaticamente'}
      />
      {visibleRoutines.length ? <div className="routine-list">
        {visibleRoutines.map(routine => {
          const user = data.users.find(item => item.id === routine.userId)
          const nextDue = nextRoutineDueDate(routine, today)
          return <div key={routine.id} className={`routine-row ${routine.active ? '' : 'is-disabled'}`}>
            {!isChild ? <label className="recurring-switch" title={routine.active ? 'Metti in pausa' : 'Riattiva'}>
              <input type="checkbox" checked={routine.active} onChange={() => toggleRoutineActive(routine.id)} />
            </label> : <Repeat2 size={17} />}
            <button className="routine-row__copy" onClick={() => !isChild && openRoutine(routine)} disabled={isChild}>
              <strong>{routine.title}</strong>
              <span><Avatar user={user} size="xs" /> {user?.name} · {frequencyLabel(routine.frequency)}</span>
              <small>
                {routine.active
                  ? nextDue ? `Prossima: ${dayLabel(nextDue, true)}` : 'Nessuna prossima ricorrenza'
                  : 'Routine in pausa'}
              </small>
              {routine.notes ? <em>{routine.notes}</em> : null}
            </button>
            <Badge tone={routine.active ? 'success' : 'neutral'}>{routine.active ? 'Attiva' : 'Pausa'}</Badge>
            {!isChild ? <IconButton label="Modifica" onClick={() => openRoutine(routine)}><Pencil size={16} /></IconButton> : null}
            {!isChild ? <IconButton label="Elimina" onClick={() => deleteRoutine(routine.id)}><Trash2 size={16} /></IconButton> : null}
          </div>
        })}
      </div> : <EmptyState
        icon={<CalendarClock size={28} />}
        title="Nessuna routine"
        text={isChild
          ? 'Non hai ancora routine assegnate.'
          : 'Crea attività come pattumiere, cambio lenzuola, filtri, zaini o controlli periodici.'}
        action={!isChild ? <Button variant="soft" onClick={() => openRoutine()}>Crea la prima routine</Button> : null}
      />}
    </Card> : null}

    {view === 'archive' ? <Card>
      <CardHeader title="Storico attività" subtitle="Promemoria completati e singole esecuzioni delle routine" />
      {archiveEntries.length ? <div className="check-list">
        {archiveEntries.slice(0, 150).map(entry => {
          const user = data.users.find(item => item.id === entry.userId)
          return <div key={entry.key} className="check-item is-done">
            <span className="check-item__check"><Check size={16} /></span>
            <div className="check-item__copy routine-history-copy">
              <strong>{entry.title}</strong>
              <span>
                <Avatar user={user} size="xs" /> {user?.name} · {entry.date} · {entry.kind === 'routine' ? 'Routine' : 'Promemoria'}
              </span>
            </div>
            {entry.kind === 'routine' && entry.routine
              ? <IconButton label="Annulla completamento" onClick={() => undoRoutineCompletion(entry.routine!.id, entry.date)}><RotateCcw size={16} /></IconButton>
              : entry.kind === 'todo'
                ? <IconButton label="Riapri" onClick={() => toggleTodo(entry.item.id)}><RotateCcw size={16} /></IconButton>
                : null}
          </div>
        })}
      </div> : <EmptyState icon={<History size={28} />} title="Archivio vuoto" text="Le attività completate appariranno qui." />}
    </Card> : null}

    {!isChild ? <Modal
      open={!!routineEditing}
      onClose={() => setRoutineEditing(null)}
      title={routineEditing?.id ? 'Modifica routine' : 'Nuova routine'}
      subtitle="La data iniziale determina il giorno di riferimento della ricorrenza."
      footer={<div className="modal-actions"><span /><div className="modal-actions__right">
        <Button variant="ghost" onClick={() => setRoutineEditing(null)}>Annulla</Button>
        <Button onClick={saveRoutine}>Salva routine</Button>
      </div></div>}
    >
      {routineEditing ? <div className="form-grid form-grid--2">
        <Field label="Attività" className="field--wide">
          <input
            autoFocus
            value={routineEditing.title}
            onChange={e => setRoutineEditing({ ...routineEditing, title: e.target.value })}
            placeholder="Es. Cambio lenzuola"
          />
        </Field>
        <Field label="Assegna a">
          <select value={routineEditing.userId} onChange={e => setRoutineEditing({ ...routineEditing, userId: Number(e.target.value) })}>
            {data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field>
        <Field label="Frequenza">
          <select value={routineEditing.frequency} onChange={e => setRoutineEditing({ ...routineEditing, frequency: e.target.value as RoutineFrequency })}>
            {FREQUENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Prima esecuzione">
          <input
            type="date"
            value={routineEditing.startDate}
            onChange={e => setRoutineEditing({ ...routineEditing, startDate: e.target.value })}
          />
        </Field>
        <Field label="Fino al" hint="Facoltativo">
          <input
            type="date"
            min={routineEditing.startDate || undefined}
            value={routineEditing.endDate || ''}
            onChange={e => setRoutineEditing({ ...routineEditing, endDate: e.target.value })}
          />
        </Field>
        <Field label="Note" className="field--wide">
          <textarea
            rows={3}
            value={routineEditing.notes || ''}
            onChange={e => setRoutineEditing({ ...routineEditing, notes: e.target.value })}
            placeholder="Es. ricordarsi anche delle federe"
          />
        </Field>
        <label className="toggle-row field--wide">
          <input
            type="checkbox"
            checked={routineEditing.active !== false}
            onChange={e => setRoutineEditing({ ...routineEditing, active: e.target.checked })}
          />
          Attiva
        </label>
      </div> : null}
    </Modal> : null}
  </div>
}
