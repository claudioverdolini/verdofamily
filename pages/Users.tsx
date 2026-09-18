import React, { useState } from 'react'
import { Camera, Cloud, Copy, KeyRound, Plus, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { DEFAULT_PREFS, imageFileToAvatarDataUrl } from '../utils'

export default function UsersPage() {
  const { data, authUser, addUser, updateUser, updateCurrentProfile, deleteUser, cloudAuthenticated, familyName, createFamilyInvite } = useFamily()
  const isAdmin = authUser?.role === 'admin'
  const [editing, setEditing] = useState<any>(null)
  const [inviteRole, setInviteRole] = useState<'adult' | 'child'>('adult')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copia')
  const [avatarBusy, setAvatarBusy] = useState(false)

  function openNew() {
    if (!isAdmin) return
    setEditing({ id: undefined, name: '', role: 'adulto', password: '', color: '#5B5BD6', avatarUrl: '' })
  }

  async function avatarFromFile(file?: File) {
    if (!file || !editing) return
    setAvatarBusy(true)
    try {
      const avatarUrl = await imageFileToAvatarDataUrl(file)
      setEditing((current: any) => current ? { ...current, avatarUrl } : current)
    } catch (error: any) {
      alert(error?.message || 'Impossibile elaborare la foto.')
    } finally {
      setAvatarBusy(false)
    }
  }

  function save() {
    if (!editing?.name?.trim()) return
    if (!cloudAuthenticated && !editing?.password) return

    if (editing.id) {
      if (editing.id === authUser?.id) {
        updateCurrentProfile({
          name: editing.name.trim(),
          color: editing.color,
          avatarUrl: editing.avatarUrl,
          ...(!cloudAuthenticated ? { password: editing.password || '' } : {})
        })
      } else if (isAdmin) {
        updateUser(editing.id, { ...editing, name: editing.name.trim() })
      }
    } else if (isAdmin) {
      addUser({ name: editing.name.trim(), role: editing.role, password: editing.password || '', color: editing.color, avatarUrl: editing.avatarUrl, prefs: { ...DEFAULT_PREFS, accent: editing.color } })
    }
    setEditing(null)
  }

  async function generateInvite() {
    setInviteBusy(true)
    setInviteError('')
    setInviteCode('')
    try {
      const result = await createFamilyInvite(inviteRole)
      if (!result.ok) setInviteError(result.error || 'Impossibile creare il codice.')
      else setInviteCode(result.code || '')
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyInvite() {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopyLabel('Copiato!')
      window.setTimeout(() => setCopyLabel('Copia'), 1400)
    } catch {
      setCopyLabel('Seleziona il codice')
    }
  }

  return <div className="page">
    <PageIntro
      eyebrow="Famiglia"
      title="Utenti"
      description={cloudAuthenticated ? `Membri collegati a ${familyName || 'questa famiglia'} e profili locali.` : 'Ogni persona può avere foto, colore e preferenze personali.'}
      actions={isAdmin && !cloudAuthenticated ? <Button icon={<Plus size={18} />} onClick={openNew}>Nuovo utente</Button> : null}
    />

    {isAdmin && cloudAuthenticated ? <div className="invite-panel">
      <div className="invite-panel__copy"><strong>Invita un membro</strong><span>Genera un codice monouso valido 7 giorni. Sul secondo dispositivo basta registrarsi e scegliere “Usa un codice”.</span></div>
      <Segmented value={inviteRole} onChange={setInviteRole} options={[{ value: 'adult', label: 'Adulto' }, { value: 'child', label: 'Bimbo' }]} />
      <Button size="sm" icon={<UserPlus size={16} />} disabled={inviteBusy} onClick={generateInvite}>{inviteBusy ? 'Creazione…' : 'Genera codice'}</Button>
      {inviteCode ? <><div className="invite-code">{inviteCode}</div><Button variant="ghost" size="sm" icon={<Copy size={15} />} onClick={copyInvite}>{copyLabel}</Button></> : null}
      {inviteError ? <div className="login-error" style={{ width: '100%' }}>{inviteError}</div> : null}
    </div> : null}

    <div className="users-grid">{data.users.map(user => <Card key={user.id} className="user-card">
      <div className="user-card__hero"><Avatar user={user} size="xl" /><div><strong>{user.name}</strong><span>{user.role}</span></div></div>
      <div className="user-card__meta">
        <Badge tone={user.role === 'admin' ? 'violet' : 'neutral'}>{user.role === 'admin' ? <><ShieldCheck size={13} /> Admin</> : user.role}</Badge>
        {user.cloudUserId ? <Badge tone="success"><Cloud size={13} /> Cloud</Badge> : <Badge><KeyRound size={13} /> Profilo locale</Badge>}
      </div>
      {isAdmin || user.id === authUser?.id ? <div className="user-card__actions"><Button variant="soft" size="sm" onClick={() => setEditing({ ...user })}>{user.id === authUser?.id ? 'Modifica profilo' : 'Gestisci'}</Button>{isAdmin && user.id !== authUser?.id && !user.cloudUserId ? <IconButton label="Elimina" onClick={() => deleteUser(user.id)}><Trash2 size={17} /></IconButton> : null}</div> : null}
    </Card>)}</div>

    {!data.users.length ? <Card><EmptyState icon={<UserRound size={30} />} title="Nessun utente" text="Invita o crea il primo profilo familiare." /></Card> : null}

    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id === authUser?.id ? 'Il mio profilo' : editing?.id ? 'Gestisci profilo' : 'Nuovo profilo locale'} footer={<div className="modal-actions"><div>{isAdmin && editing?.id && editing.id !== authUser?.id && !editing.cloudUserId ? <Button variant="danger" onClick={() => { deleteUser(editing.id); setEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button disabled={avatarBusy} onClick={save}>{avatarBusy ? 'Foto…' : 'Salva'}</Button></div></div>}>
      {editing ? <div className="profile-editor"><div className="profile-editor__avatar"><Avatar user={editing} size="xl" /><label className="btn btn--soft btn--sm"><Camera size={16} /> {avatarBusy ? 'Elaboro…' : editing.avatarUrl ? 'Cambia foto' : 'Carica foto'}<input type="file" accept="image/*" hidden disabled={avatarBusy} onChange={e => avatarFromFile(e.target.files?.[0])} /></label>{editing.avatarUrl ? <button className="text-link" onClick={() => { if (confirm('Rimuovere la foto identificativa da questo profilo?')) setEditing({ ...editing, avatarUrl: '' }) }}>Rimuovi foto</button> : null}<small className="profile-photo-hint">La foto viene ritagliata e ridotta automaticamente.</small></div><div className="form-grid form-grid--2"><Field label="Nome" className="field--wide"><input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="Ruolo"><select value={editing.role} disabled={!isAdmin || !!editing.cloudUserId} onChange={e => setEditing({ ...editing, role: e.target.value })}><option value="adulto">Adulto</option><option value="bimbo">Bimbo</option><option value="admin">Admin</option></select></Field><Field label="Colore profilo"><input type="color" value={editing.color} onChange={e => setEditing({ ...editing, color: e.target.value })} /></Field>{!cloudAuthenticated && !editing.cloudUserId ? <Field label="Password" className="field--wide"><input type="password" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} /></Field> : <div className="callout field--wide">Gli accessi cloud usano email e password personali tramite Supabase. Le password non vengono salvate nei dati della famiglia.</div>}</div></div> : null}
    </Modal>
  </div>
}
