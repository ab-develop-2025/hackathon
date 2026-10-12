# Yauga Token — devnet setup

Phase 1 creates one SPL token on Solana **devnet** and lets members convert Yauga points into it. Mainnet is not implemented. The admin switch is **Admin → Yauga Token → Enabled / Disabled**.

## What members see when it is enabled

- `/dashboard` shows **My Wallet** and a **Convert tokens** shortcut under Points. On the website they connect Phantom or Solflare. On the Android app, connect uses **Mobile Wallet Adapter** (Phantom, Solflare, Seed Vault, and other MWA wallets on the phone) via the `@yaugahaus/yauga-solana-mwa` Capacitor bridge. iOS still uses Phantom or Solflare where available; MWA is Android-only.
- The app stores the public address only, after the wallet signs `Yauga wallet link` plus their user id.
- **My redemptions** shows **Convert to Yauga Token** when their balance is at least the minimum (500 by default) and they have a linked wallet.
- Points are removed when they confirm. Tokens are minted to that address. If the transfer fails before it is sent, the points are returned. History shows the debit and, on failure, the return.

## Create the token

1. Apply the migration `supabase/migrations/20261010120000_yauga_token.sql`.
2. Deploy the function:

```bash
supabase functions deploy yauga-token --no-verify-jwt
```

The function checks the signed-in user itself. `verify_jwt` is false in `supabase/config.toml` so the gateway does not reject the session before that check.

3. Open **Admin → Yauga Token**.
4. **Generate treasury**, or paste an existing devnet secret key and choose **Store key**. The secret is written to `yauga_token_secrets`, which has row level security and no browser policy. The page shows the public address and “key stored”. It does not show the secret again.
5. Fund that public address with devnet SOL. Open [https://faucet.solana.com](https://faucet.solana.com), choose Devnet, paste the treasury address, and request SOL. Keep at least 0.02 SOL. Each conversion spends a little SOL on fees, and the first transfer to a wallet also creates their token account.
6. Fill in the metadata and choose **Create token on devnet**.

On-chain:

| Field | Value |
|---|---|
| Network | Devnet (`https://api.devnet.solana.com`) |
| Decimals | 9 |
| Maximum supply | 10,000,000,000 tokens. Conversions stop when the next mint would pass this. |
| Mint authority | Treasury wallet |
| Freeze authority | None |
| Name | Up to 32 characters. Default `Yauga` |
| Symbol | Up to 10 characters. Default `YAUGA` |
| Seller fee | 0 |

Decimals are fixed when the mint is created. If **Create token** already ran, that mint keeps its original decimals (the first version used 0). Creating again is rejected while a mint address is stored. A new mint is a new devnet token.

The function uploads this JSON to the public `token-metadata` bucket as `yauga.json` and stores that URL on the mint (Metaplex metadata, max 200 characters):

```json
{
  "name": "Yauga",
  "symbol": "YAUGA",
  "description": "Yauga loyalty token. Devnet only.",
  "image": "https://www.yauga.com/yauga_logo_black.png",
  "external_url": "https://www.yauga.com",
  "attributes": [{ "trait_type": "network", "value": "devnet" }]
}
```

The image must be an `https://` URL. Wallets read `name`, `symbol`, and `image` from that file. Description is in the JSON only. It is not a separate on-chain field.

7. Set **Points per 1 token** (default 100) and **Minimum points to convert** (default 500). Save.
8. Switch **Yauga Token** to **Enabled**.

A second Create token click is rejected while a mint address is stored. Replacing the treasury after a mint exists is rejected, because the mint authority would no longer match.

On devnet, **Reset token for testing** clears the stored mint, turns the switch off, and returns points for conversions that were not sent. The treasury key stays, so you can create the next mint with the same wallet. The old mint remains on Solana. Confirmed conversions stay in history. Redeploy `yauga-token` before using reset:

```bash
supabase functions deploy yauga-token --no-verify-jwt
```

## Exchange rules

- Balance must be at least the minimum (500).
- The member chooses a whole number of tokens.
- Points removed = tokens × points per token.
- Points left over stay in the loyalty balance. At 100 points per token, 550 points can become 5 tokens and 50 points.
- The destination is the linked wallet. Conversion does not ask the member to paste a recovery phrase.

## Where the key lives

`yauga_token_secrets.secret_key` is readable by the service role inside `yauga-token`. It is not in `settings` (that table is public) and it is not in the iOS or Android bundle. A leaked key can mint more tokens and spend the treasury’s SOL. Treat the database backup as sensitive.

Devnet SOL in the treasury is only for fees. It is not the member token.
