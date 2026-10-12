/**
 * Yauga Token on Solana devnet.
 * Actions: status | generate-treasury | store-treasury | create-token | reset-token | link-wallet | convert
 * The treasury secret never leaves this function.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from 'npm:@solana/web3.js@1.98.0'
import {
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from 'npm:@solana/spl-token@0.4.13'
import nacl from 'npm:tweetnacl@1.0.3'
import { Buffer } from 'node:buffer'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const DEVNET = 'https://api.devnet.solana.com'
const TOKEN_DECIMALS = 9
const MAX_WHOLE_TOKENS = 10_000_000_000n

function rawUnits(wholeTokens: bigint, decimals: number): bigint {
  return wholeTokens * (10n ** BigInt(decimals))
}

/** Whole-token amount as a locale-friendly string (no floating precision loss). */
function formatWholeTokens(raw: bigint, decimals: number): string {
  const whole = raw / (10n ** BigInt(decimals))
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function normalizeNetwork(value: string | undefined): 'devnet' | 'mainnet' {
  const n = (value || 'devnet').trim().toLowerCase()
  if (n === 'mainnet' || n === 'mainnet-beta') return 'mainnet'
  return 'devnet'
}
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const FRONTEND_URL = Deno.env.get('FRONTEND_URL')

function getCorsHeaders(origin: string | null) {
  const normalize = (v: string) => v.trim().toLowerCase().replace(/\/+$/, '')
  const defaults = [
    ...(FRONTEND_URL ? [FRONTEND_URL] : []),
    'http://localhost:3000',
    'http://localhost:5173',
    'capacitor://localhost',
    'https://localhost',
  ]
  const envAllow = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allowedOrigins = Array.from(new Set([...defaults, ...envAllow].map(normalize))).filter(Boolean)
  const normalizedOrigin = origin ? normalize(origin) : null
  const isAllowed = !!normalizedOrigin && allowedOrigins.includes(normalizedOrigin)
  const allowOrigin = origin ? (isAllowed ? origin : 'null') : (defaults[0] || 'null')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function encodeBs58(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const digits = [0]
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = ''
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) out += '1'
  for (let q = digits.length - 1; q >= 0; q--) out += BASE58_ALPHABET[digits[q]]
  return out
}

function decodeBs58(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array()
  const bytes = [0]
  for (let i = 0; i < value.length; i++) {
    const index = BASE58_ALPHABET.indexOf(value[i])
    if (index < 0) throw new Error('Invalid base58 secret key')
    let carry = index
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (let k = 0; value[k] === '1' && k < value.length - 1; k++) bytes.push(0)
  return Uint8Array.from(bytes.reverse())
}

async function setting(admin: SupabaseClient, key: string): Promise<string> {
  const { data } = await admin.from('settings').select('value').eq('key', key).maybeSingle()
  return String(data?.value ?? '')
}

async function putSetting(admin: SupabaseClient, key: string, value: string, email: string | null) {
  const { error } = await admin
    .from('settings')
    .upsert({ key, value, updated_by: email, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

async function requireUser(admin: SupabaseClient, req: Request) {
  const header = req.headers.get('Authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('Not authenticated')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new Error('Session expired')
  return data.user
}

async function requireAdmin(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from('user_profiles')
    .select('is_admin')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.is_admin) throw new Error('Admin only')
}

async function loadTreasury(admin: SupabaseClient): Promise<Keypair | null> {
  const { data, error } = await admin.from('yauga_token_secrets').select('secret_key, public_key').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.secret_key) return null
  const secret = decodeBs58(String(data.secret_key))
  if (secret.length !== 64) throw new Error('Stored treasury key is invalid')
  return Keypair.fromSecretKey(secret)
}

async function saveTreasury(admin: SupabaseClient, kp: Keypair) {
  const secret = encodeBs58(kp.secretKey)
  const { error } = await admin.from('yauga_token_secrets').upsert({
    id: 1,
    secret_key: secret,
    public_key: kp.publicKey.toBase58(),
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  await putSetting(admin, 'yauga_token_treasury_public', kp.publicKey.toBase58(), null)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s)
  return concatBytes([u32(bytes.length), bytes])
}

/** Metaplex CreateMetadataAccountV3 (instruction 33), DataV2, no creators. */
function createMetadataInstruction(mint: PublicKey, payer: PublicKey, name: string, symbol: string, uri: string) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )
  const data = concatBytes([
    new Uint8Array([33]),
    borshString(name),
    borshString(symbol),
    borshString(uri),
    u16(0),
    new Uint8Array([0]), // creators none
    new Uint8Array([0]), // collection none
    new Uint8Array([0]), // uses none
    new Uint8Array([1]), // is mutable
    new Uint8Array([0]), // collection details none
  ])
  return {
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_METADATA_PROGRAM_ID,
    data: Buffer.from(data),
  }
}

async function publicStatus(admin: SupabaseClient) {
  const keys = [
    'yauga_token_enabled',
    'yauga_token_network',
    'yauga_token_points_per_token',
    'yauga_token_min_points',
    'yauga_token_mint_address',
    'yauga_token_treasury_public',
    'yauga_token_name',
    'yauga_token_symbol',
    'yauga_token_description',
    'yauga_token_image_url',
    'yauga_token_metadata_uri',
  ]
  const { data, error } = await admin.from('settings').select('key, value').in('key', keys)
  if (error) throw new Error(error.message)
  const map = new Map((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const treasury = await loadTreasury(admin).catch(() => null)
  let solBalance = 0
  const treasuryPublic = map.get('yauga_token_treasury_public') || treasury?.publicKey.toBase58() || ''
  const mintAddress = map.get('yauga_token_mint_address') || ''
  const network = normalizeNetwork(map.get('yauga_token_network'))
  // Phase 1 RPC is always Devnet; network label still reflects the stored setting.
  const connection = new Connection(DEVNET, 'confirmed')
  if (treasuryPublic) {
    try {
      solBalance = await connection.getBalance(new PublicKey(treasuryPublic))
    } catch {
      solBalance = 0
    }
  }

  let decimals = TOKEN_DECIMALS
  let supplyFormatted: string | null = null
  let remainingFormatted: string | null = null
  let treasuryAtaFormatted: string | null = null
  let maxSupplyFormatted = formatWholeTokens(rawUnits(MAX_WHOLE_TOKENS, TOKEN_DECIMALS), TOKEN_DECIMALS)
  if (mintAddress) {
    try {
      const mintPk = new PublicKey(mintAddress)
      const mintInfo = await getMint(connection, mintPk)
      decimals = mintInfo.decimals
      const maxRaw = rawUnits(MAX_WHOLE_TOKENS, decimals)
      maxSupplyFormatted = formatWholeTokens(maxRaw, decimals)
      supplyFormatted = formatWholeTokens(mintInfo.supply, decimals)
      // Mint-on-demand: "in treasury" = remaining mintable under the cap (not an ATA balance).
      const remainingRaw = maxRaw > mintInfo.supply ? maxRaw - mintInfo.supply : 0n
      remainingFormatted = formatWholeTokens(remainingRaw, decimals)
      if (treasuryPublic) {
        try {
          const ata = await getAssociatedTokenAddress(mintPk, new PublicKey(treasuryPublic))
          const acct = await getAccount(connection, ata)
          treasuryAtaFormatted = formatWholeTokens(acct.amount, decimals)
        } catch {
          treasuryAtaFormatted = '0'
        }
      }
    } catch {
      supplyFormatted = null
      remainingFormatted = null
      treasuryAtaFormatted = null
    }
  }

  return {
    enabled: map.get('yauga_token_enabled') === 'true',
    chain: 'Solana',
    network,
    networkLabel: network === 'mainnet' ? 'Mainnet' : 'Devnet',
    pointsPerToken: Number(map.get('yauga_token_points_per_token') || 100),
    minPoints: Number(map.get('yauga_token_min_points') || 500),
    mintAddress,
    treasuryPublic,
    treasuryConfigured: !!treasury,
    solLamports: solBalance,
    name: map.get('yauga_token_name') || 'Yauga',
    symbol: map.get('yauga_token_symbol') || 'YAUGA',
    description: map.get('yauga_token_description') || '',
    imageUrl: map.get('yauga_token_image_url') || '',
    metadataUri: map.get('yauga_token_metadata_uri') || '',
    decimals,
    maxSupply: maxSupplyFormatted,
    supply: supplyFormatted,
    /** Remaining mintable whole tokens (max − minted). Shown as “In treasury”. */
    treasuryTokenBalance: remainingFormatted,
    treasuryAtaBalance: treasuryAtaFormatted,
  }
}

serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server is missing Supabase credentials' }, 500, cors)
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const user = await requireUser(admin, req)

    if (action === 'status') {
      await requireAdmin(admin, user.id)
      return json(await publicStatus(admin), 200, cors)
    }

    if (action === 'generate-treasury' || action === 'store-treasury') {
      await requireAdmin(admin, user.id)
      const network = await setting(admin, 'yauga_token_network')
      if (network && network !== 'devnet') return json({ error: 'Phase 1 is devnet only' }, 400, cors)
      const existingMint = (await setting(admin, 'yauga_token_mint_address')).trim()
      if (existingMint) return json({ error: 'A token already exists. The treasury key cannot be replaced.' }, 400, cors)
      let kp: Keypair
      if (action === 'generate-treasury') {
        kp = Keypair.generate()
      } else {
        const raw = String(body.secretKey || '').trim()
        const secret = decodeBs58(raw)
        if (secret.length !== 64) return json({ error: 'Paste the base58 secret key (64 bytes).' }, 400, cors)
        kp = Keypair.fromSecretKey(secret)
      }
      await saveTreasury(admin, kp)
      return json({ treasuryPublic: kp.publicKey.toBase58(), network: 'devnet' }, 200, cors)
    }

    if (action === 'reset-token') {
      await requireAdmin(admin, user.id)
      const network = (await setting(admin, 'yauga_token_network')).trim() || 'devnet'
      if (network !== 'devnet') return json({ error: 'Reset is only available on devnet' }, 400, cors)
      if (body.confirm !== true) return json({ error: 'Confirm the reset before clearing the devnet token' }, 400, cors)
      const previousMint = (await setting(admin, 'yauga_token_mint_address')).trim()
      if (!previousMint) return json({ error: 'No token is stored' }, 400, cors)

      const { data: openRows, error: openError } = await admin
        .from('token_conversions')
        .select('id, status')
        .in('status', ['pending', 'sending'])
      if (openError) return json({ error: openError.message }, 400, cors)
      let refunded = 0
      for (const row of openRows || []) {
        const { error } = await admin.rpc('fail_token_conversion', {
          p_id: row.id,
          p_error: 'Devnet token reset before the transfer was sent',
        })
        if (error) return json({ error: error.message }, 400, cors)
        refunded += 1
      }

      const email = user.email || null
      await putSetting(admin, 'yauga_token_mint_address', '', email)
      await putSetting(admin, 'yauga_token_metadata_uri', '', email)
      await putSetting(admin, 'yauga_token_enabled', 'false', email)
      return json({
        reset: true,
        previousMint,
        refunded,
        network: 'devnet',
      }, 200, cors)
    }

    if (action === 'create-token') {
      await requireAdmin(admin, user.id)
      const network = (await setting(admin, 'yauga_token_network')).trim() || 'devnet'
      if (network !== 'devnet') return json({ error: 'Phase 1 is devnet only' }, 400, cors)
      const existingMint = (await setting(admin, 'yauga_token_mint_address')).trim()
      if (existingMint) return json({ error: 'Token already created', mintAddress: existingMint }, 400, cors)
      const treasury = await loadTreasury(admin)
      if (!treasury) return json({ error: 'Generate or save a treasury wallet first' }, 400, cors)

      const name = String(body.name || 'Yauga').trim()
      const symbol = String(body.symbol || 'YAUGA').trim().toUpperCase()
      const description = String(body.description || '').trim()
      const imageUrl = String(body.imageUrl || '').trim()
      if (!name || name.length > 32) return json({ error: 'Name is required and must be 32 characters or fewer' }, 400, cors)
      if (!symbol || symbol.length > 10) return json({ error: 'Symbol is required and must be 10 characters or fewer' }, 400, cors)
      if (!imageUrl.startsWith('https://')) return json({ error: 'Image URL must start with https://' }, 400, cors)

      const metadata = {
        name,
        symbol,
        description: description || `${name} loyalty token. Devnet only.`,
        image: imageUrl,
        external_url: 'https://www.yauga.com',
        attributes: [{ trait_type: 'network', value: 'devnet' }],
      }
      const fileBody = JSON.stringify(metadata)
      const { error: uploadError } = await admin.storage.from('token-metadata').upload('yauga.json', fileBody, {
        contentType: 'application/json',
        upsert: true,
      })
      if (uploadError) return json({ error: `Metadata upload failed: ${uploadError.message}` }, 500, cors)
      const { data: pub } = admin.storage.from('token-metadata').getPublicUrl('yauga.json')
      const uri = pub.publicUrl
      if (uri.length > 200) {
        return json({ error: `Metadata URL is ${uri.length} characters. Metaplex allows 200.` }, 400, cors)
      }

      const connection = new Connection(DEVNET, 'confirmed')
      const balance = await connection.getBalance(treasury.publicKey)
      if (balance < 20_000_000) {
        return json({
          error: `Treasury needs at least 0.02 SOL on devnet for fees. It has ${balance / 1_000_000_000} SOL. Fund ${treasury.publicKey.toBase58()} at https://faucet.solana.com`,
        }, 400, cors)
      }

      const mint = await createMint(connection, treasury, treasury.publicKey, null, TOKEN_DECIMALS)
      const ix = createMetadataInstruction(mint, treasury.publicKey, name, symbol, uri)
      const tx = new Transaction().add(new TransactionInstruction(ix))
      await sendAndConfirmTransaction(connection, tx, [treasury])

      const email = user.email || null
      await putSetting(admin, 'yauga_token_mint_address', mint.toBase58(), email)
      await putSetting(admin, 'yauga_token_name', name, email)
      await putSetting(admin, 'yauga_token_symbol', symbol, email)
      await putSetting(admin, 'yauga_token_description', metadata.description, email)
      await putSetting(admin, 'yauga_token_image_url', imageUrl, email)
      await putSetting(admin, 'yauga_token_metadata_uri', uri, email)
      await putSetting(admin, 'yauga_token_network', 'devnet', email)

      return json({
        mintAddress: mint.toBase58(),
        metadataUri: uri,
        treasuryPublic: treasury.publicKey.toBase58(),
        network: 'devnet',
      }, 200, cors)
    }

    if (action === 'link-wallet') {
      const publicKey = String(body.publicKey || '').trim()
      const signatureB64 = String(body.signature || '').trim()
      let owner: PublicKey
      try {
        owner = new PublicKey(publicKey)
      } catch {
        return json({ error: 'That is not a Solana address' }, 400, cors)
      }
      const message = new TextEncoder().encode(`Yauga wallet link\n${user.id}`)
      let sig: Uint8Array
      try {
        sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0))
      } catch {
        return json({ error: 'Signature could not be read' }, 400, cors)
      }
      const ok = nacl.sign.detached.verify(message, sig, owner.toBytes())
      if (!ok) return json({ error: 'Wallet signature did not match this account' }, 400, cors)
      const { error } = await admin
        .from('user_profiles')
        .update({ solana_wallet: owner.toBase58(), updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
      if (error) return json({ error: error.message }, 400, cors)
      return json({ solanaWallet: owner.toBase58(), network: 'devnet' }, 200, cors)
    }

    if (action === 'convert') {
      const conversionId = String(body.conversionId || '').trim()
      if (!conversionId) return json({ error: 'Missing conversion' }, 400, cors)
      const network = (await setting(admin, 'yauga_token_network')).trim() || 'devnet'
      if (network !== 'devnet') return json({ error: 'Yauga Token is devnet only' }, 400, cors)

      const claim = await admin.rpc('claim_token_conversion', { p_id: conversionId, p_user_id: user.id })
      if (claim.error) return json({ error: claim.error.message }, 400, cors)
      const claimed = Boolean((claim.data as { claimed?: boolean })?.claimed)
      const row = (claim.data as { row?: Record<string, unknown> | null })?.row
      if (!row) return json({ error: 'Conversion not found' }, 404, cors)

      const status = String(row.status || '')
      const signature = row.signature ? String(row.signature) : ''
      if (status === 'confirmed' && signature) {
        return json({ status: 'confirmed', signature, tokens: row.tokens }, 200, cors)
      }
      if (status === 'failed') {
        return json({ error: String(row.error || 'Conversion failed'), status: 'failed' }, 400, cors)
      }
      if (!claimed && status === 'sending' && !signature) {
        return json({ error: 'Transfer already in progress. Wait a moment and retry.', status: 'sending' }, 409, cors)
      }
      if (status === 'submitted' && signature) {
        const connection = new Connection(DEVNET, 'confirmed')
        const info = await connection.getSignatureStatus(signature)
        const conf = info.value?.confirmationStatus
        if (conf === 'confirmed' || conf === 'finalized') {
          await admin.rpc('complete_token_conversion', { p_id: conversionId, p_signature: signature })
          return json({ status: 'confirmed', signature, tokens: row.tokens }, 200, cors)
        }
        if (info.value?.err) {
          return json({ error: 'The Solana transaction failed. An admin needs to reconcile this conversion.', signature }, 400, cors)
        }
        return json({ error: 'Waiting for Solana to confirm. Retry in a few seconds.', signature, status: 'submitted' }, 409, cors)
      }

      const treasury = await loadTreasury(admin)
      if (!treasury) {
        await admin.rpc('fail_token_conversion', { p_id: conversionId, p_error: 'Treasury is not configured' })
        return json({ error: 'Treasury is not configured. Points were returned.' }, 400, cors)
      }
      const mintPk = new PublicKey(String(row.mint_address))
      const dest = new PublicKey(String(row.destination))
      const amount = BigInt(Number(row.tokens))
      try {
        const connection = new Connection(DEVNET, 'confirmed')
        const mintInfo = await getMint(connection, mintPk)
        const raw = rawUnits(amount, mintInfo.decimals)
        const cap = rawUnits(MAX_WHOLE_TOKENS, mintInfo.decimals)
        if (mintInfo.supply + raw > cap) {
          await admin.rpc('fail_token_conversion', { p_id: conversionId, p_error: 'Yauga Token supply cap reached' })
          return json({ error: 'Yauga Token supply is capped at 10,000,000,000. Points were returned.' }, 400, cors)
        }
        const ata = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, dest)
        const sig = await mintTo(connection, treasury, mintPk, ata.address, treasury, raw)
        await admin.rpc('mark_token_conversion_submitted', { p_id: conversionId, p_signature: sig })
        await admin.rpc('complete_token_conversion', { p_id: conversionId, p_signature: sig })
        return json({ status: 'confirmed', signature: sig, tokens: row.tokens }, 200, cors)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transfer failed'
        await admin.rpc('fail_token_conversion', { p_id: conversionId, p_error: message })
        return json({ error: `${message} Points were returned.` }, 400, cors)
      }
    }

    return json({ error: 'Unknown action' }, 400, cors)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed'
    const status = message === 'Not authenticated' || message === 'Session expired' ? 401 : message === 'Admin only' ? 403 : 400
    return json({ error: message }, status, cors)
  }
})
