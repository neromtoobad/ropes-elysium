// Option maths for the mockups: Black-Scholes, r = 0, same model the ROPES vault already uses.
window.SPOT = 65.65; window.SIGMA = 0.78;
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const YEAR = 525600;
window.EXP = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440 };
window.STEP = { "1m": 0.05, "5m": 0.05, "15m": 0.10, "1h": 0.25, "1d": 1.0 };
window.price = (S, K, mins, type) => { const v = SIGMA * Math.sqrt(mins / YEAR); const d1 = (Math.log(S / K) + v * v / 2) / v, d2 = d1 - v;
  const c = S * N(d1) - K * N(d2); return { call: c, put: c - S + K, dc: N(d1), dp: N(d1) - 1, digi: N(d2) }[type]; };
window.chain = (exp, n = 11) => { const st = STEP[exp], mins = EXP[exp]; const mid = Math.round(SPOT / st) * st; const rows = [];
  for (let i = Math.floor(n / 2); i >= -Math.floor(n / 2); i--) { const K = +(mid + i * st).toFixed(2);
    const c = price(SPOT, K, mins, "call"), p = price(SPOT, K, mins, "put"); const sp = (x) => Math.max(0.004, x * 0.03);
    const h = (k) => Math.abs(Math.sin(K * 97.13 + k)) ; 
    rows.push({ K, c, p, cb: Math.max(0.001, c - sp(c)), ca: c + sp(c), pb: Math.max(0.001, p - sp(p)), pa: p + sp(p),
      dc: price(SPOT, K, mins, "dc"), dp: price(SPOT, K, mins, "dp"), cq: Math.round(40 + 900 * h(1) * Math.exp(-Math.abs(i) / 3)), pq: Math.round(40 + 900 * h(2) * Math.exp(-Math.abs(i) / 3)) }); }
  return rows; };
window.f = (x, d = 3) => x.toFixed(d);
window.usd = (x) => "$" + x.toFixed(2);
