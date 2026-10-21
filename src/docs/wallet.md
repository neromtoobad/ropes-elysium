# Wallet & bankroll
> Playing with your own wallet: deposits, seats, payouts and withdrawals.

Your wallet is used for exactly two things: funding your bankroll and receiving withdrawals. There are no signatures during play. The one-minute cadence runs through the game server on testnet.

## Bankroll

1. **Mint test dollars.** **GET TEST tUSDC** calls `mint` on the tUSDC contract from your own wallet: 10,000 per call, free.
2. **Deposit.** Send tUSDC to the house and sign a message proving the deposit is yours. The deposit is verified by its on-chain receipt and credits your bankroll exactly once.
3. **Play.** Seats come out of your bankroll with no wallet popup.
4. **Payouts.** When a run ends, what's left of the stack goes back to your bankroll at once.
5. **Withdraw.** **WITHDRAW ALL** sends your whole balance back on-chain on the server's next tick.

## Safety rules

- Your **withdrawal address is the wallet that made your first deposit**, never anything the browser says.
- A deposit can only be credited once (a database-level unique on the transaction).
- A bankroll that withdraws to one wallet doesn't accept deposits from another.

## Gas

You need a little **testnet HYPE** in your wallet for the mint and deposit transactions. Get it from the [Elysium faucet](https://elysium.kinetiq.xyz/testnet-faucet). A transaction costs about 0.00001 HYPE.
