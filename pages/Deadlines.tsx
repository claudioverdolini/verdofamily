import React, { useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro } from '../ui'
import { localDateISO } from '../utils'

export default function DeadlinesPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const [editing, setEditing] = useState<any>(null)

  const deadlines = useMemo(
    () => data.deadlines
      .filter(item => !item.kind || item.kind === 'general')
      .slice()
      .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date)),
    [data.deadlines]
  )

  function openNew() {
    setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'general' })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    upsertDeadline({ ...editing, title: editing.title.trim(), userId: Number(editing.userId), kind: 'general' })
    setEditing(null)
  }

  return <div className="page">
    <PageIntro
      eyebrow="Promemoria"
      title="Scadenze"
      description="Date e promemoria generali della famiglia. Medicine, terapie e visite ora sono raccolte nel modulo Salute."
      actions={<Button icon={<Plus size={18} />} onClick={openNew}>Nuova scadenza</Button>}
    />

    <Card>
      {deadlines.length ? <div className="deadline-list">{deadlines.map(item => {
        const user = data.users.find(person => person.id === item.userId)
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span><Avatar user={user} size="xs" /> {user?.name}</span></div>
          {item.done ? <Badge tone="success">Completata</Badge> : <Badge tone="warning">Da fare</Badge>}
          <IconButton label="Modifica" onClick={() => setEditing({ ...item })}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState title="Nessuna scadenza" text="Aggiungi la prima data importante." action={<Button onClick={openNew}>Aggiungi scadenza</Button>} />}
    </Card>

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Modifica scadenza' : 'Nuova scadenza'}
      size="md"
      footer={<div className="modal-actions"><div>{editing?.id ? <Button variant="danger" onClick={() => { deleteDeadline(editing.id); setEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}
    >
      <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing?.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field>
        <Field label="Data"><input type="date" value={editing?.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Per chi"><select value={editing?.userId || authUser?.id || ''} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
      </div>
    </Modal>
  </div>
}
