import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { settingsApi } from '../lib/api'
import {
  createYaugaToken,
  generateTreasury,
  resetYaugaToken,
  storeTreasury,
  yaugaTokenAdminStatus,
} from '../lib/yaugaToken'

const inputClass =
  'mt-1 w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-sm text-white'

export default function AdminYaugaTokenPanel() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('Yauga')
  const [symbol, setSymbol] = useState('YAUGA')
  const [description, setDescription] = useState('Yauga loyalty token. Devnet only.')
  const [imageUrl, setImageUrl] = useState('https://www.yauga.com/yauga_logo_black.png')
  const [secretKey, setSecretKey] = useState('')
  const [pointsPerToken, setPointsPerToken] = useState('100')
  const [minPoints, setMinPoints] = useState('500')
  const [showSecret, setShowSecret] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [treasuryOpen, setTreasuryOpen] = useState(false)
  const [exchangeOpen, setExchangeOpen] = useState(false)

  const status = useQuery({
    queryKey: ['yauga-token-status'],
    queryFn: () => yaugaTokenAdminStatus(),
  })

  const enabledSetting = useQuery({
    queryKey: ['setting', 'yauga_token_enabled'],
    queryFn: () => settingsApi.get('yauga_token_enabled').catch(() => null),
  })

  const enabled = enabledSetting.data?.value === 'true'

  const seeded = useRef(false)
  useEffect(() => {
    const row = status.data as { pointsPerToken?: number; minPoints?: number; name?: string; symbol?: string; description?: string; imageUrl?: string } | undefined
    if (!row || seeded.current) return
    seeded.current = true
    if (row.pointsPerToken) setPointsPerToken(String(row.pointsPerToken))
    if (row.minPoints) setMinPoints(String(row.minPoints))
    if (row.name) setName(row.name)
    if (row.symbol) setSymbol(row.symbol)
    if (row.description) setDescription(row.description)
    if (row.imageUrl) setImageUrl(row.imageUrl)
  }, [status.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['yauga-token-status'] })
    queryClient.invalidateQueries({ queryKey: ['setting', 'yauga_token_enabled'] })
  }

  const toggle = useMutation({
    mutationFn: (next: boolean) => settingsApi.update('yauga_token_enabled', next ? 'true' : 'false'),
    onSuccess: () => {
      toast.success('Yauga Token updated')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not update the switch'),
  })

  const saveRate = useMutation({
    mutationFn: async () => {
      const rate = Math.floor(Number(pointsPerToken))
      const min = Math.floor(Number(minPoints))
      if (!Number.isFinite(rate) || rate < 1) throw new Error('Points per token must be a whole number above 0')
      if (!Number.isFinite(min) || min < 1) throw new Error('Minimum points must be a whole number above 0')
      await settingsApi.update('yauga_token_points_per_token', String(rate))
      await settingsApi.update('yauga_token_min_points', String(min))
    },
    onSuccess: () => {
      toast.success('Exchange rate saved')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save the rate'),
  })

  const generate = useMutation({
    mutationFn: () => generateTreasury(),
    onSuccess: () => {
      toast.success('Treasury wallet created. Fund it with devnet SOL before creating the token.')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create a treasury'),
  })

  const saveKey = useMutation({
    mutationFn: () => storeTreasury(secretKey.trim()),
    onSuccess: () => {
      setSecretKey('')
      setShowSecret(false)
      toast.success('Treasury key stored. It will not be shown again.')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not store the key'),
  })

  const create = useMutation({
    mutationFn: () => createYaugaToken({ name, symbol, description, imageUrl }),
    onSuccess: () => {
      toast.success('Devnet token created')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create the token'),
  })

  const reset = useMutation({
    mutationFn: () => resetYaugaToken(),
    onSuccess: () => {
      toast.success('Devnet token cleared. You can create another.')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not reset the token'),
  })

  const data = status.data as {
    treasuryPublic?: string
    treasuryConfigured?: boolean
    mintAddress?: string
    metadataUri?: string
    solLamports?: number
    pointsPerToken?: number
    minPoints?: number
    name?: string
    symbol?: string
    chain?: string
    network?: string
    networkLabel?: string
    supply?: string | null
    maxSupply?: string
    treasuryTokenBalance?: string | null
    decimals?: number
  } | undefined

  const sol = data?.solLamports != null ? (data.solLamports / 1_000_000_000).toFixed(4) : '—'
  const networkLabel = data?.networkLabel || (data?.network === 'mainnet' ? 'Mainnet' : 'Devnet')

  return (
    <div className="space-y-6">
      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">Yauga Token</h2>
            <p className="text-sm text-white/55 mt-1">Phase 1 uses Solana devnet only. Mainnet is not available here.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => toggle.mutate(e.target.checked)}
              className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
            />
            <span className="text-sm text-white/80">{enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        {status.isError && (
          <p className="text-sm text-red-300 mt-4">{(status.error as Error).message}</p>
        )}
      </div>

      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-white">Status</h3>
          <button
            type="button"
            className="btn-haus-ghost rounded-lg px-3 py-1.5 text-sm text-white/80 disabled:opacity-50"
            disabled={status.isFetching}
            onClick={() => refresh()}
          >
            {status.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-white/[0.1] bg-black/30 p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-white/45">Tokenomics</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-white/55">Symbol</dt>
                <dd className="font-medium text-white">{data?.symbol || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/55">Quantity minted</dt>
                <dd className="font-medium text-white tabular-nums">
                  {data?.mintAddress ? (data.supply ?? '—') : 'Not created'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/55">In treasury</dt>
                <dd className="font-medium text-white tabular-nums">
                  {data?.mintAddress ? (data.treasuryTokenBalance ?? '—') : '—'}
                </dd>
              </div>
              {data?.maxSupply && (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/55">Max supply</dt>
                  <dd className="text-white/70 tabular-nums">{data.maxSupply}</dd>
                </div>
              )}
            </dl>
            {data?.mintAddress && (
              <p className="text-xs text-white/40 pt-1">
                In treasury is remaining mintable supply. Tokens are minted to members on convert, not held in a wallet balance.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-white/[0.1] bg-black/30 p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-white/45">Chain</p>
            <p className="text-lg font-semibold text-white">{data?.chain || 'Solana'}</p>
            <p className="text-sm text-white/55 break-all">
              {data?.mintAddress ? `Mint ${data.mintAddress}` : 'No mint yet'}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.1] bg-black/30 p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-white/45">Network</p>
            <p className="text-lg font-semibold text-white">{networkLabel}</p>
            <p className="text-sm text-white/55">
              {networkLabel === 'Mainnet'
                ? 'Live Solana mainnet (not available in phase 1).'
                : 'Solana Devnet for testing.'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] space-y-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left font-medium text-white"
          onClick={() => setInstructionsOpen((v) => !v)}
          aria-expanded={instructionsOpen}
        >
          <span>Token creation instructions</span>
          <span className="text-sm font-normal text-white/50">{instructionsOpen ? 'Hide' : 'Show'}</span>
        </button>
        {instructionsOpen && (
          <>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-white/70">
              <li>Leave the network on devnet. This screen cannot create a mainnet token.</li>
              <li>Generate a treasury, or paste an existing devnet secret key once. The key is stored for the server and is not shown again.</li>
              <li>
                Fund the treasury public address with devnet SOL (at least 0.02). Use{' '}
                <a className="underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  faucet.solana.com
                </a>
                . Select Devnet, paste the address, and request SOL.
              </li>
              <li>
                Set the metadata. Name (max 32), symbol (max 10), description, and an https image. Create token uploads
                this JSON and writes it on the mint:
              </li>
            </ol>
            <pre className="text-xs text-white/70 overflow-x-auto rounded-lg bg-black/40 p-3">{`{
  "name": "Yauga",
  "symbol": "YAUGA",
  "description": "Yauga loyalty token. Devnet only.",
  "image": "https://www.yauga.com/yauga_logo_black.png",
  "external_url": "https://www.yauga.com",
  "attributes": [{ "trait_type": "network", "value": "devnet" }]
}`}</pre>
            <ul className="list-disc pl-5 text-sm text-white/70 space-y-1">
              <li>Decimals are 9. The maximum supply is 10,000,000,000 tokens. Freeze authority is none. The treasury keeps mint authority and mints on demand until that cap.</li>
              <li>Set how many points buy 1 token, and the minimum balance (500). Members at or above that balance can convert whole tokens from My redemptions.</li>
              <li>Turn Yauga Token Enabled on. Members then see My Wallet on the dashboard.</li>
            </ul>
          </>
        )}
      </div>

      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] space-y-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left font-medium text-white"
          onClick={() => setTreasuryOpen((v) => !v)}
          aria-expanded={treasuryOpen}
        >
          <span>Treasury and mint</span>
          <span className="text-sm font-normal text-white/50">{treasuryOpen ? 'Hide' : 'Show'}</span>
        </button>
        {treasuryOpen && (
          <>
            <p className="text-sm text-white/60">
              Treasury: {data?.treasuryPublic || 'Not created'}
              {data?.treasuryConfigured ? ' · key stored' : ''}
            </p>
            <p className="text-sm text-white/60">Devnet SOL: {sol}</p>
            <p className="text-sm text-white/60 break-all">Mint: {data?.mintAddress || 'Not created'}</p>
            {data?.metadataUri && <p className="text-sm text-white/60 break-all">Metadata: {data.metadataUri}</p>}

            {!data?.mintAddress && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-haus-fill rounded-lg px-4 py-2" onClick={() => generate.mutate()} disabled={generate.isPending}>
                  Generate treasury
                </button>
                <button type="button" className="btn-haus-ghost rounded-lg px-4 py-2 text-white/80" onClick={() => setShowSecret((v) => !v)}>
                  Paste existing key
                </button>
              </div>
            )}
            {showSecret && !data?.mintAddress && (
              <div>
                <label className="text-sm text-white/70" htmlFor="treasury-secret">Devnet secret key (base58)</label>
                <input id="treasury-secret" className={inputClass} value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="off" />
                <button type="button" className="btn-haus-fill rounded-lg px-4 py-2 mt-2" onClick={() => saveKey.mutate()} disabled={saveKey.isPending || !secretKey.trim()}>
                  Store key
                </button>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-white/70">Name
                <input className={inputClass} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="text-sm text-white/70">Symbol
                <input className={inputClass} value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </label>
              <label className="text-sm text-white/70 md:col-span-2">Description
                <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="text-sm text-white/70 md:col-span-2">Image URL (https)
                <input className={inputClass} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-haus-fill rounded-lg px-4 py-2 disabled:opacity-50"
                disabled={!!data?.mintAddress || !data?.treasuryConfigured || create.isPending}
                onClick={() => create.mutate()}
              >
                {data?.mintAddress ? 'Token created' : 'Create token on devnet'}
              </button>
              {data?.mintAddress && (
                <button
                  type="button"
                  className="btn-haus-ghost rounded-lg px-4 py-2 text-white/80 disabled:opacity-50"
                  disabled={reset.isPending}
                  onClick={() => {
                    const ok = window.confirm(
                      'Clear this devnet token so you can create another? The old mint stays on Solana. Yauga Token switches off. Unsent conversions return their points. The treasury key stays.',
                    )
                    if (ok) reset.mutate()
                  }}
                >
                  Reset token for testing
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] space-y-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left font-medium text-white"
          onClick={() => setExchangeOpen((v) => !v)}
          aria-expanded={exchangeOpen}
        >
          <span>Exchange</span>
          <span className="text-sm font-normal text-white/50">{exchangeOpen ? 'Hide' : 'Show'}</span>
        </button>
        {exchangeOpen && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-white/70">Points per 1 token
                <input className={inputClass} value={pointsPerToken} onChange={(e) => setPointsPerToken(e.target.value)} inputMode="numeric" />
              </label>
              <label className="text-sm text-white/70">Minimum points to convert
                <input className={inputClass} value={minPoints} onChange={(e) => setMinPoints(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <p className="text-xs text-white/45">
              Saved rate: {data?.pointsPerToken ?? '—'} points per token. Minimum: {data?.minPoints ?? 500}.
            </p>
            <button type="button" className="btn-haus-fill rounded-lg px-4 py-2" onClick={() => saveRate.mutate()} disabled={saveRate.isPending}>
              Save exchange rate
            </button>
          </>
        )}
      </div>
    </div>
  )
}
