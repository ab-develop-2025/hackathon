import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { redemptionsApi } from '../lib/api'
import type { RedemptionItem, RedemptionRequest } from '../types/database'
import { normalizePostcode, toTitleCase } from '../lib/textFormat'
import { supabase } from '../lib/supabase'
import { beginTokenConversion, conversionQuote, getYaugaTokenSettings, settleTokenConversion } from '../lib/yaugaToken'

type Props = {
  isOpen: boolean
  onClose: () => void
  userEmail: string
  userName: string
  pointsBalance: number
  solanaWallet?: string | null
}

export default function RedemptionsModal({ isOpen, onClose, userEmail, userName, pointsBalance, solanaWallet }: Props) {
  const queryClient = useQueryClient()
  const [selectedItem, setSelectedItem] = useState<RedemptionItem | null>(null)
  const [step, setStep] = useState<'list' | 'address'>('list')
  const [address, setAddress] = useState({
    name: userName || '',
    line1: '',
    line2: '',
    townCity: '',
    postcode: '',
  })

  const { data: items = [] } = useQuery({
    queryKey: ['redemption-items-active'],
    queryFn: async () => (await redemptionsApi.listActiveItems()) as RedemptionItem[],
    enabled: isOpen,
  })

  const { data: myRequests = [] } = useQuery({
    queryKey: ['redemption-requests', userEmail],
    queryFn: async () => (await redemptionsApi.listMyRequests(userEmail)) as RedemptionRequest[],
    enabled: isOpen && !!userEmail,
  })

  const [tokenCount, setTokenCount] = useState(1)
  const [pendingConversionId, setPendingConversionId] = useState<string | null>(null)
  const [convertCooldown, setConvertCooldown] = useState(false)
  const convertCooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (convertCooldownTimer.current) clearTimeout(convertCooldownTimer.current)
    }
  }, [])

  const startConvertCooldown = () => {
    setConvertCooldown(true)
    if (convertCooldownTimer.current) clearTimeout(convertCooldownTimer.current)
    convertCooldownTimer.current = setTimeout(() => setConvertCooldown(false), 5000)
  }

  const { data: tokenSettings } = useQuery({
    queryKey: ['yauga-token-settings'],
    queryFn: () => getYaugaTokenSettings(),
    enabled: isOpen,
  })

  const { data: openConversion } = useQuery({
    queryKey: ['token-conversion-open', userEmail],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('token_conversions')
        .select('id, status, tokens')
        .in('status', ['pending', 'sending', 'submitted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; status: string; tokens: number } | null
    },
    enabled: isOpen && !!userEmail && !!tokenSettings?.enabled,
  })

  const retryConversionId = pendingConversionId || openConversion?.id || null
  const quote = conversionQuote(
    pointsBalance,
    tokenCount,
    tokenSettings?.pointsPerToken ?? 100,
    tokenSettings?.minPoints ?? 500,
  )

  const convertMutation = useMutation({
    mutationFn: async () => {
      const id = retryConversionId || (await beginTokenConversion(tokenCount))
      try {
        return await settleTokenConversion(id)
      } catch (err) {
        setPendingConversionId(id)
        throw err
      }
    },
    onMutate: () => {
      startConvertCooldown()
    },
    onSuccess: (result) => {
      setPendingConversionId(null)
      queryClient.setQueryData(['token-conversion-open', userEmail], null)
      queryClient.invalidateQueries({ queryKey: ['points', userEmail] })
      queryClient.invalidateQueries({ queryKey: ['points-history', userEmail] })
      queryClient.invalidateQueries({ queryKey: ['token-conversion-open', userEmail] })
      toast.success(`Sent ${result.tokens ?? tokenCount} Yauga tokens`)
    },
    onError: (e: Error) => toast.error(e.message || 'Conversion failed'),
  })

  const isConverting = convertMutation.isPending
  const showRetryUi = !!retryConversionId && !isConverting
  const convertBusy = isConverting || convertCooldown

  const redeemMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error('No item selected')
      if (!address.name.trim() || !address.line1.trim() || !address.townCity.trim() || !address.postcode.trim()) {
        throw new Error('Please fill in all required address fields')
      }

      return await redemptionsApi.redeem(selectedItem.id, {
        name: toTitleCase(address.name),
        line1: toTitleCase(address.line1),
        line2: toTitleCase(address.line2),
        townCity: toTitleCase(address.townCity),
        postcode: normalizePostcode(address.postcode),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points', userEmail] })
      queryClient.invalidateQueries({ queryKey: ['points-history', userEmail] })
      queryClient.invalidateQueries({ queryKey: ['redemption-items-active'] })
      queryClient.invalidateQueries({ queryKey: ['redemption-requests', userEmail] })
      toast.success('Redemption requested')
      setStep('list')
      setSelectedItem(null)
      setAddress((prev) => ({ ...prev, line1: '', line2: '', townCity: '', postcode: '' }))
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to redeem'),
  })

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.points_cost - b.points_cost)
  }, [items])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-white">My Redemptions</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white/65" aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-white/65">
              Your points: <span className="font-semibold text-primary">{pointsBalance.toLocaleString()}</span>
            </div>
            {step === 'address' && (
              <button
                type="button"
                onClick={() => {
                  setStep('list')
                  setSelectedItem(null)
                }}
                className="btn"
              >
                Back
              </button>
            )}
          </div>

          {step === 'list' && (
            <div className="space-y-6">
              {tokenSettings?.enabled && (
                <div className="border border-white/[0.12] rounded-lg p-4 bg-[#070707]">
                  <h3 className="font-semibold text-white">Convert to Yauga Token</h3>
                  <p className="text-sm text-white/60 mt-1">
                    Devnet. {tokenSettings.pointsPerToken.toLocaleString()} points = 1 token. You need at least{' '}
                    {tokenSettings.minPoints.toLocaleString()} points.
                  </p>
                  {!tokenSettings.mintAddress && (
                    <p className="text-sm text-white/50 mt-2">The token is not ready yet.</p>
                  )}
                  {tokenSettings.mintAddress && !solanaWallet && (
                    <p className="text-sm text-white/50 mt-2">Connect a wallet in My Wallet first.</p>
                  )}
                  {tokenSettings.mintAddress && solanaWallet && !quote.eligible && !showRetryUi && (
                    <p className="text-sm text-white/50 mt-2">
                      You have {pointsBalance.toLocaleString()} points. {tokenSettings.minPoints.toLocaleString()} unlocks conversion.
                    </p>
                  )}
                  {tokenSettings.mintAddress && solanaWallet && (quote.eligible || showRetryUi || isConverting) && (
                    <div className="mt-3 space-y-2">
                      {showRetryUi ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <p className="min-w-0 flex-1 text-sm text-white/70 pb-2">A transfer is waiting to finish.</p>
                          <button
                            type="button"
                            className="btn btn-live ml-auto shrink-0"
                            disabled={convertBusy}
                            onClick={() => convertMutation.mutate()}
                          >
                            {isConverting ? 'Converting…' : 'Retry transfer'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-sm text-white/70">
                              Tokens
                              <input
                                type="number"
                                min={1}
                                max={quote.maxTokens}
                                value={tokenCount}
                                onChange={(e) => setTokenCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                                disabled={convertBusy}
                                className="mt-1 block w-28 rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-3 py-2 text-white disabled:opacity-50"
                              />
                            </label>
                            <button
                              type="button"
                              className="btn btn-live ml-auto shrink-0"
                              disabled={convertBusy || !quote.canConvert}
                              onClick={() => convertMutation.mutate()}
                            >
                              {isConverting ? 'Converting…' : 'Convert'}
                            </button>
                          </div>
                          <p className="text-sm text-white/70">
                            {quote.canConvert
                              ? `${quote.cost.toLocaleString()} points. ${quote.remainder.toLocaleString()} points stay.`
                              : `Up to ${quote.maxTokens.toLocaleString()} tokens.`}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  {solanaWallet && (
                    <p className="text-xs text-white/40 mt-2 break-all">Sends to {solanaWallet}</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedItems.map((it) => {
                  const outOfStock = it.quantity !== null && it.quantity <= 0
                  const canRedeem = !outOfStock && pointsBalance >= it.points_cost
                  return (
                    <div key={it.id} className="border border-white/[0.12] rounded-lg p-4 bg-[#0B0B0D]">
                      <div className="flex gap-3">
                        {it.image_url ? (
                          <img src={it.image_url} alt={it.title} className="w-20 h-20 rounded object-cover border border-white/[0.12]" />
                        ) : (
                          <div className="w-20 h-20 rounded bg-white/[0.08] border border-white/[0.12]" />
                        )}
                        <div className="flex-1">
                          <div className="font-semibold text-white">{it.title}</div>
                          {it.description && <div className="text-sm text-white/65 mt-1">{it.description}</div>}
                          <div className="mt-2 text-sm text-white/75">
                            Cost: <span className="font-semibold">{it.points_cost.toLocaleString()}</span> points
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            Qty: {it.quantity == null ? 'Unlimited' : it.quantity}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          disabled={!canRedeem}
                          onClick={() => {
                            setSelectedItem(it)
                            setAddress((prev) => ({ ...prev, name: prev.name || userName || '' }))
                            setStep('address')
                          }}
                          className="btn btn-live"
                        >
                          {outOfStock ? 'Out of stock' : canRedeem ? 'Redeem' : 'Not enough points'}
                        </button>
                      </div>
                    </div>
                  )
                })}
                {sortedItems.length === 0 && (
                  <div className="text-white/50 text-center py-8 col-span-full">No redemption items available yet.</div>
                )}
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-white mb-2">My Requests</h3>
                {myRequests.length === 0 ? (
                  <div className="text-sm text-white/50">No requests yet.</div>
                ) : (
                  <div className="space-y-2">
                    {myRequests.slice(0, 10).map((r) => (
                      <div key={r.id} className="flex items-center justify-between border border-white/[0.12] rounded-lg px-3 py-2">
                        <div>
                          <div className="text-sm font-medium text-white">{r.item_title}</div>
                          <div className="text-xs text-white/50">
                            {new Date(r.requested_at).toLocaleDateString('en-GB')} • -{r.item_points_cost.toLocaleString()} pts
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          r.status === 'fulfilled' ? 'bg-violet-100 text-violet-800' : r.status === 'cancelled' ? 'bg-white/[0.08] text-white/75' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'address' && selectedItem && (
            <div className="space-y-4">
              <div className="border border-white/[0.12] rounded-lg p-4 bg-[#070707]">
                <div className="font-semibold text-white">Redeeming: {selectedItem.title}</div>
                <div className="text-sm text-white/75">Cost: {selectedItem.points_cost.toLocaleString()} points</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-white/75 mb-1">Name *</label>
                  <input
                    value={address.name}
                    onChange={(e) => setAddress({ ...address, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-white/75 mb-1">Address line 1 *</label>
                  <input
                    value={address.line1}
                    onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-white/75 mb-1">Address line 2</label>
                  <input
                    value={address.line2}
                    onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-white/75 mb-1">Town/City *</label>
                  <input
                    value={address.townCity}
                    onChange={(e) => setAddress({ ...address, townCity: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-white/75 mb-1">Postcode *</label>
                  <input
                    value={address.postcode}
                    onChange={(e) => setAddress({ ...address, postcode: e.target.value })}
                    maxLength={12}
                    className="w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('list')
                    setSelectedItem(null)
                  }}
                  className="btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={redeemMutation.isPending}
                  onClick={() => redeemMutation.mutate()}
                  className="btn btn-live"
                >
                  {redeemMutation.isPending ? 'Submitting...' : 'Confirm Redeem'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

