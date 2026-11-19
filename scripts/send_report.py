#!/usr/bin/env python3
"""Reference client for the Bot Race report endpoint. Standard library only.

Copy this file into your bot, or call `send()` from your own code.

Environment (put these in your bot's .env, never in code or git):
    BOT_RACE_URL    https://<project>.supabase.co/functions/v1/report
    BOT_RACE_TOKEN  tcb_... (from your profile page on the dashboard)

Examples:
    python send_report.py snapshot --account paper --equity 100512.30 --total-return-pct 0.51
    python send_report.py daily record.json
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
    snap = sub.add_parser("snapshot", help="send an intraday snapshot")
    snap.add_argument("--account", choices=["paper", "live"], default="paper")
    snap.add_argument("--equity", type=float, required=True)
    snap.add_argument("--total-return-pct", type=float, required=True)
    snap.add_argument("--net-deposits", type=float, default=0.0)
    daily = sub.add_parser("daily", help="send a daily record from a JSON file")
    daily.add_argument("path")
    args = parser.parse_args()

    if args.cmd == "snapshot":
        payload: dict[str, Any] = {
            "type": "snapshot",
            "account": args.account,
            "equity": args.equity,
            "total_return_pct": args.total_return_pct,
            "net_deposits": args.net_deposits,
        }
    else:
        with open(args.path) as f:
            payload = {"type": "daily", **json.load(f)}

    try:
        print(json.dumps(send(payload), indent=2))
    except ReportError as e:
        print(f"Rejected: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
