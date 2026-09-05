import React, { useState } from 'react'
import { Camera, KeyRound, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro } from '../ui'
import { DEFAULT_PREFS } from '../utils'

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function UsersPage() {
  const { data, authUser, addUser, updateUser, deleteUser } = useFamily()
  const isAdmin = authUser?.role === 'admin'
  const [editing, setEditing] = useState<any>(null)

  function openNew() {
    if (!isAdmin) return
    setEditing({ id: undefined, name: '', role: 'adulto', password: '', color: '#5B5BD6', avatarUrl: '' })
  }

  async function avatarFromFile(file?: File) {
    if (!file || !editing) return
    const avatarUrl = await fileToDataUrl(file)
    setEditing({ ...editing, avatarUrl })
  }

  function save() {
    if (!editing?.name?.trim() || !editing?.password) return
    if (editing.id) updateUser(editing.id, { ...editing, name: editing.name.trim() })
    else addUser({ name: editing.name.trim(), role: editing.role, password: editing.password, color: editing.color, avatarUrl: editing.avatarUrl, prefs: { ...DEFAULT_PREFS, accent: editing.color } })
    setEditing(null)
  }

  return <div className="page">
    <PageIntro eyebrow="Famiglia" title="Utenti" description="Ogni persona entra con la propria password e può avere foto, colore e preferenze personali." actions={isAdmin ? <Button icon={<Plus size={18} />} onClick={openNew}>Nuovo utente</Button> : null} />
    <div className="users-grid">{data.users.map(user => <Card key={user.id} className="user-card"><div className="user-card__hero"><Avatar user={user} size="xl" /><div><strong>{user.name}</strong><span>{user.role}</span></div></div><div className="user-card__meta"><Badge tone={user.role === 'admin' ? 'violet' : 'neutral'}>{user.role === 'admin' ? <><ShieldCheck size={13} /> Admin</> : user.role}</Badge><Badge><KeyRound size={13} /> Password attiva</Badge></div>{isAdmin ? <div className="user-card__actions"><Button variant="soft" size="sm" onClick={() => setEditing({ ...user })}>Gestisci</Button>{user.id !== authUser?.id ? <IconButton label="Elimina" onClick={() => deleteUser(user.id)}><Trash2 size={17} /></IconButton> : null}</div> : null}</Card>)}</div>
    {!data.users.length ? <Card><EmptyState icon={<UserRound size={30} />} title="Nessun utente" text="Crea il primo profilo familiare." /></Card> : null}

    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Gestisci utente' : 'Nuovo utente'} footer={<div className="modal-actions"><div>{editing?.id && editing.id !== authUser?.id ? <Button variant="danger" onClick={() => { deleteUser(editing.id); setEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}>
      {editing ? <div className="profile-editor"><div className="profile-editor__avatar"><Avatar user={editing} size="xl" /><label className="btn btn--soft btn--sm"><Camera size={16} /> Carica foto<input type="file" accept="image/*" hidden onChange={e => avatarFromFile(e.target.files?.[0])} /></label>{editing.avatarUrl ? <button className="text-link" onClick={() => setEditing({ ...editing, avatarUrl: '' })}>Rimuovi foto</button> : null}</div><div className="form-grid form-grid--2"><Field label="Nome" className="field--wide"><input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="Ruolo"><select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}><option value="adulto">Adulto</option><option value="bimbo">Bimbo</option><option value="admin">Admin</option></select></Field><Field label="Colore profilo"><input type="color" value={editing.color} onChange={e => setEditing({ ...editing, color: e.target.value })} /></Field><Field label="Password" className="field--wide"><input type="password" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} /></Field></div></div> : null}
    </Modal>
  </div>
}
