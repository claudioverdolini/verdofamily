export type BackgroundPresetId =
  | 'none'
  | 'color'
  | 'aurora'
  | 'sky'
  | 'sand'
  | 'forest'
  | 'sunset'
  | 'night'
  | 'lavender'
  | 'custom'

export const BACKGROUND_PRESETS: Array<{
  id: Exclude<BackgroundPresetId, 'custom' | 'color'>
  name: string
  subtitle: string
  css: string
}> = [
  {
    id: 'none',
    name: 'Nessuno',
    subtitle: 'Sfondo pulito',
    css: 'none'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    subtitle: 'Azzurro, verde e viola',
    css: 'radial-gradient(circle at 18% 20%, rgba(34,197,94,.34), transparent 30%), radial-gradient(circle at 82% 15%, rgba(59,130,246,.30), transparent 34%), radial-gradient(circle at 68% 78%, rgba(168,85,247,.26), transparent 36%), linear-gradient(135deg, #eafcf2 0%, #eef7ff 46%, #f7efff 100%)'
  },
  {
    id: 'sky',
    name: 'Cielo',
    subtitle: 'Blu luminoso e morbido',
    css: 'radial-gradient(circle at 72% 18%, rgba(255,255,255,.88), transparent 21%), radial-gradient(circle at 18% 70%, rgba(125,211,252,.34), transparent 30%), linear-gradient(160deg, #dff4ff 0%, #eff8ff 42%, #dbeafe 100%)'
  },
  {
    id: 'sand',
    name: 'Sabbia',
    subtitle: 'Caldo e naturale',
    css: 'radial-gradient(circle at 22% 25%, rgba(251,191,36,.20), transparent 28%), radial-gradient(circle at 78% 72%, rgba(234,88,12,.12), transparent 32%), linear-gradient(145deg, #fff8eb 0%, #f7eddc 48%, #f3e4cd 100%)'
  },
  {
    id: 'forest',
    name: 'Bosco',
    subtitle: 'Verde profondo e salvia',
    css: 'radial-gradient(circle at 20% 18%, rgba(187,247,208,.18), transparent 28%), radial-gradient(circle at 78% 72%, rgba(16,185,129,.16), transparent 34%), linear-gradient(145deg, #173b32 0%, #244c3e 48%, #315d4e 100%)'
  },
  {
    id: 'sunset',
    name: 'Tramonto',
    subtitle: 'Corallo, pesca e rosa',
    css: 'radial-gradient(circle at 18% 22%, rgba(251,146,60,.30), transparent 30%), radial-gradient(circle at 80% 28%, rgba(244,63,94,.22), transparent 32%), linear-gradient(145deg, #fff0e5 0%, #ffe6e9 52%, #f8e8f3 100%)'
  },
  {
    id: 'night',
    name: 'Notte',
    subtitle: 'Blu scuro e indaco',
    css: 'radial-gradient(circle at 18% 16%, rgba(99,102,241,.28), transparent 26%), radial-gradient(circle at 78% 18%, rgba(14,165,233,.18), transparent 28%), radial-gradient(circle at 50% 84%, rgba(168,85,247,.16), transparent 30%), linear-gradient(150deg, #0f172a 0%, #172554 46%, #1e1b4b 100%)'
  },
  {
    id: 'lavender',
    name: 'Lavanda',
    subtitle: 'Lilla e rosa cipria',
    css: 'radial-gradient(circle at 20% 30%, rgba(196,181,253,.34), transparent 30%), radial-gradient(circle at 80% 24%, rgba(251,207,232,.30), transparent 32%), linear-gradient(145deg, #f6f0ff 0%, #fff4fb 48%, #f0efff 100%)'
  }
]

export function backgroundCssForPreset(id?: string) {
  return BACKGROUND_PRESETS.find(item => item.id === id)?.css || 'none'
}
