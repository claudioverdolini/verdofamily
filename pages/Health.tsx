import React, { useMemo, useState } from 'react'
import {
  Activity,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  HeartPulse,
  Package,
  Paperclip,
  Pencil,
  Pill,
  Plus,
  Stethoscope,
  Trash2,
  Upload
} from 'lucide-react'
import { useFamily } from '../store'
import { supabase } from '../supabaseClient'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, medicineInventorySummary, nextId, parseISODate, therapyDailyUse, therapyLineRequiredTablets } from '../utils'

type HealthSection = 'overview' | 'visits' | 'inventory' | 'therapy' | 'records'
type FollowUpUnit = 'days' | 'weeks' | 'months' | 'years'
type BookingReminderUnit = 'days' | 'weeks' | 'months'

function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return parseISODate(value).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return value
  }
}

function formatFileSize(bytes?: number) {
  const value = Number(bytes || 0)
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function positiveNumber(value: any) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function nonNegativeNumber(value: any) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function addFollowUpInterval(dateStr: string, amount: number, unit: FollowUpUnit) {
  if (!dateStr || !Number.isFinite(amount) || amount <= 0) return ''
  const value = Math.max(1, Math.round(amount))
  const date = parseISODate(dateStr)
  if (unit === 'days') {
    date.setDate(date.getDate() + value)
    return localDateISO(date)
  }
  if (unit === 'weeks') {
    date.setDate(date.getDate() + (value * 7))
    return localDateISO(date)
  }

  const originalDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + (unit === 'years' ? value * 12 : value))
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate()
  date.setDate(Math.min(originalDay, lastDay))
  return localDateISO(date)
}

function calculatedFollowUpDate(item: any) {
  if (item.nextVisitDate) return item.nextVisitDate
  const every = positiveNumber(item.followUpEvery)
  if (!every || !item.date) return ''
  return addFollowUpInterval(item.date, every, (item.followUpUnit || 'months') as FollowUpUnit)
}

function followUpLabel(item: any) {
  if (item.nextVisitDate) return `Prossimo controllo: ${formatDate(item.nextVisitDate)}`
  const every = positiveNumber(item.followUpEvery)
  if (!every) return ''
  const unit = ({ days: 'giorni', weeks: 'settimane', months: 'mesi', years: 'anni' } as Record<string, string>)[item.followUpUnit || 'months']
  return `Controllo ogni ${every} ${unit}`
}

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

function therapyPhase(item: any) {
  if (item.done) return { label: 'Archiviata', tone: 'success' as const }
  const start = item.therapyStartDate || ''
  const end = item.therapyEndDate || ''
  const today = localDateISO()
  if (!start) return { label: 'Da definire', tone: 'warning' as const }
  if (end && end < start) return { label: 'Date da verificare', tone: 'danger' as const }
  if (today < start) return { label: 'Programmata', tone: 'neutral' as const }
  if (end && today > end) return { label: 'Terminata', tone: 'success' as const }
  if (end && today === end) return { label: 'Ultimo giorno', tone: 'warning' as const }
  return { label: 'In corso', tone: 'violet' as const }
}

function stockStatus(summary: ReturnType<typeof medicineInventorySummary>, done: boolean) {
  if (done) return { label: 'Archiviato', tone: 'success' as const }
  if (summary.packageCount > 0 && summary.totalStock <= 0) return { label: 'Esaurito', tone: 'danger' as const }
  if (summary.shortageDate || summary.shortageKnown > 0) return { label: 'Scorta insufficiente', tone: 'warning' as const }
  if (summary.expiredPackageCount > 0) return { label: 'Scaduti presenti', tone: 'danger' as const }
  if (summary.expiringSoonPackageCount > 0) return { label: 'Scadenza vicina', tone: 'warning' as const }
  if (!summary.packageCount) return { label: 'Nessuna confezione', tone: 'neutral' as const }
  return { label: 'Scorta OK', tone: 'success' as const }
}

function visitStatus(item: any) {
  const status = item.healthStatus || (item.done ? 'completed' : 'scheduled')
  if (status === 'completed') return { label: 'Effettuata', tone: 'success' as const }
  if (status === 'cancelled') return { label: 'Annullata', tone: 'neutral' as const }
  if (item.date < localDateISO()) return { label: 'Da aggiornare', tone: 'warning' as const }
  return { label: item.autoGenerated ? 'Promemoria automatico' : 'Programmata', tone: 'violet' as const }
}

function recordKindLabel(kind?: string) {
  return ({ exam: 'Esame', report: 'Referto', vaccine: 'Vaccino', document: 'Documento', note: 'Nota clinica' } as Record<string, string>)[kind || ''] || 'Documento'
}

function nextNestedId(list: Array<{ id?: number }>) {
  return list.length ? Math.max(...list.map(item => Number(item.id || 0))) + 1 : 1
}

export default function HealthPage() {
  const {
    data,
    authUser,
    familyId,
    cloudAuthenticated,
    upsertDeadline,
    toggleDeadline,
    deleteDeadline,
    upsertCalendarEvent,
    deleteCalendarEvent
  } = useFamily()
  const [section, setSection] = useState<HealthSection>('overview')
  const [editing, setEditing] = useState<any>(null)
  const [personFilter, setPersonFilter] = useState<number | 'all'>('all')
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [attachmentMessage, setAttachmentMessage] = useState('')
  const [quickMedicine, setQuickMedicine] = useState<any>(null)
  const readOnlyHealth = authUser?.role === 'bimbo'

  const medicines = useMemo(
    () => data.deadlines.filter(item => item.kind === 'medicine').slice().sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title)),
    [data.deadlines]
  )
  const therapies = useMemo(
    () => data.deadlines.filter(item => item.kind === 'therapy').slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.therapyStartDate || a.date).localeCompare(b.therapyStartDate || b.date)),
    [data.deadlines]
  )
  const visits = useMemo(
    () => data.deadlines.filter(item => item.kind === 'visit').slice().sort((a, b) => {
      const aScheduled = (a.healthStatus || 'scheduled') === 'scheduled' && a.date >= localDateISO()
      const bScheduled = (b.healthStatus || 'scheduled') === 'scheduled' && b.date >= localDateISO()
      if (aScheduled !== bScheduled) return aScheduled ? -1 : 1
      return aScheduled ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    }),
    [data.deadlines]
  )
  const records = useMemo(
    () => data.deadlines.filter(item => item.kind === 'health-record').slice().sort((a, b) => b.date.localeCompare(a.date)),
    [data.deadlines]
  )

  const effectivePersonFilter: number | 'all' = readOnlyHealth && authUser ? authUser.id : personFilter
  const visibleVisits = effectivePersonFilter === 'all' ? visits : visits.filter(item => item.userId === effectivePersonFilter)
  const visibleTherapies = effectivePersonFilter === 'all' ? therapies : therapies.filter(item => item.userId === effectivePersonFilter)
  const visibleRecords = effectivePersonFilter === 'all' ? records : records.filter(item => item.userId === effectivePersonFilter)
  const today = localDateISO()
  const upcomingVisits = visibleVisits.filter(item => (item.healthStatus || 'scheduled') === 'scheduled' && item.date >= today)
  const activeTherapies = visibleTherapies.filter(item => !item.done && (item.therapyStartDate || item.date) <= today && (!item.therapyEndDate || item.therapyEndDate >= today))
  const medicineAlerts = medicines.filter(item => {
    const summary = medicineInventorySummary(item, therapies)
    return !item.done && (summary.shortageDate || summary.shortageKnown > 0 || summary.expiredPackageCount > 0 || summary.expiringSoonPackageCount > 0)
  })

  function blankPackage(existing: any[] = []) {
    return { id: nextNestedId(existing), expiryDate: '', quantity: '', packageSize: '', lot: '', addedAt: localDateISO() }
  }

  function blankTherapyMedicine(existing: any[] = []) {
    const used = new Set(existing.map(line => Number(line.medicineId || 0)))
    const firstAvailable = medicines.find(medicine => !used.has(medicine.id)) || medicines[0]
    return { id: nextNestedId(existing), medicineId: firstAvailable?.id || 0, tabletsPerDose: 1, dosesPerDay: 1, usage: '' }
  }

  function openNew(kind: 'visit' | 'inventory' | 'therapy' | 'record') {
    if (readOnlyHealth) return
    setAttachmentMessage('')
    if (kind === 'visit') {
      setEditing({
        id: undefined,
        title: '',
        date: localDateISO(),
        time: '',
        userId: authUser?.id || data.users[0]?.id || 1,
        done: false,
        kind: 'visit',
        healthStatus: 'scheduled',
        specialty: '',
        doctor: '',
        facility: '',
        purpose: '',
        outcome: '',
        nextVisitDate: '',
        followUpEvery: '',
        followUpUnit: 'months',
        bookingReminderEvery: '',
        bookingReminderUnit: 'days',
        notes: '',
        attachments: []
      })
      return
    }
    if (kind === 'record') {
      setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'health-record', healthRecordKind: 'exam', provider: '', result: '', notes: '', attachments: [] })
      return
    }
    if (kind === 'inventory') {
      setEditing({ id: undefined, title: '', date: localDateISO(), userId: 0, done: false, kind: 'medicine', activeIngredient: '', purpose: '', notes: '', defaultPackageSize: '', packages: [blankPackage()] })
      return
    }
    setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'therapy', prescriber: '', purpose: '', notes: '', therapyStartDate: localDateISO(), therapyEndDate: '', therapyMedicines: medicines.length ? [blankTherapyMedicine()] : [], attachments: [] })
  }

  function editItem(item: any) {
    setAttachmentMessage('')
    const copy = JSON.parse(JSON.stringify(item))
    if (copy.kind === 'medicine') copy.packages ||= []
    if (copy.kind === 'therapy') copy.therapyMedicines ||= []
    copy.attachments ||= []
    setEditing(copy)
  }

  function upsertVisitCalendar(visit: any, eventId?: number) {
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

  function saveVisit() {
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

  function save() {
    if (!editing || readOnlyHealth) return

    if (editing.kind === 'visit') {
      saveVisit()
      return
    }

    if (editing.kind === 'health-record') {
      if (!editing.title?.trim() || !editing.date) return
      upsertDeadline({ ...editing, title: editing.title.trim(), userId: Number(editing.userId), kind: 'health-record', done: false, provider: editing.provider?.trim() || '', result: editing.result?.trim() || '', notes: editing.notes?.trim() || '' })
      setEditing(null)
      return
    }

    if (editing.kind === 'medicine') {
      if (!editing.title?.trim()) return
      const packages = (editing.packages || []).filter((pkg: any) => pkg.expiryDate || pkg.lot?.trim() || Number(pkg.quantity || 0) > 0).map((pkg: any, index: number) => ({
        id: Number(pkg.id) || index + 1,
        expiryDate: pkg.expiryDate || '',
        quantity: nonNegativeNumber(pkg.quantity),
        packageSize: positiveNumber(pkg.packageSize),
        lot: pkg.lot?.trim() || '',
        addedAt: pkg.addedAt || localDateISO()
      }))
      const nearestExpiry = packages.map((pkg: any) => pkg.expiryDate).filter(Boolean).sort()[0] || localDateISO()
      upsertDeadline({ ...editing, title: editing.title.trim(), date: nearestExpiry, userId: 0, kind: 'medicine', activeIngredient: editing.activeIngredient?.trim() || '', purpose: editing.purpose?.trim() || '', notes: editing.notes?.trim() || '', defaultPackageSize: positiveNumber(editing.defaultPackageSize), packages, therapyStartDate: undefined, therapyEndDate: undefined, therapyMedicines: undefined, prescriber: undefined, usage: undefined })
      setEditing(null)
      return
    }

    if (editing.kind === 'therapy') {
      if (!editing.therapyStartDate) return alert('Indica almeno la data di inizio della terapia.')
      if (editing.therapyEndDate && editing.therapyEndDate < editing.therapyStartDate) return alert('La data di fine terapia non può essere precedente alla data di inizio.')
      const therapyMedicines = (editing.therapyMedicines || []).filter((line: any) => Number(line.medicineId || 0) > 0).map((line: any, index: number) => ({
        id: Number(line.id) || index + 1,
        medicineId: Number(line.medicineId),
        tabletsPerDose: Number(positiveNumber(line.tabletsPerDose) || 1),
        dosesPerDay: Number(positiveNumber(line.dosesPerDay) || 1),
        usage: line.usage?.trim() || ''
      }))
      if (!therapyMedicines.length) return alert('Aggiungi almeno un medicinale alla terapia.')
      const patient = data.users.find(user => user.id === Number(editing.userId))
      const title = editing.title?.trim() || `Terapia ${patient?.name || ''}`.trim()
      upsertDeadline({ ...editing, title, date: editing.therapyEndDate || editing.therapyStartDate, userId: Number(editing.userId || authUser?.id || data.users[0]?.id || 1), kind: 'therapy', prescriber: editing.prescriber?.trim() || '', purpose: editing.purpose?.trim() || '', notes: editing.notes?.trim() || '', therapyStartDate: editing.therapyStartDate, therapyEndDate: editing.therapyEndDate || '', therapyMedicines })
      setEditing(null)
    }
  }

  async function removeStoredAttachment(path: string) {
    if (!supabase || !familyId || !path) return
    await supabase.functions.invoke('health-attachment', { body: { action: 'delete', familyId, path } })
  }

  async function deleteEditing() {
    if (!editing?.id || readOnlyHealth) return
    if (editing.kind === 'medicine') {
      const linked = therapies.filter(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === Number(editing.id)))
      if (linked.length) return alert(`Questo medicinale è collegato a ${linked.length} ${linked.length === 1 ? 'terapia' : 'terapie'}. Rimuovilo prima dalle terapie oppure archivialo.`)
    }
    if (!confirm('Eliminare definitivamente questa voce?')) return
    setAttachmentBusy(true)
    try {
      await Promise.allSettled((editing.attachments || []).map((attachment: any) => removeStoredAttachment(attachment.path)))
      if (editing.kind === 'visit' && editing.calendarEventId) deleteCalendarEvent(editing.calendarEventId)
      if (editing.kind === 'visit' && editing.bookingReminderEventId) deleteCalendarEvent(editing.bookingReminderEventId)
      if (editing.kind === 'visit' && editing.followUpVisitId) {
        const follow = data.deadlines.find(item => item.id === Number(editing.followUpVisitId) && item.autoGenerated)
        if (follow) {
          if (follow.calendarEventId) deleteCalendarEvent(follow.calendarEventId)
          if (follow.bookingReminderEventId) deleteCalendarEvent(follow.bookingReminderEventId)
          deleteDeadline(follow.id)
        }
      }
      deleteDeadline(editing.id)
      setEditing(null)
    } finally {
      setAttachmentBusy(false)
    }
  }

  async function uploadAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    if (readOnlyHealth) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editing?.id) return
    if (!supabase || !familyId || !cloudAuthenticated) {
      setAttachmentMessage('Gli allegati richiedono l’accesso cloud.')
      return
    }
    const stored = data.deadlines.find(item => item.id === editing.id && item.kind === editing.kind)
    if (!stored) {
      setAttachmentMessage('La scheda non risulta più sincronizzata. Chiudila, aggiorna la pagina e riaprila prima di caricare allegati.')
      return
    }
    setAttachmentBusy(true)
    setAttachmentMessage('')
    try {
      const form = new FormData()
      form.append('action', 'upload')
      form.append('familyId', familyId)
      form.append('recordId', `${editing.kind}-${editing.id}`)
      form.append('file', file)
      const { data: result, error } = await supabase.functions.invoke('health-attachment', { body: form })
      if (error || !result?.ok || !result?.attachment) throw new Error(error?.message || result?.error || 'Caricamento non riuscito')
      const attachments = [...(editing.attachments || []), result.attachment]
      upsertDeadline({ ...stored, ...editing, attachments })
      setEditing({ ...editing, attachments })
      setAttachmentMessage(result.attachment?.driveBackup?.ok === false
        ? 'Allegato salvato su Supabase. Backup Drive da verificare.'
        : 'Allegato salvato su Supabase e copiato su Google Drive.')
    } catch (error: any) {
      setAttachmentMessage(`Allegato non salvato: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setAttachmentBusy(false)
    }
  }

  async function openAttachment(attachment: any) {
    if (!supabase || !familyId) return
    setAttachmentBusy(true)
    setAttachmentMessage('')
    try {
      const { data: result, error } = await supabase.functions.invoke('health-attachment', { body: { action: 'signed-url', familyId, path: attachment.path } })
      if (error || !result?.ok || !result?.signedUrl) throw new Error(error?.message || result?.error || 'File non disponibile')
      const link = document.createElement('a')
      link.href = result.signedUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (error: any) {
      setAttachmentMessage(`Impossibile aprire l’allegato: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setAttachmentBusy(false)
    }
  }

  async function deleteAttachment(attachment: any) {
    if (!editing?.id || !confirm(`Eliminare l’allegato “${attachment.name}”?`)) return
    setAttachmentBusy(true)
    setAttachmentMessage('')
    try {
      await removeStoredAttachment(attachment.path)
      const attachments = (editing.attachments || []).filter((item: any) => item.id !== attachment.id)
      const stored = data.deadlines.find(item => item.id === editing.id) || editing
      upsertDeadline({ ...stored, attachments })
      setEditing({ ...editing, attachments })
      setAttachmentMessage('Allegato eliminato.')
    } catch (error: any) {
      setAttachmentMessage(`Eliminazione non riuscita: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setAttachmentBusy(false)
    }
  }

  function renderAttachments() {
    if (!editing || !['visit', 'health-record', 'therapy'].includes(editing.kind)) return null
    const attachments = editing.attachments || []
    return <Card className="field--wide">
      <CardHeader title={`Allegati · ${editing.kind === 'visit' ? 'Visita' : editing.kind === 'therapy' ? 'Terapia' : 'Esame/referto'}: ${editing.title || 'senza titolo'}`} subtitle="PDF, foto e documenti sono conservati in Supabase privato e copiati su Google Drive." />
      {!editing.id ? <div className="callout"><strong>Salva prima la scheda.</strong> Dopo il primo salvataggio riaprila per allegare referti, ricette, impegnative o foto.</div> : !cloudAuthenticated ? <div className="callout">Accedi al cloud per gestire gli allegati.</div> : <>
        {!readOnlyHealth ? <div className="backup-actions" style={{ marginBottom: attachments.length ? 12 : 0 }}>
          <label className="btn btn--soft" style={{ cursor: attachmentBusy ? 'wait' : 'pointer' }}>
            <Upload size={16} /> {attachmentBusy ? 'Attendi…' : 'Carica allegato'}
            <input hidden disabled={attachmentBusy} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff,.doc,.docx,application/pdf,image/*" onChange={uploadAttachment} />
          </label>
        </div> : null}
        {attachments.length ? <div className="sortable-list">{attachments.map((attachment: any) => <div key={attachment.id}>
          <span><strong>{attachment.name}</strong>{attachment.size ? ` · ${formatFileSize(attachment.size)}` : ''}</span>
          <div><button disabled={attachmentBusy} onClick={() => openAttachment(attachment)} title="Apri"><ExternalLink size={15} /></button>{!readOnlyHealth ? <button disabled={attachmentBusy} onClick={() => deleteAttachment(attachment)} title="Elimina"><Trash2 size={15} /></button> : null}</div>
        </div>)}</div> : <div className="muted">Nessun allegato.</div>}
      </>}
      {attachmentMessage ? <div className="callout" style={{ marginTop: 10 }}>{attachmentMessage}</div> : null}
    </Card>
  }

  function addPackage() {
    const current = editing?.packages || []
    setEditing({ ...editing, packages: [...current, blankPackage(current)] })
  }
  function updatePackage(id: number, patch: any) { setEditing({ ...editing, packages: (editing.packages || []).map((pkg: any) => Number(pkg.id) === Number(id) ? { ...pkg, ...patch } : pkg) }) }
  function removePackage(id: number) { setEditing({ ...editing, packages: (editing.packages || []).filter((pkg: any) => Number(pkg.id) !== Number(id)) }) }
  function addTherapyMedicine() {
    const current = editing?.therapyMedicines || []
    if (medicines.length) setEditing({ ...editing, therapyMedicines: [...current, blankTherapyMedicine(current)] })
  }

  function openQuickMedicine() {
    setQuickMedicine({
      title: '',
      activeIngredient: '',
      defaultPackageSize: '',
      quantity: '',
      expiryDate: '',
      purpose: '',
      notes: ''
    })
  }

  function saveQuickMedicine() {
    if (!quickMedicine?.title?.trim()) return alert('Inserisci il nome del medicinale.')
    const medicineId = nextId(data.deadlines)
    const packageSize = positiveNumber(quickMedicine.defaultPackageSize)
    const quantity = nonNegativeNumber(quickMedicine.quantity)
    const packages = quickMedicine.expiryDate || quantity > 0 || packageSize
      ? [{
          id: 1,
          expiryDate: quickMedicine.expiryDate || '',
          quantity,
          packageSize,
          lot: '',
          addedAt: localDateISO()
        }]
      : []
    upsertDeadline({
      id: medicineId,
      title: quickMedicine.title.trim(),
      date: quickMedicine.expiryDate || localDateISO(),
      userId: 0,
      done: false,
      kind: 'medicine',
      activeIngredient: quickMedicine.activeIngredient?.trim() || '',
      purpose: quickMedicine.purpose?.trim() || '',
      notes: quickMedicine.notes?.trim() || '',
      defaultPackageSize: packageSize,
      packages
    })

    const current = editing?.therapyMedicines || []
    const line = {
      id: nextNestedId(current),
      medicineId,
      tabletsPerDose: 1,
      dosesPerDay: 1,
      usage: ''
    }
    setEditing({ ...editing, therapyMedicines: [...current, line] })
    setQuickMedicine(null)
  }

  function updateTherapyMedicine(id: number, patch: any) { setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).map((line: any) => Number(line.id) === Number(id) ? { ...line, ...patch } : line) }) }
  function removeTherapyMedicine(id: number) { setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).filter((line: any) => Number(line.id) !== Number(id)) }) }

  const planningTherapies = editing?.kind === 'therapy' ? (editing.id ? therapies.map(therapy => therapy.id === editing.id ? editing : therapy) : [...therapies, { ...editing, id: -1 }]) : therapies
  const editingFollowUpDate = editing?.kind === 'visit' && editing?.healthStatus === 'completed' ? calculatedFollowUpDate(editing) : ''
  const editingBookingTargetDate = editing?.kind === 'visit' ? (editing?.healthStatus === 'completed' ? editingFollowUpDate : (editing?.date || '')) : ''
  const editingBookingReminderDate = editing?.kind === 'visit' ? calculatedBookingReminderDate(editing, editingBookingTargetDate) : ''

  const pageAction = readOnlyHealth
    ? null
    : section === 'visits'
      ? <Button icon={<Plus size={18} />} onClick={() => openNew('visit')}>Nuova visita</Button>
      : section === 'inventory'
        ? <Button icon={<Package size={18} />} onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>
        : section === 'therapy'
          ? <Button icon={<Stethoscope size={18} />} onClick={() => openNew('therapy')}>Nuova terapia</Button>
          : section === 'records'
            ? <Button icon={<Plus size={18} />} onClick={() => openNew('record')}>Nuovo documento</Button>
            : <Button icon={<Plus size={18} />} onClick={() => openNew('visit')}>Aggiungi visita</Button>

  return <div className="page">
    <PageIntro eyebrow="Cartella sanitaria familiare" title="Salute" description="Visite, terapie, medicinali, esami e documenti sanitari raccolti in un unico posto, con promemoria automatici e allegati protetti." actions={pageAction} />
    {readOnlyHealth ? <div className="callout"><strong>Cartella personale in sola lettura.</strong> Puoi consultare le tue informazioni e aprire i tuoi allegati; le modifiche restano riservate agli adulti della famiglia.</div> : null}

    <div className="page-tabs-wrap">
      <Segmented value={section} onChange={setSection} options={[
        { value: 'overview', label: 'Panoramica' },
        { value: 'visits', label: 'Visite' },
        { value: 'therapy', label: 'Terapie' },
        { value: 'inventory', label: 'Medicine' },
        { value: 'records', label: 'Esami & referti' }
      ]} />
    </div>

    {!readOnlyHealth && (section === 'overview' || section === 'visits' || section === 'therapy' || section === 'records') ? <div style={{ marginBottom: 14, maxWidth: 320 }}><Field label="Persona"><select value={personFilter} onChange={e => setPersonFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">Tutta la famiglia</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field></div> : null}

    {section === 'overview' ? <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Card><CardHeader title="Prossime visite" subtitle={upcomingVisits.length ? `${upcomingVisits.length} programmate` : 'Nessuna visita imminente'} /><strong style={{ fontSize: 26 }}>{upcomingVisits.length}</strong>{upcomingVisits[0] ? <div className="muted" style={{ marginTop: 6 }}>{formatDate(upcomingVisits[0].date)} · {upcomingVisits[0].title}</div> : null}</Card>
        <Card><CardHeader title="Terapie attive" subtitle="In corso oggi" /><strong style={{ fontSize: 26 }}>{activeTherapies.length}</strong>{activeTherapies[0] ? <div className="muted" style={{ marginTop: 6 }}>{activeTherapies[0].title}</div> : null}</Card>
        <Card><CardHeader title="Medicine da controllare" subtitle="Scorte o scadenze" /><strong style={{ fontSize: 26 }}>{medicineAlerts.length}</strong>{medicineAlerts[0] ? <div className="muted" style={{ marginTop: 6 }}>{medicineAlerts[0].title}</div> : null}</Card>
        <Card><CardHeader title="Storico sanitario" subtitle="Visite e documenti registrati" /><strong style={{ fontSize: 26 }}>{visibleVisits.filter(v => v.healthStatus === 'completed').length + visibleRecords.length}</strong></Card>
      </div>

      <Card>
        <CardHeader title="Prossime attività" subtitle="Le visite generate automaticamente dalla frequenza dei controlli compaiono qui e anche nel Calendario." />
        {upcomingVisits.length || activeTherapies.length ? <div className="deadline-list">
          {upcomingVisits.slice(0, 5).map(item => { const user = data.users.find(u => u.id === item.userId); return <div className="deadline-row" key={`v-${item.id}`}><div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name}{item.doctor ? ` · ${item.doctor}` : ''}{item.facility ? ` · ${item.facility}` : ''}{item.autoGenerated ? ' · promemoria automatico' : ''}</span></div><Badge tone="violet">Visita</Badge><IconButton label="Apri" onClick={() => { setSection('visits'); editItem(item) }}><Pencil size={17} /></IconButton></div> })}
          {activeTherapies.slice(0, 5).map(item => { const user = data.users.find(u => u.id === item.userId); return <div className="deadline-row" key={`t-${item.id}`}><div className="deadline-date"><strong>{(item.therapyEndDate || item.date)?.slice(8, 10) || '—'}</strong><span>{(item.therapyEndDate || item.date)?.slice(5, 7) || '—'}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name} · {item.therapyEndDate ? `fino al ${formatDate(item.therapyEndDate)}` : 'continuativa'}</span></div><Badge tone="success">Terapia</Badge><IconButton label="Apri" onClick={() => { setSection('therapy'); editItem(item) }}><Pencil size={17} /></IconButton></div> })}
        </div> : <EmptyState icon={<HeartPulse size={28} />} title="Tutto tranquillo" text="Non risultano visite imminenti o terapie attive per la selezione corrente." />}
      </Card>
    </> : null}

    {section === 'visits' ? <Card>
      <CardHeader title="Visite e controlli" subtitle="Quando chiudi una visita puoi indicare la prossima data o una frequenza e scegliere quanto prima ricordarti di prenotarla. VerdoFamily crea entrambi i promemoria nel Calendario." />
      {visibleVisits.length ? <div className="deadline-list">{visibleVisits.map(item => {
        const user = data.users.find(u => u.id === item.userId)
        const status = visitStatus(item)
        const details = [user?.name, item.specialty, item.doctor, item.facility, item.time ? `ore ${item.time}` : '', followUpLabel(item), (item.healthStatus || 'scheduled') === 'scheduled' ? bookingReminderLabel(item) : '', item.attachments?.length ? `📎 ${item.attachments.length}` : ''].filter(Boolean).join(' · ')
        return <div key={item.id} className={`deadline-row ${item.healthStatus === 'cancelled' ? 'is-done' : ''}`}>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span>{item.outcome ? <span>Esito: {item.outcome}</span> : null}</div>
          <Badge tone={status.tone}>{status.label}</Badge>
          <IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => editItem(item)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState icon={<Stethoscope size={28} />} title="Nessuna visita registrata" text="Inserisci una visita programmata oppure ricostruisci lo storico delle visite già effettuate." action={<Button onClick={() => openNew('visit')}>Aggiungi visita</Button>} />}
    </Card> : null}

    {section === 'records' ? <Card>
      <CardHeader title="Esami, referti e documenti" subtitle="Conserva lo storico e allega direttamente PDF, foto dei referti, certificati e altri documenti sanitari." />
      {visibleRecords.length ? <div className="deadline-list">{visibleRecords.map(item => { const user = data.users.find(u => u.id === item.userId); return <div key={item.id} className="deadline-row"><div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name} · {recordKindLabel(item.healthRecordKind)}{item.provider ? ` · ${item.provider}` : ''}{item.attachments?.length ? ` · 📎 ${item.attachments.length}` : ''}</span>{item.result ? <span>Esito: {item.result}</span> : null}</div><Badge tone="neutral">{recordKindLabel(item.healthRecordKind)}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => editItem(item)}><Trash2 size={17} /></IconButton></div> })}</div> : <EmptyState icon={<FileText size={28} />} title="Nessun documento sanitario" text="Registra esami, referti, vaccini o altre informazioni cliniche." action={<Button onClick={() => openNew('record')}>Aggiungi documento</Button>} />}
    </Card> : null}

    {section === 'inventory' ? <Card>
      <CardHeader title="Magazzino medicinali" subtitle="Ogni medicinale può avere più confezioni, anche con scadenze diverse. Le scorte sono condivise tra tutte le terapie." />
      {medicines.length ? <div className="deadline-list">{medicines.map(item => {
        const summary = medicineInventorySummary(item, therapies)
        const status = stockStatus(summary, item.done)
        const details = [`${summary.packageCount} ${summary.packageCount === 1 ? 'confezione' : 'confezioni'}`, `${summary.totalStock} compresse disponibili`, summary.therapyCount ? `${summary.therapyCount} terapie collegate` : 'nessuna terapia collegata', summary.activeDailyUse ? `consumo ${summary.activeDailyUse}/giorno` : '', summary.coverageUntil ? `copertura fino al ${formatDate(summary.coverageUntil)}` : '', summary.shortageKnown ? `mancano almeno ${summary.shortageKnown} compresse${summary.packagesToBuy ? ` (≈ ${summary.packagesToBuy} conf.)` : ''}` : ''].filter(Boolean).join(' · ')
        const expiry = summary.earliestExpiry
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button><div className="deadline-date"><strong>{expiry ? expiry.slice(8, 10) : '—'}</strong><span>{expiry ? expiry.slice(5, 7) : 'SCAD'}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div><Badge tone={status.tone}>{status.label}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => { const linked = therapies.some(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === item.id)); if (linked) alert('Il medicinale è collegato a una terapia. Rimuovilo prima dalla terapia o archivialo.'); else deleteDeadline(item.id) }}><Trash2 size={17} /></IconButton></div>
      })}</div> : <EmptyState icon={<Package size={26} />} title="Magazzino vuoto" text="Inserisci un medicinale e le confezioni che hai in casa." action={<Button onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>} />}
    </Card> : null}

    {section === 'therapy' ? <Card>
      <CardHeader title="Terapie prescritte" subtitle="Una terapia può contenere più medicinali e può richiedere più confezioni dello stesso farmaco." />
      {!medicines.length ? <EmptyState icon={<Pill size={26} />} title="Prima crea il magazzino" text="Aggiungi almeno un medicinale; poi potrai collegarlo alle terapie." action={<Button onClick={() => setSection('inventory')}>Vai alle medicine</Button>} /> : visibleTherapies.length ? <div className="deadline-list">{visibleTherapies.map(item => {
        const user = data.users.find(person => person.id === item.userId)
        const phase = therapyPhase(item)
        const lineDetails = (item.therapyMedicines || []).map(line => {
          const medicine = medicines.find(product => product.id === Number(line.medicineId))
          if (!medicine) return 'Medicinale non trovato'
          const required = item.therapyEndDate ? therapyLineRequiredTablets(item.therapyStartDate || '', item.therapyEndDate, line) : null
          const packSize = Number(medicine.defaultPackageSize || medicine.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
          const boxes = required !== null && packSize > 0 ? Math.ceil(Number(required || 0) / packSize) : 0
          const globalSummary = medicineInventorySummary(medicine, therapies)
          const warning = globalSummary.shortageDate ? ` ⚠ scorta insufficiente dal ${formatDate(globalSummary.shortageDate)}` : ''
          return `${medicine.title}: ${line.tabletsPerDose} × ${line.dosesPerDay}/g${required !== null ? ` · ${required} cps${boxes ? ` ≈ ${boxes} conf.` : ''}` : ' · continuativa'}${warning}`
        }).join(' | ')
        const details = [user?.name ? `Per ${user.name}` : '', item.prescriber ? `Dr. ${item.prescriber}` : '', `${formatDate(item.therapyStartDate)} → ${item.therapyEndDate ? formatDate(item.therapyEndDate) : 'continuativa'}`, lineDetails, item.attachments?.length ? `📎 ${item.attachments.length}` : ''].filter(Boolean).join(' · ')
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button><div className="deadline-date"><strong>{(item.therapyStartDate || item.date).slice(8, 10)}</strong><span>{(item.therapyStartDate || item.date).slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div><Badge tone={phase.tone}>{phase.label}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => editItem(item)}><Trash2 size={17} /></IconButton></div>
      })}</div> : <EmptyState icon={<Stethoscope size={26} />} title="Nessuna terapia" text="Registra una prescrizione e collega uno o più medicinali dal magazzino." action={<Button onClick={() => openNew('therapy')}>Nuova terapia</Button>} />}
    </Card> : null}

    <Modal
      open={!!editing}
      onClose={() => { setEditing(null); setQuickMedicine(null) }}
      title={editing?.kind === 'visit' ? (editing?.id ? 'Modifica visita' : 'Nuova visita') : editing?.kind === 'health-record' ? (editing?.id ? 'Modifica documento sanitario' : 'Nuovo documento sanitario') : editing?.kind === 'medicine' ? (editing?.id ? 'Modifica medicinale' : 'Nuovo medicinale') : (editing?.id ? 'Modifica terapia' : 'Nuova terapia')}
      size={editing?.kind === 'visit' || editing?.kind === 'health-record' ? 'md' : 'lg'}
      footer={readOnlyHealth
        ? <div className="modal-actions"><div /><div className="modal-actions__right"><Button onClick={() => setEditing(null)}>Chiudi</Button></div></div>
        : <div className="modal-actions"><div>{editing?.id ? <Button variant="danger" disabled={attachmentBusy} onClick={deleteEditing}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}
    >
      {editing?.kind === 'visit' ? <div className="form-grid form-grid--2">
        <Field label="Visita / controllo" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Visita cardiologica" /></Field>
        <Field label="Persona"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Stato"><select value={editing.healthStatus || 'scheduled'} onChange={e => setEditing({ ...editing, healthStatus: e.target.value })}><option value="scheduled">Programmata</option><option value="completed">Effettuata</option><option value="cancelled">Annullata</option></select></Field>
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Ora"><input type="time" value={editing.time || ''} onChange={e => setEditing({ ...editing, time: e.target.value })} /></Field>
        <Field label="Specialità"><input value={editing.specialty || ''} onChange={e => setEditing({ ...editing, specialty: e.target.value })} placeholder="Es. Cardiologia" /></Field>
        <Field label="Medico / specialista"><input value={editing.doctor || ''} onChange={e => setEditing({ ...editing, doctor: e.target.value })} /></Field>
        <Field label="Struttura"><input value={editing.facility || ''} onChange={e => setEditing({ ...editing, facility: e.target.value })} /></Field>

        <Card className="field--wide">
          <CardHeader title="Prossimo controllo automatico" subtitle="Usa una data precisa oppure una frequenza. Puoi anche creare un secondo promemoria che ti avvisa quando è il momento di prenotare il controllo." />
          <div className="form-grid form-grid--2">
            <Field label="Prossima visita" hint="Ha priorità sulla frequenza."><input type="date" min={editing.date || undefined} value={editing.nextVisitDate || ''} onChange={e => setEditing({ ...editing, nextVisitDate: e.target.value })} /></Field>
            <Field label="Ripeti controllo ogni"><input type="number" min="1" step="1" value={editing.followUpEvery ?? ''} onChange={e => setEditing({ ...editing, followUpEvery: e.target.value })} placeholder="Es. 6" /></Field>
            <Field label="Unità"><select value={editing.followUpUnit || 'months'} onChange={e => setEditing({ ...editing, followUpUnit: e.target.value })}><option value="days">Giorni</option><option value="weeks">Settimane</option><option value="months">Mesi</option><option value="years">Anni</option></select></Field>
            <div className="callout" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editing.healthStatus === 'completed' ? (editingFollowUpDate ? `Prossimo controllo: ${formatDate(editingFollowUpDate)}` : 'Nessun controllo successivo impostato.') : 'Il controllo successivo verrà generato quando la visita sarà indicata come effettuata.'}</div>
          </div>
          <div className="form-grid form-grid--2" style={{ marginTop: 12 }}>
            <Field label="Ricordami di prenotarla" hint="Rispetto alla data del prossimo controllo."><select value={bookingReminderPreset(editing)} onChange={e => setBookingPreset(e.target.value)}><option value="none">Nessun promemoria</option><option value="7d">7 giorni prima</option><option value="15d">15 giorni prima</option><option value="1m">1 mese prima</option><option value="custom">Personalizzato</option></select></Field>
            {bookingReminderPreset(editing) === 'custom' ? <>
              <Field label="Anticipo"><input type="number" min="1" step="1" value={editing.bookingReminderEvery ?? ''} onChange={e => setEditing({ ...editing, bookingReminderEvery: e.target.value })} /></Field>
              <Field label="Unità anticipo"><select value={editing.bookingReminderUnit || 'days'} onChange={e => setEditing({ ...editing, bookingReminderUnit: e.target.value })}><option value="days">Giorni</option><option value="weeks">Settimane</option><option value="months">Mesi</option></select></Field>
            </> : <div className="callout" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editingBookingReminderDate ? `Promemoria prenotazione: ${formatDate(editingBookingReminderDate)}` : 'Nessun promemoria di prenotazione.'}</div>}
            {bookingReminderPreset(editing) === 'custom' ? <div className="callout" style={{ alignSelf: 'end' }}><CalendarClock size={16} /> {editingBookingReminderDate ? `Promemoria prenotazione: ${formatDate(editingBookingReminderDate)}` : 'Imposta prima la data del controllo.'}</div> : null}
          </div>
        </Card>

        <Field label="Motivo" className="field--wide"><textarea rows={2} value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Field label="Esito / indicazioni" className="field--wide"><textarea rows={3} value={editing.outcome || ''} onChange={e => setEditing({ ...editing, outcome: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
        {renderAttachments()}
      </div> : null}

      {editing?.kind === 'health-record' ? <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Analisi del sangue" /></Field>
        <Field label="Persona"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Tipo"><select value={editing.healthRecordKind || 'exam'} onChange={e => setEditing({ ...editing, healthRecordKind: e.target.value })}><option value="exam">Esame</option><option value="report">Referto</option><option value="vaccine">Vaccino</option><option value="document">Documento / certificato</option><option value="note">Nota clinica</option></select></Field>
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Struttura / professionista"><input value={editing.provider || ''} onChange={e => setEditing({ ...editing, provider: e.target.value })} /></Field>
        <Field label="Esito / risultato" className="field--wide"><textarea rows={3} value={editing.result || ''} onChange={e => setEditing({ ...editing, result: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
        {renderAttachments()}
      </div> : null}

      {editing?.kind === 'medicine' ? <div className="form-grid form-grid--2">
        <Field label="Nome medicinale" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Tachipirina 500 mg" /></Field>
        <Field label="Principio attivo"><input value={editing.activeIngredient || ''} onChange={e => setEditing({ ...editing, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
        <Field label="Compresse per confezione" hint="Serve per stimare quante scatole acquistare."><input type="number" min="0" step="1" value={editing.defaultPackageSize ?? ''} onChange={e => setEditing({ ...editing, defaultPackageSize: e.target.value })} placeholder="Es. 30" /></Field>
        <Field label="A cosa serve" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
        <Card className="field--wide"><CardHeader title="Confezioni in magazzino" subtitle="Ogni riga rappresenta una confezione fisica. Quantità = compresse effettivamente rimaste oggi." action={<Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addPackage}>Confezione</Button>} />
          {(editing.packages || []).length ? <div className="receipt-matches">{(editing.packages || []).map((pkg: any, index: number) => <div className="receipt-match" key={pkg.id}><div className="receipt-match__head"><strong>Confezione {index + 1}</strong><IconButton label="Rimuovi confezione" onClick={() => removePackage(pkg.id)}><Trash2 size={16} /></IconButton></div><div className="form-grid form-grid--2" style={{ marginTop: 10 }}><Field label="Scadenza"><input type="date" value={pkg.expiryDate || ''} onChange={e => updatePackage(pkg.id, { expiryDate: e.target.value })} /></Field><Field label="Compresse rimaste"><input type="number" min="0" step="0.25" value={pkg.quantity ?? ''} onChange={e => updatePackage(pkg.id, { quantity: e.target.value })} /></Field><Field label="Contenuto originale"><input type="number" min="0" step="1" value={pkg.packageSize ?? ''} onChange={e => updatePackage(pkg.id, { packageSize: e.target.value })} /></Field><Field label="Lotto"><input value={pkg.lot || ''} onChange={e => updatePackage(pkg.id, { lot: e.target.value })} /></Field></div></div>)}</div> : <EmptyState title="Nessuna confezione" text="Puoi tenere il medicinale in anagrafica anche senza scorta." action={<Button variant="soft" onClick={addPackage}>Aggiungi confezione</Button>} />}
        </Card>
      </div> : null}

      {editing?.kind === 'therapy' ? <div className="form-grid form-grid--2">
        <Field label="Nome terapia" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Terapia antibiotica" /></Field>
        <Field label="Prescritta a"><select value={editing.userId || authUser?.id || ''} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Prescritta da"><input value={editing.prescriber || ''} onChange={e => setEditing({ ...editing, prescriber: e.target.value })} placeholder="Medico / specialista" /></Field>
        <Field label="Inizio terapia"><input type="date" value={editing.therapyStartDate || ''} onChange={e => setEditing({ ...editing, therapyStartDate: e.target.value })} /></Field>
        <Field label="Fine terapia" hint="Lascia vuoto per una terapia continuativa."><input type="date" min={editing.therapyStartDate || undefined} value={editing.therapyEndDate || ''} onChange={e => setEditing({ ...editing, therapyEndDate: e.target.value })} /></Field>
        <Field label="Motivo / indicazione" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Card className="field--wide"><CardHeader
          title="Medicinali della terapia"
          subtitle="Puoi collegare un farmaco già censito oppure crearne uno nuovo senza uscire dalla terapia."
          action={<div className="therapy-medicine-actions">
            <Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addTherapyMedicine} disabled={!medicines.length}>Esistente</Button>
            <Button size="sm" variant="soft" icon={<Package size={15} />} onClick={openQuickMedicine}>Nuovo farmaco</Button>
          </div>}
        />
          {quickMedicine ? <div className="callout" style={{ marginBottom: 12 }}>
            <div className="receipt-match__head">
              <strong>Censisci nuovo medicinale</strong>
              <Button size="sm" variant="ghost" onClick={() => setQuickMedicine(null)}>Chiudi</Button>
            </div>
            <div className="form-grid form-grid--2" style={{ marginTop: 10 }}>
              <Field label="Nome medicinale" className="field--wide"><input autoFocus value={quickMedicine.title || ''} onChange={e => setQuickMedicine({ ...quickMedicine, title: e.target.value })} placeholder="Es. Allopurinolo 300 mg" /></Field>
              <Field label="Principio attivo"><input value={quickMedicine.activeIngredient || ''} onChange={e => setQuickMedicine({ ...quickMedicine, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
              <Field label="Compresse per confezione"><input type="number" min="0" step="1" value={quickMedicine.defaultPackageSize ?? ''} onChange={e => setQuickMedicine({ ...quickMedicine, defaultPackageSize: e.target.value })} placeholder="Es. 30" /></Field>
              <Field label="Compresse disponibili"><input type="number" min="0" step="0.25" value={quickMedicine.quantity ?? ''} onChange={e => setQuickMedicine({ ...quickMedicine, quantity: e.target.value })} placeholder="Facoltativo" /></Field>
              <Field label="Scadenza confezione"><input type="date" value={quickMedicine.expiryDate || ''} onChange={e => setQuickMedicine({ ...quickMedicine, expiryDate: e.target.value })} /></Field>
              <Field label="A cosa serve"><input value={quickMedicine.purpose || ''} onChange={e => setQuickMedicine({ ...quickMedicine, purpose: e.target.value })} /></Field>
              <Field label="Note" className="field--wide"><textarea rows={2} value={quickMedicine.notes || ''} onChange={e => setQuickMedicine({ ...quickMedicine, notes: e.target.value })} /></Field>
            </div>
            <div className="modal-actions__right" style={{ marginTop: 10 }}>
              <Button variant="ghost" onClick={() => setQuickMedicine(null)}>Annulla</Button>
              <Button onClick={saveQuickMedicine}>Salva e collega</Button>
            </div>
          </div> : null}
          {(editing.therapyMedicines || []).length ? <div className="receipt-matches">{(editing.therapyMedicines || []).map((line: any, index: number) => {
            const medicine = medicines.find(product => product.id === Number(line.medicineId))
            const required = editing.therapyEndDate ? therapyLineRequiredTablets(editing.therapyStartDate || '', editing.therapyEndDate, line) : null
            const packageSize = Number(medicine?.defaultPackageSize || medicine?.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
            const boxes = required !== null && packageSize > 0 ? Math.ceil(Number(required || 0) / packageSize) : 0
            const summary = medicine ? medicineInventorySummary(medicine, planningTherapies as any) : null
            return <div className="receipt-match" key={line.id}><div className="receipt-match__head"><strong>Medicinale {index + 1}</strong><IconButton label="Rimuovi medicinale" onClick={() => removeTherapyMedicine(line.id)}><Trash2 size={16} /></IconButton></div><div className="form-grid form-grid--2" style={{ marginTop: 10 }}><Field label="Medicinale" className="field--wide"><select value={line.medicineId || 0} onChange={e => updateTherapyMedicine(line.id, { medicineId: Number(e.target.value) })}>{medicines.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select></Field><Field label="Compresse per assunzione"><input type="number" min="0" step="0.25" value={line.tabletsPerDose ?? ''} onChange={e => updateTherapyMedicine(line.id, { tabletsPerDose: e.target.value })} /></Field><Field label="Assunzioni al giorno" hint="0,5 = una volta ogni due giorni."><input type="number" min="0" step="0.25" value={line.dosesPerDay ?? ''} onChange={e => updateTherapyMedicine(line.id, { dosesPerDay: e.target.value })} /></Field><Field label="Modalità d'uso" className="field--wide"><input value={line.usage || ''} onChange={e => updateTherapyMedicine(line.id, { usage: e.target.value })} /></Field></div>{medicine ? <div className={summary?.shortageDate ? 'callout callout--warning' : 'callout callout--success'} style={{ marginTop: 10 }}><strong>{medicine.title}</strong>: {therapyDailyUse(line)} compresse/giorno{required !== null ? ` · ${required} compresse${boxes ? ` (≈ ${boxes} confezioni)` : ''}` : ' · terapia continuativa'}.{summary?.shortageDate ? ` Scorta insufficiente dal ${formatDate(summary.shortageDate)}.` : ' Scorta compatibile con le terapie note.'}</div> : null}</div>
          })}</div> : <EmptyState title="Nessun medicinale collegato" text="Puoi scegliere un farmaco già presente nel magazzino oppure censirne uno nuovo qui." action={<div className="therapy-medicine-actions"><Button variant="soft" onClick={addTherapyMedicine} disabled={!medicines.length}>Scegli esistente</Button><Button variant="soft" onClick={openQuickMedicine}>Censisci nuovo</Button></div>} />}
        </Card>
        <Field label="Note sulla terapia" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
        {renderAttachments()}
      </div> : null}
    </Modal>
  </div>
}
