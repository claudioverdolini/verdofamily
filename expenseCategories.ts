import type { ExpenseCategory, ExpenseSubcategory } from './types'

export type ExpenseSubcategoryOption = { value: ExpenseSubcategory; label: string }
export type ExpenseCategoryOption = { value: ExpenseCategory; label: string; subcategories: ExpenseSubcategoryOption[] }

export const EXPENSE_CATEGORIES: ExpenseCategoryOption[] = [
  { value: 'groceries', label: 'Spesa alimentare', subcategories: [] },
  { value: 'dining', label: 'Ristoranti / bar', subcategories: [
    { value: 'dining_restaurant_bar', label: 'Ristoranti e bar' },
    { value: 'dining_delivery', label: 'Delivery / asporto' }
  ] },
  { value: 'home', label: 'Casa', subcategories: [
    { value: 'home_mortgage_rent', label: 'Mutuo / affitto' },
    { value: 'home_furnishings', label: 'Arredo e acquisti casa' },
    { value: 'home_maintenance', label: 'Manutenzione casa' }
  ] },
  { value: 'transport', label: 'Auto e trasporti', subcategories: [
    { value: 'transport_fuel', label: 'Carburante' },
    { value: 'transport_installment', label: 'Rata auto' },
    { value: 'transport_maintenance', label: 'Manutenzione' },
    { value: 'transport_tax_revision', label: 'Bollo / revisione' },
    { value: 'transport_insurance', label: 'Assicurazione auto' },
    { value: 'transport_parking_tolls', label: 'Parcheggi / pedaggi' },
    { value: 'transport_charging', label: 'Ricarica elettrica' },
    { value: 'transport_public', label: 'Altri trasporti' }
  ] },
  { value: 'health', label: 'Salute', subcategories: [
    { value: 'health_pharmacy', label: 'Farmacia' },
    { value: 'health_visits', label: 'Visite / prestazioni' }
  ] },
  { value: 'school', label: 'Scuola', subcategories: [
    { value: 'school_books_stationery', label: 'Libri / cartoleria' },
    { value: 'school_fees_activities', label: 'Mensa / rette / attività' }
  ] },
  { value: 'bills', label: 'Bollette e servizi', subcategories: [
    { value: 'bills_energy', label: 'Luce / gas / acqua' },
    { value: 'bills_phone_internet', label: 'Telefono / internet' },
    { value: 'bills_insurance', label: 'Assicurazioni' },
    { value: 'bills_banking', label: 'Banca / commissioni' }
  ] },
  { value: 'leisure', label: 'Tempo libero', subcategories: [
    { value: 'leisure_travel', label: 'Viaggi / vacanze' },
    { value: 'leisure_subscriptions', label: 'Abbonamenti digitali' },
    { value: 'leisure_sport_entertainment', label: 'Sport / intrattenimento' }
  ] },
  { value: 'clothing', label: 'Abbigliamento', subcategories: [] },
  { value: 'other', label: 'Altro', subcategories: [] }
]

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map(item => item.value)
export const EXPENSE_SUBCATEGORY_VALUES = EXPENSE_CATEGORIES.flatMap(item => item.subcategories.map(sub => sub.value))

export function expenseCategoryLabel(value: ExpenseCategory) {
  return EXPENSE_CATEGORIES.find(item => item.value === value)?.label || 'Altro'
}

export function expenseSubcategoryOptions(category: ExpenseCategory) {
  return EXPENSE_CATEGORIES.find(item => item.value === category)?.subcategories || []
}

export function expenseSubcategoryLabel(value?: ExpenseSubcategory) {
  if (!value) return ''
  for (const category of EXPENSE_CATEGORIES) {
    const found = category.subcategories.find(item => item.value === value)
    if (found) return found.label
  }
  return ''
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return EXPENSE_CATEGORY_VALUES.includes(String(value) as ExpenseCategory)
}

export function isExpenseSubcategory(value: unknown): value is ExpenseSubcategory {
  return EXPENSE_SUBCATEGORY_VALUES.includes(String(value) as ExpenseSubcategory)
}

export function subcategoryBelongsToCategory(subcategory: unknown, category: ExpenseCategory) {
  if (!subcategory) return false
  return expenseSubcategoryOptions(category).some(item => item.value === subcategory)
}
