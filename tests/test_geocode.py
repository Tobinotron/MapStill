"""The place search keeps to Nominatim's usage policy: answers are kept, requests are
spaced, and the server can be changed or switched off without a new version."""

from __future__ import annotations

from typing import Any

import pytest

from mapstill import geocode

LONDON = {"display_name": "London, England", "boundingbox": ["51.28", "51.69", "-0.51", "0.33"]}


class Server:
    """Stands in for Nominatim: notes what is asked, and what the search waits."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.asked: list[str] = []
        self.waited: list[float] = []
        self.now = 1000.0
        monkeypatch.setattr(geocode, "_fetch", self.fetch)
        monkeypatch.setattr(geocode.time, "monotonic", lambda: self.now)
        monkeypatch.setattr(geocode.time, "sleep", self.sleep)
        monkeypatch.setattr(geocode, "_answers", {})
        monkeypatch.setattr(geocode, "_last_request", 0.0)
        monkeypatch.delenv(geocode.ENDPOINT_VARIABLE, raising=False)

    def fetch(self, url: str, timeout: float) -> Any:
        self.asked.append(url)
        return [LONDON, {"display_name": "no bounds"}]

    def sleep(self, seconds: float) -> None:
        self.waited.append(seconds)
        self.now += seconds


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> Server:
    return Server(monkeypatch)


def test_places_are_read_from_the_answer(server: Server) -> None:
    assert geocode.search("london") == [
        {"name": "London, England", "bounds": [-0.51, 51.28, 0.33, 51.69]}
    ]
    assert server.asked[0].startswith(geocode.ENDPOINT + "?q=london&")


def test_an_answer_is_kept_and_not_asked_for_again(server: Server) -> None:
    first = geocode.search("London")
    assert geocode.search("  london ") == first
    assert len(server.asked) == 1
    geocode.search("Paris")
    assert len(server.asked) == 2


def test_requests_are_at_least_a_second_apart(server: Server) -> None:
    geocode.search("london")
    server.now += 0.25
    geocode.search("paris")
    assert server.waited == [pytest.approx(0.75)]
    server.now += 5
    geocode.search("rome")
    assert len(server.waited) == 1  # long enough ago: no waiting


def test_a_failed_request_counts_for_the_pause_but_is_not_kept(
    server: Server, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreachable(url: str, timeout: float) -> Any:
        raise geocode.GeocodeError("the place search is not reachable")

    monkeypatch.setattr(geocode, "_fetch", unreachable)
    with pytest.raises(geocode.GeocodeError):
        geocode.search("london")
    monkeypatch.setattr(geocode, "_fetch", server.fetch)
    assert geocode.search("london")  # asked again
    assert server.waited == [pytest.approx(1.0)]


def test_another_server_can_be_named_or_the_search_switched_off(
    server: Server, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(geocode.ENDPOINT_VARIABLE, "https://nominatim.example.org/search")
    geocode.search("london")
    assert server.asked[0].startswith("https://nominatim.example.org/search?")
    monkeypatch.setenv(geocode.ENDPOINT_VARIABLE, "off")
    with pytest.raises(geocode.GeocodeError, match="switched off"):
        geocode.search("london")
    assert len(server.asked) == 1
