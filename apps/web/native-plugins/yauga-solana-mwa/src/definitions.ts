export interface YaugaSolanaMwaPlugin {
  /** True when an MWA-compatible wallet app is installed (Android only). */
  isAvailable(): Promise<{ available: boolean }>
  /** Launch a solana-wallet:// association URI via Android intent. */
  launchWalletUri(options: { uri: string }): Promise<{ launched: boolean }>
}
