# Risk limits
> Every number the contract enforces, in one place.

| Limit | Value | What it does |
|---|---|---|
| Round risk cap | **25%** of the vault's free balance at the open (`roundCapBps = 2500`) | The most one round can ever owe its winning side. Buys that would exceed it revert (`OverCap`). |
| Buy lock | last **5 s** (`buyLockSecs`) | No new positions just before the bell. |
| Stale mark | **3 s** (`maxStaleSecs`) | A trade needs a mark at most 3 seconds old. |
| Sample window | **8 s** (`sampleWindowSecs`) | A strike must be read within 8 s of the open, a close within 8 s after the bell. |
| Late spread | doubles in the last **10 s** (`lateSecs`) | Wider quotes when price moves fastest. |
| Spread bounds | 0.2% – 10% half-spread | The owner can't set a spread outside this. |
| Round cap bounds | ≤ 50% | The owner can't let a round risk more than half the vault. |
| Volatility bounds | `1e13` – `5e15` per √s | A bad σ can't give quotes away. |
| Entry price cap | 0.90 | The game won't buy a side priced above 90%. |
| Stale-round void | 120 s after the bell | Anyone can void a round the keeper abandoned. |
| Scoreboard gas | 1,500,000 | `settle` refuses to run without it. |

The current values are read live on [/transparency](/transparency).
