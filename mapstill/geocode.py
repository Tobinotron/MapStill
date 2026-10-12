"""Finding a place by name, with OpenStreetMap's Nominatim.

Asked from here and not from the web view because Nominatim's usage policy wants
requests that name the application. It also asks for at most one request per second
and no search-as-you-type: the UI only searches when the user submits.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import VERSION

ENDPOINT = "https://nominatim.openstreetmap.org/search"
USER_AGENT = f"MapStill/{VERSION} (desktop app)"


class GeocodeError(RuntimeError):
    pass


def _place(row: dict[str, Any]) -> dict[str, Any]:
    south, north, west, east = (float(v) for v in row["boundingbox"])
    return {"name": row["display_name"], "bounds": [west, south, east, north]}


def search(query: str, limit: int = 6, timeout: float = 10.0) -> list[dict[str, Any]]:
    """Places matching ``query``, best first: ``{name, bounds: [west, south, east, north]}``."""
    params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": limit})
    request = urllib.request.Request(f"{ENDPOINT}?{params}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            rows = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise GeocodeError(f"the place search is not reachable: {exc}") from exc
    return [_place(r) for r in rows if isinstance(r, dict) and "boundingbox" in r]
