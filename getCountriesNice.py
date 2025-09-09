#!/usr/bin/env python3
import base64
import csv
import json
import sys
import time
from typing import Dict, List, Any, Optional

import requests


BASE_URL = "https://www.ieb.co.za/_api/cloud-data/v2/items/query"
APP_ID = "f72cf4f7-b63d-407c-8567-51f156db9ae8"


def build_r(offset: int, limit: int = 200, extra_filter: Optional[Dict[str, Any]] = None) -> str:
    """
    Build the base64-encoded `.r` parameter for the IEB Cloud Data API.
    Set `filter` to {} for ALL schools, or pass e.g. {"country": "South Africa"}.
    """
    payload = {
        "dataCollectionId": "IEBHighSchools",
        "query": {
            "filter": extra_filter or {},  # {} -> ALL
            "sort": [{"fieldName": "title", "order": "ASC"}],
            "paging": {"offset": offset, "limit": limit},
            "fields": []
        },
        "referencedItemOptions": [],
        "returnTotalCount": True,
        "environment": "LIVE",
        "appId": APP_ID
    }
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def fetch_page(offset: int, limit: int, cookies: Optional[str] = None, timeout: int = 30) -> Dict[str, Any]:
    """
    Fetch a single page. If `cookies` provided, pass as a Cookie header string:
    e.g. "server-session-bind=...; XSRF-TOKEN=...; hs=...; svSession=...; client-session-bind=..."
    """
    params = {".r": build_r(offset, limit)}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36",
        "Accept": "application/json"
    }
    if cookies:
        headers["Cookie"] = cookies

    resp = requests.get(BASE_URL, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_all_schools(limit: int = 200, cookies: Optional[str] = None, delay_sec: float = 0.0) -> List[Dict[str, Any]]:
    """
    Paginate until all schools are retrieved. Returns the array of items (objects containing .data).
    """
    all_items: List[Dict[str, Any]] = []
    offset = 0

    # First page to learn total
    first = fetch_page(offset, limit, cookies=cookies)
    total = int(first.get("pagingMetadata", {}).get("total", 0))
    items = first.get("dataItems", []) or []
    all_items.extend(items)
    print(f"Fetched {len(items)} / {total}")

    # Loop remaining pages
    while len(all_items) < total and items:
        offset += limit
        if delay_sec > 0:
            time.sleep(delay_sec)
        page = fetch_page(offset, limit, cookies=cookies)
        items = page.get("dataItems", []) or []
        all_items.extend(items)
        print(f"Fetched {len(all_items)} / {total}")

    return all_items


def save_json(items: List[Dict[str, Any]], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved JSON: {path} ({len(items)} records)")


def save_csv(items: List[Dict[str, Any]], path: str) -> None:
    """
    Writes a flattened CSV with the most useful fields.
    """
    fields = ["title", "province", "area", "telephone", "emailAddress", "website"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["title", "province", "area", "telephone", "email", "website"])
        for it in items:
            d = (it or {}).get("data", {})
            w.writerow([
                d.get("title", ""),
                d.get("province", ""),
                d.get("area", ""),
                d.get("telephone", ""),
                d.get("emailAddress", ""),
                d.get("website", "")
            ])
    print(f"✅ Saved CSV:  {path} ({len(items)} rows)")


def main():
    """
    Usage:
      python grab_ieb_schools.py
      python grab_ieb_schools.py "server-session-bind=...; XSRF-TOKEN=...; hs=...; svSession=...; client-session-bind=..."
    """
    cookies = sys.argv[1] if len(sys.argv) > 1 else None

    try:
        items = fetch_all_schools(limit=200, cookies=cookies)
    except requests.HTTPError as e:
        print(f"HTTP error: {e}\nResponse: {getattr(e, 'response', None) and e.response.text}")
        raise

    # Save
    save_json(items, "ieb_high_schools.json")
    save_csv(items, "ieb_high_schools.csv")


if __name__ == "__main__":
    main()
