/* ---------- payments (same block in index.html and admin.html; edit src/pay-shared.js, then run build.py) ---------- */
const PAY_METHODS = {
  "sol":       { label: "SOL",  net: "Solana",   chain: "solana",   asset: "native", decimals: 9 },
  "usdc-sol":  { label: "USDC", net: "Solana",   chain: "solana",   asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, stable: true },
  "eth-base":  { label: "ETH",  net: "Base",     chain: "base",     asset: "native", decimals: 18 },
  "usdc-base": { label: "USDC", net: "Base",     chain: "base",     asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, stable: true },
  "eth-eth":   { label: "ETH",  net: "Ethereum", chain: "ethereum", asset: "native", decimals: 18 },
  "usdc-eth":  { label: "USDC", net: "Ethereum", chain: "ethereum", asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, stable: true },
};
// free nodes that answer browsers directly, tried in order (Solana has only one that works without a key)
const PAY_RPC = {
  solana: ["https://solana-rpc.publicnode.com"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org", "https://1rpc.io/base"],
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth"],
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const payWallet = (wallets, methodId) => {
  const m = PAY_METHODS[methodId];
  return m ? (m.chain === "solana" ? String(wallets?.solana || "").trim() : String(wallets?.evm || "").trim()) : "";
};
/* Asks each node in turn, two rounds. A node that's down, busy or still catching up (empty answer)
   just passes to the next one. A "bad parameter" answer means the hash itself is wrong, so stop there. */
async function payRpc(urls, method, params) {
  let lastErr = null, sawNull = false;
  for (let round = 0; round < 2; round++) {
    if (round) await new Promise(r => setTimeout(r, 1500));
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await res.json().catch(() => null);
        if (j?.error) {
          if (j.error.code === -32602 || /invalid|wrong ?size|malformed|parse/i.test(j.error.message || "")) { const e = new Error(j.error.message); e.badInput = true; throw e; }
          lastErr = new Error(j.error.message || "RPC error"); continue;
        }
        if (!res.ok || !j) { lastErr = new Error("RPC HTTP " + res.status); continue; }
        if (j.result == null) { sawNull = true; continue; }
        return j.result;
      } catch (e) {
        if (e.badInput) throw e;
        lastErr = e;
      }
    }
  }
  if (sawNull) return null;
  throw lastErr || new Error("no node answered");
}
const payPriceCache = {};
// live USD price of SOL or ETH, from the deepest pool of the wrapped token
async function payUsdPrice(sym) {
  const hit = payPriceCache[sym]; if (hit && Date.now() - hit.t < 60000) return hit.v;
  const [chain, addr] = sym === "SOL" ? ["solana", "So11111111111111111111111111111111111111112"] : ["base", "0x4200000000000000000000000000000000000006"];
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${addr}`, { signal: AbortSignal.timeout(12000) });
  const pairs = await res.json();
  let best = null;
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (String(p?.baseToken?.address || "").toLowerCase() !== addr.toLowerCase()) continue;
    const liq = Number(p?.liquidity?.usd) || 0, px = Number(p?.priceUsd);
    if (px > 0 && (!best || liq > best.liq)) best = { liq, px };
  }
  if (!best) throw new Error("price unavailable");
  payPriceCache[sym] = { v: best.px, t: Date.now() };
  return best.px;
}
// how much to send for a given USD price (1% buffer on SOL/ETH for price moves)
async function payQuote(methodId, usd) {
  const m = PAY_METHODS[methodId];
  if (m.stable) return { amount: usd, text: usd.toFixed(2) };
  const px = await payUsdPrice(m.label);
  const dp = m.label === "SOL" ? 4 : 5, f = 10 ** dp;
  const amount = Math.ceil(usd / px * 1.01 * f) / f;
  return { amount, text: amount.toFixed(dp), price: px };
}
const payFmt = (amount, label) => amount == null || !Number.isFinite(amount) ? "–"
  : `${amount >= 1000 ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Number(amount.toPrecision(6))} ${label}`;
/* Checks one transaction against the MemeDex wallet.
   state: "ok" (paid enough), "fail" (definitely not valid) or "unknown" (couldn't check; review by hand). */
async function verifyPayment(methodId, txRaw, wallets, usdRequired, minRatio = 0.97) {
  const m = PAY_METHODS[methodId];
  const tx = String(txRaw || "").trim();
  const out = { method: methodId, tx, ok: false, state: "fail", amount: null, usd: null, from: null, time: null, checkedAt: Date.now(), reason: "" };
  if (!m) return { ...out, reason: "Unknown payment method" };
  const wallet = m.chain === "solana" ? payWallet(wallets, methodId) : payWallet(wallets, methodId).toLowerCase();
  if (!wallet) return { ...out, state: "unknown", reason: "The payment wallet isn't set up yet" };
  const notFound = "Transaction not found yet. Wait until it's confirmed, then check again.";
  try {
    if (m.chain === "solana") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx)) return { ...out, reason: "That doesn't look like a Solana transaction signature" };
      const r = await payRpc(PAY_RPC.solana, "getTransaction", [tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      if (!r) return { ...out, reason: notFound };
      if (r.meta?.err) return { ...out, reason: "This transaction failed on-chain" };
      const keys = (r.transaction?.message?.accountKeys || []).map(k => typeof k === "string" ? k : k?.pubkey);
      out.from = keys[0] || null;
      out.time = r.blockTime ? r.blockTime * 1000 : null;
      if (m.asset === "native") {
        const i = keys.indexOf(wallet);
        out.amount = i < 0 ? 0 : (r.meta.postBalances[i] - r.meta.preBalances[i]) / 1e9;
      } else {
        const sum = list => (list || []).filter(b => b.mint === m.asset && b.owner === wallet).reduce((s, b) => s + Number(b.uiTokenAmount?.amount || 0), 0);
        out.amount = (sum(r.meta.postTokenBalances) - sum(r.meta.preTokenBalances)) / 10 ** m.decimals;
      }
    } else {
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return { ...out, reason: "That doesn't look like a transaction hash (0x followed by 64 characters)" };
      const url = PAY_RPC[m.chain];
      const [t, rc] = await Promise.all([payRpc(url, "eth_getTransactionByHash", [tx]), payRpc(url, "eth_getTransactionReceipt", [tx])]);
      if (!t || !rc) return { ...out, reason: notFound };
      if (rc.status !== "0x1") return { ...out, reason: "This transaction failed on-chain" };
      out.from = String(t.from || "").toLowerCase() || null;
      if (m.asset === "native") out.amount = String(t.to || "").toLowerCase() === wallet ? Number(BigInt(t.value || "0x0")) / 1e18 : 0;
      else {
        let raw = 0n;
        for (const l of rc.logs || []) {
          if (String(l.address || "").toLowerCase() !== m.asset || l.topics?.[0] !== TRANSFER_TOPIC) continue;
          if (("0x" + String(l.topics[2] || "").slice(-40)).toLowerCase() === wallet) raw += BigInt(l.data || "0x0");
        }
        out.amount = Number(raw) / 10 ** m.decimals;
      }
      const blk = await payRpc(url, "eth_getBlockByNumber", [rc.blockNumber, false]).catch(() => null);
      out.time = blk?.timestamp ? parseInt(blk.timestamp, 16) * 1000 : null;
    }
  } catch (e) {
    if (e?.badInput) return { ...out, reason: `That isn't a valid transaction on ${m.net}. Check you copied the whole hash and picked the right network.` };
    return { ...out, state: "unknown", reason: "The blockchain nodes didn't answer, so the payment couldn't be checked right now. Try again in a moment." };
  }
  if (!(out.amount > 0)) return { ...out, reason: `This transaction doesn't send ${m.label} on ${m.net} to the MemeDex wallet` };
  try { out.usd = m.stable ? out.amount : out.amount * await payUsdPrice(m.label); } catch { out.usd = null; }
  if (out.usd == null) return { ...out, state: "unknown", reason: `Received ${payFmt(out.amount, m.label)}, but the price check failed. It will be confirmed by hand.` };
  if (out.usd < usdRequired * minRatio) return { ...out, reason: `Received ${payFmt(out.amount, m.label)} (≈ $${out.usd.toFixed(2)}), which is less than the $${usdRequired} fee` };
  return { ...out, ok: true, state: "ok" };
}
/* ---------- end payments ---------- */
