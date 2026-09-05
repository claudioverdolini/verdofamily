import React, { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Filter, Pencil, Plus, Trash2, Utensils } from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { addDays, dayLabel, ingredientsToText, localDateISO, MEAL_SLOTS, MEAL_TYPES, parseIngredients, weekDates } from '../utils'

export default function MealsPage() {
  const { data, authUser, upsertDish, deleteDish, upsertMealPlan, deleteMealPlan } = useFamily()
  const today = localDateISO()
  const [tab, setTab] = useState<'planner' | 'dishes'>('planner')
  const [cursor, setCursor] = useState(today)
  const [typeFilter, setTypeFilter] = useState('Tutti')
  const [editingDish, setEditingDish] = useState<any>(null)
  const [editingPlan, setEditingPlan] = useState<any>(null)

  const week = useMemo(() => weekDates(cursor), [cursor])
  const filteredDishes = useMemo(() => data.dishes.filter(d => typeFilter === 'Tutti' || d.type === typeFilter).sort((a, b) => `${a.type}${a.name}${a.variant}`.localeCompare(`${b.type}${b.name}${b.variant}`)), [data.dishes, typeFilter])

  const plansByKey = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const plan of data.mealPlans) {
      if (!week.includes(plan.date)) continue
      const key = `${plan.date}|${plan.slot}`
      map[key] ||= []
      map[key].push(plan)
    }
    return map
  }, [data.mealPlans, week.join('|')])

  function openDish(dish?: any) {
    setEditingDish(dish ? { ...dish, ingredientsText: ingredientsToText(dish.ingredients) } : { id: undefined, name: '', type: 'Primo', variant: '', ingredientsText: '' })
  }

  function saveDish() {
    if (!editingDish?.name?.trim()) return
    upsertDish({
      id: editingDish.id,
      name: editingDish.name.trim(),
      type: editingDish.type,
      variant: editingDish.variant.trim(),
      ingredients: parseIngredients(editingDish.ingredientsText || '')
    })
    setEditingDish(null)
  }

  function openPlan(date = today, slot = 'Pranzo', plan?: any) {
    setEditingPlan(plan ? { ...plan } : { id: undefined, date, slot, userId: authUser?.id || data.users[0]?.id || 1, dishId: data.dishes[0]?.id || '' })
  }

  function savePlan() {
    if (!editingPlan?.dishId || !editingPlan?.date) return
    upsertMealPlan({ ...editingPlan, dishId: Number(editingPlan.dishId), userId: Number(editingPlan.userId) })
    setEditingPlan(null)
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Pianificazione"
        title="Pasti"
        description="Più piatti per ogni momento della giornata, filtri per tipologia e dispensa aggiornata automaticamente."
        actions={<Button icon={<Plus size={18} />} onClick={() => tab === 'planner' ? openPlan(today, 'Pranzo') : openDish()}>{tab === 'planner' ? 'Pianifica pasto' : 'Nuovo piatto'}</Button>}
      />

      <div className="page-tabs-wrap"><Segmented value={tab} onChange={setTab} options={[{ value: 'planner', label: 'Planner settimanale' }, { value: 'dishes', label: `Piatti · ${data.dishes.length}` }]} /></div>

      {tab === 'planner' ? (
        <Card className="meal-planner-card">
          <div className="planner-toolbar">
            <div className="planner-toolbar__nav"><IconButton label="Settimana precedente" onClick={() => setCursor(addDays(cursor, -7))}><ChevronLeft size={20} /></IconButton><button className="today-btn" onClick={() => setCursor(today)}>Questa settimana</button><IconButton label="Settimana successiva" onClick={() => setCursor(addDays(cursor, 7))}><ChevronRight size={20} /></IconButton></div>
            <strong>{dayLabel(week[0], true)} – {dayLabel(week[6], true)}</strong>
          </div>

          <div className="meal-board">
            <div className="meal-board__corner" />
            {week.map(date => <div key={date} className={`meal-board__day ${date === today ? 'is-today' : ''}`}><strong>{dayLabel(date)}</strong><span>{date.slice(8, 10)}</span></div>)}
            {MEAL_SLOTS.map(slot => (
              <React.Fragment key={slot}>
                <div className="meal-board__slot">{slot}</div>
                {week.map(date => {
                  const list = plansByKey[`${date}|${slot}`] || []
                  return <div key={`${date}|${slot}`} className="meal-board__cell">
                    {list.map(plan => {
                      const dish = data.dishes.find(d => d.id === plan.dishId)
                      const user = data.users.find(u => u.id === plan.userId)
                      return <button key={plan.id} className="meal-plan-pill" onClick={() => openPlan(date, slot, plan)} style={{ '--meal-color': user?.color || '#5B5BD6' } as React.CSSProperties}><strong>{dish?.name || 'Piatto'}</strong>{dish?.variant ? <span>{dish.variant}</span> : null}</button>
                    })}
                    <button className="meal-add" onClick={() => openPlan(date, slot)}>+</button>
                  </div>
                })}
              </React.Fragment>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === 'dishes' ? (
        <div>
          <div className="filter-bar"><Filter size={18} /><div className="chip-scroll">{['Tutti', ...MEAL_TYPES].map(type => <button key={type} className={`chip ${typeFilter === type ? 'is-active' : ''}`} onClick={() => setTypeFilter(type)}>{type}</button>)}</div></div>
          {filteredDishes.length ? <div className="dish-grid">{filteredDishes.map(dish => <Card key={dish.id} className="dish-card"><div className="dish-card__top"><Badge>{dish.type}</Badge><div><IconButton label="Modifica" onClick={() => openDish(dish)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => deleteDish(dish.id)}><Trash2 size={17} /></IconButton></div></div><strong>{dish.name}</strong>{dish.variant ? <span className="dish-card__variant">{dish.variant}</span> : null}<div className="dish-card__ingredients">{dish.ingredients.length ? dish.ingredients.map((i, idx) => <span key={`${i.name}-${idx}`}>{i.name} · {i.qty}{i.unit}</span>) : <span>Nessun ingrediente censito</span>}</div></Card>)}</div> : <Card><EmptyState icon={<Utensils size={30} />} title="Nessun piatto" text="Censisci i piatti che preparate più spesso." action={<Button onClick={() => openDish()}>Nuovo piatto</Button>} /></Card>}
        </div>
      ) : null}

      <Modal open={!!editingDish} onClose={() => setEditingDish(null)} title={editingDish?.id ? 'Modifica piatto' : 'Nuovo piatto'} footer={<div className="modal-actions"><div>{editingDish?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteDish(editingDish.id); setEditingDish(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingDish(null)}>Annulla</Button><Button onClick={saveDish}>Salva</Button></div></div>}>
        {editingDish ? <div className="form-grid form-grid--2"><Field label="Nome" className="field--wide"><input autoFocus value={editingDish.name} onChange={e => setEditingDish({ ...editingDish, name: e.target.value })} /></Field><Field label="Tipologia"><select value={editingDish.type} onChange={e => setEditingDish({ ...editingDish, type: e.target.value })}>{MEAL_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field><Field label="Variante"><input value={editingDish.variant} onChange={e => setEditingDish({ ...editingDish, variant: e.target.value })} placeholder="Es. Pomodoro, Carbonara…" /></Field><Field label="Ingredienti" className="field--wide" hint="Formato: nome=quantità=unità; nome=quantità=unità"><textarea rows={5} value={editingDish.ingredientsText} onChange={e => setEditingDish({ ...editingDish, ingredientsText: e.target.value })} placeholder="Pasta=80=g; Passata=100=g" /></Field></div> : null}
      </Modal>

      <Modal open={!!editingPlan} onClose={() => setEditingPlan(null)} title={editingPlan?.id ? 'Modifica pianificazione' : 'Pianifica pasto'} footer={<div className="modal-actions"><div>{editingPlan?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteMealPlan(editingPlan.id); setEditingPlan(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingPlan(null)}>Annulla</Button><Button onClick={savePlan}>Salva</Button></div></div>}>
        {editingPlan ? <div className="form-grid form-grid--2"><Field label="Data"><input type="date" value={editingPlan.date} onChange={e => setEditingPlan({ ...editingPlan, date: e.target.value })} /></Field><Field label="Momento"><select value={editingPlan.slot} onChange={e => setEditingPlan({ ...editingPlan, slot: e.target.value })}>{MEAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></Field><Field label="Per chi"><select value={editingPlan.userId} onChange={e => setEditingPlan({ ...editingPlan, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field><Field label="Piatto"><select value={editingPlan.dishId} onChange={e => setEditingPlan({ ...editingPlan, dishId: Number(e.target.value) })}>{data.dishes.map(d => <option key={d.id} value={d.id}>{d.type} · {d.name}{d.variant ? ` (${d.variant})` : ''}</option>)}</select></Field></div> : null}
      </Modal>
    </div>
  )
}
