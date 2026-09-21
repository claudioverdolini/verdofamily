import React, { useMemo, useState } from 'react'
import {
  Backpack,
  BookOpen,
  Check,
  ClipboardCheck,
  CreditCard,
  FileText,
  GraduationCap,
  MapPin,
  MessageSquareText,
  Pencil,
  Plane,
  Plus,
  Trash2
} from 'lucide-react'
import { useFamily } from '../store'
import MultiAssigneePicker from '../components/MultiAssigneePicker'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { addDays, dayLabel, localDateISO, money, parseISODate } from '../utils'
import type { SchoolItemType } from '../types'

const DAYS = [
  { id: 1, label: 'Lunedì', short: 'Lun' },
  { id: 2, label: 'Martedì', short: 'Mar' },
  { id: 3, label: 'Mercoledì', short: 'Mer' },
  { id: 4, label: 'Giovedì', short: 'Gio' },
  { id: 5, label: 'Venerdì', short: 'Ven' }
]

const ITEM_TYPES: Array<{ value: SchoolItemType; label: string; icon: React.ReactNode }> = [
  { value: 'homework', label: 'Compito', icon: <BookOpen size={15} /> },
  { value: 'test', label: 'Verifica', icon: <ClipboardCheck size={15} /> },
  { value: 'oral', label: 'Interrogazione', icon: <MessageSquareText size={15} /> },
  { value: 'material', label: 'Materiale', icon: <Backpack size={15} /> },
  { value: 'circular', label: 'Circolare', icon: <FileText size={15} /> },
  { value: 'permission', label: 'Autorizzazione', icon: <FileText size={15} /> },
  { value: 'trip', label: 'Gita/Uscita', icon: <Plane size={15} /> },
  { value: 'payment', label: 'Pagamento', icon: <CreditCard size={15} /> }
]

function typeInfo(type: SchoolItemType) {
  return ITEM_TYPES.find(item => item.value === type) || ITEM_TYPES[0]
}

function weekday(date: string) {
  const day = parseISODate(date).getDay()
  return day === 0 ? 7 : day
}

function dateText(date: string) {
  return parseISODate(date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function SchoolPage() {
  const {
    data,
    authUser,
    upsertSchoolSubject,
    deleteSchoolSubject,
    upsertSchoolTimetableEntry,
    deleteSchoolTimetableEntry,
    upsertSchoolItem,
    toggleSchoolItem,
    deleteSchoolItem
  } = useFamily()

  const isChild = authUser?.role === 'bimbo'
  const students = useMemo(() => {
    const children = data.users.filter(user => user.role === 'bimbo')
    if (isChild && authUser) return [authUser]
    return children.length ? children : data.users
  }, [data.users, isChild, authUser])

  const [studentId, setStudentId] = useState(authUser?.role === 'bimbo' ? authUser.id : (students[0]?.id || data.users[0]?.id || 1))
  const [view, setView] = useState<'tomorrow' | 'agenda' | 'timetable' | 'subjects'>('tomorrow')
  const [itemEditing, setItemEditing] = useState<any>(null)
  const [lessonEditing, setLessonEditing] = useState<any>(null)
  const [subjectEditing, setSubjectEditing] = useState<any>(null)

  const today = localDateISO()
  const tomorrow = addDays(today, 1)
  const selectedStudent = data.users.find(user => user.id === studentId) || students[0]

  const subjects = data.schoolSubjects.slice().sort((a, b) => a.name.localeCompare(b.name))
  const studentItems = data.schoolItems.filter(item => item.userId === selectedStudent?.id)
  const tomorrowItems = studentItems
    .filter(item => item.date === tomorrow)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.type.localeCompare(b.type))

  const tomorrowLessons = data.schoolTimetable
    .filter(entry => entry.userId === selectedStudent?.id && entry.weekday === weekday(tomorrow))
    .sort((a, b) => a.order - b.order)

  const upcomingItems = studentItems
    .filter(item => item.date >= today)
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date) || a.type.localeCompare(b.type))

  function subjectName(id?: number) {
    return id ? data.schoolSubjects.find(subject => subject.id === id)?.name || '' : ''
  }

  function openItem(item?: any, presetDate?: string) {
    const defaultUserId = selectedStudent?.id || students[0]?.id || 1
    setItemEditing(item ? { ...item, userIds: [Number(item.userId)] } : {
      id: undefined,
      userId: defaultUserId,
      userIds: [defaultUserId],
      type: 'homework' as SchoolItemType,
      title: '',
      date: presetDate || tomorrow,
      subjectId: undefined,
      notes: '',
      amount: undefined,
      done: false
    })
  }

  function saveItem() {
    if (!itemEditing?.title?.trim() || !itemEditing?.date) return
    const userIds = itemEditing.id
      ? [Number(itemEditing.userId)]
      : Array.from(new Set(
          (Array.isArray(itemEditing.userIds) && itemEditing.userIds.length ? itemEditing.userIds : [itemEditing.userId])
            .map(Number)
            .filter((id: number) => id > 0)
        ))
    if (!userIds.length) return
    userIds.forEach((userId: number, index: number) => upsertSchoolItem({
      id: itemEditing.id && index === 0 ? itemEditing.id : undefined,
      userId,
      type: itemEditing.type,
      title: itemEditing.title.trim(),
      date: itemEditing.date,
      subjectId: itemEditing.subjectId ? Number(itemEditing.subjectId) : undefined,
      notes: itemEditing.notes || '',
      amount: itemEditing.type === 'payment' ? Math.max(0, Number(itemEditing.amount) || 0) : undefined,
      done: !!itemEditing.done,
      createdAt: itemEditing.createdAt
    }))
    setItemEditing(null)
  }

  function openLesson(entry?: any, day = 1) {
    if (isChild) return
    setLessonEditing(entry ? { ...entry } : {
      id: undefined,
      userId: selectedStudent?.id || students[0]?.id || 1,
      weekday: day,
      order: 1,
      subjectId: subjects[0]?.id || 0,
      startTime: '',
      endTime: '',
      room: '',
      notes: ''
    })
  }

  function saveLesson() {
    if (isChild || !lessonEditing?.subjectId) return
    upsertSchoolTimetableEntry({
      id: lessonEditing.id,
      userId: Number(lessonEditing.userId),
      weekday: Number(lessonEditing.weekday),
      order: Number(lessonEditing.order),
      subjectId: Number(lessonEditing.subjectId),
      startTime: lessonEditing.startTime || undefined,
      endTime: lessonEditing.endTime || undefined,
      room: lessonEditing.room || '',
      notes: lessonEditing.notes || ''
    })
    setLessonEditing(null)
  }

  function saveSubject() {
    if (isChild || !subjectEditing?.name?.trim()) return
    upsertSchoolSubject({
      id: subjectEditing.id,
      name: subjectEditing.name.trim(),
      shortName: subjectEditing.shortName?.trim() || undefined
    })
    setSubjectEditing(null)
  }

  const tomorrowOpen = tomorrowItems.filter(item => !item.done).length
  const testsSoon = upcomingItems.filter(item => !item.done && (item.type === 'test' || item.type === 'oral') && item.date <= addDays(today, 7)).length

  return <div className="page">
    <PageIntro
      eyebrow="Scuola"
      title="Centro scuola"
      description="Orario, compiti, verifiche, materiale, circolari e pagamenti raccolti per ogni ragazzo."
      actions={<Button icon={<Plus size={18} />} onClick={() => openItem(undefined, view === 'tomorrow' ? tomorrow : today)}>Nuova attività</Button>}
    />

    {!isChild && students.length > 1 ? <div className="school-student-switch">
      {students.map(user => <button key={user.id} className={studentId === user.id ? 'is-active' : ''} onClick={() => setStudentId(user.id)}>
        <Avatar user={user} size="xs" /><span>{user.name}</span>
      </button>)}
    </div> : null}

    <div className="school-stats">
      <Card className="school-stat"><span>Domani</span><strong>{tomorrowOpen}</strong><small>cose da ricordare</small></Card>
      <Card className="school-stat"><span>Verifiche 7 giorni</span><strong>{testsSoon}</strong><small>verifiche/interrogazioni</small></Card>
      <Card className="school-stat"><span>Materie domani</span><strong>{tomorrowLessons.length}</strong><small>lezioni previste</small></Card>
    </div>

    <div className="page-tabs-wrap page-tabs-wrap--school">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'tomorrow', label: 'Domani' },
          { value: 'agenda', label: `Agenda · ${upcomingItems.filter(item => !item.done).length}` },
          { value: 'timetable', label: 'Orario' },
          { value: 'subjects', label: `Materie · ${subjects.length}` }
        ]}
      />
    </div>

    {view === 'tomorrow' ? <div className="school-tomorrow-grid">
      <Card className="school-tomorrow-card">
        <CardHeader
          title={`Domani · ${dateText(tomorrow)}`}
          subtitle={selectedStudent?.name || ''}
          action={<Button variant="soft" onClick={() => openItem(undefined, tomorrow)}>Aggiungi</Button>}
        />

        <div className="school-tomorrow-section">
          <label><GraduationCap size={16} /> Lezioni</label>
          {tomorrowLessons.length ? <div className="school-lesson-list">
            {tomorrowLessons.map(entry => {
              const subject = data.schoolSubjects.find(item => item.id === entry.subjectId)
              return <div key={entry.id} className="school-lesson-chip">
                <strong>{entry.order}</strong>
                <span><b>{subject?.name || 'Materia'}</b><small>{entry.startTime || ''}{entry.endTime ? `–${entry.endTime}` : ''}{entry.room ? ` · ${entry.room}` : ''}</small></span>
              </div>
            })}
          </div> : <span className="school-empty-inline">Nessuna lezione inserita per questo giorno.</span>}
        </div>

        <div className="school-tomorrow-section">
          <label><Backpack size={16} /> Da preparare</label>
          {tomorrowItems.length ? <div className="school-item-list">
            {tomorrowItems.map(item => {
              const info = typeInfo(item.type)
              return <div key={item.id} className={`school-item ${item.done ? 'is-done' : ''}`}>
                <button className="check-item__check" onClick={() => toggleSchoolItem(item.id)}>{item.done ? <Check size={15} /> : null}</button>
                <button className="school-item__copy" onClick={() => toggleSchoolItem(item.id)}>
                  <span>{info.icon}<b>{info.label}</b>{item.subjectId ? <em>{subjectName(item.subjectId)}</em> : null}</span>
                  <strong>{item.title}</strong>
                  {item.notes ? <small>{item.notes}</small> : null}
                  {item.type === 'payment' && item.amount !== undefined ? <small>{money(item.amount)}</small> : null}
                </button>
                <IconButton label="Modifica" onClick={() => openItem(item)}><Pencil size={16} /></IconButton>
              </div>
            })}
          </div> : <EmptyState icon={<Backpack size={26} />} title="Zaino tranquillo" text="Non ci sono compiti, materiali o avvisi registrati per domani." />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Checklist serale" subtitle="Quello che conviene controllare prima di chiudere lo zaino" />
        <div className="school-checklist">
          <div><Backpack size={18} /><span><strong>Materiale</strong><small>{tomorrowItems.filter(item => !item.done && item.type === 'material').length} elementi ancora aperti</small></span></div>
          <div><BookOpen size={18} /><span><strong>Compiti</strong><small>{tomorrowItems.filter(item => !item.done && item.type === 'homework').length} da completare</small></span></div>
          <div><ClipboardCheck size={18} /><span><strong>Verifiche</strong><small>{tomorrowItems.filter(item => !item.done && ['test','oral'].includes(item.type)).length} previste</small></span></div>
          <div><FileText size={18} /><span><strong>Avvisi</strong><small>{tomorrowItems.filter(item => !item.done && ['circular','permission','trip','payment'].includes(item.type)).length} da gestire</small></span></div>
        </div>
      </Card>
    </div> : null}

    {view === 'agenda' ? <Card>
      <CardHeader title="Agenda scolastica" subtitle="Tutto ciò che deve succedere da oggi in avanti" />
      {upcomingItems.length ? <div className="school-agenda-list">
        {upcomingItems.map(item => {
          const info = typeInfo(item.type)
          return <div key={item.id} className={`school-agenda-row ${item.done ? 'is-done' : ''}`}>
            <button className="check-item__check" onClick={() => toggleSchoolItem(item.id)}>{item.done ? <Check size={15} /> : null}</button>
            <div className="school-agenda-date"><strong>{item.date.slice(8,10)}</strong><span>{item.date.slice(5,7)}</span></div>
            <div className="school-agenda-copy">
              <span>{info.icon}<b>{info.label}</b>{item.subjectId ? <em>{subjectName(item.subjectId)}</em> : null}</span>
              <strong>{item.title}</strong>
              <small>{dateText(item.date)}{item.notes ? ` · ${item.notes}` : ''}</small>
            </div>
            <div className="school-agenda-row__meta">
              {item.type === 'payment' && item.amount !== undefined ? <Badge tone="warning">{money(item.amount)}</Badge> : <Badge>{info.label}</Badge>}
              <div className="school-agenda-row__actions">
                <IconButton label="Modifica" onClick={() => openItem(item)}><Pencil size={16} /></IconButton>
                <IconButton label="Elimina" onClick={() => deleteSchoolItem(item.id)}><Trash2 size={16} /></IconButton>
              </div>
            </div>
          </div>
        })}
      </div> : <EmptyState icon={<GraduationCap size={28} />} title="Agenda vuota" text="Non ci sono attività scolastiche future." />}
    </Card> : null}

    {view === 'timetable' ? <div className="school-timetable">
      {DAYS.map(day => {
        const lessons = data.schoolTimetable
          .filter(entry => entry.userId === selectedStudent?.id && entry.weekday === day.id)
          .sort((a,b) => a.order - b.order)
        return <Card key={day.id} className="school-day-card">
          <CardHeader title={day.label} subtitle={`${lessons.length} lezioni`} action={!isChild ? <IconButton label="Aggiungi lezione" onClick={() => openLesson(undefined, day.id)}><Plus size={16} /></IconButton> : null} />
          {lessons.length ? <div className="school-day-lessons">
            {lessons.map(entry => {
              const subject = data.schoolSubjects.find(item => item.id === entry.subjectId)
              return <button key={entry.id} onClick={() => !isChild && openLesson(entry)} disabled={isChild}>
                <strong>{entry.order}</strong>
                <span><b>{subject?.name || 'Materia'}</b><small>{entry.startTime || ''}{entry.endTime ? `–${entry.endTime}` : ''}{entry.room ? ` · Aula ${entry.room}` : ''}</small></span>
              </button>
            })}
          </div> : <div className="school-empty-inline">Nessuna lezione.</div>}
        </Card>
      })}
    </div> : null}

    {view === 'subjects' ? <Card>
      <CardHeader
        title="Materie"
        subtitle={isChild ? 'Materie disponibili per il tuo orario e le attività' : 'Censiscile una sola volta e riusale nell’orario, compiti e verifiche'}
        action={!isChild ? <Button variant="soft" onClick={() => setSubjectEditing({ name: '', shortName: '' })}>Nuova materia</Button> : null}
      />
      {subjects.length ? <div className="school-subject-grid">
        {subjects.map(subject => <div key={subject.id} className="school-subject-card">
          <span><GraduationCap size={18} /></span>
          <div><strong>{subject.name}</strong><small>{subject.shortName || 'Materia scolastica'}</small></div>
          {!isChild ? <IconButton label="Modifica" onClick={() => setSubjectEditing({ ...subject })}><Pencil size={15} /></IconButton> : null}
          {!isChild ? <IconButton label="Elimina" onClick={() => deleteSchoolSubject(subject.id)}><Trash2 size={15} /></IconButton> : null}
        </div>)}
      </div> : <EmptyState icon={<GraduationCap size={28} />} title="Nessuna materia" text="Aggiungi le materie per poter costruire l’orario e collegare compiti e verifiche." />}
    </Card> : null}

    <Modal
      open={!!itemEditing}
      onClose={() => setItemEditing(null)}
      title={itemEditing?.id ? 'Modifica attività scolastica' : 'Nuova attività scolastica'}
      footer={<div className="modal-actions"><div>{itemEditing?.id ? <Button variant="danger" onClick={() => { deleteSchoolItem(itemEditing.id); setItemEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setItemEditing(null)}>Annulla</Button><Button onClick={saveItem}>Salva</Button></div></div>}
    >
      {itemEditing ? <div className="form-grid form-grid--2">
        <Field label="Tipo">
          <select value={itemEditing.type} onChange={e => setItemEditing({ ...itemEditing, type: e.target.value as SchoolItemType })}>
            {ITEM_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
        {itemEditing.id || isChild ? <Field label="Per">
          <select value={itemEditing.userId} onChange={e => setItemEditing({ ...itemEditing, userId: Number(e.target.value), userIds: [Number(e.target.value)] })} disabled={isChild}>
            {students.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field> : <Field label="Per" className="field--wide" hint="Seleziona uno o più ragazzi. L’attività verrà creata separatamente per ciascuno.">
          <MultiAssigneePicker
            users={students}
            selectedIds={itemEditing.userIds || [itemEditing.userId].filter(Boolean)}
            onChange={userIds => setItemEditing({ ...itemEditing, userIds, userId: userIds[0] || 0 })}
            showFamilyShortcut={false}
            childrenLabel="Tutti i ragazzi"
          />
        </Field>}
        <Field label="Titolo" className="field--wide">
          <input autoFocus value={itemEditing.title} onChange={e => setItemEditing({ ...itemEditing, title: e.target.value })} placeholder="Es. Portare cartellina di tecnologia" />
        </Field>
        <Field label="Data">
          <input type="date" value={itemEditing.date} onChange={e => setItemEditing({ ...itemEditing, date: e.target.value })} />
        </Field>
        <Field label="Materia" hint="Facoltativa">
          <select value={itemEditing.subjectId || ''} onChange={e => setItemEditing({ ...itemEditing, subjectId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Nessuna materia</option>
            {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </Field>
        {itemEditing.type === 'payment' ? <Field label="Importo">
          <input type="number" min="0" step="0.01" value={itemEditing.amount ?? ''} onChange={e => setItemEditing({ ...itemEditing, amount: e.target.value })} />
        </Field> : null}
        <Field label="Note" className="field--wide">
          <textarea rows={3} value={itemEditing.notes || ''} onChange={e => setItemEditing({ ...itemEditing, notes: e.target.value })} placeholder="Dettagli, pagine, materiale specifico…" />
        </Field>
      </div> : null}
    </Modal>

    {!isChild ? <Modal
      open={!!lessonEditing}
      onClose={() => setLessonEditing(null)}
      title={lessonEditing?.id ? 'Modifica lezione' : 'Aggiungi lezione'}
      footer={<div className="modal-actions"><div>{lessonEditing?.id ? <Button variant="danger" onClick={() => { deleteSchoolTimetableEntry(lessonEditing.id); setLessonEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setLessonEditing(null)}>Annulla</Button><Button onClick={saveLesson}>Salva</Button></div></div>}
    >
      {lessonEditing ? <div className="form-grid form-grid--2">
        <Field label="Ragazzo">
          <select value={lessonEditing.userId} onChange={e => setLessonEditing({ ...lessonEditing, userId: Number(e.target.value) })}>{students.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
        </Field>
        <Field label="Giorno">
          <select value={lessonEditing.weekday} onChange={e => setLessonEditing({ ...lessonEditing, weekday: Number(e.target.value) })}>{DAYS.map(day => <option key={day.id} value={day.id}>{day.label}</option>)}</select>
        </Field>
        <Field label="Materia">
          <select value={lessonEditing.subjectId} onChange={e => setLessonEditing({ ...lessonEditing, subjectId: Number(e.target.value) })}>
            <option value={0}>Seleziona materia</option>
            {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </Field>
        <Field label="Ora / posizione">
          <input type="number" min="1" value={lessonEditing.order} onChange={e => setLessonEditing({ ...lessonEditing, order: Number(e.target.value) })} />
        </Field>
        <Field label="Dalle"><input type="time" value={lessonEditing.startTime || ''} onChange={e => setLessonEditing({ ...lessonEditing, startTime: e.target.value })} /></Field>
        <Field label="Alle"><input type="time" value={lessonEditing.endTime || ''} onChange={e => setLessonEditing({ ...lessonEditing, endTime: e.target.value })} /></Field>
        <Field label="Aula" className="field--wide"><input value={lessonEditing.room || ''} onChange={e => setLessonEditing({ ...lessonEditing, room: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={lessonEditing.notes || ''} onChange={e => setLessonEditing({ ...lessonEditing, notes: e.target.value })} /></Field>
      </div> : null}
    </Modal> : null}

    {!isChild ? <Modal
      open={!!subjectEditing}
      onClose={() => setSubjectEditing(null)}
      title={subjectEditing?.id ? 'Modifica materia' : 'Nuova materia'}
      footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setSubjectEditing(null)}>Annulla</Button><Button onClick={saveSubject}>Salva</Button></div></div>}
    >
      {subjectEditing ? <div className="form-grid">
        <Field label="Nome materia"><input autoFocus value={subjectEditing.name} onChange={e => setSubjectEditing({ ...subjectEditing, name: e.target.value })} placeholder="Es. Matematica" /></Field>
        <Field label="Nome breve" hint="Facoltativo"><input value={subjectEditing.shortName || ''} onChange={e => setSubjectEditing({ ...subjectEditing, shortName: e.target.value })} placeholder="Es. MAT" /></Field>
      </div> : null}
    </Modal> : null}
  </div>
}
