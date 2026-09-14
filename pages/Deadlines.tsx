import React, { useState } from 'react'
import { Check, Pencil, Pill, Plus, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, parseISODate } from '../utils'

type DeadlineSection = 'general' | 'medicine'

function medicineStatus(date: string, done: boolean) {
  if (done) return { label: 'Archiviato', tone: 'success' }
  const today = parseISODate(localDateISO())
  const target = parseISODate(date)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: 'Scaduto', tone: 'danger' }
  if (days === 0) return { label: 'Scade oggi', tone: 'danger' }
  if (days <= 30) return { label: `Scade tra ${days} gg`, tone: 'warning' }
  return { label: `Scade tra ${days} gg`, tone: 'neutral' }
}

export default function DeadlinesPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const [editing, setEditing] = useState<any>(null)
  const [section, setSection] = useState<DeadlineSection>('general')

  function openNew(kind: DeadlineSection = section) {
    setEditing({
      id: undefined,
      title: '',
      date: localDateISO(),
      userId: kind === 'medicine' ? 0 : (authUser?.id || data.users[0]?.id || 1),
      done: false,
      kind,
      activeIngredient: '',
      purpose: '',
      usage: '',
      prescriber: '',
      notes: ''
    })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    upsertDeadline({
      ...editing,
      title: editing.title.trim(),
      userId: Number(editing.userId || 0),
      kind: editing.kind || 'general',
      activeIngredient: editing.activeIngredient?.trim() || '',
      purpose: editing.purpose?.trim() || '',
      usage: editing.usage?.trim() || '',
      prescriber: editing.prescriber?.trim() || '',
      notes: editing.notes?.trim() || ''
    })
    setEditing(null)
  }

  const list = data.deadlines
    .filter(item => section === 'medicine' ? item.kind === 'medicine' : item.kind !== 'medicine')
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date))

  const pageAction = section === 'medicine'
    ? <Button icon={<Pill size={18} />} onClick={() => openNew('medicine')}>Aggiungi medicinale</Button>
    : <Button icon={<Plus size={18} />} onClick={() => openNew('general')}>Nuova scadenza</Button>

  return <div className="page">
    <PageIntro
      eyebrow="Promemoria"
      title="Scadenze"
      description="Documenti, pagamenti, rinnovi e medicinali: tutte le date importanti in un unico posto."
      actions={pageAction}
    />

    <div className="page-tabs-wrap">
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'general', label: 'Scadenze generali' },
          { value: 'medicine', label: 'Medicinali' }
        ]}
      />
    </div>

    <Card>
      {section === 'medicine' ? <CardHeader title="Scadenze medicinali" subtitle="Monitora la data di scadenza e conserva, se vuoi, le informazioni utili sulla terapia." /> : null}

      {list.length ? <div className="deadline-list">{list.map(item => {
        const user = data.users.find(u => u.id === item.userId)
        const status = section === 'medicine' ? medicineStatus(item.date, item.done) : null
        const medicineInfo = [
          user?.name ? `Prescritto a ${user.name}` : '',
          item.purpose ? `Serve per: ${item.purpose}` : '',
          item.usage ? `Uso: ${item.usage}` : ''
        ].filter(Boolean).join(' · ')

        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy">
            <strong>{item.title}</strong>
            {section === 'medicine'
              ? <span>{medicineInfo || 'Nessun dettaglio aggiuntivo'}</span>
              : <span><Avatar user={user} size="xs" /> {user?.name}</span>}
          </div>
          {section === 'medicine'
            ? <Badge tone={status?.tone}>{status?.label}</Badge>
            : item.done ? <Badge tone="success">Completata</Badge> : <Badge tone="warning">Da fare</Badge>}
          <IconButton label="Modifica" onClick={() => setEditing({ ...item, kind: item.kind || 'general' })}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState
        icon={section === 'medicine' ? <Pill size={24} /> : undefined}
        title={section === 'medicine' ? 'Nessun medicinale monitorato' : 'Nessuna scadenza'}
        text={section === 'medicine' ? 'Aggiungi un medicinale per tenere sotto controllo la data di scadenza.' : 'Aggiungi la prima data importante.'}
        action={<Button onClick={() => openNew(section)}>{section === 'medicine' ? 'Aggiungi medicinale' : 'Aggiungi scadenza'}</Button>}
      />}
    </Card>

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.kind === 'medicine' ? (editing?.id ? 'Modifica medicinale' : 'Nuovo medicinale') : (editing?.id ? 'Modifica scadenza' : 'Nuova scadenza')}
      subtitle={editing?.kind === 'medicine' ? 'Solo nome e data di scadenza sono necessari. Tutti gli altri campi sono facoltativi.' : undefined}
      size={editing?.kind === 'medicine' ? 'lg' : 'md'}
      footer={<div className="modal-actions"><div>{editing?.id ? <Button variant="danger" onClick={() => { deleteDeadline(editing.id); setEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}
    >
      {editing ? editing.kind === 'medicine' ? <div className="form-grid form-grid--2">
        <Field label="Nome medicinale" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Tachipirina 500 mg" /></Field>
        <Field label="Data di scadenza"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Prescritto a"><select value={editing.userId || 0} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}><option value={0}>Non specificato</option>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Principio attivo"><input value={editing.activeIngredient || ''} onChange={e => setEditing({ ...editing, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
        <Field label="Prescritto da"><input value={editing.prescriber || ''} onChange={e => setEditing({ ...editing, prescriber: e.target.value })} placeholder="Medico / specialista" /></Field>
        <Field label="A cosa serve" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} placeholder="Es. dolore, pressione, allergia…" /></Field>
        <Field label="Modalità d'uso / dosaggio" className="field--wide"><textarea rows={3} value={editing.usage || ''} onChange={e => setEditing({ ...editing, usage: e.target.value })} placeholder="Es. 1 compressa dopo cena, solo al bisogno…" /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Altre informazioni utili" /></Field>
      </div> : <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field>
        <Field label="Data"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Per chi"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      </div> : null}
    </Modal>
  </div>
}
