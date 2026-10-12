import type { YaugaSolanaMwaPlugin } from './definitions'

export class YaugaSolanaMwaWeb implements YaugaSolanaMwaPlugin {
  async isAvailable(): Promise<{ available: boolean }> {
    return { available: false }
  }

  async launchWalletUri(): Promise<{ launched: boolean }> {
    throw new Error('Mobile Wallet Adapter is only available in the Android app')
  }
}
