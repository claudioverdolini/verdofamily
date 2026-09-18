import React, { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  Camera,
  Image as ImageIcon,
  Megaphone,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Plus,
  StickyNote,
  Trash2,
  Upload
} from 'lucide-react'
import { useFamily } from '../store'
import { supabase } from '../supabaseClient'
import type { BoardAttachment, BoardPost, BoardPostType } from '../types'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO } from '../utils'

const TYPE_OPTIONS: Array<{ value: BoardPostType; label: string }> = [
  { value: 'message', label: 'Messaggio' },
  { value: 'note', label: 'Nota' },
  { value: 'reminder', label: 'Promemoria' },
  { value: 'photo', label: 'Foto' }
]

function typeLabel(type: BoardPostType) {
  return TYPE_OPTIONS.find(item => item.value === type)?.label || 'Nota'
}

function typeIcon(type: BoardPostType) {
  if (type === 'message') return <MessageCircle size={16} />
  if (type === 'reminder') return <Bell size={16} />
  if (type === 'photo') return <Camera size={16} />
  return <StickyNote size={16} />
}

function formatWhen(value: string) {
  try {
    return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

function BoardPhoto({ attachment, familyId }: { attachment: BoardAttachment; familyId: string | null }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setUrl('')
    setFailed(false)
    if (!supabase || !familyId || !attachment.path) {
      setFailed(true)
      return
    }
    supabase.functions.invoke('noticeboard-attachment', {
      body: { action: 'signed-url', familyId, path: attachment.path }
    }).then(({ data, error }) => {
      if (!active) return
      if (error || !data?.ok || !data?.signedUrl) {
        setFailed(true)
        return
      }
      setUrl(data.signedUrl)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [attachment.path, familyId])

  if (failed) return <div className="board-photo board-photo--missing"><ImageIcon size={24} /><span>Foto non disponibile</span></div>
  if (!url) return <div className="board-photo board-photo--loading"><ImageIcon size={24} /></div>
  return <img className="board-photo" src={url} alt={attachment.name || 'Foto bacheca'} />
}

export default function BoardPage() {
  const {
    data,
    authUser,
    familyId,
    cloudAuthenticated,
    upsertBoardPost,
    toggleBoardPin,
    deleteBoardPost,
    addBoardAttachment,
    removeBoardAttachment
  } = useFamily()

  const [view, setView] = useState<'wall' | 'recent' | 'mine'>('wall')
  const [editing, setEditing] = useState<any>(null)
  const [quickMessage, setQuickMessage] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [photoMessage, setPhotoMessage] = useState('')

  const today = localDateISO()
  const isChild = authUser?.role === 'bimbo'

  function canSee(post: BoardPost) {
    if (!authUser) return false
    if (post.authorUserId === authUser.id) return true
    if (post.audience === 'family') return true
    return (post.userIds || []).includes(authUser.id)
  }

  function canEdit(post: BoardPost) {
    if (!authUser) return false
    return authUser.role !== 'bimbo' || post.authorUserId === authUser.id
  }

  const visible = useMemo(
    () => data.boardPosts.filter(canSee).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data.boardPosts, authUser?.id, authUser?.role]
  )

  const pinned = visible.filter(post => post.pinned)
  const activeReminders = visible.filter(post => post.type === 'reminder' && post.dueDate && post.dueDate >= today)
  const photos = visible.filter(post => post.attachments?.length)
  const mine = visible.filter(post => post.authorUserId === authUser?.id)

  const shown = view === 'mine'
    ? mine
    : view === 'recent'
      ? visible
      : visible.filter(post => post.pinned || post.type === 'reminder' || post.updatedAt.slice(0, 10) >= localDateISO(new Date(Date.now() - 7 * 86400000)))

  function openNew(type: BoardPostType = 'note') {
    setPhotoMessage('')
    setPendingFile(null)
    setEditing({
      id: undefined,
      type,
      title: '',
      body: '',
      audience: 'family',
      userIds: [],
      pinned: false,
      dueDate: '',
      attachments: []
    })
  }

  function openEdit(post: BoardPost) {
    if (!canEdit(post)) return
    setPhotoMessage('')
    setPendingFile(null)
    setEditing({ ...post, userIds: [...(post.userIds || [])], attachments: [...(post.attachments || [])] })
  }

  function toggleTarget(userId: number) {
    if (!editing) return
    const ids: number[] = editing.userIds || []
    setEditing({ ...editing, userIds: ids.includes(userId) ? ids.filter(id => id !== userId) : [...ids, userId] })
  }

  async function uploadPhoto(postId: string, file: File) {
    if (!supabase || !familyId || !cloudAuthenticated) throw new Error('Le foto richiedono l’accesso cloud.')
    const form = new FormData()
    form.append('action', 'upload')
    form.append('familyId', familyId)
    form.append('postId', postId)
    form.append('file', file)
    const { data: result, error } = await supabase.functions.invoke('noticeboard-attachment', { body: form })
    if (error || !result?.ok || !result?.attachment) throw new Error(error?.message || result?.error || 'Caricamento non riuscito')
    addBoardAttachment(postId, result.attachment)
    return result.attachment as BoardAttachment
  }

  async function savePost() {
    if (!editing || (!editing.title?.trim() && !editing.body?.trim() && !pendingFile && !(editing.attachments || []).length)) return
    if (editing.audience === 'users' && !(editing.userIds || []).length) {
      setPhotoMessage('Scegli almeno un destinatario oppure imposta “Tutta la famiglia”.')
      return
    }
    setBusy(true)
    setPhotoMessage('')
    const id = upsertBoardPost({
      id: editing.id,
      type: editing.type,
      title: editing.title || '',
      body: editing.body || '',
      audience: editing.audience,
      userIds: editing.userIds || [],
      pinned: !!editing.pinned,
      dueDate: editing.type === 'reminder' ? (editing.dueDate || undefined) : undefined,
      attachments: editing.attachments || []
    })

    try {
      if (pendingFile) await uploadPhoto(id, pendingFile)
      setEditing(null)
      setPendingFile(null)
    } catch (error: any) {
      setEditing({ ...editing, id })
      setPhotoMessage(`Post salvato, ma la foto non è stata caricata: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteAttachment(attachment: BoardAttachment) {
    if (!editing?.id || !familyId || !supabase) return
    if (!confirm('Eliminare l’allegato “' + attachment.name + '” dalla bacheca?')) return
    setBusy(true)
    setPhotoMessage('')
    try {
      const { data: result, error } = await supabase.functions.invoke('noticeboard-attachment', {
        body: { action: 'delete', familyId, path: attachment.path }
      })
      if (error || !result?.ok) throw new Error(error?.message || result?.error || 'Eliminazione non riuscita')
      removeBoardAttachment(editing.id, attachment.id)
      setEditing({
        ...editing,
        attachments: (editing.attachments || []).filter((item: BoardAttachment) => item.id !== attachment.id)
      })
    } catch (error: any) {
      setPhotoMessage(error?.message || 'Impossibile eliminare la foto.')
    } finally {
      setBusy(false)
    }
  }

  async function deletePost(post: BoardPost) {
    if (!canEdit(post) || !confirm('Eliminare questo contenuto dalla bacheca?')) return
    setBusy(true)
    try {
      if (supabase && familyId && post.attachments?.length) {
        await Promise.allSettled(post.attachments.map(attachment =>
          supabase.functions.invoke('noticeboard-attachment', { body: { action: 'delete', familyId, path: attachment.path } })
        ))
      }
      deleteBoardPost(post.id)
      if (editing?.id === post.id) setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  function sendQuickMessage() {
    const body = quickMessage.trim()
    if (!body) return
    upsertBoardPost({
      type: 'message',
      title: '',
      body,
      audience: 'family',
      userIds: [],
      pinned: false
    })
    setQuickMessage('')
  }

  function audienceText(post: BoardPost) {
    if (post.audience === 'family') return 'Tutta la famiglia'
    const names = (post.userIds || []).map(id => data.users.find(user => user.id === id)?.name).filter(Boolean)
    return names.join(', ') || 'Destinatari'
  }

  function reminderTone(post: BoardPost) {
    if (!post.dueDate) return 'neutral' as const
    if (post.dueDate < today) return 'danger' as const
    if (post.dueDate === today) return 'warning' as const
    return 'neutral' as const
  }

  return <div className="page page--board">
    <PageIntro
      eyebrow="Famiglia"
      title="Bacheca"
      description="Il frigorifero digitale di casa: messaggi, note, foto e promemoria importanti sempre visibili."
      actions={<Button icon={<Plus size={18} />} onClick={() => openNew('note')}>Nuovo contenuto</Button>}
    />

    <Card className="board-quick-compose">
      <div className="board-quick-compose__icon"><Megaphone size={20} /></div>
      <input
        value={quickMessage}
        onChange={e => setQuickMessage(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') sendQuickMessage() }}
        placeholder="Scrivi un messaggio veloce alla famiglia…"
      />
      <Button size="sm" onClick={sendQuickMessage} disabled={!quickMessage.trim()}>Pubblica</Button>
      <Button size="sm" variant="soft" icon={<Camera size={16} />} onClick={() => openNew('photo')}>Foto</Button>
    </Card>

    <div className="board-stats">
      <Card className="board-stat"><Pin size={17} /><span><strong>{pinned.length}</strong><small>fissati in alto</small></span></Card>
      <Card className="board-stat"><Bell size={17} /><span><strong>{activeReminders.length}</strong><small>promemoria attivi</small></span></Card>
      <Card className="board-stat"><Camera size={17} /><span><strong>{photos.length}</strong><small>post con foto</small></span></Card>
    </div>

    <div className="page-tabs-wrap">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'wall', label: 'In evidenza' },
          { value: 'recent', label: `Tutta la bacheca · ${visible.length}` },
          { value: 'mine', label: `I miei · ${mine.length}` }
        ]}
      />
    </div>

    {view === 'wall' && pinned.length ? <section className="board-pinned-section">
      <div className="board-section-title"><Pin size={16} /><div><strong>Fissati sul tablet</strong><small>Restano sempre in primo piano.</small></div></div>
      <div className="board-pinned-grid">
        {pinned.map(post => <BoardCard key={post.id} post={post} familyId={familyId} data={data} authUser={authUser} canEdit={canEdit(post)} audienceText={audienceText(post)} reminderTone={reminderTone(post)} onEdit={() => openEdit(post)} onPin={() => toggleBoardPin(post.id)} onDelete={() => deletePost(post)} />)}
      </div>
    </section> : null}

    <section className="board-feed-section">
      <div className="board-section-title"><StickyNote size={16} /><div><strong>{view === 'wall' ? 'Da non perdere' : view === 'mine' ? 'I miei contenuti' : 'Tutta la bacheca'}</strong><small>Messaggi, note, foto e promemoria in ordine di aggiornamento.</small></div></div>
      {shown.length ? <div className="board-feed-grid">
        {shown.filter(post => view !== 'wall' || !post.pinned).map(post => <BoardCard key={post.id} post={post} familyId={familyId} data={data} authUser={authUser} canEdit={canEdit(post)} audienceText={audienceText(post)} reminderTone={reminderTone(post)} onEdit={() => openEdit(post)} onPin={() => toggleBoardPin(post.id)} onDelete={() => deletePost(post)} />)}
      </div> : <Card><EmptyState icon={<StickyNote size={30} />} title="Bacheca vuota" text="Pubblica un messaggio, una foto o un promemoria per la famiglia." action={<Button onClick={() => openNew('message')}>Scrivi il primo messaggio</Button>} /></Card>}
    </section>

    <Modal
      open={!!editing}
      onClose={() => !busy && setEditing(null)}
      title={editing?.id ? 'Modifica bacheca' : 'Nuovo contenuto'}
      footer={<div className="modal-actions">
        <div>{editing?.id ? <Button variant="danger" disabled={busy} icon={<Trash2 size={16} />} onClick={() => { const post = data.boardPosts.find(item => item.id === editing.id); if (post) void deletePost(post) }}>Elimina</Button> : null}</div>
        <div className="modal-actions__right"><Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Annulla</Button><Button disabled={busy} onClick={savePost}>{busy ? 'Salvataggio…' : 'Salva'}</Button></div>
      </div>}
    >
      {editing ? <div className="form-grid form-grid--2">
        <Field label="Tipo">
          <select value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value as BoardPostType })}>
            {TYPE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Visibilità">
          <select value={editing.audience} onChange={e => setEditing({ ...editing, audience: e.target.value, userIds: e.target.value === 'family' ? [] : editing.userIds })}>
            <option value="family">Tutta la famiglia</option>
            <option value="users">Solo alcune persone</option>
          </select>
        </Field>

        <Field label="Titolo" className="field--wide" hint="Facoltativo per i messaggi veloci">
          <input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Ricordarsi le chiavi" />
        </Field>

        <Field label="Messaggio" className="field--wide">
          <textarea rows={4} value={editing.body || ''} onChange={e => setEditing({ ...editing, body: e.target.value })} placeholder="Scrivi qui il contenuto…" />
        </Field>

        {editing.audience === 'users' ? <Field label="Destinatari" className="field--wide">
          <div className="board-user-picker">
            {data.users.map(user => {
              const selected = (editing.userIds || []).includes(user.id)
              return <button type="button" key={user.id} className={selected ? 'is-active' : ''} onClick={() => toggleTarget(user.id)}><Avatar user={user} size="xs" /> {user.name}</button>
            })}
          </div>
        </Field> : null}

        {editing.type === 'reminder' ? <Field label="Data promemoria">
          <input type="date" value={editing.dueDate || ''} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} />
        </Field> : null}

        {!isChild ? <label className="toggle-row field--wide"><input type="checkbox" checked={!!editing.pinned} onChange={e => setEditing({ ...editing, pinned: e.target.checked })} /><span><strong>Fissa in alto</strong><small>Resta sempre ben visibile nella bacheca e nella Home del tablet.</small></span></label> : null}

        <Field label="Foto" className="field--wide" hint="JPG, PNG, WEBP o HEIC · massimo 12 MB">
          <label className="board-upload-button">
            <Upload size={16} />
            <span>{pendingFile ? pendingFile.name : 'Scegli una foto'}</span>
            <input hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" onChange={e => setPendingFile(e.target.files?.[0] || null)} />
          </label>
        </Field>

        {(editing.attachments || []).length ? <div className="board-modal-attachments field--wide">
          {(editing.attachments || []).map((attachment: BoardAttachment) => <div key={attachment.id}>
            <BoardPhoto attachment={attachment} familyId={familyId} />
            <button type="button" disabled={busy} onClick={() => void deleteAttachment(attachment)}><Trash2 size={14} /> Rimuovi</button>
          </div>)}
        </div> : null}

        {photoMessage ? <div className="callout field--wide">{photoMessage}</div> : null}
      </div> : null}
    </Modal>
  </div>
}

function BoardCard({
  post,
  familyId,
  data,
  authUser,
  canEdit,
  audienceText,
  reminderTone,
  onEdit,
  onPin,
  onDelete
}: {
  post: BoardPost
  familyId: string | null
  data: any
  authUser: any
  canEdit: boolean
  audienceText: string
  reminderTone: 'neutral' | 'warning' | 'danger'
  onEdit: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const author = data.users.find((user: any) => user.id === post.authorUserId)
  return <Card className={`board-card board-card--${post.type} ${post.pinned ? 'is-pinned' : ''}`}>
    <div className="board-card__top">
      <div className="board-card__type">{typeIcon(post.type)}<span>{typeLabel(post.type)}</span></div>
      <div className="board-card__actions">
        {post.pinned ? <Badge tone="warning"><Pin size={11} /> Fissato</Badge> : null}
        {canEdit && authUser?.role !== 'bimbo' ? <IconButton label={post.pinned ? 'Togli dai fissati' : 'Fissa in alto'} onClick={onPin}>{post.pinned ? <PinOff size={15} /> : <Pin size={15} />}</IconButton> : null}
        {canEdit ? <IconButton label="Modifica" onClick={onEdit}><Pencil size={15} /></IconButton> : null}
        {canEdit ? <IconButton label="Elimina" onClick={onDelete}><Trash2 size={15} /></IconButton> : null}
      </div>
    </div>

    {post.attachments?.length ? <div className={`board-card__photos ${post.attachments.length > 1 ? 'has-many' : ''}`}>
      {post.attachments.slice(0, 4).map(attachment => <BoardPhoto key={attachment.id} attachment={attachment} familyId={familyId} />)}
    </div> : null}

    <div className="board-card__copy">
      {post.title ? <strong>{post.title}</strong> : null}
      {post.body ? <p>{post.body}</p> : null}
    </div>

    {post.type === 'reminder' && post.dueDate ? <div className="board-card__due"><Badge tone={reminderTone}><Bell size={12} /> {post.dueDate.split('-').reverse().join('/')}</Badge></div> : null}

    <div className="board-card__footer">
      <div className="board-card__author">{author ? <Avatar user={author} size="sm" /> : null}<span><strong>{author?.name || 'Famiglia'}</strong><small>{audienceText}</small></span></div>
      <time>{formatWhen(post.updatedAt)}</time>
    </div>
  </Card>
}
