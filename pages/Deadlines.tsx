import React, { useEffect, useMemo, useState } from 'react'
import {
  Cake,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CreditCard,
  FileText,
  Filter,
  GraduationCap,
  Home,
  Pencil,
  Plane,
  Plus,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import { useFamily } from '../store'
import MultiAssigneePicker from '../components/MultiAssigneePicker'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, parseISODate } from '../utils'
import type { DeadlineCategory } from '../types'

const CATEGORY_OPTIONS: Array<{ value: DeadlineCategory; label: string; icon: React.ReactNode }> = [
  { value: 'documents', label: 'Documenti', icon: <FileText size={15} /> },
  { value: 'insurance', label: 'Assicurazioni', icon: <ShieldCheck size={15} /> },
  { value: 'car', label: 'Auto', icon: <Car size={15} /> },
  { value: 'subscriptions', label: 'Abbonamenti', icon: <CreditCard size={15} /> },
  { value: 'school', label: 'Scuola', icon: <GraduationCap size={15} /> },
  { value: 'holidays', label: 'Vacanze', icon: <Plane size={15} /> },
  { value: 'birthdays', label: 'Compleanni', icon: <Cake size={15} /> },
  { value: 'home', label: 'Casa', icon: <Home size={15} /> },
  { value: 'other', label: 'Altro', icon: <CircleDot size={15} /> }
]

const REMINDER_PRESETS = [90, 30, 7, 1, 0]

function categoryInfo(category?: DeadlineCategory) {
  return CATEGORY_OPTIONS.find(item => item.value === category) || CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1]
}

function daysFromToday(date: string, today: string) {
  return Math.round((parseISODate(date).getTime() - parseISODate(today).getTime()) / 86400000)
}

function dateLabel(date: string) {
  return parseISODate(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
}

function reminderLabel(days: number[]) {
  const sorted = [...(days || [])].sort((a, b) => b - a)
  if (!sorted.length) return 'Nessun preavviso'
  return sorted.map(day => day === 0 ? 'giorno stesso' : `${day}g`).join(' · ')
}

export default function DeadlinesPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const today = localDateISO()
  const [editing, setEditing] = useState<any>(null)
  const [view, setView] = useState<'upcoming' | 'year'>('upcoming')
  const [category, setCategory] = useState<'all' | DeadlineCategory>('all')
  const [year, setYear] = useState(Number(today.slice(0, 4)))

  const deadlines = useMemo(
    () => data.deadlines
      .filter(item => !item.kind || item.kind === 'general')
      .slice()
      .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date)),
    [data.deadlines]
  )

  const filtered = deadlines.filter(item => category === 'all' || (item.category || 'other') === category)
  const upcoming = filtered.filter(item => !item.done)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const deadlineId = Number(params.get('deadline') || 0)
    if (!deadlineId) return
    const deadline = data.deadlines.find(item => item.id === deadlineId && (!item.kind || item.kind === 'general'))
    if (!deadline) return
    setEditing({ ...deadline, reminderDays: [...(deadline.reminderDays || [90, 30, 7])] })
    params.delete('deadline')
    const search = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (search ? '?' + search : ''))
  }, [data.deadlines])

  function openNew() {
    const defaultUserId = authUser?.id || data.users[0]?.id || 1
    setEditing({
      id: undefined,
      title: '',
      date: today,
      userId: defaultUserId,
      userIds: [defaultUserId],
      done: false,
      kind: 'general',
      category: 'other' as DeadlineCategory,
      reminderDays: [90, 30, 7],
      repeatYearly: false,
      notes: ''
    })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    const userIds = editing.id
      ? [Number(editing.userId)]
      : Array.from(new Set(
          (Array.isArray(editing.userIds) && editing.userIds.length ? editing.userIds : [editing.userId])
            .map(Number)
            .filter((id: number) => id > 0)
        ))
    if (!userIds.length) return
    userIds.forEach((userId: number, index: number) => upsertDeadline({
      ...editing,
      id: editing.id && index === 0 ? editing.id : undefined,
      title: editing.title.trim(),
      userId,
      kind: 'general',
      category: editing.category || 'other',
      reminderDays: Array.from(new Set((editing.reminderDays || []).map(Number))).sort((a: number, b: number) => b - a),
      repeatYearly: editing.repeatYearly === true,
      notes: editing.notes || ''
    }))
    setEditing(null)
  }

  function toggleReminder(day: number) {
    if (!editing) return
    const current: number[] = Array.isArray(editing.reminderDays) ? editing.reminderDays : []
    setEditing({
      ...editing,
      reminderDays: current.includes(day)
        ? current.filter(value => value !== day)
        : [...current, day].sort((a, b) => b - a)
    })
  }

  const stats = {
    overdue: upcoming.filter(item => item.date < today).length,
    next30: upcoming.filter(item => {
      const diff = daysFromToday(item.date, today)
      return diff >= 0 && diff <= 30
    }).length,
    recurring: deadlines.filter(item => item.repeatYearly).length
  }

  return <div className="page">
    <PageIntro
      eyebrow="Centro annuale"
      title="Scadenze"
      description="Documenti, assicurazioni, auto, scuola, abbonamenti, compleanni e manutenzioni con preavvisi automatici."
      actions={<Button icon={<Plus size={18} />} onClick={openNew}>Nuova scadenza</Button>}
    />

    <div className="deadline-stats">
      <Card className="deadline-stat"><span>Scadute</span><strong>{stats.overdue}</strong><small>richiedono attenzione</small></Card>
      <Card className="deadline-stat"><span>Prossimi 30 giorni</span><strong>{stats.next30}</strong><small>in arrivo</small></Card>
      <Card className="deadline-stat"><span>Annuali</span><strong>{stats.recurring}</strong><small>si rinnovano da sole</small></Card>
    </div>

    <div className="deadline-toolbar">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'upcoming', label: `Prossime · ${upcoming.length}` },
          { value: 'year', label: 'Vista anno' }
        ]}
      />
      <label className="deadline-category-select" title="Filtra le scadenze per categoria">
        <span className="deadline-category-select__icon"><Filter size={16} /></span>
        <span className="deadline-category-select__copy">
          <small>Categoria</small>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as 'all' | DeadlineCategory)}
            aria-label="Filtra per categoria"
          >
            <option value="all">Tutte le categorie</option>
            {CATEGORY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </span>
      </label>
    </div>

    {view === 'upcoming' ? <Card>
      {filtered.length ? <div className="deadline-list">{filtered.map(item => {
        const user = data.users.find(person => person.id === item.userId)
        const info = categoryInfo(item.category)
        const diff = daysFromToday(item.date, today)
        const status = item.done ? 'done' : diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 30 ? 'soon' : 'future'
        const statusText = item.done
          ? 'Completata'
          : diff < 0
            ? `Scaduta da ${Math.abs(diff)}g`
            : diff === 0
              ? 'Scade oggi'
              : `Tra ${diff}g`

        return <div key={item.id} className={`deadline-row deadline-row--${status} ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)} title={item.repeatYearly ? 'Completa e passa all’anno prossimo' : 'Segna completata'}>
            {item.done ? <Check size={16} /> : null}
          </button>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy deadline-copy--smart">
            <strong>{item.title}</strong>
            <span><Avatar user={user} size="xs" /> {user?.name}</span>
            <small>{info.label} · Avvisi: {reminderLabel(item.reminderDays || [90, 30, 7])}{item.repeatYearly ? ' · Annuale' : ''}</small>
            {item.notes ? <em>{item.notes}</em> : null}
          </div>
          <div className="deadline-row__meta">
            <Badge tone={status === 'overdue' || status === 'today' ? 'warning' : item.done ? 'success' : 'neutral'}>{statusText}</Badge>
            <div className="deadline-row__actions">
              <IconButton label="Modifica" onClick={() => setEditing({ ...item, reminderDays: [...(item.reminderDays || [90, 30, 7])] })}><Pencil size={17} /></IconButton>
              <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
            </div>
          </div>
        </div>
      })}</div> : <EmptyState title="Nessuna scadenza" text="Aggiungi la prima data importante." action={<Button onClick={openNew}>Aggiungi scadenza</Button>} />}
    </Card> : null}

    {view === 'year' ? <div className="year-deadline-view">
      <div className="year-deadline-head">
        <IconButton label="Anno precedente" onClick={() => setYear(value => value - 1)}><ChevronLeft size={19} /></IconButton>
        <div><span>Timeline familiare</span><strong>{year}</strong></div>
        <IconButton label="Anno successivo" onClick={() => setYear(value => value + 1)}><ChevronRight size={19} /></IconButton>
      </div>

      <div className="year-deadline-grid">
        {Array.from({ length: 12 }, (_, index) => {
          const month = index + 1
          const monthItems = filtered
            .filter(item => Number(item.date.slice(0, 4)) === year && Number(item.date.slice(5, 7)) === month)
            .sort((a, b) => a.date.localeCompare(b.date))
          const monthName = new Date(year, index, 1).toLocaleDateString('it-IT', { month: 'long' })

          return <Card key={month} className="year-month-card">
            <header><span>{monthName}</span><Badge>{monthItems.length}</Badge></header>
            {monthItems.length ? <div className="year-month-list">
              {monthItems.map(item => {
                const info = categoryInfo(item.category)
                return <button key={item.id} onClick={() => setEditing({ ...item, reminderDays: [...(item.reminderDays || [90, 30, 7])] })}>
                  <strong>{item.date.slice(8, 10)}</strong>
                  <span>{info.icon}</span>
                  <div><b>{item.title}</b><small>{info.label}{item.repeatYearly ? ' · annuale' : ''}</small></div>
                </button>
              })}
            </div> : <div className="year-month-empty">Nessuna scadenza</div>}
          </Card>
        })}
      </div>
    </div> : null}

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Modifica scadenza' : 'Nuova scadenza'}
      subtitle="Scegli quando vuoi essere avvisato prima della data."
      size="md"
      footer={<div className="modal-actions">
        <div>{editing?.id ? <Button variant="danger" onClick={() => { deleteDeadline(editing.id); setEditing(null) }}>Elimina</Button> : null}</div>
        <div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div>
      </div>}
    >
      <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide">
          <input autoFocus value={editing?.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Assicurazione Volvo" />
        </Field>
        <Field label="Data">
          <input type="date" value={editing?.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} />
        </Field>
        {editing?.id ? <Field label="Per chi">
          <select value={editing?.userId || authUser?.id || ''} onChange={e => setEditing({ ...editing, userId: Number(e.target.value), userIds: [Number(e.target.value)] })}>
            {data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field> : <Field label="Per chi" className="field--wide" hint="Puoi assegnare la stessa scadenza a più persone con un solo inserimento. Ognuno avrà il proprio stato.">
          <MultiAssigneePicker
            users={data.users}
            selectedIds={editing?.userIds || [editing?.userId].filter(Boolean)}
            onChange={userIds => setEditing({ ...editing, userIds, userId: userIds[0] || 0 })}
          />
        </Field>}
        <Field label="Categoria">
          <select
            value={editing?.category || 'other'}
            onChange={e => {
              const nextCategory = e.target.value as DeadlineCategory
              setEditing({
                ...editing,
                category: nextCategory,
                repeatYearly: nextCategory === 'birthdays' ? true : editing?.repeatYearly
              })
            }}
          >
            {CATEGORY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Preavvisi" className="field--wide" hint="Riceverai le notifiche nei giorni selezionati">
          <div className="deadline-reminder-picker">
            {REMINDER_PRESETS.map(day => <button
              type="button"
              key={day}
              className={(editing?.reminderDays || []).includes(day) ? 'is-active' : ''}
              onClick={() => toggleReminder(day)}
            >
              {day === 0 ? 'Il giorno stesso' : `${day} giorni prima`}
            </button>)}
          </div>
        </Field>
        <label className="toggle-row field--wide">
          <input
            type="checkbox"
            checked={editing?.repeatYearly === true}
            onChange={e => setEditing({ ...editing, repeatYearly: e.target.checked })}
          />
          Si ripete ogni anno
        </label>
        <Field label="Note" className="field--wide">
          <textarea rows={3} value={editing?.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Polizza, riferimento, cosa fare alla scadenza…" />
        </Field>
        {editing?.lastCompletedDate ? <div className="deadline-last-completed field--wide">
          <CalendarDays size={16} />
          Ultima completata: {dateLabel(editing.lastCompletedDate)}
        </div> : null}
      </div>
    </Modal>
  </div>
}
