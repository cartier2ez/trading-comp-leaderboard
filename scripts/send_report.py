#!/usr/bin/env python3
"""Reference client for the Bot Race v2 report endpoint. Standard library only.

Copy this file into your bot, or call `send()` from your own code.

Environment (put these in your bot's .env, never in code or git):
    BOT_RACE_URL    the endpoint shown on your profile page (not the website address)
    BOT_RACE_TOKEN  tcb_... (from your profile page)

Examples:
    python send_report.py snapshot --equity 10123.45 --open-positions 4
    python send_report.py bets bets.json      # a JSON list of settled bets
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


class ReportError(Exception):
    """The dashboard rejected the report (4xx). Retrying won't help."""


def send(payload: dict[str, Any], *, retries: int = 3, timeout: float = 15.0) -> dict[str, Any]:
    """Send one report. Up to `retries` attempts, waiting 2 s then 4 s between them."""
    url = os.environ["BOT_RACE_URL"]
    token = os.environ["BOT_RACE_TOKEN"]
    body = json.dumps(payload).encode()
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result: dict[str, Any] = json.load(resp)
                return result
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429 and attempt > 1:
                # Our earlier attempt was saved; only its response got lost.
                return {"ok": True, "note": "already saved by an earlier attempt"}
            if 400 <= e.code < 500:
                raise ReportError(f"HTTP {e.code}: {detail}") from None
            error = f"HTTP {e.code}: {detail}"
        except (urllib.error.URLError, TimeoutError) as e:
            error = str(e)
        if attempt < retries:
            time.sleep(2**attempt)
    raise RuntimeError(f"Report failed after {retries} attempts: {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    snap = sub.add_parser("snapshot", help="send the current account value")
    snap.add_argument("--equity", type=float, required=True)
    snap.add_argument("--open-positions", type=int)
    snap.add_argument("--settled-bets", type=int)
    snap.add_argument("--won-bets", type=int)
    snap.add_argument("--fees-paid", type=float)
    snap.add_argument("--sim-version")
    bets = sub.add_parser("bets", help="send settled bets from a JSON file (a list)")
    bets.add_argument("path")
    for p in (snap, bets):
        p.add_argument("--account", choices=["paper", "live"], default="paper")
    args = parser.parse_args()

    payload: dict[str, Any] = {"schema_version": 2, "type": args.cmd, "account": args.account}
    if args.cmd == "snapshot":
        fields = ("equity", "open_positions", "settled_bets", "won_bets", "fees_paid", "sim_version")
        payload.update({f: getattr(args, f) for f in fields if getattr(args, f) is not None})
    else:
        with open(args.path) as f:
            payload["bets"] = json.load(f)

    try:
        print(json.dumps(send(payload), indent=2))
    except ReportError as e:
        print(f"Rejected: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
