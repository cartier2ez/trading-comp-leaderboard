# Bot Race: connecting your bot

This guide is for Jon, Ruben and Ian, and for the Claude (or other AI) that helps
each of you wire up your bot. Give it this whole file.

The dashboard ranks everyone by **total % return**. SPY is shown as a reference line
only. Your bot can use any language, broker or strategy. It only has to send two
kinds of small JSON reports to one URL.

> **If you are an AI assistant setting this up:** read the whole file first. Ask the
> human for their `BOT_RACE_URL` and `BOT_RACE_TOKEN`, put both in their bot's `.env`
> (or equivalent secret store), and never print the token, commit it, or put it in
> code. Then add the two reports below to the bot's existing scheduler, send one test
> snapshot, and show the human the response. Don't change their trading logic.

## 1. Get your token

1. Log in to the dashboard (magic link to your invited email).
2. Go to **Profile → Bot token → Generate token**. Copy it right away; it's shown once.
3. Add to your bot's `.env` (make sure `.env` is in `.gitignore`):

```
BOT_RACE_URL=https://<project>.supabase.co/functions/v1/report
BOT_RACE_TOKEN=tcb_...
```

The exact URL is shown on your profile page. If the token leaks, click **Replace token**:
the old one stops working immediately.

While you're on the profile page, upload your three faces (1st smiling, 2nd straight
face, 3rd crying).

## 2. The two reports

Every report is an HTTP `POST` to `BOT_RACE_URL` with headers
`Authorization: Bearer <BOT_RACE_TOKEN>` and `Content-Type: application/json`.
The server works out who you are from the token, so don't send your name.

**All percentages are in percent, not fractions: `1.25` means +1.25%.**

### Snapshot (live race, during market hours)

Send every **10 minutes** while the market is open (Mon–Fri 9:30–16:00 ET). At most
one per minute is accepted.

```json
{
  "type": "snapshot",
  "account": "paper",
  "equity": 100512.30,
  "total_return_pct": 0.51,
  "net_deposits": 0
}
```

### Daily close (the official score)

Send **once per trading day after the close** (e.g. 16:15 ET or later), even on days
with no trades. Re-sending the same `date` overwrites that day.

```json
{
  "type": "daily",
  "account": "paper",
  "date": "2026-11-19",
  "equity": 100512.30,
  "net_deposits": 0,
  "day_return_pct": 0.42,
  "total_return_pct": 0.51,
  "benchmark": "SPY",
  "benchmark_return_pct": 0.14,
  "strategy": "trend_basket_sma210",
  "tracking_since": "2026-11-18"
}
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `"snapshot"` or `"daily"` |
| `account` | yes | `"paper"` or `"live"` (real money). Each has its own tab and its own history. |
| `equity` | yes | Account value in dollars right now (cash + positions). |
| `total_return_pct` | yes | Return since `tracking_since`, see formula below. |
| `net_deposits` | no (default 0) | Cash you added (+) or withdrew (−) since `tracking_since`. |
| `date` | daily | Trading day this record closes, `YYYY-MM-DD` (New York date). |
| `day_return_pct` | daily | Today's return: `(equity_today / equity_yesterday − 1) × 100`, adjusted for deposits made today. |
| `benchmark_return_pct` | daily | SPY's return since `tracking_since`, same method as yours. |
| `benchmark` | no (default `"SPY"`) | Ticker of the benchmark. |
| `strategy` | no | Short name of what your bot is running (≤ 80 chars). Shown on your card. |
| `tracking_since` | daily | The day you started tracking this account (`YYYY-MM-DD`). |
| `schema_version` | no | `1` if you send it. |

Any other field is **rejected**. That keeps all three bots' data identical in shape and
stops account numbers or keys from leaking in by accident.

### How to compute total return

```
starting_equity  = equity at tracking_since (e.g. 100000 for a fresh Alpaca paper account)
total_return_pct = ((equity - net_deposits) / starting_equity - 1) * 100
```

Same idea for SPY: `benchmark_return_pct = (spy_price_now / spy_price_at_tracking_since - 1) * 100`.

When you switch to real money, start a fresh history: send `"account": "live"` with a
new `tracking_since` (the day you went live) and the live starting equity (e.g. $500).
Keep sending paper reports too if your paper bot keeps running.

## 3. Responses

| Status | Meaning | What to do |
|---|---|---|
| `200` | Stored. Body echoes what was saved. | Nothing. |
| `401` | Missing, wrong or revoked token. | Check `.env`; generate a new token if needed. |
| `422` | Payload invalid. `problems` lists every issue in plain English. | Fix the payload; don't retry as-is. |
| `429` | Snapshot sent less than 60 s after the last one. | Slow down. |
| `5xx` / network error | Temporary problem. | Retry with backoff (2 s, 4 s, 8 s). |

Never let a failed report crash or block your trading run: log it and move on.

## 4. Example code

**Python, any broker** (standard library only): `scripts/send_report.py` in the
dashboard repo has a `send(payload)` function with retries. Copy it into your bot.

**Python with Alpaca (`alpaca-py`):**

```python
import os
from alpaca.trading.client import TradingClient
from send_report import send  # copied from the dashboard repo

STARTING_EQUITY = 100_000.0   # equity on TRACKING_SINCE
TRACKING_SINCE = "2026-11-18"

client = TradingClient(os.environ["ALPACA_API_KEY"], os.environ["ALPACA_SECRET_KEY"], paper=True)
equity = float(client.get_account().equity)

send({
    "type": "snapshot",
    "account": "paper",
    "equity": round(equity, 2),
    "total_return_pct": round((equity / STARTING_EQUITY - 1) * 100, 4),
})
```

**curl (quick test):**

```bash
curl -sS -X POST "$BOT_RACE_URL" \
  -H "Authorization: Bearer $BOT_RACE_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"snapshot","account":"paper","equity":100000,"total_return_pct":0}'
```

## 5. Rules of the road

- Never send account numbers, API keys, order IDs or anything that identifies your
  brokerage account. Only the fields above.
- Report honestly: the numbers come from your broker, not from a backtest.
- Tentative until the Thu Nov 19, 2026 call: scoring rule, start/end dates, whether
  everyone uses the same `tracking_since`, and whether options are allowed.

## 6. Checklist

- [ ] Token generated, stored in `.env`, `.env` git-ignored
- [ ] Test snapshot returns `200` and your card appears on the dashboard
- [ ] Snapshot job every 10 min during market hours
- [ ] Daily job once after the close, every trading day
- [ ] Report failures are logged, not fatal
- [ ] Three faces uploaded on the profile page
