"""Finding a place by name, with OpenStreetMap's Nominatim.

Asked from here and not from the web view because Nominatim's usage policy
(https://operations.osmfoundation.org/policies/nominatim/) wants requests that name
the application. What else it asks for, and how it is met:

- at most one request per second: requests wait for their turn here;
- no search-as-you-type: the UI only searches when the user submits;
- answers that are kept instead of asked for again: they are, while the program runs;
- a way to stop asking that server without a new version of the app: the environment
  variable ``MAPSTILL_PLACE_SEARCH`` names another Nominatim server, or is ``off``.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import VERSION

ENDPOINT = "https://nominatim.openstreetmap.org/search"
ENDPOINT_VARIABLE = "MAPSTILL_PLACE_SEARCH"
USER_AGENT = f"MapStill/{VERSION} (desktop app)"
MIN_INTERVAL = 1.0  # seconds between two requests
ANSWERS_KEPT = 200

_turn = threading.Lock()
_last_request = 0.0
_answers: dict[tuple[str, int, str], list[dict[str, Any]]] = {}


class GeocodeError(RuntimeError):
    pass


def endpoint() -> str | None:
    """The server that is asked; None when the search is switched off."""
    chosen = os.environ.get(ENDPOINT_VARIABLE, "").strip()
    if chosen.lower() == "off":
        return None
    return chosen or ENDPOINT


def _place(row: dict[str, Any]) -> dict[str, Any]:
    south, north, west, east = (float(v) for v in row["boundingbox"])
    return {"name": row["display_name"], "bounds": [west, south, east, north]}


def _fetch(url: str, timeout: float) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise GeocodeError(f"the place search is not reachable: {exc}") from exc


def search(query: str, limit: int = 6, timeout: float = 10.0) -> list[dict[str, Any]]:
    """Places matching ``query``, best first: ``{name, bounds: [west, south, east, north]}``."""
    global _last_request
    server = endpoint()
    if server is None:
        raise GeocodeError("the place search is switched off")
    key = (server, limit, " ".join(query.lower().split()))
    with _turn:  # one request at a time, and none sooner than a second after the last
        if key in _answers:
            return _answers[key]
        wait = _last_request + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": limit})
        try:
            rows = _fetch(f"{server}?{params}", timeout)
        finally:
            _last_request = time.monotonic()
        places = [_place(r) for r in rows if isinstance(r, dict) and "boundingbox" in r]
        if len(_answers) >= ANSWERS_KEPT:
            del _answers[next(iter(_answers))]  # the oldest
        _answers[key] = places
        return places
