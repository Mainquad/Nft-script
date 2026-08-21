# Nft-script

Config-driven NFT minting tools for EVM chains. Simulates every call before it spends gas, asks for confirmation on the interactive scripts, then submits. Built by racing real mints — used to catch NOT FOR HUMANS on Ethereum and RWA Flywheel Babies + OnChainHoodCats on Robinhood Chain.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and add:

- `PRIVATE_KEY=0x...` — the wallet that signs and (usually) pays gas
- `ALCHEMY_KEY=...` — only if you use `wss-mint.js` or `rwa_parallel.js` (WebSocket-based scripts). Free at [alchemy.com](https://www.alchemy.com)

Generate a fresh throwaway wallet if you don't want to use an existing one:

```bash
node gen_wallet.js
```

Back up the mnemonic offline. If the machine dies, that's the only recovery path.

## Chains supported

`ethereum`, `base`, `arbitrum`, `optimism`, `robinhood`, `robinhood-testnet`

Add more in `lib/chains.js`.

## Scripts

### `mint.js` — generic minter with confirmation prompt

For any mint you can describe as `function foo(...)` at some address for some price. Copy `mints/example.js` to `mints/YOUR_MINT.js`, edit the fields, then:

```bash
node mint.js mints/YOUR_MINT.js
```

Validates the config, simulates the call, prints gas + total cost in USD, asks `y/N`. Handles ETH/USD live price display. Saves a receipt JSON per successful mint.

### `wss-mint.js` — WebSocket sniper for cadenced drips

For contracts where minting is throttled by some contract-state check (e.g. a global cooldown that resets every N blocks). Subscribes to `newHeads` via Alchemy WSS, fires an `eth_call` on every new block, submits the moment the check passes. Requires `ALCHEMY_KEY`.

```bash
node wss-mint.js mints/YOUR_MINT.js
```

Env tunables: `POLL_MS` (unused here — block-driven), `TIP_MULT` (default 2 — multiplies priority fee to jump in-block ordering), `GAS_LIMIT` (default 300000).

### `hoodcats.js` — SIWE-style ticket flow

For projects that use an off-chain "sign in with Ethereum" challenge → server-signed ticket → on-chain redeem pattern. Currently hardcoded to OnChainHoodCats — use it as a template for similar flows. Checks whether the wallet has already claimed before starting, so it exits cleanly if you're re-running after a win.

```bash
node hoodcats.js .env
```

### `hoodcats_parallel.js` and `rwa_parallel.js` — multi-wallet racers

Parallel versions for when you have multiple wallets and want to race the same mint from all of them. Load keys from `.env2` and `.env.hoodcats` (numbered `PRIVATE_KEY_1`, `PRIVATE_KEY_2`, ...).

Note: using multiple wallets against a one-per-wallet mint is sybil behavior. Some projects filter multi-claimers out of later drops. Your call.

### `gen_wallet.js` and `gen_hoodcats_wallets.js` — wallet generators

Generate throwaway wallets and save keys to `.env` or `.env.hoodcats`. Prints the mnemonic once — back it up if you plan to keep anything won.

### `split_funds.js` — distribute gas across wallets

Splits the balance of your source wallet (`.env`) across the sibling wallets in `.env.hoodcats`. Useful before running parallel scripts where each wallet needs to pay its own gas.

```bash
node split_funds.js robinhood 0.0001   # chain, reserve amount in ETH
```

Shows a plan → prompts `y/N` → sends one tx per destination.

## Environment file layout

- `.env` — main wallet (`PRIVATE_KEY=...`) and shared config (`ALCHEMY_KEY=...`)
- `.env2` — optional second wallet (`PRIVATE_KEY=...`)
- `.env.hoodcats` — sibling wallets for parallel scripts (`PRIVATE_KEY_1=...`, `PRIVATE_KEY_2=...`, plus `ADDRESS_N` for reference)

All are gitignored. `.env.example` shows the shape.

## What each script does under the hood

- Validates chain ID matches the RPC's response before touching anything
- Fetches live ETH/USD via CoinGecko for cost display where relevant
- Confirms contract bytecode exists at the address
- Runs `eth_call` (a simulation) before `eth_sendTransaction` — bails on revert with the raw revert data (decode with a 4byte lookup if unfamiliar)
- Waits for on-chain receipt, confirms status 1, then decodes `Transfer(0x0 → agent)` events to find minted tokenId
- Saves receipt JSON to `receipts/` (gitignored)

## Known gaps

- Merkle-proof allowlists — pass the proof in `args` on your config
- Backend-signed permits other than SIWE — grab the signature from browser DevTools first
- ERC-1155 — mints work but tokenId decode won't find them (uses ERC-721 Transfer topic)
- The `qty` field in configs is used for value calculation but not automatically passed to the contract — some contracts want a quantity argument, some don't. Set `args` accordingly.

## Security

- Your private key lives in `.env`. Never commit it. The gitignore covers this but stay alert.
- Never share `.env`, `.env2`, `.env.hoodcats`, or your mnemonic — with anyone, including whoever gave you this repo.
- Test on Base or Robinhood testnet before spending on mainnet.
- On free-tier hosted environments (GitHub Codespaces free tier auto-deletes after 30 days idle), transfer valuable NFTs to a wallet you fully control soon after minting. Or back up the mnemonic offline.

## Contributing

Fork it. This is a working scratchpad, not a polished library.
