import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import type { Adapter } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import {
  SolanaMobileWalletAdapter,
  SolanaMobileWalletAdapterWalletName,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
  type AuthorizationResultCache,
} from '@solana-mobile/wallet-adapter-mobile'
import { YaugaSolanaMwa } from '@yaugahaus/yauga-solana-mwa'
import toast from 'react-hot-toast'
import '../lib/solanaBuffer'
import {
  bytesToBase64,
  disconnectSolanaWallet,
  linkSolanaWallet,
  linkSolanaWalletViaMobileAdapter,
} from '../lib/yaugaToken'

const DEVNET = 'https://api.devnet.solana.com'

type Props = {
  userId: string
  linkedAddress: string | null
}

type WalletBundle = {
  adapters: Adapter[]
  authCache: AuthorizationResultCache | null
}

function shortAddress(address: string) {
  if (address.length < 12) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function connectLabel(name: string, android: boolean, changing: boolean) {
  if (android && name === SolanaMobileWalletAdapterWalletName) {
    return changing ? 'Change wallet' : 'Connect wallet'
  }
  return changing ? `Change to ${name}` : `Connect ${name}`
}

function ConnectPanel({
  userId,
  linkedAddress,
  authCache,
}: Props & { authCache: AuthorizationResultCache | null }) {
  const queryClient = useQueryClient()
  const { wallets, disconnect, connecting } = useWallet()
  const [busy, setBusy] = useState(false)
  const [pickingWallet, setPickingWallet] = useState(false)
  const android = Capacitor.getPlatform() === 'android'
  const [mwaAvailable, setMwaAvailable] = useState<boolean | null>(android ? null : true)

  useEffect(() => {
    if (!android) return
    let cancelled = false
    void YaugaSolanaMwa.isAvailable()
      .then(({ available }) => {
        if (!cancelled) setMwaAvailable(available)
      })
      .catch(() => {
        if (!cancelled) setMwaAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [android])

  const link = useMutation({
    mutationFn: async (walletName: string) => {
      if (authCache) {
        try {
          await authCache.clear()
        } catch {
          /* ignore stale cache clear */
        }
      }
      try {
        await disconnect()
      } catch {
        /* may not be connected yet */
      }

      // Android: authorize + signMessage must share one MWA session or the second open is blocked.
      if (android) {
        return linkSolanaWalletViaMobileAdapter(userId)
      }

      const adapter = wallets.find((w) => w.adapter.name === walletName)?.adapter as
        | (Adapter & { signMessage?: (message: Uint8Array) => Promise<Uint8Array> })
        | undefined
      if (!adapter) throw new Error('That wallet is not available on this device')
      await adapter.connect()
      const key = adapter.publicKey
      if (!key) throw new Error('Wallet did not return an address')
      if (!adapter.signMessage) throw new Error('This wallet cannot sign the link message')
      const message = new TextEncoder().encode(`Yauga wallet link\n${userId}`)
      const signature = await adapter.signMessage(message)
      await linkSolanaWallet(key.toBase58(), bytesToBase64(signature))
      return key.toBase58()
    },
    onSuccess: (address) => {
      setPickingWallet(false)
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      toast.success(`Wallet linked ${shortAddress(address)}`)
    },
    onError: (e: Error) => toast.error(e.message || 'Could not link wallet'),
    onSettled: () => setBusy(false),
  })

  const unlink = useMutation({
    mutationFn: async () => {
      if (authCache) {
        try {
          await authCache.clear()
        } catch {
          /* ignore */
        }
      }
      await disconnectSolanaWallet(userId)
      try {
        await disconnect()
      } catch {
        /* wallet app may already be closed */
      }
    },
    onSuccess: () => {
      setPickingWallet(false)
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      toast.success('Wallet disconnected')
    },
    onError: (e: Error) => toast.error(e.message || 'Could not disconnect'),
  })

  const names = wallets.map((w) => w.adapter.name)
  const showConnectButtons = !linkedAddress || pickingWallet
  const changing = !!linkedAddress && pickingWallet

  const startChangeWallet = () => {
    if (android && names.length === 1) {
      setBusy(true)
      toast('Approve connect and sign in your wallet app')
      link.mutate(names[0])
      return
    }
    setPickingWallet(true)
  }

  return (
    <section className="card dashboard-card" aria-labelledby="dash-wallet">
      <h2 id="dash-wallet" className="display m card-title">
        My Wallet
      </h2>
      <p className="small muted">
        {android
          ? 'Solana devnet. Connect with Phantom, Solflare, or another wallet on this phone.'
          : 'Solana devnet. Yauga stores the public address only.'}
      </p>
      {linkedAddress && !pickingWallet ? (
        <div className="dashboard-card-actions" style={{ marginTop: 'var(--s4)' }}>
          <p className="small" title={linkedAddress}>
            <span className="utility utility-s muted">Devnet · </span>
            {shortAddress(linkedAddress)}
          </p>
          <button
            type="button"
            className="btn btn-live"
            disabled={busy || connecting || link.isPending || unlink.isPending}
            onClick={startChangeWallet}
          >
            {link.isPending ? 'Waiting for wallet…' : 'Change wallet'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => unlink.mutate()}
            disabled={unlink.isPending || link.isPending}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="dashboard-card-actions" style={{ marginTop: 'var(--s4)' }}>
          {changing && (
            <p className="small muted">Pick the wallet to use for token conversions.</p>
          )}
          {android && mwaAvailable === false && (
            <p className="small muted">
              Install Phantom or Solflare from the Play Store, then tap Connect wallet.
            </p>
          )}
          {showConnectButtons &&
            names.map((name) => (
              <button
                key={name}
                type="button"
                className="btn btn-live"
                disabled={busy || connecting || link.isPending || (android && mwaAvailable === false)}
                onClick={() => {
                  setBusy(true)
                  if (android) toast('Approve connect and sign in your wallet app')
                  link.mutate(name)
                }}
              >
                {link.isPending ? 'Waiting for wallet…' : connectLabel(name, android, changing)}
              </button>
            ))}
          {changing && (
            <button
              type="button"
              className="btn"
              disabled={busy || link.isPending}
              onClick={() => setPickingWallet(false)}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function buildWallets(): WalletBundle {
  const platform = Capacitor.getPlatform()
  if (platform === 'android') {
    const authCache = createDefaultAuthorizationResultCache()
    return {
      authCache,
      adapters: [
        new SolanaMobileWalletAdapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: {
            name: 'Yauga',
            uri: 'https://www.yauga.com',
            // MWA requires a path relative to identity.uri (not an absolute URL).
            icon: '/Yauga.png',
          },
          authorizationResultCache: authCache,
          chain: 'solana:devnet',
          onWalletNotFound: createDefaultWalletNotFoundHandler(),
        }),
      ],
    }
  }
  return {
    authCache: null,
    adapters: [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
  }
}

export default function MyWalletCard({ userId, linkedAddress }: Props) {
  const { adapters, authCache } = useMemo(() => buildWallets(), [])

  return (
    <ConnectionProvider endpoint={DEVNET}>
      <WalletProvider wallets={adapters} autoConnect={false}>
        <ConnectPanel userId={userId} linkedAddress={linkedAddress} authCache={authCache} />
      </WalletProvider>
    </ConnectionProvider>
  )
}
