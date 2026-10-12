import { registerPlugin } from '@capacitor/core'
import type { YaugaSolanaMwaPlugin } from './definitions'

const YaugaSolanaMwa = registerPlugin<YaugaSolanaMwaPlugin>('YaugaSolanaMwa', {
  web: () => import('./web').then((m) => new m.YaugaSolanaMwaWeb()),
})

export * from './definitions'
export { YaugaSolanaMwa }
