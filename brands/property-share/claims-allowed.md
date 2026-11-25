# Claims allowed — PropertyShare

Factual claims the content may make. Anything not here must be a plain description of how the software works.

- PropertyShare is open source; the code is public on GitHub.
- The contract mints exactly 1,000,000 shares per property and cannot mint more.
- Rent deposits are split pro rata to holders at the moment of deposit; holders claim their own rent.
- Buying shares mid-period does not collect rent deposited before the purchase.
- Deposits do not loop over holders, so their gas cost does not grow with the number of holders.
- Only allowlisted addresses can hold or receive shares.
- Includes pause, two-step admin handover with delay, wallet recovery, and a primary-sale contract with soft cap and refunds.
- The contracts have 53 automated tests (Foundry), including fuzz tests.
- It currently runs on test networks only (Anvil, Sepolia, Base Sepolia).
- It has not been audited yet.
