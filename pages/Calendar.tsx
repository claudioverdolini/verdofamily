import React, { useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, Pencil, Trash2 } from 'lucide-react'
import type { CalendarEvent } from '../types'
import { useFamily } from '../store'
import { Avatar, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { addDays, dayLabel, localDateISO, monthCells, monthTitle, parseISODate, weekDates } from '../utils'

const emptyEvent = (date: string, userId: number) => ({ id: undefined, title: '', date, time: '', endTime: '', userId, notes: '' })

export default function CalendarPage() {
  const { data, authUser, upsertCalendarEvent, deleteCalendarEvent } = useFamily()
  const today = localDateISO()
  const [view, setView] = useState<'month' | 'week' | 'agenda'>('month')
  const [cursor, setCursor] = useState(today)
  const [editing, setEditing] = useState<any>(null)

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const week = useMemo(() => weekDates(cursor), [cursor])
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const event of data.calendarEvents) {
      map[event.date] ||= []
      map[event.date].push(event)
    }
    Object.values(map).forEach(list => list.sort((a, b) => (a.time || '').localeCompare(b.time || '')))
    return map
  }, [data.calendarEvents])

  const agenda = useMemo(
    () => data.calendarEvents.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
    [data.calendarEvents]
  )

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
    setEditing({ ...event })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    upsertCalendarEvent({ ...editing, title: editing.title.trim(), userId: Number(editing.userId), time: editing.time || '', endTime: editing.endTime || '' })
    setEditing(null)
  }

  return (
    <div className="page">
      <PageIntro eyebrow="Organizzazione" title="Calendario" description="Impegni familiari in una vista pulita, veloce e modificabile al volo." actions={<Button icon={<CalendarPlus size={18} />} onClick={() => openNew(today)}>Nuovo impegno</Button>} />

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
                        const user = data.users.find(u => u.id === event.userId)
                        return <button key={event.id} className="calendar-event" onClick={() => openEdit(event)} style={{ '--event-color': user?.color || '#5B5BD6' } as React.CSSProperties}><span>{event.time || '•'}</span><strong>{event.title}</strong></button>
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
                    const user = data.users.find(u => u.id === event.userId)
                    return <button key={event.id} className="week-event" onClick={() => openEdit(event)} style={{ '--event-color': user?.color || '#5B5BD6' } as React.CSSProperties}><span className="week-event__time"><Clock3 size={13} /> {event.time || 'Tutto il giorno'}</span><strong>{event.title}</strong><span>{user?.name}</span></button>
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
              const user = data.users.find(u => u.id === event.userId)
              return <button key={event.id} className="agenda-row" onClick={() => openEdit(event)}><div className="agenda-date"><strong>{event.date.slice(8, 10)}</strong><span>{parseISODate(event.date).toLocaleDateString('it-IT', { month: 'short' })}</span></div><div className="agenda-time">{event.time || '—'}</div><div className="agenda-copy"><strong>{event.title}</strong><span>{event.notes || 'Nessuna nota'}</span></div><div className="agenda-user"><Avatar user={user} size="sm" /><span>{user?.name}</span></div><ChevronRight size={18} /></button>
            }) : <EmptyState icon={<CalendarPlus size={30} />} title="Calendario vuoto" text="Aggiungi il primo impegno della famiglia." action={<Button onClick={() => openNew(today)}>Aggiungi impegno</Button>} />}
          </div>
        ) : null}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Modifica impegno' : 'Nuovo impegno'} subtitle="Puoi indicare anche orario, persona e note." footer={<div className="modal-actions">{editing?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteCalendarEvent(editing.id); setEditing(null) }}>Elimina</Button> : <span />}<div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button icon={<Pencil size={17} />} onClick={save}>{editing?.id ? 'Salva modifiche' : 'Crea impegno'}</Button></div></div>}>
        {editing ? <div className="form-grid form-grid--2"><Field label="Titolo" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Dentista, allenamento, riunione…" /></Field><Field label="Data"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field><Field label="Ora inizio"><input type="time" value={editing.time || ''} onChange={e => setEditing({ ...editing, time: e.target.value })} /></Field><Field label="Ora fine"><input type="time" value={editing.endTime || ''} onChange={e => setEditing({ ...editing, endTime: e.target.value })} /></Field><Field label="Per chi"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field><Field label="Note" className="field--wide"><textarea rows={4} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Dettagli utili…" /></Field></div> : null}
      </Modal>
    </div>
  )
}
