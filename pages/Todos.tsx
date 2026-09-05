import React, { useMemo, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Button, Card, EmptyState, PageIntro, Segmented } from '../ui'

export default function TodosPage() {
  const { data, authUser, addTodo, toggleTodo, deleteTodo } = useFamily()
  const [view, setView] = useState<'open' | 'done'>('open')
  const [title, setTitle] = useState('')
  const [userId, setUserId] = useState(authUser?.id || data.users[0]?.id || 1)

  const list = useMemo(() => data.todos.filter(t => view === 'done' ? t.done : !t.done).sort((a,b) => b.id - a.id), [data.todos, view])

  function submit() {
    if (!title.trim()) return
    addTodo({ title: title.trim(), userId: Number(userId) })
    setTitle('')
  }

  return <div className="page">
    <PageIntro eyebrow="Promemoria veloci" title="ToDo List" description="Le cose piccole che altrimenti finiscono nei messaggi, nelle note e nella testa." />
    <Card className="todo-compose-card"><div className="todo-compose"><input autoComplete="off" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Aggiungi un promemoria…" /><select value={userId} onChange={e => setUserId(Number(e.target.value))}>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select><Button icon={<Plus size={17} />} onClick={submit}>Aggiungi</Button></div></Card>
    <div className="page-tabs-wrap"><Segmented value={view} onChange={setView} options={[{ value: 'open', label: `Da fare · ${data.todos.filter(t => !t.done).length}` }, { value: 'done', label: `Archivio · ${data.todos.filter(t => t.done).length}` }]} /></div>
    <Card>{list.length ? <div className="check-list">{list.map(item => { const user = data.users.find(u => u.id === item.userId); return <div key={item.id} className={`check-item ${item.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleTodo(item.id)}>{item.done ? <Check size={16} /> : null}</button><button className="check-item__copy" onClick={() => toggleTodo(item.id)}><strong>{item.title}</strong><span><Avatar user={user} size="xs" /> {user?.name} · {item.createdAt}</span></button><button className="icon-btn" onClick={() => deleteTodo(item.id)} aria-label="Elimina"><Trash2 size={17} /></button></div> })}</div> : <EmptyState title={view === 'open' ? 'Tutto fatto' : 'Archivio vuoto'} text={view === 'open' ? 'Nessun promemoria aperto.' : 'Le attività completate appariranno qui.'} />}</Card>
  </div>
}
