from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Patch point not found: {label}")
    return text.replace(old, new, 1)


# --- types.ts -------------------------------------------------------------
types_path = Path("types.ts")
types = types_path.read_text(encoding="utf-8")
types = replace_once(
    types,
    "  linkedHealthVisitId?: number\n",
    "  linkedHealthVisitId?: number\n  linkedHealthReminderType?: 'visit' | 'booking'\n",
    "calendar reminder type",
)
types = replace_once(
    types,
    "  calendarEventId?: number\n  healthRecordKind?: 'exam' | 'report' | 'vaccine' | 'document' | 'note'\n",
    "  calendarEventId?: number\n  bookingReminderEvery?: number\n  bookingReminderUnit?: 'days' | 'weeks' | 'months'\n  bookingReminderEventId?: number\n  healthRecordKind?: 'exam' | 'report' | 'vaccine' | 'document' | 'note'\n",
    "visit booking reminder fields",
)
types_path.write_text(types, encoding="utf-8")


# --- store.tsx ------------------------------------------------------------
store_path = Path("store.tsx")
store = store_path.read_text(encoding="utf-8")
store = replace_once(
    store,
    "  function upsertCalendarEvent(event: Omit<CalendarEvent, 'id'> & { id?: number }) {\n    setData(prev => ({ ...prev, calendarEvents: event.id ? prev.calendarEvents.map(e => e.id === event.id ? { ...e, ...event, id: e.id } : e) : [...prev.calendarEvents, { ...event, id: nextId(prev.calendarEvents) }] }))\n  }\n",
    "  function upsertCalendarEvent(event: Omit<CalendarEvent, 'id'> & { id?: number }) {\n    setData(prev => {\n      if (!event.id) return { ...prev, calendarEvents: [...prev.calendarEvents, { ...event, id: nextId(prev.calendarEvents) }] }\n      const exists = prev.calendarEvents.some(e => e.id === event.id)\n      return { ...prev, calendarEvents: exists ? prev.calendarEvents.map(e => e.id === event.id ? { ...e, ...event, id: e.id } : e) : [...prev.calendarEvents, { ...event, id: event.id }] }\n    })\n  }\n",
    "calendar upsert explicit ids",
)
store_path.write_text(store, encoding="utf-8")


# --- pages/Health.tsx -----------------------------------------------------
health_path = Path("pages/Health.tsx")
health = health_path.read_text(encoding="utf-8")

health = replace_once(
    health,
    "type FollowUpUnit = 'days' | 'weeks' | 'months' | 'years'\n",
    "type FollowUpUnit = 'days' | 'weeks' | 'months' | 'years'\ntype BookingReminderUnit = 'days' | 'weeks' | 'months'\n",
    "booking reminder unit type",
)

follow_marker = """function followUpLabel(item: any) {
  if (item.nextVisitDate) return `Prossimo controllo: ${formatDate(item.nextVisitDate)}`
  const every = positiveNumber(item.followUpEvery)
  if (!every) return ''
  const unit = ({ days: 'giorni', weeks: 'settimane', months: 'mesi', years: 'anni' } as Record<string, string>)[item.followUpUnit || 'months']
  return `Controllo ogni ${every} ${unit}`
}
"""
booking_helpers = follow_marker + """
function subtractBookingInterval(dateStr: string, amount: number, unit: BookingReminderUnit) {
  if (!dateStr || !Number.isFinite(amount) || amount <= 0) return ''
  const value = Math.max(1, Math.round(amount))
  const date = parseISODate(dateStr)
  if (unit === 'days') {
    date.setDate(date.getDate() - value)
    return localDateISO(date)
  }
  if (unit === 'weeks') {
    date.setDate(date.getDate() - (value * 7))
    return localDateISO(date)
  }
  const originalDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() - value)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate()
  date.setDate(Math.min(originalDay, lastDay))
  return localDateISO(date)
}

function calculatedBookingReminderDate(item: any, targetDate?: string) {
  const every = positiveNumber(item?.bookingReminderEvery)
  const date = targetDate || item?.date || ''
  if (!every || !date) return ''
  return subtractBookingInterval(date, every, (item.bookingReminderUnit || 'days') as BookingReminderUnit)
}

function bookingReminderLabel(item: any) {
  const every = positiveNumber(item?.bookingReminderEvery)
  if (!every) return ''
  const unit = item.bookingReminderUnit || 'days'
  const label = unit === 'months'
    ? (every === 1 ? '1 mese' : `${every} mesi`)
    : unit === 'weeks'
      ? (every === 1 ? '1 settimana' : `${every} settimane`)
      : (every === 1 ? '1 giorno' : `${every} giorni`)
  const date = calculatedBookingReminderDate(item)
  return `Prenotare ${label} prima${date ? ` · ${formatDate(date)}` : ''}`
}

function bookingReminderPreset(item: any) {
  const every = positiveNumber(item?.bookingReminderEvery)
  const unit = item?.bookingReminderUnit || 'days'
  if (!every) return 'none'
  if (unit === 'days' && every === 7) return '7d'
  if (unit === 'days' && every === 15) return '15d'
  if (unit === 'months' && every === 1) return '1m'
  return 'custom'
}
"""
health = replace_once(health, follow_marker, booking_helpers, "booking helper functions")

health = replace_once(
    health,
    "        followUpEvery: '',\n        followUpUnit: 'months',\n        notes: '',\n",
    "        followUpEvery: '',\n        followUpUnit: 'months',\n        bookingReminderEvery: '',\n        bookingReminderUnit: 'days',\n        notes: '',\n",
    "new visit booking defaults",
)

calendar_marker = """  function upsertVisitCalendar(visit: any, existingEventId?: number) {
    const payload = {
      title: `Visita: ${visit.title}`,
      date: visit.date,
      time: visit.time || '',
      userId: Number(visit.userId),
      notes: `Promemoria Salute${visit.doctor ? ` · ${visit.doctor}` : ''}${visit.facility ? ` · ${visit.facility}` : ''}`,
      linkedHealthVisitId: Number(visit.id)
    }
    const exists = existingEventId ? data.calendarEvents.some(event => event.id === existingEventId) : false
    upsertCalendarEvent(exists ? { ...payload, id: existingEventId } : payload)
  }
"""
calendar_replacement = """  function upsertVisitCalendar(visit: any, eventId?: number) {
    const payload = {
      title: `Visita: ${visit.title}`,
      date: visit.date,
      time: visit.time || '',
      userId: Number(visit.userId),
      notes: `Promemoria Salute${visit.doctor ? ` · ${visit.doctor}` : ''}${visit.facility ? ` · ${visit.facility}` : ''}`,
      linkedHealthVisitId: Number(visit.id),
      linkedHealthReminderType: 'visit' as const
    }
    upsertCalendarEvent(eventId ? { ...payload, id: eventId } : payload)
  }

  function upsertBookingCalendar(visit: any, eventId: number) {
    const theoreticalDate = calculatedBookingReminderDate(visit)
    if (!theoreticalDate || !visit.date) return
    const reminderDate = theoreticalDate < today && visit.date >= today ? today : theoreticalDate
    upsertCalendarEvent({
      id: eventId,
      title: `Prenotare: ${visit.title}`,
      date: reminderDate,
      time: '',
      userId: Number(visit.userId),
      notes: `Promemoria prenotazione per controllo previsto il ${formatDate(visit.date)}${visit.doctor ? ` · ${visit.doctor}` : ''}${visit.facility ? ` · ${visit.facility}` : ''}`,
      linkedHealthVisitId: Number(visit.id),
      linkedHealthReminderType: 'booking' as const
    })
  }

  function setBookingPreset(value: string) {
    if (!editing) return
    if (value === 'none') return setEditing({ ...editing, bookingReminderEvery: '', bookingReminderUnit: 'days' })
    if (value === '7d') return setEditing({ ...editing, bookingReminderEvery: 7, bookingReminderUnit: 'days' })
    if (value === '15d') return setEditing({ ...editing, bookingReminderEvery: 15, bookingReminderUnit: 'days' })
    if (value === '1m') return setEditing({ ...editing, bookingReminderEvery: 1, bookingReminderUnit: 'months' })
    setEditing({ ...editing, bookingReminderEvery: positiveNumber(editing.bookingReminderEvery) || 10, bookingReminderUnit: editing.bookingReminderUnit || 'days' })
  }
"""
health = replace_once(health, calendar_marker, calendar_replacement, "calendar reminder functions")

start = health.find("  function saveVisit() {\n")
end = health.find("\n  function save() {", start)
if start < 0 or end < 0:
    raise SystemExit("Patch point not found: saveVisit block")
new_save_visit = """  function saveVisit() {
    if (!editing?.title?.trim() || !editing.date) return
    const status = editing.healthStatus || 'scheduled'
    const isNew = !editing.id
    const sourceId = Number(editing.id || nextId(data.deadlines))
    const explicitOrCalculatedFollowUp = status === 'completed' ? calculatedFollowUpDate(editing) : ''
    const bookingEvery = positiveNumber(editing.bookingReminderEvery)
    const bookingUnit = (editing.bookingReminderUnit || 'days') as BookingReminderUnit

    if (explicitOrCalculatedFollowUp && explicitOrCalculatedFollowUp <= editing.date) {
      alert('La prossima visita deve essere successiva alla visita appena effettuata.')
      return
    }

    const oldFollow = editing.followUpVisitId
      ? data.deadlines.find(item => item.id === Number(editing.followUpVisitId) && item.kind === 'visit')
      : undefined

    let calendarCursor = nextId(data.calendarEvents)
    const reserveCalendarId = (existing?: any) => {
      const current = Number(existing || 0)
      if (current) return current
      const reserved = calendarCursor
      calendarCursor += 1
      return reserved
    }

    let sourceCalendarEventId = Number(editing.calendarEventId || 0) || undefined
    let sourceBookingReminderEventId = Number(editing.bookingReminderEventId || 0) || undefined

    if (status === 'scheduled') {
      sourceCalendarEventId = reserveCalendarId(sourceCalendarEventId)
      if (bookingEvery) sourceBookingReminderEventId = reserveCalendarId(sourceBookingReminderEventId)
      else if (sourceBookingReminderEventId) {
        deleteCalendarEvent(sourceBookingReminderEventId)
        sourceBookingReminderEventId = undefined
      }
    } else {
      if (status === 'cancelled' && sourceCalendarEventId) {
        deleteCalendarEvent(sourceCalendarEventId)
        sourceCalendarEventId = undefined
      }
      if (sourceBookingReminderEventId) {
        deleteCalendarEvent(sourceBookingReminderEventId)
        sourceBookingReminderEventId = undefined
      }
    }

    let followId: number | undefined
    let followEventId: number | undefined
    let followBookingReminderEventId: number | undefined
    if (explicitOrCalculatedFollowUp) {
      followId = oldFollow?.id || (isNew ? sourceId + 1 : nextId(data.deadlines))
      followEventId = reserveCalendarId(oldFollow?.calendarEventId)
      if (bookingEvery) followBookingReminderEventId = reserveCalendarId(oldFollow?.bookingReminderEventId)
      else if (oldFollow?.bookingReminderEventId) deleteCalendarEvent(oldFollow.bookingReminderEventId)
    }

    const source = {
      ...editing,
      title: editing.title.trim(),
      id: editing.id,
      userId: Number(editing.userId),
      kind: 'visit' as const,
      healthStatus: status,
      done: status === 'completed' || status === 'cancelled',
      specialty: editing.specialty?.trim() || '',
      doctor: editing.doctor?.trim() || '',
      facility: editing.facility?.trim() || '',
      purpose: editing.purpose?.trim() || '',
      outcome: editing.outcome?.trim() || '',
      notes: editing.notes?.trim() || '',
      followUpEvery: positiveNumber(editing.followUpEvery),
      followUpUnit: (editing.followUpUnit || 'months') as FollowUpUnit,
      bookingReminderEvery: bookingEvery,
      bookingReminderUnit: bookingUnit,
      nextVisitDate: explicitOrCalculatedFollowUp || '',
      followUpVisitId: followId,
      calendarEventId: sourceCalendarEventId,
      bookingReminderEventId: sourceBookingReminderEventId
    }

    upsertDeadline(source)

    const materializedSource = { ...source, id: sourceId }
    if (status === 'scheduled' && sourceCalendarEventId) upsertVisitCalendar(materializedSource, sourceCalendarEventId)
    if (status === 'scheduled' && sourceBookingReminderEventId) upsertBookingCalendar(materializedSource, sourceBookingReminderEventId)
    if (status === 'completed' && sourceCalendarEventId) upsertVisitCalendar(materializedSource, sourceCalendarEventId)

    if (explicitOrCalculatedFollowUp && followId && followEventId) {
      const follow = {
        id: oldFollow?.id,
        title: source.title,
        date: explicitOrCalculatedFollowUp,
        time: oldFollow?.time || '',
        userId: source.userId,
        done: false,
        kind: 'visit' as const,
        healthStatus: 'scheduled' as const,
        specialty: source.specialty,
        doctor: source.doctor,
        facility: source.facility,
        purpose: source.purpose,
        outcome: '',
        notes: oldFollow?.notes || 'Promemoria creato automaticamente dalla frequenza del controllo precedente.',
        nextVisitDate: '',
        followUpEvery: source.followUpEvery,
        followUpUnit: source.followUpUnit,
        bookingReminderEvery: source.bookingReminderEvery,
        bookingReminderUnit: source.bookingReminderUnit,
        bookingReminderEventId: followBookingReminderEventId,
        followUpSourceId: sourceId,
        autoGenerated: true,
        calendarEventId: followEventId,
        attachments: oldFollow?.attachments || []
      }
      upsertDeadline(follow)
      upsertVisitCalendar({ ...follow, id: followId }, followEventId)
      if (followBookingReminderEventId) upsertBookingCalendar({ ...follow, id: followId }, followBookingReminderEventId)
    } else if (oldFollow?.autoGenerated) {
      if (oldFollow.calendarEventId) deleteCalendarEvent(oldFollow.calendarEventId)
      if (oldFollow.bookingReminderEventId) deleteCalendarEvent(oldFollow.bookingReminderEventId)
      deleteDeadline(oldFollow.id)
    }

    setEditing(null)
  }
"""
health = health[:start] + new_save_visit + health[end:]

health = replace_once(
    health,
    "      if (editing.kind === 'visit' && editing.calendarEventId) deleteCalendarEvent(editing.calendarEventId)\n",
    "      if (editing.kind === 'visit' && editing.calendarEventId) deleteCalendarEvent(editing.calendarEventId)\n      if (editing.kind === 'visit' && editing.bookingReminderEventId) deleteCalendarEvent(editing.bookingReminderEventId)\n",
    "delete own booking reminder",
)
health = replace_once(
    health,
    "          if (follow.calendarEventId) deleteCalendarEvent(follow.calendarEventId)\n          deleteDeadline(follow.id)\n",
    "          if (follow.calendarEventId) deleteCalendarEvent(follow.calendarEventId)\n          if (follow.bookingReminderEventId) deleteCalendarEvent(follow.bookingReminderEventId)\n          deleteDeadline(follow.id)\n",
    "delete follow booking reminder",
)

health = replace_once(
    health,
    "  const editingFollowUpDate = editing?.kind === 'visit' && editing?.healthStatus === 'completed' ? calculatedFollowUpDate(editing) : ''\n",
    "  const editingFollowUpDate = editing?.kind === 'visit' && editing?.healthStatus === 'completed' ? calculatedFollowUpDate(editing) : ''\n  const editingBookingTargetDate = editing?.kind === 'visit' ? (editing?.healthStatus === 'completed' ? editingFollowUpDate : (editing?.date || '')) : ''\n  const editingBookingReminderDate = editing?.kind === 'visit' ? calculatedBookingReminderDate(editing, editingBookingTargetDate) : ''\n",
    "editing booking reminder preview",
)

health = replace_once(
    health,
    "        const details = [user?.name, item.specialty, item.doctor, item.facility, item.time ? `ore ${item.time}` : '', followUpLabel(item), item.attachments?.length ? `📎 ${item.attachments.length}` : ''].filter(Boolean).join(' · ')\n",
    "        const details = [user?.name, item.specialty, item.doctor, item.facility, item.time ? `ore ${item.time}` : '', followUpLabel(item), (item.healthStatus || 'scheduled') === 'scheduled' ? bookingReminderLabel(item) : '', item.attachments?.length ? `📎 ${item.attachments.length}` : ''].filter(Boolean).join(' · ')\n",
    "visit list booking reminder label",
)

health = replace_once(
    health,
    "      <CardHeader title=\"Visite e controlli\" subtitle=\"Quando chiudi una visita puoi indicare la prossima data oppure una frequenza: VerdoFamily crea il controllo successivo e il relativo evento in Calendario.\" />\n",
    "      <CardHeader title=\"Visite e controlli\" subtitle=\"Quando chiudi una visita puoi indicare la prossima data o una frequenza e scegliere quanto prima ricordarti di prenotarla. VerdoFamily crea entrambi i promemoria nel Calendario.\" />\n",
    "visits card subtitle",
)

old_auto_card = """        <Card className=\"field--wide\">
          <CardHeader title=\"Prossimo controllo automatico\" subtitle=\"Usa una data precisa oppure una frequenza. Quando la visita è segnata come effettuata, il sistema crea automaticamente la prossima visita e il promemoria nel Calendario.\" />
          <div className=\"form-grid form-grid--2\">
            <Field label=\"Prossima visita\" hint=\"Ha priorità sulla frequenza.\"><input type=\"date\" min={editing.date || undefined} value={editing.nextVisitDate || ''} onChange={e => setEditing({ ...editing, nextVisitDate: e.target.value })} /></Field>
            <Field label=\"Ripeti controllo ogni\"><input type=\"number\" min=\"1\" step=\"1\" value={editing.followUpEvery ?? ''} onChange={e => setEditing({ ...editing, followUpEvery: e.target.value })} placeholder=\"Es. 6\" /></Field>
            <Field label=\"Unità\"><select value={editing.followUpUnit || 'months'} onChange={e => setEditing({ ...editing, followUpUnit: e.target.value })}><option value=\"days\">Giorni</option><option value=\"weeks\">Settimane</option><option value=\"months\">Mesi</option><option value=\"years\">Anni</option></select></Field>
            <div className=\"callout\" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editing.healthStatus === 'completed' ? (editingFollowUpDate ? `Prossimo promemoria: ${formatDate(editingFollowUpDate)}` : 'Nessun controllo successivo impostato.') : 'Il promemoria verrà generato quando la visita sarà indicata come effettuata.'}</div>
          </div>
        </Card>
"""
new_auto_card = """        <Card className=\"field--wide\">
          <CardHeader title=\"Prossimo controllo automatico\" subtitle=\"Usa una data precisa oppure una frequenza. Puoi anche creare un secondo promemoria che ti avvisa quando è il momento di prenotare il controllo.\" />
          <div className=\"form-grid form-grid--2\">
            <Field label=\"Prossima visita\" hint=\"Ha priorità sulla frequenza.\"><input type=\"date\" min={editing.date || undefined} value={editing.nextVisitDate || ''} onChange={e => setEditing({ ...editing, nextVisitDate: e.target.value })} /></Field>
            <Field label=\"Ripeti controllo ogni\"><input type=\"number\" min=\"1\" step=\"1\" value={editing.followUpEvery ?? ''} onChange={e => setEditing({ ...editing, followUpEvery: e.target.value })} placeholder=\"Es. 6\" /></Field>
            <Field label=\"Unità\"><select value={editing.followUpUnit || 'months'} onChange={e => setEditing({ ...editing, followUpUnit: e.target.value })}><option value=\"days\">Giorni</option><option value=\"weeks\">Settimane</option><option value=\"months\">Mesi</option><option value=\"years\">Anni</option></select></Field>
            <div className=\"callout\" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editing.healthStatus === 'completed' ? (editingFollowUpDate ? `Prossimo controllo: ${formatDate(editingFollowUpDate)}` : 'Nessun controllo successivo impostato.') : 'Il controllo successivo verrà generato quando la visita sarà indicata come effettuata.'}</div>
          </div>
          <div className=\"form-grid form-grid--2\" style={{ marginTop: 12 }}>
            <Field label=\"Ricordami di prenotarla\" hint=\"Rispetto alla data del prossimo controllo.\"><select value={bookingReminderPreset(editing)} onChange={e => setBookingPreset(e.target.value)}><option value=\"none\">Nessun promemoria</option><option value=\"7d\">7 giorni prima</option><option value=\"15d\">15 giorni prima</option><option value=\"1m\">1 mese prima</option><option value=\"custom\">Personalizzato</option></select></Field>
            {bookingReminderPreset(editing) === 'custom' ? <>
              <Field label=\"Anticipo\"><input type=\"number\" min=\"1\" step=\"1\" value={editing.bookingReminderEvery ?? ''} onChange={e => setEditing({ ...editing, bookingReminderEvery: e.target.value })} /></Field>
              <Field label=\"Unità anticipo\"><select value={editing.bookingReminderUnit || 'days'} onChange={e => setEditing({ ...editing, bookingReminderUnit: e.target.value })}><option value=\"days\">Giorni</option><option value=\"weeks\">Settimane</option><option value=\"months\">Mesi</option></select></Field>
            </> : <div className=\"callout\" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editingBookingReminderDate ? `Promemoria prenotazione: ${formatDate(editingBookingReminderDate)}` : 'Nessun promemoria di prenotazione.'}</div>}
            {bookingReminderPreset(editing) === 'custom' ? <div className=\"callout\" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editingBookingReminderDate ? `Promemoria prenotazione: ${formatDate(editingBookingReminderDate)}` : 'Imposta prima la data del controllo.'}</div> : null}
          </div>
        </Card>
"""
health = replace_once(health, old_auto_card, new_auto_card, "visit automatic follow-up card")

health_path.write_text(health, encoding="utf-8")
print("Health booking reminder patch applied successfully")
