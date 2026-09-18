import React, { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock3, Filter, Pencil, Plus, ShoppingCart, Sparkles, Trash2, Utensils } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { addDays, dayLabel, ingredientsToText, localDateISO, MEAL_SLOTS, MEAL_TYPES, normalize, parseIngredients, weekDates } from '../utils'

function ingredientAvailability(name: string, unit: string, pantry: any[]) {
  return pantry
    .filter(item => normalize(item.name) === normalize(name) && normalize(item.unit) === normalize(unit))
    .reduce((sum, item) => sum + Number(item.qty || 0), 0)
}

function expiryDays(date?: string) {
  if (!date) return null
  const today = new Date(`${localDateISO()}T12:00:00`).getTime()
  const target = new Date(`${date}T12:00:00`).getTime()
  return Math.round((target - today) / 86400000)
}

export default function MealsPage() {
  const { data, authUser, upsertDish, deleteDish, upsertMealPlan, deleteMealPlan, addShoppingItem } = useFamily()
  const today = localDateISO()
  const [tab, setTab] = useState<'planner' | 'smart' | 'dishes'>('planner')
  const [cursor, setCursor] = useState(today)
  const [typeFilter, setTypeFilter] = useState('Tutti')
  const [editingDish, setEditingDish] = useState<any>(null)
  const [editingPlan, setEditingPlan] = useState<any>(null)

  const [smartDate, setSmartDate] = useState(today)
  const [smartSlot, setSmartSlot] = useState('Cena')
  const [smartUserId, setSmartUserId] = useState(authUser?.id || data.users[0]?.id || 1)
  const [smartMaxMinutes, setSmartMaxMinutes] = useState(30)

  const week = useMemo(() => weekDates(cursor), [cursor])
  const filteredDishes = useMemo(
    () => data.dishes
      .filter(d => typeFilter === 'Tutti' || d.type === typeFilter)
      .sort((a, b) => `${a.type}${a.name}${a.variant}`.localeCompare(`${b.type}${b.name}${b.variant}`)),
    [data.dishes, typeFilter]
  )

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

  const smartSuggestions = useMemo(() => {
    const recentStart = addDays(today, -10)
    return data.dishes.map(dish => {
      const ingredients = dish.ingredients || []
      let coverageScore = 0
      let expiryBoost = 0
      const missing: Array<{ name: string; qty: number; unit: string }> = []
      const expiringUsed: string[] = []

      for (const ing of ingredients) {
        const need = Math.max(0, Number(ing.qty || 0))
        const available = ingredientAvailability(ing.name, ing.unit, data.pantry)
        if (need <= 0) coverageScore += 1
        else coverageScore += Math.min(1, available / need)

        if (available < need) {
          missing.push({ name: ing.name, qty: Math.max(0, need - available), unit: ing.unit || 'pz' })
        }

        const expiringMatches = data.pantry.filter(item => {
          if (normalize(item.name) !== normalize(ing.name) || Number(item.qty || 0) <= 0) return false
          const days = expiryDays(item.expiryDate)
          return days !== null && days >= 0 && days <= 5
        })
        if (expiringMatches.length) {
          expiryBoost += 1
          expiringUsed.push(ing.name)
        }
      }

      const ingredientCount = Math.max(1, ingredients.length)
      const coveragePct = Math.round((coverageScore / ingredientCount) * 100)
      const recentUses = data.mealPlans.filter(plan =>
        plan.dishId === dish.id &&
        plan.date >= recentStart &&
        plan.date <= today
      ).length

      const preferred = (dish.preferredByUserIds || []).includes(Number(smartUserId))
      const minutes = Number(dish.prepMinutes || 0)
      const timeFits = !minutes || smartMaxMinutes >= 999 || minutes <= smartMaxMinutes

      const score =
        (coveragePct * .5) +
        Math.min(20, expiryBoost * 8) +
        (preferred ? 15 : 0) +
        (timeFits ? 10 : -18) -
        Math.min(30, recentUses * 12) -
        Math.min(28, missing.length * 7)

      const reasons: string[] = []
      if (coveragePct >= 100) reasons.push('hai già tutti gli ingredienti')
      else if (coveragePct >= 70) reasons.push('hai quasi tutto in casa')
      if (expiringUsed.length) reasons.push(`usa ${expiringUsed.slice(0, 2).join(', ')} prima della scadenza`)
      if (preferred) reasons.push('piace alla persona selezionata')
      if (minutes && timeFits) reasons.push(`pronto in circa ${minutes} min`)
      if (recentUses === 0) reasons.push('non compare nei pasti degli ultimi 10 giorni')
      else if (recentUses >= 2) reasons.push('già mangiato di recente')

      return {
        dish,
        score,
        coveragePct,
        missing,
        expiringUsed,
        recentUses,
        preferred,
        timeFits,
        reasons
      }
    }).sort((a, b) => b.score - a.score || a.missing.length - b.missing.length)
  }, [data.dishes, data.pantry, data.mealPlans, smartUserId, smartMaxMinutes, today])

  function openDish(dish?: any) {
    setEditingDish(dish
      ? { ...dish, ingredientsText: ingredientsToText(dish.ingredients), preferredByUserIds: [...(dish.preferredByUserIds || [])] }
      : { id: undefined, name: '', type: 'Primo', variant: '', ingredientsText: '', prepMinutes: 30, preferredByUserIds: [] })
  }

  function saveDish() {
    if (!editingDish?.name?.trim()) return
    upsertDish({
      id: editingDish.id,
      name: editingDish.name.trim(),
      type: editingDish.type,
      variant: editingDish.variant.trim(),
      ingredients: parseIngredients(editingDish.ingredientsText || ''),
      prepMinutes: Math.max(0, Number(editingDish.prepMinutes) || 0) || undefined,
      preferredByUserIds: (editingDish.preferredByUserIds || []).map(Number)
    })
    setEditingDish(null)
  }

  function openPlan(date = today, slot = 'Pranzo', plan?: any, dishId?: number) {
    setEditingPlan(plan ? { ...plan } : {
      id: undefined,
      date,
      slot,
      userId: smartUserId || authUser?.id || data.users[0]?.id || 1,
      dishId: dishId || data.dishes[0]?.id || ''
    })
  }

  function savePlan() {
    if (!editingPlan?.dishId || !editingPlan?.date) return
    upsertMealPlan({ ...editingPlan, dishId: Number(editingPlan.dishId), userId: Number(editingPlan.userId) })
    setEditingPlan(null)
  }

  function togglePreferredUser(userId: number) {
    if (!editingDish) return
    const current: number[] = editingDish.preferredByUserIds || []
    setEditingDish({
      ...editingDish,
      preferredByUserIds: current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]
    })
  }

  function addMissingToShopping(suggestion: any) {
    for (const ing of suggestion.missing) {
      const alreadyOpen = data.shopping.some(item => !item.taken && normalize(item.name) === normalize(ing.name))
      if (alreadyOpen) continue
      addShoppingItem({
        name: ing.name,
        qty: Math.max(1, Number(ing.qty || 0)),
        unit: ing.unit || 'pz',
        category: data.pantry.find(item => normalize(item.name) === normalize(ing.name))?.category || 'Generico'
      })
    }
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Pianificazione"
        title="Pasti"
        description="Planner settimanale e suggerimenti intelligenti basati su dispensa, scadenze, tempo disponibile e varietà."
        actions={<Button icon={<Plus size={18} />} onClick={() => tab === 'planner' ? openPlan(today, 'Pranzo') : tab === 'dishes' ? openDish() : setTab('smart')}>{tab === 'planner' ? 'Pianifica pasto' : tab === 'dishes' ? 'Nuovo piatto' : 'Trova un piatto'}</Button>}
      />

      <div className="page-tabs-wrap">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'planner', label: 'Planner settimanale' },
            { value: 'smart', label: 'Cosa cuciniamo?' },
            { value: 'dishes', label: `Piatti · ${data.dishes.length}` }
          ]}
        />
      </div>

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

      {tab === 'smart' ? <div className="smart-meals">
        <Card className="smart-meals__controls">
          <CardHeader title="Dimmi cosa ti serve" subtitle="Il motore usa solo i dati già presenti in VerdoFamily." />
          <div className="form-grid form-grid--4">
            <Field label="Quando"><input type="date" value={smartDate} onChange={e => setSmartDate(e.target.value)} /></Field>
            <Field label="Pasto"><select value={smartSlot} onChange={e => setSmartSlot(e.target.value)}>{MEAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></Field>
            <Field label="Per chi"><select value={smartUserId} onChange={e => setSmartUserId(Number(e.target.value))}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
            <Field label="Tempo massimo"><select value={smartMaxMinutes} onChange={e => setSmartMaxMinutes(Number(e.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={999}>Nessun limite</option></select></Field>
          </div>
        </Card>

        {smartSuggestions.length ? <div className="smart-meal-grid">
          {smartSuggestions.slice(0, 8).map((suggestion, index) => {
            const dish = suggestion.dish
            const top = index === 0
            return <Card key={dish.id} className={`smart-meal-card ${top ? 'is-top' : ''}`}>
              <div className="smart-meal-card__head">
                <div>{top ? <Badge tone="success">Consiglio migliore</Badge> : <Badge>{dish.type}</Badge>}</div>
                {dish.prepMinutes ? <span><Clock3 size={14} /> {dish.prepMinutes} min</span> : null}
              </div>
              <div className="smart-meal-card__title">
                <strong>{dish.name}</strong>
                {dish.variant ? <span>{dish.variant}</span> : null}
              </div>

              <div className="smart-meal-score">
                <div><span style={{ width: `${Math.max(0, Math.min(100, suggestion.coveragePct))}%` }} /></div>
                <small>{suggestion.coveragePct}% ingredienti disponibili</small>
              </div>

              <div className="smart-meal-reasons">
                {(suggestion.reasons.length ? suggestion.reasons : ['piatto disponibile nel ricettario']).slice(0, 3).map((reason: string, idx: number) => <span key={idx}><Sparkles size={13} /> {reason}</span>)}
              </div>

              {suggestion.missing.length ? <div className="smart-meal-missing">
                <strong>Manca</strong>
                <div>{suggestion.missing.slice(0, 4).map((ing: any) => <span key={`${ing.name}-${ing.unit}`}>{ing.name} · {Number(ing.qty || 0).toFixed(Number(ing.qty || 0) % 1 ? 1 : 0)}{ing.unit}</span>)}</div>
              </div> : <div className="smart-meal-ready">✓ Puoi prepararlo con quello che hai già</div>}

              <div className="smart-meal-actions">
                <Button onClick={() => openPlan(smartDate, smartSlot, undefined, dish.id)}>Pianifica</Button>
                {suggestion.missing.length ? <Button variant="soft" icon={<ShoppingCart size={15} />} onClick={() => addMissingToShopping(suggestion)}>Aggiungi mancanti</Button> : null}
              </div>
            </Card>
          })}
        </div> : <Card><EmptyState icon={<Utensils size={30} />} title="Nessun piatto da consigliare" text="Censisci prima qualche piatto con i relativi ingredienti." action={<Button onClick={() => { setTab('dishes'); openDish() }}>Aggiungi un piatto</Button>} /></Card>}
      </div> : null}

      {tab === 'dishes' ? (
        <div>
          <div className="filter-bar"><Filter size={18} /><div className="chip-scroll">{['Tutti', ...MEAL_TYPES].map(type => <button key={type} className={`chip ${typeFilter === type ? 'is-active' : ''}`} onClick={() => setTypeFilter(type)}>{type}</button>)}</div></div>
          {filteredDishes.length ? <div className="dish-grid">{filteredDishes.map(dish => <Card key={dish.id} className="dish-card">
            <div className="dish-card__top"><Badge>{dish.type}</Badge><div><IconButton label="Modifica" onClick={() => openDish(dish)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => deleteDish(dish.id)}><Trash2 size={17} /></IconButton></div></div>
            <strong>{dish.name}</strong>
            {dish.variant ? <span className="dish-card__variant">{dish.variant}</span> : null}
            {dish.prepMinutes ? <span className="dish-card__time"><Clock3 size={13} /> {dish.prepMinutes} min</span> : null}
            {(dish.preferredByUserIds || []).length ? <div className="dish-card__preferred">{(dish.preferredByUserIds || []).map(id => { const user = data.users.find(item => item.id === id); return user ? <span key={id}><Avatar user={user} size="xs" /> {user.name}</span> : null })}</div> : null}
            <div className="dish-card__ingredients">{dish.ingredients.length ? dish.ingredients.map((i, idx) => <span key={`${i.name}-${idx}`}>{i.name} · {i.qty}{i.unit}</span>) : <span>Nessun ingrediente censito</span>}</div>
          </Card>)}</div> : <Card><EmptyState icon={<Utensils size={30} />} title="Nessun piatto" text="Censisci i piatti che preparate più spesso." action={<Button onClick={() => openDish()}>Nuovo piatto</Button>} /></Card>}
        </div>
      ) : null}

      <Modal open={!!editingDish} onClose={() => setEditingDish(null)} title={editingDish?.id ? 'Modifica piatto' : 'Nuovo piatto'} footer={<div className="modal-actions"><div>{editingDish?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteDish(editingDish.id); setEditingDish(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingDish(null)}>Annulla</Button><Button onClick={saveDish}>Salva</Button></div></div>}>
        {editingDish ? <div className="form-grid form-grid--2">
          <Field label="Nome" className="field--wide"><input autoFocus value={editingDish.name} onChange={e => setEditingDish({ ...editingDish, name: e.target.value })} /></Field>
          <Field label="Tipologia"><select value={editingDish.type} onChange={e => setEditingDish({ ...editingDish, type: e.target.value })}>{MEAL_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field>
          <Field label="Variante"><input value={editingDish.variant} onChange={e => setEditingDish({ ...editingDish, variant: e.target.value })} placeholder="Es. Pomodoro, Carbonara…" /></Field>
          <Field label="Tempo di preparazione"><input type="number" min="0" step="5" value={editingDish.prepMinutes || ''} onChange={e => setEditingDish({ ...editingDish, prepMinutes: Number(e.target.value) })} placeholder="30" /></Field>
          <Field label="Preferito da" className="field--wide" hint="Facoltativo: aiuta VerdoFamily a personalizzare i suggerimenti.">
            <div className="meal-preference-picker">{data.users.map(user => {
              const selected = (editingDish.preferredByUserIds || []).includes(user.id)
              return <button type="button" key={user.id} className={selected ? 'is-active' : ''} onClick={() => togglePreferredUser(user.id)}><Avatar user={user} size="xs" /> {user.name}</button>
            })}</div>
          </Field>
          <Field label="Ingredienti" className="field--wide" hint="Formato: nome=quantità=unità; nome=quantità=unità"><textarea rows={5} value={editingDish.ingredientsText} onChange={e => setEditingDish({ ...editingDish, ingredientsText: e.target.value })} placeholder="Pasta=80=g; Passata=100=g" /></Field>
        </div> : null}
      </Modal>

      <Modal open={!!editingPlan} onClose={() => setEditingPlan(null)} title={editingPlan?.id ? 'Modifica pianificazione' : 'Pianifica pasto'} footer={<div className="modal-actions"><div>{editingPlan?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteMealPlan(editingPlan.id); setEditingPlan(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingPlan(null)}>Annulla</Button><Button onClick={savePlan}>Salva</Button></div></div>}>
        {editingPlan ? <div className="form-grid form-grid--2"><Field label="Data"><input type="date" value={editingPlan.date} onChange={e => setEditingPlan({ ...editingPlan, date: e.target.value })} /></Field><Field label="Momento"><select value={editingPlan.slot} onChange={e => setEditingPlan({ ...editingPlan, slot: e.target.value })}>{MEAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></Field><Field label="Per chi"><select value={editingPlan.userId} onChange={e => setEditingPlan({ ...editingPlan, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field><Field label="Piatto"><select value={editingPlan.dishId} onChange={e => setEditingPlan({ ...editingPlan, dishId: Number(e.target.value) })}>{data.dishes.map(d => <option key={d.id} value={d.id}>{d.type} · {d.name}{d.variant ? ` (${d.variant})` : ''}</option>)}</select></Field></div> : null}
      </Modal>
    </div>
  )
}
