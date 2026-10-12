# Yauga Solana token — feasibility

The flow fits this app. Points already live in an off-chain ledger, admin settings are a simple on/off store, and the phone app is the same dashboard inside the native shell. The chain transfer has to run on the server, and wallet connect is an Android feature.

No code has been changed for this yet.

## What already exists

Yauga Points are rows in `points_ledger`. The balance is the sum of `delta`. Spending points is already a one-way debit: redemptions call `request_redemption`, which checks the balance and writes a negative row in one database step. History text comes from the `notes` field, so a line like `Points Conversion: 12 Tokens sent to wallet (Abc…)` can show up in the existing history table once we add a new reason.

Admin settings are key/value rows edited from `/admin`. A Blockchain Settings section is the same pattern as the other settings panels.

The mobile app is not a separate codebase. It is this web app inside Capacitor (`com.yaugahaus.app`), on Android and iOS. `isNativeApp()` already tells the native shell apart from the website, so My Wallet and Convert can be limited to the app.

There is no Solana code in the project today.

## How the conversion should work

The phone must never hold the Yauga-Token-Wallet key, and it must never decide how many tokens to send. The app only connects the member’s wallet and asks the server to convert.

1. Member connects a wallet in the app. The app stores that address on their profile.
2. If Blockchain Settings has the token enabled, the points section shows how many whole tokens that balance is worth.
3. Convert opens the one-way confirmation. No cancels. Yes calls a new edge function.
4. The function reads the rate and the stored wallet, works out the token amount, and checks the treasury token balance on Solana.
5. If the treasury is short, it stops and leaves points unchanged.
6. If the treasury can cover it, it debits the points, sends the tokens from the Yauga-Token-Wallet to the member, then writes the ledger note with the amount and address.

The debit should follow the redemption pattern: one locked database step, then the chain send. Those two steps can fail independently, so we also need a conversion record (pending, sent, or failed) and a way to put points back if the transfer fails after the debit. A second tap must not send twice.

The member may not have a token account for this mint yet. The treasury transaction should create that account when it is missing. The treasury wallet therefore needs a small SOL balance for fees and account rent, as well as the tokens.

Lock the rate as **points per 1 token**. Example: rate `100`, balance `250` → eligible for `2` tokens, `200` points debited, `50` points left. The screen can preview that; the server recalculates it.

## Mobile Wallet Adapter

Mobile Wallet Adapter is the Solana Android connect protocol (Phantom, Solflare, Seed Vault, and similar). It does not run inside the Capacitor web view by itself. The Android app needs a small native plugin that talks to the wallet app and returns the public address. The website never shows this.

iOS does not support Mobile Wallet Adapter. The iOS app would need a different connect path, such as a Phantom or Solflare link. For a first version, wallet connect and convert can be Android-only.

## What we need before any app code

### On Solana (devnet first, then mainnet)

- A new treasury keypair: the Yauga-Token-Wallet.
- An SPL token mint: name, symbol, decimals, and total supply. Mint that supply into the treasury.
- A decision on mint authority: keep it so you can mint more later, or revoke it so supply is fixed.
- SOL in the treasury for transfer fees and for creating a member’s token account.
- A paid RPC endpoint. Public mainnet RPC will not be reliable enough.

### Secrets, not admin fields

- Treasury private key and RPC URL go in Supabase secrets. They must not be saved in the settings table, the admin form, or the app.
- Mint address and treasury public address can be server config. Admins only need the two controls in the requirements: enabled yes/no, and the points-per-token rate.

### In the app, when we build it

- Blockchain Settings on `/admin`.
  - Enable Token? Yes / No
  - Token Conversion Rate (points per 1 token)
- A wallet address on the member profile, set only by a successful wallet connect.
- A conversion record: member, points, tokens, wallet, transaction signature, status.
- A new points reason, for example `token_conversion`, plus the history note: `Points Conversion: xx Tokens sent to wallet (address)`.
- One edge function that checks the flag, the rate, the balance, and the treasury, then debits and transfers.
- On the native dashboard only:
  - My Wallet — Mobile Wallet Adapter connect, store the wallet address.
  - Under Yauga Points, Convert when the token is enabled. Show eligible tokens, then a one-way confirmation. No cancels. Yes runs the transfer.

### Outside the code

Sending a token someone can hold or transfer is different from the current closed points balance, which is only spent inside Yauga. Worth a legal check before mainnet, especially under UK financial-promotion rules. Devnet can be built and tested before that.

## Product requirements (source)

1. `/admin` > Blockchain Settings
   - Enable Token? Yes / No
   - Token Conversion Rate (how many points = tokens)

2. On the mobile app only
   - A. If Token Enabled = yes: under Dashboard, a My Wallet section. Use the mobile wallet adapter to connect a wallet to the Yauga app and store the wallet address.
   - B. Yauga Points: an option to convert to Yauga Tokens. Selecting it shows how many tokens the member is eligible for based on the Token Conversion Rate. Convert shows a modal that this is a one-way conversion. Are you sure? No cancels. Yes checks the Yauga-Token-Wallet balance for sufficient tokens. If so, send that amount from the Yauga-Token-Wallet to the user’s wallet, confirm the transaction, and update the points log: `Points Conversion: xx Tokens sent to wallet (address)`.
