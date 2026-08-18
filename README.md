# Mint framework

Config-driven NFT minting for EVM chains. Simulates every call before it spends real gas, asks for confirmation, then submits.

## Setup

```bash
npm install
cp .env.example .env      # edit .env, paste your PRIVATE_KEY
```

Generate a fresh throwaway wallet if you don't want to use an existing one:

```bash
node -e "const w=require('ethers').Wallet.createRandom(); console.log('ADDRESS:',w.address); console.log('PRIVATE_KEY:',w.privateKey); console.log('MNEMONIC:',w.mnemonic.phrase)"
```

Back up the mnemonic somewhere safe. Fund the address with the ETH you'll need for gas plus the mint price.

## Use

1. Copy `mints/example.js` to `mints/your-mint.js`
2. Edit: chain, contract address, function signature, args, price
3. Run: `node mint.js mints/your-mint.js`
4. Read the simulation output; type `y` to send

## Chains supported

ethereum, base, arbitrum, optimism, robinhood, robinhood-testnet

Add more in `lib/chains.js`.

## What it does

- Validates the config
- Confirms wallet chain matches expected
- Fetches live ETH/USD price for cost display
- Checks contract bytecode exists
- Simulates the call with `eth_call` — bails on revert with the raw revert data (decode with 4byte lookup if unfamiliar)
- Estimates gas, shows total cost
- Waits for `y` confirmation
- Submits, waits for receipt
- Decodes ERC-721 `Transfer(0 → agent)` events to find minted tokenId(s)
- Saves a receipt JSON

## Known gaps

- Merkle-proof allowlist mints — pass the proof in `args`
- Backend-signed permits — grab the signature from browser DevTools first
- ERC-1155 — mints fine but tokenId decode won't find them (uses ERC-721 Transfer topic)
- Multi-mint / qty parameter — only used for value calc, not passed to the contract yet

## Security

- Your private key is in `.env`, which is gitignored. Never commit `.env`.
- Never share `.env` or your mnemonic with anyone, including whoever gave you this script.
- Test on a cheap chain first (Base, Robinhood testnet).
