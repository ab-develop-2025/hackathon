import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.yauga.app',
  appName: 'Yauga',
  webDir: 'dist',
  // Direct Yauga Ring BLE only. Do not link Health Connect back in.
  // `@capacitor/app` required for NFC Universal Link / custom-scheme open handling.
  // `@yaugahaus/yauga-solana-mwa` bridges Solana Mobile Wallet Adapter on Android.
  includePlugins: ['@yaugahaus/yauga-ring', '@yaugahaus/yauga-solana-mwa', '@capacitor/app'],
  server: {
    androidScheme: 'https',
    // iOS keeps the default capacitor:// origin (already allowed on edge functions).
  },
}

export default config
