import './solanaBuffer'
import { PublicKey } from '@solana/web3.js'
import { authApi } from './auth'
import { supabase } from './supabase'

export type TokenQuote = {
  cost: number
  eligible: boolean
  canConvert: boolean
  remainder: number
  maxTokens: number
}

/** Whole tokens only. Eligible once balance reaches minPoints. */
export function conversionQuote(
  balance: number,
  tokens: number,
  pointsPerToken: number,
  minPoints: number,
): TokenQuote {
  const rate = Number.isFinite(pointsPerToken) && pointsPerToken > 0 ? Math.floor(pointsPerToken) : 0
  const min = Number.isFinite(minPoints) && minPoints > 0 ? Math.floor(minPoints) : 500
  const safeBalance = Number.isFinite(balance) ? Math.floor(balance) : 0
  const whole = Number.isFinite(tokens) ? Math.floor(tokens) : 0
  const maxTokens = rate > 0 ? Math.floor(safeBalance / rate) : 0
  const cost = whole > 0 && rate > 0 ? whole * rate : 0
  const eligible = safeBalance >= min && rate > 0
  const canConvert = eligible && whole >= 1 && whole <= maxTokens && cost <= safeBalance
  return {
    cost,
    eligible,
    canConvert,
    remainder: safeBalance - (canConvert ? cost : 0),
    maxTokens,
  }
}

export type YaugaTokenPublicSettings = {
  enabled: boolean
  pointsPerToken: number
  minPoints: number
  mintAddress: string
  network: 'devnet'
}

export async function getYaugaTokenSettings(): Promise<YaugaTokenPublicSettings> {
  const keys = [
    'yauga_token_enabled',
    'yauga_token_points_per_token',
    'yauga_token_min_points',
    'yauga_token_mint_address',
    'yauga_token_network',
  ]
  const { data, error } = await supabase.from('settings').select('key, value').in('key', keys)
  if (error) throw error
  const map = new Map((data || []).map((row: { key: string; value: string }) => [row.key, row.value]))
  const network = map.get('yauga_token_network')
  return {
    enabled: map.get('yauga_token_enabled') === 'true',
    pointsPerToken: Number(map.get('yauga_token_points_per_token') || 100),
    minPoints: Number(map.get('yauga_token_min_points') || 500),
    mintAddress: (map.get('yauga_token_mint_address') || '').trim(),
    network: network === 'devnet' || !network ? 'devnet' : 'devnet',
  }
}

async function tokenFunction(body: Record<string, unknown>) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase configuration is missing.')
  const session = await authApi.getSessionWithRefresh()
  if (!session?.access_token) throw new Error('Not authenticated')
  const response = await fetch(`${supabaseUrl}/functions/v1/yauga-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: { error?: string; signature?: string; status?: string; tokens?: number; treasuryPublic?: string; mintAddress?: string; metadataUri?: string; solanaWallet?: string } = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(text || 'Token request failed')
  }
  if (!response.ok) {
    const err = new Error(payload.error || 'Token request failed') as Error & { signature?: string; status?: string }
    err.signature = payload.signature
    err.status = payload.status
    throw err
  }
  return payload
}

export function yaugaTokenAdminStatus() {
  return tokenFunction({ action: 'status' })
}

export function generateTreasury() {
  return tokenFunction({ action: 'generate-treasury' })
}

export function storeTreasury(secretKey: string) {
  return tokenFunction({ action: 'store-treasury', secretKey })
}

export function createYaugaToken(input: { name: string; symbol: string; description: string; imageUrl: string }) {
  return tokenFunction({ action: 'create-token', ...input })
}

export function resetYaugaToken() {
  return tokenFunction({ action: 'reset-token', confirm: true })
}

export function linkSolanaWallet(publicKey: string, signature: string) {
  return tokenFunction({ action: 'link-wallet', publicKey, signature })
}

const YAUGA_MWA_IDENTITY = {
  name: 'Yauga',
  uri: 'https://www.yauga.com',
  // MWA requires a path relative to identity.uri (not an absolute URL).
  icon: '/Yauga.png',
} as const

function mwaAccountToPublicKey(account: { address: string; publicKey?: Uint8Array | ArrayBuffer | number[] }) {
  if (account.publicKey) {
    const bytes =
      account.publicKey instanceof Uint8Array
        ? account.publicKey
        : new Uint8Array(account.publicKey as ArrayLike<number>)
    return new PublicKey(bytes)
  }
  try {
    return new PublicKey(account.address)
  } catch {
    const bytes = Uint8Array.from(atob(account.address), (c) => c.charCodeAt(0))
    return new PublicKey(bytes)
  }
}

function extractEd25519Signature(signedPayload: Uint8Array, message: Uint8Array): Uint8Array {
  if (signedPayload.length === 64) return signedPayload
  if (signedPayload.length === message.length + 64) return signedPayload.slice(message.length)
  if (signedPayload.length > 64) return signedPayload.slice(-64)
  throw new Error('Wallet returned an unexpected signature')
}

/**
 * Android Mobile Wallet Adapter: authorize + sign the link message in one session.
 * Calling connect() then signMessage() separately is blocked after the wallet returns.
 */
export async function linkSolanaWalletViaMobileAdapter(userId: string): Promise<string> {
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js')
  const message = new TextEncoder().encode(`Yauga wallet link\n${userId}`)

  const { publicKey, signature } = await transact(async (wallet) => {
    const auth = await wallet.authorize({
      chain: 'solana:devnet',
      identity: YAUGA_MWA_IDENTITY,
    })
    const account = auth.accounts[0] as { address: string; publicKey?: Uint8Array } | undefined
    if (!account) throw new Error('Wallet did not return an address')

    const pk = mwaAccountToPublicKey(account)
    const signedPayloads = await wallet.signMessages({
      addresses: [account.address],
      payloads: [message],
    })
    const signed = signedPayloads[0]
    if (!signed) throw new Error('Wallet did not sign the link message')
    return { publicKey: pk.toBase58(), signature: extractEd25519Signature(signed, message) }
  })

  await linkSolanaWallet(publicKey, bytesToBase64(signature))
  return publicKey
}

export function settleTokenConversion(conversionId: string) {
  return tokenFunction({ action: 'convert', conversionId })
}

export async function beginTokenConversion(tokens: number) {
  const { data, error } = await supabase.rpc('begin_token_conversion', { p_tokens: tokens })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function disconnectSolanaWallet(userId: string) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ solana_wallet: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
