# MemeDex

Live meme coin screener in a single static page: prices, charts, on-chain trades, Coin Grade A–F and original-vs-copy checks across Solana, Ethereum, BNB Chain, Base, Arbitrum, Polygon and Robinhood Chain.

## Run it

- **Locally:** open `index.html` in Chrome, Firefox or Safari (needs an internet connection).
- **Hosting:** it's a plain static site with no build step and no server. Vercel, Netlify, Cloudflare Pages or GitHub Pages all serve it as is. On Vercel, import this repo with the "Other" preset and leave the build command empty.

## Features

- Market, Trending, New Listings and a personal Watchlist (saved in the visitor's browser)
- Moving trending ticker, chain filter with chain logos, quick filters (liquidity, no copies, grade A–C)
- Token page with candlestick chart, live trades read straight from the chain, stats and a security panel
- Updates on its own: prices every 15 seconds, swaps as they happen on supported pools
- Fun mode: animal emoji cursor, a burst of animals on every click or tap, and a stream while you press and hold. The 🐾 button in the header turns it off (saved per visitor).

## Coin Grade

The grade is based on how much of the supply the token creator's wallet still holds:

| Grade | Dev holds |
|---|---|
| A | < 1% |
| B | 1% – < 2% |
| C | 2% – < 3% |
| D | 3% – < 4% |
| E | 4% – 5% |
| F | > 5% |

A dash (–) means the dev share can't be confirmed, for example when a token was launched through a launchpad contract or the holder data doesn't add up. The bands live in `CFG.gradeBands` at the top of the script.

## Original vs copy

A token is flagged **COPY** when another token with the same ticker on the same chain had its pool created earlier and still has meaningful liquidity (`CFG.copyLiveLiquidity`, default $10K).

## Disclaimer

Grades and copy checks are automated and can be wrong. Nothing here is financial advice. DYOR.
