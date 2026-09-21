import React, { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, Pencil, Repeat2, Trash2 } from 'lucide-react'
import type { CalendarEvent } from '../types'
import { useFamily } from '../store'
import { Avatar, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { addDays, calendarOccurrencesBetween, dayLabel, localDateISO, monthCells, monthTitle, parseISODate, weekDates } from '../utils'

const REMINDER_PRESETS = [
  { value: 1440, label: '1 giorno prima' },
  { value: 120, label: '2 ore prima' },
  { value: 60, label: '1 ora prima' },
  { value: 30, label: '30 min prima' },
  { value: 10, label: '10 min prima' },
  { value: 0, label: "All'orario" }
]

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Non ripetere' },
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'biweekly', label: 'Ogni 2 settimane' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'yearly', label: 'Ogni anno' }
]

const recurrenceLabel = (value?: string) => RECURRENCE_OPTIONS.find(option => option.value === (value || 'none'))?.label || 'Non ripetere'

const emptyEvent = (date: string, userId: number) => ({
  id: undefined,
  title: '',
  date,
  time: '',
  endTime: '',
  reminderMinutes: [60],
  userId,
  userIds: [userId],
  audience: 'users',
  recurrence: 'none',
  recurrenceEndDate: '',
  notes: ''
})

export default function CalendarPage() {
  const { data, authUser, upsertCalendarEvent, deleteCalendarEvent } = useFamily()
  const today = localDateISO()
  const [view, setView] = useState<'month' | 'week' | 'agenda'>(() => window.matchMedia?.('(max-width: 820px)').matches ? 'agenda' : 'month')
  const [cursor, setCursor] = useState(today)
  const [editing, setEditing] = useState<any>(null)

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const week = useMemo(() => weekDates(cursor), [cursor])
  const visibleStart = view === 'month' ? cells[0]?.date : week[0]
  const visibleEnd = view === 'month' ? cells[cells.length - 1]?.date : week[6]
  const visibleOccurrences = useMemo(
    () => calendarOccurrencesBetween(data.calendarEvents, visibleStart || cursor, visibleEnd || cursor),
    [data.calendarEvents, visibleStart, visibleEnd, cursor]
  )
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const event of visibleOccurrences) {
      map[event.date] ||= []
      map[event.date].push(event)
    }
    Object.values(map).forEach(list => list.sort((a, b) => (a.time || '').localeCompare(b.time || '')))
    return map
  }, [visibleOccurrences])

  const agendaStart = useMemo(() => {
    const dates = data.calendarEvents.map(event => event.date).filter(Boolean).sort()
    return dates[0] && dates[0] < today ? dates[0] : today
  }, [data.calendarEvents, today])
  const agenda = useMemo(
    () => calendarOccurrencesBetween(data.calendarEvents, agendaStart, addDays(today, 365))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
    [data.calendarEvents, agendaStart, today]
  )

  function participantIds(event: any) {
    if (event?.audience === 'family') return data.users.map(user => user.id)
    const ids = Array.isArray(event?.userIds) && event.userIds.length ? event.userIds.map(Number) : [Number(event?.userId || 0)]
    return Array.from(new Set(ids.filter((id: number) => id > 0))) as number[]
  }

  function peopleLabel(event: any) {
    if (event?.audience === 'family') return 'Famiglia'
    const names = participantIds(event).map(id => data.users.find(user => user.id === id)?.name).filter(Boolean)
    return names.join(', ') || 'Nessuno'
  }

  function primaryUser(event: any) {
    return data.users.find(user => user.id === participantIds(event)[0])
  }

  function move(direction: -1 | 1) {
    if (view === 'month') {
      const d = parseISODate(cursor)
      d.setMonth(d.getMonth() + direction)
      setCursor(localDateISO(d))
    } else {
      setCursor(addDays(cursor, 7 * direction))
    }
  }

  function openNew(date = cursor) {
    setEditing(emptyEvent(date, authUser?.id || data.users[0]?.id || 1))
  }

  function openEdit(event: CalendarEvent) {
    const source = data.calendarEvents.find(item => item.id === event.id) || event
    setEditing({
      ...source,
      audience: source.audience || 'users',
      userIds: Array.isArray(source.userIds) && source.userIds.length ? source.userIds.map(Number) : [Number(source.userId || 0)].filter(Boolean),
      reminderMinutes: [...(source.reminderMinutes || [60])],
      recurrence: source.recurrence || 'none',
      recurrenceEndDate: source.recurrenceEndDate || ''
    })
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const eventId = Number(params.get('event') || 0)
    if (!eventId) return
    const event = data.calendarEvents.find(item => item.id === eventId)
    if (!event) return
    openEdit(event)
    params.delete('event')
    const search = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (search ? '?' + search : ''))
  }, [data.calendarEvents])

  function toggleParticipant(id: number) {
    if (!editing) return
    const current = participantIds(editing)
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    setEditing({ ...editing, audience: 'users', userIds: next, userId: next[0] || editing.userId })
  }

  function toggleReminder(minutes: number) {
    if (!editing) return
    const current: number[] = Array.isArray(editing.reminderMinutes) ? editing.reminderMinutes : [60]
    const next = current.includes(minutes)
      ? current.filter(value => value !== minutes)
      : [...current, minutes]
    setEditing({ ...editing, reminderMinutes: Array.from(new Set(next)).sort((a, b) => b - a) })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    const audience = editing.audience === 'family' ? 'family' : 'users'
    const userIds = audience === 'family' ? data.users.map(user => user.id) : participantIds(editing)
    if (!userIds.length) return alert('Seleziona almeno una persona oppure scegli Tutta la famiglia.')
    upsertCalendarEvent({
      ...editing,
      title: editing.title.trim(),
      userId: Number(userIds[0]),
      userIds,
      audience,
      time: editing.time || '',
      endTime: editing.endTime || '',
      recurrence: ['daily','weekly','biweekly','monthly','yearly'].includes(editing.recurrence) ? editing.recurrence : 'none',
      recurrenceEndDate: editing.recurrence && editing.recurrence !== 'none' && editing.recurrenceEndDate >= editing.date ? editing.recurrenceEndDate : undefined,
      reminderMinutes: Array.from(new Set((editing.reminderMinutes || [60]).map(Number))).filter((value: number) => value >= 0 && value <= 10080).sort((a: number, b: number) => b - a)
    })
    setEditing(null)
  }

  return (
    <div className="page">
      <PageIntro eyebrow="Organizzazione" title="Calendario" description="Impegni personali, condivisi tra più persone o per tutta la famiglia." actions={<Button icon={<CalendarPlus size={18} />} onClick={() => openNew(today)}>Nuovo impegno</Button>} />

      <Card className="calendar-card">
        <div className="calendar-toolbar">
          <div className="calendar-toolbar__nav">
            <IconButton label="Indietro" onClick={() => move(-1)}><ChevronLeft size={20} /></IconButton>
            <button className="today-btn" onClick={() => setCursor(today)}>Oggi</button>
            <IconButton label="Avanti" onClick={() => move(1)}><ChevronRight size={20} /></IconButton>
            <h2>{view === 'month' ? monthTitle(cursor) : `${dayLabel(week[0], true)} – ${dayLabel(week[6], true)}`}</h2>
          </div>
          <Segmented value={view} onChange={setView} options={[{ value: 'month', label: 'Mese' }, { value: 'week', label: 'Settimana' }, { value: 'agenda', label: 'Agenda' }]} />
        </div>

        {view === 'month' ? (
          <div className="month-view">
            <div className="month-head">{['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(day => <div key={day}>{day}</div>)}</div>
            <div className="month-grid">
              {cells.map(cell => {
                const list = eventsByDate[cell.date] || []
                return (
                  <div key={cell.date} className={`month-cell ${!cell.inMonth ? 'is-muted' : ''} ${cell.date === today ? 'is-today' : ''}`}>
                    <button className="month-cell__day" onClick={() => openNew(cell.date)}>{Number(cell.date.slice(8, 10))}</button>
                    <div className="month-cell__events">
                      {list.slice(0, 3).map(event => {
                        const user = primaryUser(event)
                        return <button key={`${event.id}-${event.date}`} className="calendar-event" onClick={() => openEdit(event)} style={{ '--event-color': user?.color || '#5B5BD6' } as React.CSSProperties}><span>{event.time || '•'}</span><strong>{event.title}</strong></button>
                      })}
                      {list.length > 3 ? <span className="calendar-more">+{list.length - 3} altri</span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {view === 'week' ? (
          <div className="week-calendar">
            {week.map(date => (
              <section key={date} className={`week-calendar__day ${date === today ? 'is-today' : ''}`}>
                <button className="week-calendar__head" onClick={() => openNew(date)}><span>{dayLabel(date)}</span><strong>{Number(date.slice(8, 10))}</strong></button>
                <div className="week-calendar__events">
                  {(eventsByDate[date] || []).map(event => {
                    const user = primaryUser(event)
                    return <button key={`${event.id}-${event.date}`} className="week-event" onClick={() => openEdit(event)} style={{ '--event-color': user?.color || '#5B5BD6' } as React.CSSProperties}><span className="week-event__time"><Clock3 size={13} /> {event.time || 'Tutto il giorno'}</span><strong>{event.title}</strong><span>{peopleLabel(event)}</span></button>
                  })}
                  {!(eventsByDate[date] || []).length ? <button className="week-empty" onClick={() => openNew(date)}>+ Aggiungi</button> : null}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {view === 'agenda' ? (
          <div className="agenda-list">
            {agenda.length ? agenda.map(event => {
              const user = primaryUser(event)
              return <button key={`${event.id}-${event.date}`} className="agenda-row" onClick={() => openEdit(event)}><div className="agenda-date"><strong>{event.date.slice(8, 10)}</strong><span>{parseISODate(event.date).toLocaleDateString('it-IT', { month: 'short' })}</span></div><div className="agenda-time">{event.time || '—'}</div><div className="agenda-copy"><strong>{event.title}{event.recurrence && event.recurrence !== 'none' ? <Repeat2 size={13} className="calendar-recurrence-inline" /> : null}</strong><span>{event.recurrence && event.recurrence !== 'none' ? `${recurrenceLabel(event.recurrence)} · ${event.notes || 'Nessuna nota'}` : (event.notes || 'Nessuna nota')}</span></div><div className="agenda-user">{event.audience === 'family' ? <span>Famiglia</span> : <><Avatar user={user} size="sm" /><span>{peopleLabel(event)}</span></>}</div><ChevronRight size={18} /></button>
            }) : <EmptyState icon={<CalendarPlus size={30} />} title="Calendario vuoto" text="Aggiungi il primo impegno della famiglia." action={<Button onClick={() => openNew(today)}>Aggiungi impegno</Button>} />}
          </div>
        ) : null}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Modifica impegno' : 'Nuovo impegno'} subtitle="Puoi assegnarlo a una persona, più persone oppure a tutta la famiglia." footer={<div className="modal-actions">{editing?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteCalendarEvent(editing.id); setEditing(null) }}>Elimina</Button> : <span />}<div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button icon={<Pencil size={17} />} onClick={save}>{editing?.id ? 'Salva modifiche' : 'Crea impegno'}</Button></div></div>}>
        {editing ? <div className="form-grid form-grid--2">
          <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Dentista, allenamento, riunione…" /></Field>
          <Field label="Data"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value, recurrenceEndDate: editing.recurrenceEndDate && editing.recurrenceEndDate < e.target.value ? '' : editing.recurrenceEndDate })} /></Field>
          <Field label="Ripetizione">
            <select value={editing.recurrence || 'none'} onChange={e => setEditing({ ...editing, recurrence: e.target.value, recurrenceEndDate: e.target.value === 'none' ? '' : editing.recurrenceEndDate })}>
              {RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          {editing.recurrence && editing.recurrence !== 'none' ? <Field label="Ripeti fino al" hint="Facoltativo: se vuoto la serie non ha una data finale.">
            <input type="date" min={editing.date} value={editing.recurrenceEndDate || ''} onChange={e => setEditing({ ...editing, recurrenceEndDate: e.target.value })} />
          </Field> : null}
          <Field label="Ora inizio"><input type="time" value={editing.time || ''} onChange={e => setEditing({ ...editing, time: e.target.value })} /></Field>
          <Field label="Ora fine"><input type="time" value={editing.endTime || ''} onChange={e => setEditing({ ...editing, endTime: e.target.value })} /></Field>
          <Field label="Promemoria" className="field--wide" hint="Puoi selezionare uno o più avvisi. Se non modifichi nulla, riceverai il promemoria 1 ora prima.">
            <div className="deadline-reminder-picker">
              {REMINDER_PRESETS.map(item => <button
                type="button"
                key={item.value}
                className={(editing.reminderMinutes || [60]).includes(item.value) ? 'is-active' : ''}
                onClick={() => toggleReminder(item.value)}
              >
                {item.label}
              </button>)}
            </div>
          </Field>
          <Field label="Partecipanti" className="field--wide" hint="Famiglia include automaticamente tutti i membri attivi.">
            <div className="calendar-family-toggle">
              <input id="calendar-family-audience" type="checkbox" checked={editing.audience === 'family'} onChange={e => setEditing({ ...editing, audience: e.target.checked ? 'family' : 'users' })} />
              <label htmlFor="calendar-family-audience">Tutta la famiglia</label>
            </div>
            {editing.audience !== 'family' ? <div className="settings-check-grid" style={{ marginTop: 10 }}>{data.users.map(user => { const selected = participantIds(editing).includes(user.id); return <label key={user.id} className={selected ? 'is-selected' : ''}><input type="checkbox" checked={selected} onChange={() => toggleParticipant(user.id)} /><span>{user.name}</span></label> })}</div> : <div className="callout" style={{ marginTop: 10 }}>Questo evento sarà visibile a tutti i membri della famiglia. Con Google Calendar potrà usare il calendario condiviso configurato nelle Impostazioni.</div>}
          </Field>
          {editing.recurrence && editing.recurrence !== 'none' ? <div className="calendar-recurrence-summary field--wide"><Repeat2 size={17} /><span><strong>{recurrenceLabel(editing.recurrence)}</strong><small>{editing.recurrenceEndDate ? `fino al ${editing.recurrenceEndDate.split('-').reverse().join('/')}` : 'senza data finale'}</small></span></div> : null}
          <Field label="Note" className="field--wide"><textarea rows={4} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Dettagli utili…" /></Field>
        </div> : null}
      </Modal>
    </div>
  )
}
