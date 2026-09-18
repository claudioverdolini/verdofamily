import { supabase } from './supabaseClient'

export type PushTopics = {
  calendar: boolean
  deadlines: boolean
  chores: boolean
  school: boolean
  board: boolean
  shopping: boolean
}

export type PushStatus = {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  configured: boolean
}

function supportsPush() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

async function invokePush(familyId: string, body: Record<string, unknown>) {
  if (!supabase) throw new Error('Connessione cloud non disponibile.')
  const { data, error } = await supabase.functions.invoke('push-notifications', {
    body: { familyId, ...body }
  })
  if (error) throw new Error(error.message || 'Servizio notifiche non disponibile.')
  if (!data?.ok) throw new Error(data?.error || 'Operazione notifiche non riuscita.')
  return data
}

async function currentSubscription() {
  if (!supportsPush()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function getPushStatus(familyId: string): Promise<PushStatus> {
  if (!supportsPush()) {
    return { supported: false, permission: 'unsupported', subscribed: false, configured: false }
  }

  const subscription = await currentSubscription()
  try {
    const server = await invokePush(familyId, {
      action: 'status',
      endpoint: subscription?.endpoint || ''
    })
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: Boolean(subscription && server.subscribed),
      configured: server.configured !== false
    }
  } catch {
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: Boolean(subscription),
      configured: false
    }
  }
}

export async function enablePush(familyId: string, topics: PushTopics) {
  if (!supportsPush()) throw new Error('Questo dispositivo/browser non supporta le notifiche push Web.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Le notifiche sono bloccate nelle impostazioni del browser/dispositivo.'
      : 'Permesso notifiche non concesso.')
  }

  const status = await invokePush(familyId, { action: 'status' })
  if (!status.publicKey) throw new Error('Chiave pubblica push non disponibile.')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey)
    })
  }

  await invokePush(familyId, {
    action: 'subscribe',
    subscription: subscription.toJSON(),
    topics,
    userAgent: navigator.userAgent,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'
  })
  return subscription
}

export async function disablePush(familyId: string) {
  if (!supportsPush()) return
  const subscription = await currentSubscription()
  if (!subscription) return
  await invokePush(familyId, { action: 'unsubscribe', endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

export async function syncPushTopics(familyId: string, topics: PushTopics) {
  if (!supportsPush()) return
  const subscription = await currentSubscription()
  if (!subscription) return
  await invokePush(familyId, { action: 'preferences', topics })
}

export async function sendPushTest(familyId: string) {
  if (!supportsPush()) throw new Error('Notifiche push non supportate.')
  const subscription = await currentSubscription()
  if (!subscription) throw new Error('Attiva prima le notifiche push su questo dispositivo.')
  return invokePush(familyId, { action: 'test', endpoint: subscription.endpoint })
}

export async function notifyFamilyPush(familyId: string, categories: Array<keyof PushTopics>) {
  if (!categories.length || !supabase) return
  try {
    await invokePush(familyId, { action: 'notify-family', categories })
  } catch (error) {
    console.warn('Push famiglia non inviata:', error)
  }
}
