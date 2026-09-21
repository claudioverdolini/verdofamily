import React, { useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Clock3, ExternalLink, Filter, Link2, Pencil, Plus, ShoppingCart, Sparkles, Trash2, Utensils } from 'lucide-react'
import { useFamily } from '../store'
import MultiAssigneePicker from '../components/MultiAssigneePicker'
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


function normalizeRecipeUrl(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function recipeSource(urlValue: string) {
  try {
    const host = new URL(urlValue).hostname.replace(/^www\./i, '')
    if (host.includes('cookidoo')) return 'Cookidoo'
    return host.split('.')[0].replace(/(^|[-_])\w/g, part => part.replace(/[-_]/g, '').toUpperCase())
  } catch {
    return 'Ricetta online'
  }
}

export default function MealsPage() {
  const { data, authUser, upsertDish, deleteDish, upsertMealPlan, deleteMealPlan, addShoppingItem } = useFamily()
  const today = localDateISO()
  const [tab, setTab] = useState<'planner' | 'smart' | 'dishes' | 'recipes'>('planner')
  const [cursor, setCursor] = useState(today)
  const [selectedMobileDate, setSelectedMobileDate] = useState(today)
  const [typeFilter, setTypeFilter] = useState('Tutti')
  const [editingDish, setEditingDish] = useState<any>(null)
  const [dishEditorKind, setDishEditorKind] = useState<'dish' | 'recipe'>('dish')
  const [editingPlan, setEditingPlan] = useState<any>(null)

  const [smartDate, setSmartDate] = useState(today)
  const [smartSlot, setSmartSlot] = useState('Cena')
  const [smartUserId, setSmartUserId] = useState(authUser?.id || data.users[0]?.id || 1)
  const [smartMaxMinutes, setSmartMaxMinutes] = useState(30)

  const week = useMemo(() => weekDates(cursor), [cursor])

  useEffect(() => {
    if (!week.includes(selectedMobileDate)) {
      setSelectedMobileDate(week.includes(today) ? today : week[0])
    }
  }, [week.join('|'), selectedMobileDate, today])

  function movePlannerWeek(direction: -1 | 1) {
    const nextCursor = addDays(cursor, 7 * direction)
    const nextWeek = weekDates(nextCursor)
    setCursor(nextCursor)
    setSelectedMobileDate(nextWeek.includes(today) ? today : nextWeek[0])
  }

  function resetPlannerWeek() {
    setCursor(today)
    setSelectedMobileDate(today)
  }
  const filteredDishes = useMemo(
    () => data.dishes
      .filter(d => typeFilter === 'Tutti' || d.type === typeFilter)
      .sort((a, b) => `${a.type}${a.name}${a.variant}`.localeCompare(`${b.type}${b.name}${b.variant}`)),
    [data.dishes, typeFilter]
  )

  const linkedRecipes = useMemo(
    () => data.dishes
      .filter(dish => !!dish.sourceUrl)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data.dishes]
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
    setDishEditorKind('dish')
    setEditingDish(dish
      ? { ...dish, ingredientsText: ingredientsToText(dish.ingredients), preferredByUserIds: [...(dish.preferredByUserIds || [])] }
      : { id: undefined, name: '', type: 'Primo', variant: '', ingredientsText: '', prepMinutes: 30, preferredByUserIds: [], sourceUrl: '', sourceLabel: '', notes: '' })
  }

  function openRecipe(dish?: any) {
    setDishEditorKind('recipe')
    setEditingDish(dish
      ? { ...dish, ingredientsText: ingredientsToText(dish.ingredients), preferredByUserIds: [...(dish.preferredByUserIds || [])] }
      : { id: undefined, name: '', type: 'Altro', variant: '', ingredientsText: '', prepMinutes: 30, preferredByUserIds: [], sourceUrl: '', sourceLabel: '', notes: '' })
  }

  function saveDish() {
    if (!editingDish?.name?.trim()) return
    const sourceUrl = normalizeRecipeUrl(editingDish.sourceUrl || '')
    if (dishEditorKind === 'recipe' && !sourceUrl) {
      alert('Inserisci un link valido che inizi con http:// o https://')
      return
    }
    upsertDish({
      id: editingDish.id,
      name: editingDish.name.trim(),
      type: editingDish.type,
      variant: editingDish.variant.trim(),
      ingredients: parseIngredients(editingDish.ingredientsText || ''),
      prepMinutes: Math.max(0, Number(editingDish.prepMinutes) || 0) || undefined,
      preferredByUserIds: (editingDish.preferredByUserIds || []).map(Number),
      sourceUrl: sourceUrl || undefined,
      sourceLabel: sourceUrl ? (editingDish.sourceLabel?.trim() || recipeSource(sourceUrl)) : undefined,
      notes: editingDish.notes?.trim() || undefined
    })
    setEditingDish(null)
  }

  function missingIngredientsForPlan(dishId: number, planId?: number) {
    const dish = data.dishes.find(item => item.id === Number(dishId))
    if (!dish) return []
    const previousPlan = planId ? data.mealPlans.find(item => item.id === planId) : undefined
    const previousDish = previousPlan ? data.dishes.find(item => item.id === previousPlan.dishId) : undefined

    return (dish.ingredients || []).map(ing => {
      let available = ingredientAvailability(ing.name, ing.unit, data.pantry)
      if (previousDish) {
        available += (previousDish.ingredients || [])
          .filter(item => normalize(item.name) === normalize(ing.name) && normalize(item.unit) === normalize(ing.unit))
          .reduce((sum, item) => sum + Number(item.qty || 0), 0)
      }
      const need = Math.max(0, Number(ing.qty || 0))
      return { name: ing.name, qty: Math.max(0, need - available), unit: ing.unit || 'pz' }
    }).filter(item => item.qty > 0)
  }

  function addIngredientsToShopping(items: Array<{ name: string; qty: number; unit: string }>) {
    for (const ing of items) {
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

  function openPlan(date = today, slot = 'Pranzo', plan?: any, dishId?: number) {
    const defaultUserId = smartUserId || authUser?.id || data.users[0]?.id || 1
    setEditingPlan(plan ? { ...plan, userIds: [Number(plan.userId)], addMissingToShopping: false } : {
      id: undefined,
      date,
      slot,
      userId: defaultUserId,
      userIds: [defaultUserId],
      dishId: dishId || data.dishes[0]?.id || '',
      addMissingToShopping: true
    })
  }

  function savePlan() {
    if (!editingPlan?.dishId || !editingPlan?.date) return
    const { addMissingToShopping: shouldAddMissing, userIds: rawUserIds, ...plan } = editingPlan
    const userIds = editingPlan.id
      ? [Number(editingPlan.userId)]
      : Array.from(new Set(
          (Array.isArray(rawUserIds) && rawUserIds.length ? rawUserIds : [editingPlan.userId])
            .map(Number)
            .filter((id: number) => id > 0)
        ))
    if (!userIds.length) return
    const missing = shouldAddMissing ? missingIngredientsForPlan(Number(plan.dishId), plan.id ? Number(plan.id) : undefined) : []
    userIds.forEach((userId: number, index: number) => upsertMealPlan({
      ...plan,
      id: editingPlan.id && index === 0 ? editingPlan.id : undefined,
      dishId: Number(plan.dishId),
      userId
    }))
    if (missing.length) addIngredientsToShopping(missing)
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
    addIngredientsToShopping(suggestion.missing || [])
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Pianificazione"
        title="Pasti"
        description="Planner settimanale e suggerimenti intelligenti basati su dispensa, scadenze, tempo disponibile e varietà."
        actions={<Button icon={<Plus size={18} />} onClick={() => tab === 'planner' ? openPlan(today, 'Pranzo') : tab === 'dishes' ? openDish() : tab === 'recipes' ? openRecipe() : setTab('smart')}>{tab === 'planner' ? 'Pianifica pasto' : tab === 'dishes' ? 'Nuovo piatto' : tab === 'recipes' ? 'Salva ricetta' : 'Trova un piatto'}</Button>}
      />

      <div className="page-tabs-wrap page-tabs-wrap--meals">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'planner', label: 'Planner' },
            { value: 'smart', label: 'Idee' },
            { value: 'recipes', label: `Ricette · ${linkedRecipes.length}` },
            { value: 'dishes', label: `Piatti · ${data.dishes.length}` }
          ]}
        />
      </div>

      {tab === 'planner' ? (
        <Card className="meal-planner-card">
          <div className="planner-toolbar">
            <div className="planner-toolbar__nav"><IconButton label="Settimana precedente" onClick={() => movePlannerWeek(-1)}><ChevronLeft size={20} /></IconButton><button className="today-btn" onClick={resetPlannerWeek}>Questa settimana</button><IconButton label="Settimana successiva" onClick={() => movePlannerWeek(1)}><ChevronRight size={20} /></IconButton></div>
            <strong>{dayLabel(week[0], true)} – {dayLabel(week[6], true)}</strong>
          </div>

          <div className="meal-board meal-board--desktop">
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
                      return <button key={plan.id} className="meal-plan-pill" onClick={() => openPlan(date, slot, plan)} style={{ '--meal-color': user?.color || '#5B5BD6' } as React.CSSProperties}><strong>{dish?.name || 'Piatto'}</strong>{dish?.sourceUrl ? <span>🔗 {dish.sourceLabel || 'Ricetta online'}</span> : dish?.variant ? <span>{dish.variant}</span> : null}</button>
                    })}
                    <button className="meal-add" onClick={() => openPlan(date, slot)}>+</button>
                  </div>
                })}
              </React.Fragment>
            ))}
          </div>

          <div className="meal-mobile-planner">
            <div className="meal-mobile-week" role="tablist" aria-label="Giorni della settimana">
              {week.map(date => <button
                type="button"
                role="tab"
                aria-selected={selectedMobileDate === date}
                key={date}
                className={`${selectedMobileDate === date ? 'is-active' : ''} ${date === today ? 'is-today' : ''}`}
                onClick={() => setSelectedMobileDate(date)}
              >
                <span>{dayLabel(date).slice(0, 3)}</span>
                <strong>{date.slice(8, 10)}</strong>
              </button>)}
            </div>

            <section className={`meal-mobile-day ${selectedMobileDate === today ? 'is-today' : ''}`}>
              <header className="meal-mobile-day__head">
                <div>
                  <span>{selectedMobileDate === today ? 'Oggi' : dayLabel(selectedMobileDate, true)}</span>
                  <strong>{new Date(`${selectedMobileDate}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</strong>
                </div>
                <Button size="sm" variant="soft" icon={<Plus size={16} />} onClick={() => openPlan(selectedMobileDate, 'Pranzo')}>Pasto</Button>
              </header>

              <div className="meal-mobile-slots">
                {MEAL_SLOTS.map(slot => {
                  const list = plansByKey[`${selectedMobileDate}|${slot}`] || []
                  return <div className="meal-mobile-slot" key={slot}>
                    <div className="meal-mobile-slot__label">
                      <span>{slot}</span>
                      <button type="button" aria-label={`Aggiungi ${slot}`} onClick={() => openPlan(selectedMobileDate, slot)}><Plus size={17} /></button>
                    </div>
                    <div className="meal-mobile-slot__content">
                      {list.length ? list.map(plan => {
                        const dish = data.dishes.find(d => d.id === plan.dishId)
                        const user = data.users.find(u => u.id === plan.userId)
                        return <button
                          key={plan.id}
                          className="meal-mobile-plan"
                          onClick={() => openPlan(selectedMobileDate, slot, plan)}
                          style={{ '--meal-color': user?.color || '#5B5BD6' } as React.CSSProperties}
                        >
                          <span className="meal-mobile-plan__dot" />
                          <span className="meal-mobile-plan__copy">
                            <strong>{dish?.name || 'Piatto'}</strong>
                            <small>{dish?.variant || dish?.sourceLabel || user?.name || 'Pasto pianificato'}</small>
                          </span>
                          {user ? <Avatar user={user} size="xs" /> : <ChevronRight size={17} />}
                        </button>
                      }) : <button className="meal-mobile-empty" onClick={() => openPlan(selectedMobileDate, slot)}>
                        <Plus size={17} />
                        <span>Aggiungi {slot.toLowerCase()}</span>
                      </button>}
                    </div>
                  </div>
                })}
              </div>
            </section>
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

      {tab === 'recipes' ? (
        <div className="recipe-library">
          <Card className="recipe-library__intro">
            <div className="recipe-library__intro-icon"><BookOpen size={22} /></div>
            <div><strong>Ricettario online</strong><span>Salva ricette da Cookidoo o da qualsiasi sito. Inserendo anche gli ingredienti, VerdoFamily può controllare la dispensa e preparare la lista della spesa.</span></div>
            <Button icon={<Link2 size={17} />} onClick={() => openRecipe()}>Salva link</Button>
          </Card>

          {linkedRecipes.length ? <div className="recipe-grid">{linkedRecipes.map(recipe => {
            const missing = missingIngredientsForPlan(recipe.id)
            return <Card key={recipe.id} className="recipe-card">
              <div className="recipe-card__head">
                <div><Badge tone="success">{recipe.sourceLabel || recipeSource(recipe.sourceUrl || '')}</Badge><Badge>{recipe.type}</Badge></div>
                <div>
                  <IconButton label="Apri ricetta originale" onClick={() => window.open(recipe.sourceUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={17} /></IconButton>
                  <IconButton label="Modifica" onClick={() => openRecipe(recipe)}><Pencil size={17} /></IconButton>
                  <IconButton label="Elimina" onClick={() => deleteDish(recipe.id)}><Trash2 size={17} /></IconButton>
                </div>
              </div>
              <strong className="recipe-card__title">{recipe.name}</strong>
              {recipe.variant ? <span className="recipe-card__variant">{recipe.variant}</span> : null}
              {recipe.notes ? <p className="recipe-card__notes">{recipe.notes}</p> : null}
              <div className="recipe-card__meta">
                {recipe.prepMinutes ? <span><Clock3 size={14} /> {recipe.prepMinutes} min</span> : null}
                <span><Utensils size={14} /> {(recipe.ingredients || []).length} ingredienti</span>
              </div>
              <div className="recipe-card__availability">
                {missing.length
                  ? <><strong>Mancano {missing.length}</strong><span>{missing.slice(0, 4).map(item => item.name).join(', ')}{missing.length > 4 ? '…' : ''}</span></>
                  : <><strong>✓ Hai già tutto</strong><span>In base alle quantità registrate in dispensa.</span></>}
              </div>
              <div className="recipe-card__actions">
                <Button onClick={() => openPlan(today, 'Cena', undefined, recipe.id)}>Pianifica</Button>
                {missing.length ? <Button variant="soft" icon={<ShoppingCart size={15} />} onClick={() => addIngredientsToShopping(missing)}>Mancanti → spesa</Button> : null}
                <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={() => window.open(recipe.sourceUrl, '_blank', 'noopener,noreferrer')}>Apri ricetta</Button>
              </div>
            </Card>
          })}</div> : <Card><EmptyState icon={<BookOpen size={30} />} title="Nessuna ricetta salvata" text="Salva un link Cookidoo o una ricetta da qualsiasi sito. Aggiungi gli ingredienti per usare automaticamente dispensa e lista spesa." action={<Button icon={<Link2 size={17} />} onClick={() => openRecipe()}>Salva la prima ricetta</Button>} /></Card>}
        </div>
      ) : null}

      {tab === 'dishes' ? (
        <div>
          <div className="filter-bar"><Filter size={18} /><div className="chip-scroll">{['Tutti', ...MEAL_TYPES].map(type => <button key={type} className={`chip ${typeFilter === type ? 'is-active' : ''}`} onClick={() => setTypeFilter(type)}>{type}</button>)}</div></div>
          {filteredDishes.length ? <div className="dish-grid">{filteredDishes.map(dish => <Card key={dish.id} className="dish-card">
            <div className="dish-card__top"><div className="dish-card__badges"><Badge>{dish.type}</Badge>{dish.sourceUrl ? <Badge tone="success">{dish.sourceLabel || 'Ricetta online'}</Badge> : null}</div><div>{dish.sourceUrl ? <IconButton label="Apri ricetta" onClick={() => window.open(dish.sourceUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={17} /></IconButton> : null}<IconButton label="Modifica" onClick={() => dish.sourceUrl ? openRecipe(dish) : openDish(dish)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => deleteDish(dish.id)}><Trash2 size={17} /></IconButton></div></div>
            <strong>{dish.name}</strong>
            {dish.variant ? <span className="dish-card__variant">{dish.variant}</span> : null}
            {dish.prepMinutes ? <span className="dish-card__time"><Clock3 size={13} /> {dish.prepMinutes} min</span> : null}
            {(dish.preferredByUserIds || []).length ? <div className="dish-card__preferred">{(dish.preferredByUserIds || []).map(id => { const user = data.users.find(item => item.id === id); return user ? <span key={id}><Avatar user={user} size="xs" /> {user.name}</span> : null })}</div> : null}
            <div className="dish-card__ingredients">{dish.ingredients.length ? dish.ingredients.map((i, idx) => <span key={`${i.name}-${idx}`}>{i.name} · {i.qty}{i.unit}</span>) : <span>Nessun ingrediente censito</span>}</div>
          </Card>)}</div> : <Card><EmptyState icon={<Utensils size={30} />} title="Nessun piatto" text="Censisci i piatti che preparate più spesso." action={<Button onClick={() => openDish()}>Nuovo piatto</Button>} /></Card>}
        </div>
      ) : null}

      <Modal open={!!editingDish} onClose={() => setEditingDish(null)} title={dishEditorKind === 'recipe' ? (editingDish?.id ? 'Modifica ricetta link' : 'Salva ricetta link') : (editingDish?.id ? 'Modifica piatto' : 'Nuovo piatto')} footer={<div className="modal-actions"><div>{editingDish?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteDish(editingDish.id); setEditingDish(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingDish(null)}>Annulla</Button><Button onClick={saveDish}>Salva</Button></div></div>}>
        {editingDish ? <div className="form-grid form-grid--2">
          <Field label={dishEditorKind === 'recipe' ? 'Titolo ricetta' : 'Nome'} className="field--wide"><input autoFocus value={editingDish.name} onChange={e => setEditingDish({ ...editingDish, name: e.target.value })} placeholder={dishEditorKind === 'recipe' ? 'Es. Risotto ai funghi Bimby' : ''} /></Field>
          {dishEditorKind === 'recipe' ? <>
            <Field label="Link ricetta" className="field--wide" hint="Cookidoo o qualsiasi pagina web pubblica."><input type="url" value={editingDish.sourceUrl || ''} onChange={e => setEditingDish({ ...editingDish, sourceUrl: e.target.value, sourceLabel: editingDish.sourceLabel || recipeSource(e.target.value) })} placeholder="https://cookidoo.it/recipes/..." /></Field>
            <Field label="Fonte"><input value={editingDish.sourceLabel || ''} onChange={e => setEditingDish({ ...editingDish, sourceLabel: e.target.value })} placeholder="Cookidoo" /></Field>
            <Field label="Note"><input value={editingDish.notes || ''} onChange={e => setEditingDish({ ...editingDish, notes: e.target.value })} placeholder="Es. Piace a tutti, raddoppiare le dosi…" /></Field>
          </> : null}
          <Field label="Tipologia"><select value={editingDish.type} onChange={e => setEditingDish({ ...editingDish, type: e.target.value })}>{MEAL_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field>
          <Field label="Variante"><input value={editingDish.variant} onChange={e => setEditingDish({ ...editingDish, variant: e.target.value })} placeholder="Es. Pomodoro, Carbonara…" /></Field>
          <Field label="Tempo di preparazione"><input type="number" min="0" step="5" value={editingDish.prepMinutes || ''} onChange={e => setEditingDish({ ...editingDish, prepMinutes: Number(e.target.value) })} placeholder="30" /></Field>
          <Field label="Preferito da" className="field--wide" hint="Facoltativo: aiuta VerdoFamily a personalizzare i suggerimenti.">
            <div className="meal-preference-picker">{data.users.map(user => {
              const selected = (editingDish.preferredByUserIds || []).includes(user.id)
              return <button type="button" key={user.id} className={selected ? 'is-active' : ''} onClick={() => togglePreferredUser(user.id)}><Avatar user={user} size="xs" /> {user.name}</button>
            })}</div>
          </Field>
          <Field label="Ingredienti" className="field--wide" hint={dishEditorKind === 'recipe' ? 'Servono per confrontare la ricetta con dispensa e lista spesa. Formato: nome=quantità=unità; ...' : 'Formato: nome=quantità=unità; nome=quantità=unità'}><textarea rows={5} value={editingDish.ingredientsText} onChange={e => setEditingDish({ ...editingDish, ingredientsText: e.target.value })} placeholder="Pasta=80=g; Passata=100=g" /></Field>
        </div> : null}
      </Modal>

      <Modal open={!!editingPlan} onClose={() => setEditingPlan(null)} title={editingPlan?.id ? 'Modifica pianificazione' : 'Pianifica pasto'} footer={<div className="modal-actions"><div>{editingPlan?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deleteMealPlan(editingPlan.id); setEditingPlan(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingPlan(null)}>Annulla</Button><Button onClick={savePlan}>Salva</Button></div></div>}>
        {editingPlan ? <div className="form-grid form-grid--2"><Field label="Data"><input type="date" value={editingPlan.date} onChange={e => setEditingPlan({ ...editingPlan, date: e.target.value })} /></Field><Field label="Momento"><select value={editingPlan.slot} onChange={e => setEditingPlan({ ...editingPlan, slot: e.target.value })}>{MEAL_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</select></Field>{editingPlan.id ? <Field label="Per chi"><select value={editingPlan.userId} onChange={e => setEditingPlan({ ...editingPlan, userId: Number(e.target.value), userIds: [Number(e.target.value)] })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field> : <Field label="Per chi" className="field--wide" hint="Puoi pianificare lo stesso pasto per più persone con un’unica operazione."><MultiAssigneePicker users={data.users} selectedIds={editingPlan.userIds || [editingPlan.userId].filter(Boolean)} onChange={userIds => setEditingPlan({ ...editingPlan, userIds, userId: userIds[0] || 0 })} /></Field>}<Field label="Piatto / ricetta"><select value={editingPlan.dishId} onChange={e => setEditingPlan({ ...editingPlan, dishId: Number(e.target.value) })}>
            {linkedRecipes.length ? <optgroup label="Ricette online">{linkedRecipes.map(d => <option key={d.id} value={d.id}>{d.sourceLabel || 'Online'} · {d.name}{d.variant ? ` (${d.variant})` : ''}</option>)}</optgroup> : null}
            <optgroup label="Piatti">{data.dishes.filter(d => !d.sourceUrl).map(d => <option key={d.id} value={d.id}>{d.type} · {d.name}{d.variant ? ` (${d.variant})` : ''}</option>)}</optgroup>
          </select></Field>
          <Field label="Lista spesa" className="field--wide">
            <label className="settings-switch">
              <span><strong>Aggiungi ingredienti mancanti alla spesa</strong><small>VerdoFamily confronta la ricetta con le quantità presenti in dispensa.</small></span>
              <input type="checkbox" checked={editingPlan.addMissingToShopping !== false} onChange={e => setEditingPlan({ ...editingPlan, addMissingToShopping: e.target.checked })} />
            </label>
          </Field></div> : null}
      </Modal>
    </div>
  )
}
