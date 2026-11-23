# Bot Race v2: connecting your Polymarket bot

For Jon, Ruben and Ian, and for the Claude (or other AI) that helps each of you.
Give it this whole file. Version 1 (stocks) is closed and its reports are rejected.

The dashboard ranks everyone by **total % return** on a simulated Polymarket account.
Your bot sends its account value; **the server works out every return**.

Season settings (tentative until the three of you confirm them): starts
**Dec 1, 2026 at 00:00 New York time** with **$10,000** each, same pinned simulator.

> **If you are an AI assistant setting this up:** read the whole file first. The human
> adds `BOT_RACE_URL` and `BOT_RACE_TOKEN` to their bot's `.env` (or equivalent). Never
> print the token, commit it, or put it in code. Add the reports below to the bot's
> scheduler, send one test snapshot, and show the human the response. Don't change
> their trading logic.

## 1. Get your token

1. Log in to the dashboard (magic link to your invited email).
2. **Profile → Bot token → Generate token**. Copy it right away; it's shown once.
   A token you already have keeps working.
3. In your bot's `.env` (git-ignored). Both values come from your profile page; the URL
   is the Supabase function URL shown there, **not** the website address:

```
BOT_RACE_URL=<the endpoint on your profile page>
BOT_RACE_TOKEN=tcb_...
```

If a token leaks, click **Replace token**: the old one stops working immediately.

## 2. Reports

Every report is an HTTP `POST` to `BOT_RACE_URL` with headers
`Authorization: Bearer <BOT_RACE_TOKEN>` and `Content-Type: application/json`.
The server knows who you are from the token and adds the time and season itself.
**Any field not listed here is rejected**, so nothing private leaks in by accident.

### Snapshot: every 10 minutes, 24/7

```json
{
  "schema_version": 2,
  "type": "snapshot",
  "account": "paper",
  "equity": 10123.45,
  "open_positions": 4,
  "settled_bets": 12,
  "won_bets": 7,
  "fees_paid": 3.21,
  "sim_version": "0.4.13+us.2"
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | `2` |
| `type` | yes | `"snapshot"` |
| `account` | yes | `"paper"` (simulation). `"live"` is rejected until real money opens. |
| `equity` | yes | Total account value in dollars, **exactly as the pinned simulator reports it**: its total account value, cash plus open bets (normally at the midpoint price). Don't re-value bets yourself. 0 is allowed. |
| `open_positions` | no | How many bets are open. A count only. |
| `settled_bets` | no | Bets settled since the season started (running total). |
| `won_bets` | no | How many of those won. Needs `settled_bets`. |
| `fees_paid` | no | Dollars of fees since the season started (running total). |
| `sim_version` | no, but please send it | The simulator's version, `0.4.13+us.2`. |

**Use simulator `0.4.13+us.2` (tag `us-0.4.13.2`).** Don't use `us.1`: it counts a bet as
worth $0 when a price lookup fails. Existing `us.1` accounts open fine in `us.2`.

**Skip a snapshot while `get_balance` reports `stale_positions` above 0**, and try again
next cycle. It means a price lookup failed, so the equity isn't current. Bets waiting for
a result don't count as stale. If it lasts more than an hour, tell the other two and look
into it; never fill in a price. The server doesn't filter reports: whatever you send
counts toward rank, drawdown and closes.

There is no daily report. The server takes each day's close from your last snapshot
before New York midnight; if your bot is offline, the last one before that counts. The
newest report always wins. After 45 minutes without a report your card shows 💤.

### Settled bets: whenever bets finish

Up to 50 per report.

```json
{
  "schema_version": 2,
  "type": "bets",
  "account": "paper",
  "bets": [
    {
      "market_slug": "example-market-dec-3",
      "market_title": "Will the example happen on Dec 3?",
      "side": "Yes",
      "stake": 50.00,
      "pnl": 38.20,
      "result": "won",
      "settled_at": "2026-12-03T18:20:00Z"
    }
  ]
}
```

| Field | Meaning (all required) |
|---|---|
| `market_slug` | The market's slug. Letters, digits, `.`, `_`, `-`. |
| `market_title` | Readable title, up to 200 characters. |
| `side` | What you bet on: `"Yes"`, `"No"`, a team name. Up to 60 characters. |
| `stake` | Dollars put in, **including entry fees**. More than 0. |
| `pnl` | Profit or loss in dollars after all fees. Can't be below `-stake`. |
| `result` | `"won"`, `"lost"`, or `"push"` (voided/refunded). A position sold before the market resolved is `"won"` if pnl > 0, `"lost"` if pnl < 0, `"push"` if 0. A lost bet can't have a positive pnl. |
| `settled_at` | When it settled, with a time zone. Not in the future. |

- **Never send open bets.** Send one only once you hold nothing more on that market and
  side (the market resolved, or you sold the whole position).
- One entry per market + side + settlement. Add up partial fills.
- **Safe to resend.** Same `market_slug`, `side` and `settled_at` overwrites the earlier
  copy. Store `settled_at` once and reuse it on retries; `now()` would make duplicates.
- All three of you can see this list. The board shows bets settled during the season.

### Before the season starts

Reports are accepted but not scored. A snapshot shows you as connected (✅), with
`"counts": false` in the response. Reset your simulator so you start at $10,000 with no
open bets.

## 3. Responses

| Status | Meaning | What to do |
|---|---|---|
| `200` | Saved. The body echoes the result. | Nothing. |
| `400` / `413` | Not valid JSON / over 64 KB. | Fix it; don't retry as-is. |
| `401` | Missing, wrong or revoked token. | Check `.env`. |
| `405` | Not a POST, or you used the website address. | Use the profile page's endpoint. |
| `422` | Invalid. `problems` lists every issue. | Fix it; don't retry as-is. |
| `429` | Snapshot less than 60 s after the last one. | Ignore it. After a retry it means the first attempt was saved. |
| `5xx` / network error | Temporary. | Try 3 times in total, waiting 2 s then 4 s. |

A failed report must never crash or delay your bot: log it and move on. Snapshots
missed while offline can't be backfilled; settled bets can, so keep a list of bets not
yet acknowledged with a `200` and resend those.

## 4. Reference client

`scripts/send_report.py` (Python, standard library only) has `send(payload)` with the
retries above. Copy it into your bot, or try it from a terminal:

```bash
python send_report.py snapshot --equity 10000
python send_report.py bets bets.json
```

## 5. Rules

- No account numbers, keys, order ids or anything that identifies an account.
- Numbers come straight from the pinned simulator.
- To be confirmed by all three: start time, $10,000 start, the equity rule, end date.

## 6. Checklist

- [ ] Token in `.env`, `.env` git-ignored
- [ ] Test snapshot returns `200`
- [ ] Snapshot every 10 min, 24/7, on a machine that stays awake
- [ ] Simulator is `0.4.13+us.2`
- [ ] Snapshot skipped while `stale_positions` is above 0
- [ ] Settled bets sent once finished, with a stored `settled_at`
- [ ] Failures logged, never fatal; `429` ignored
- [ ] Simulator reset to $10,000 with no open bets at the start
- [ ] Three faces on the profile page
