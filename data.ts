import type { FamilyData } from './types'
import { DEFAULT_PREFS } from './utils'

export const initialData: FamilyData = {
  version: 3,
  users: [
    {
      id: 1,
      name: 'Admin',
      role: 'admin',
      password: 'admin',
      color: '#5B5BD6',
      avatarUrl: '',
      balance: 0,
      prefs: { ...DEFAULT_PREFS, accent: '#5B5BD6' }
    },
    {
      id: 2,
      name: 'Famiglia',
      role: 'adulto',
      password: 'famiglia',
      color: '#F97316',
      avatarUrl: '',
      balance: 0,
      prefs: { ...DEFAULT_PREFS, accent: '#F97316' }
    }
  ],
  calendarEvents: [],
  deadlines: [],
  categories: ['Generico', 'Fresco', 'Dispensa', 'Detersivi'],
  pantry: [],
  shopping: [],
  dishes: [
    {
      id: 1,
      name: 'Pasta',
      type: 'Primo',
      variant: 'Pomodoro',
      ingredients: [
        { name: 'Pasta', qty: 80, unit: 'g' },
        { name: 'Passata di pomodoro', qty: 100, unit: 'g' }
      ]
    }
  ],
  mealPlans: [],
  chores: [],
  transactions: [],
  todos: []
}
