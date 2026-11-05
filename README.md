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

## Token info updates (paid)

Token teams can pay a one-time fee (default $99 in SOL, ETH or USDC) to add a logo, banner, description and official links to their token page. The flow:

1. The team fills in **Update Token Info** on the site (`#/update`), pays to your wallet and pastes the transaction hash. The page checks the payment on-chain before it lets them submit.
2. The request lands in Supabase as *pending*.
3. An admin opens **`/admin.html`**, verifies the payment again, edits anything that needs fixing, and approves. The token page updates within a few minutes.

Admins can also create, edit and delete token profiles directly.

### Setup

1. Create a free project at supabase.com.
2. Open the SQL editor and run `supabase/schema.sql`. It creates the tables, the security rules and the `token-media` image bucket.
3. Create your admin login under Authentication → Users → Add user, then make it an admin:
   `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
4. Copy the project URL and anon key (Project Settings → API) into `CFG.supabase` in `index.html` and `ADMIN_CFG.supabase` in `admin.html`.
5. Put your receiving wallets in `CFG.pay.wallets` and `ADMIN_CFG.pay.wallets`: a Solana address, and an EVM address for Base and Ethereum. Change `usd` there to change the price.

The anon key is meant to be public. Row Level Security in the database is what stops visitors from changing anything: they can only read approved profiles and submit pending requests.

`src/pay-shared.js` holds the payment check used by both pages. After editing it, run `python3 src/build.py` to copy it into `index.html` and `admin.html`.

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
