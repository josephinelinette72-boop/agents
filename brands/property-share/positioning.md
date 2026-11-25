# Positioning — PropertyShare

## What it is (true today)
- Open-source software (MIT-style public GitHub repo) for tokenizing one rental property.
- A Solidity contract, PropertyShare, mints exactly 1,000,000 shares for one property and never mints more.
- Rent deposited in ETH or a stablecoin is split pro rata among whoever held shares when it arrived. Holders claim it themselves.
- Only allowlisted addresses can hold shares (the hook for identity checks).
- Admin controls: a two-step admin handover with a delay, pause for transfers, a role for lost-wallet recovery, and a fixed-price primary-sale contract with a soft cap and refunds.
- A self-custody wallet (command line and web) and a browser-wallet connection (e.g. MetaMask).
- 53 automated contract tests. Runs on local and public **test** networks (Anvil, Sepolia, Base Sepolia).

## What it is not (yet)
- Not live with real money. No real property, no company holding a deed, no investors.
- Not audited. Not a registered or exempt securities offering.
- There is nothing to buy.

## Stage
Building in public. The goal of marketing right now is **awareness and credibility with builders and the real-estate/proptech community**, and collecting feedback from developers — not selling anything.

## Differentiators (state carefully)
- Rent math that is fair by construction: buying mid-month does not collect earlier rent; selling keeps rent already earned.
- No loops over holders, so deposits cost the same with 10 holders or 10,000.
- Written to be read: heavily commented, built as a teaching codebase first.
