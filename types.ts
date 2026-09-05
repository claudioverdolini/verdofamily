export type Role = 'admin' | 'adulto' | 'bimbo'
export type ThemeMode = 'system' | 'light' | 'dark'

export type PageKey =
  | 'home'
  | 'calendar'
  | 'shopping'
  | 'meals'
  | 'chores'
  | 'deadlines'
  | 'todos'
  | 'users'
  | 'settings'

export type UserPrefs = {
  theme: ThemeMode
  accent: string
  density: 'compact' | 'comfortable'
  showBalances: boolean
  bottomTabs: PageKey[]
  homeCards: Array<'today' | 'shopping' | 'deadlines' | 'wallets'>
  notifications: {
    calendar: boolean
    deadlines: boolean
    chores: boolean
    shopping: boolean
    whatsapp: boolean
  }
}

export type FamilyUser = {
  id: number
  name: string
  role: Role
  password: string
  color: string
  avatarUrl: string
  balance: number
  prefs: UserPrefs
}

export type CalendarEvent = {
  id: number
  title: string
  date: string
  time: string
  endTime?: string
  userId: number
  notes?: string
}

export type Deadline = {
  id: number
  title: string
  date: string
  userId: number
  done: boolean
}

export type PantryItem = {
  id: number
  name: string
  qty: number
  unit: string
  category: string
  minQty?: number
}

export type ShoppingItem = {
  id: number
  name: string
  qty: number
  unit: string
  taken: boolean
  category?: string
}

export type Ingredient = { name: string; qty: number; unit: string }

export type Dish = {
  id: number
  name: string
  type: string
  variant: string
  ingredients: Ingredient[]
}

export type MealPlan = {
  id: number
  date: string
  slot: string
  userId: number
  dishId: number
}

export type Chore = {
  id: number
  title: string
  deadline: string
  userId: number
  amount: number
  done: boolean
  creditedTransactionId?: number
}

export type Transaction = {
  id: number
  userId: number
  type: 'credit' | 'payment' | 'reversal'
  amount: number
  date: string
  note: string
  reversed?: boolean
}

export type Todo = {
  id: number
  title: string
  userId: number
  done: boolean
  createdAt: string
}

export type FamilyData = {
  version: number
  users: FamilyUser[]
  calendarEvents: CalendarEvent[]
  deadlines: Deadline[]
  categories: string[]
  pantry: PantryItem[]
  shopping: ShoppingItem[]
  dishes: Dish[]
  mealPlans: MealPlan[]
  chores: Chore[]
  transactions: Transaction[]
  todos: Todo[]
}
