from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from mapstill import geocode
from mapstill.app import AppContext, create_app
from mapstill.store import Store


def png(size: tuple[int, int], colour: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture
def ctx(tmp_path: Path) -> AppContext:
    return AppContext(store=Store(tmp_path / "app"), exports_dir=tmp_path / "exports")


@pytest.fixture
def client(ctx: AppContext) -> TestClient:
    return TestClient(create_app(ctx))


def test_token_and_host_are_checked(tmp_path: Path) -> None:
    ctx = AppContext(token="secret", store=Store(tmp_path))
    client = TestClient(create_app(ctx))
    assert client.get("/api/app").status_code == 401
    assert client.get("/api/app", headers={"X-Map-Token": "wrong"}).status_code == 401
    assert client.get("/api/app", headers={"X-Map-Token": "secret"}).status_code == 200
    foreign = {"X-Map-Token": "secret", "Host": "evil.example"}
    assert client.get("/api/app", headers=foreign).status_code == 403


def test_settings(client: TestClient) -> None:
    assert client.get("/api/settings").json() is None
    assert client.put("/api/settings", json={"styleId": "dark"}).status_code == 200
    assert client.get("/api/settings").json() == {"styleId": "dark"}


def test_window(client: TestClient) -> None:
    assert client.get("/api/window").json() is None
    assert client.put("/api/window", json={"sections": {"Area": False}}).status_code == 200
    assert client.get("/api/window").json() == {"sections": {"Area": False}}
    assert client.get("/api/settings").json() is None


def test_presets(client: TestClient) -> None:
    saved = client.put("/api/presets", json={"name": "London", "settings": {"a": 1}})
    assert saved.json() == {"name": "London", "settings": {"a": 1}}
    assert client.get("/api/presets").json() == [{"name": "London", "settings": {"a": 1}}]
    assert client.put("/api/presets", json={"name": "!!", "settings": {}}).status_code == 400
    assert client.delete("/api/presets", params={"name": "London"}).status_code == 200
    assert client.delete("/api/presets", params={"name": "London"}).status_code == 404


def test_styles(client: TestClient) -> None:
    assert client.get("/api/styles").json() == []
    saved = client.put("/api/styles", json={"name": "Night", "style": {"rules": []}})
    assert saved.json() == {"name": "Night", "style": {"rules": []}}

    taken = client.put("/api/styles", json={"name": "night", "style": {"rules": [1]}})
    assert taken.status_code == 409
    assert "Night" in taken.json()["detail"]
    assert client.get("/api/styles").json() == [{"name": "Night", "style": {"rules": []}}]

    replaced = client.put(
        "/api/styles", json={"name": "night", "style": {"rules": [1]}, "overwrite": True}
    )
    assert replaced.status_code == 200
    assert client.get("/api/styles").json() == [{"name": "night", "style": {"rules": [1]}}]

    assert client.put("/api/styles", json={"name": "!!", "style": {}}).status_code == 400
    assert client.delete("/api/styles", params={"name": "Night"}).status_code == 200
    assert client.delete("/api/styles", params={"name": "Night"}).status_code == 404


def test_export_to_the_exports_folder(client: TestClient, ctx: AppContext, tmp_path: Path) -> None:
    started = client.post("/api/exports", json={"width": 6, "height": 4, "name": 'Lon:don "x"'})
    assert started.status_code == 200
    export_id, path = started.json()["id"], Path(started.json()["path"])
    assert path == tmp_path / "exports" / "Lon don x.png"

    def add_chunk(x: int, colour: str) -> int:
        chunks = f"/api/exports/{export_id}/chunks"
        return client.put(chunks, params={"x": x, "y": 0}, content=png((4, 4), colour)).status_code

    assert add_chunk(0, "red") == 200
    assert add_chunk(4, "blue") == 200
    assert add_chunk(9, "red") == 400

    finished = client.post(f"/api/exports/{export_id}/finish")
    assert finished.json() == {"path": str(path), "bytes": path.stat().st_size}
    with Image.open(path) as image:
        assert image.size == (6, 4)
        assert image.getpixel((0, 0)) == (255, 0, 0)
        assert image.getpixel((5, 3)) == (0, 0, 255)

    # finished: gone
    assert add_chunk(0, "red") == 404
    # the same name again does not overwrite
    again = client.post("/api/exports", json={"width": 6, "height": 4, "name": 'Lon:don "x"'})
    assert Path(again.json()["path"]).name == "Lon don x (2).png"


def test_export_to_a_chosen_path(client: TestClient, tmp_path: Path) -> None:
    chosen = tmp_path / "my map"
    started = client.post(
        "/api/exports", json={"width": 2, "height": 2, "format": "jpeg", "path": str(chosen)}
    )
    assert started.json()["path"] == str(tmp_path / "my map.jpg")
    kept = client.post(
        "/api/exports",
        json={"width": 2, "height": 2, "format": "jpeg", "path": str(tmp_path / "a.JPEG")},
    )
    assert kept.json()["path"] == str(tmp_path / "a.JPEG")


def test_a_new_export_replaces_an_abandoned_one(client: TestClient) -> None:
    first = client.post("/api/exports", json={"width": 2, "height": 2}).json()["id"]
    second = client.post("/api/exports", json={"width": 2, "height": 2}).json()["id"]
    assert client.post(f"/api/exports/{first}/finish").status_code == 404
    assert client.delete(f"/api/exports/{second}").status_code == 200
    assert client.post(f"/api/exports/{second}/finish").status_code == 404


def test_impossible_exports_are_refused(client: TestClient) -> None:
    too_large = client.post("/api/exports", json={"width": 50_000, "height": 50_000})
    assert too_large.status_code == 400
    assert "megapixels" in too_large.json()["detail"]


def test_reveal_only_shows_what_was_exported(
    client: TestClient, ctx: AppContext, tmp_path: Path
) -> None:
    shown: list[Path] = []
    ctx.reveal = shown.append
    export_id = client.post("/api/exports", json={"width": 2, "height": 2}).json()["id"]
    path = client.post(f"/api/exports/{export_id}/finish").json()["path"]

    other = tmp_path / "other.txt"
    other.touch()
    assert client.post("/api/reveal", json={"path": str(other)}).status_code == 404
    assert client.post("/api/reveal", json={"path": path}).status_code == 200
    assert shown == [Path(path)]


def test_places(client: TestClient, ctx: AppContext) -> None:
    def found(query: str) -> list[dict[str, Any]]:
        return [{"name": query.title(), "bounds": [-0.5, 51.3, 0.3, 51.7]}]

    def unreachable(query: str) -> list[dict[str, Any]]:
        raise geocode.GeocodeError("the place search is not reachable")

    ctx.search = found
    assert client.get("/api/places", params={"q": "london"}).json()[0]["name"] == "London"
    assert client.get("/api/places", params={"q": ""}).status_code == 422
    ctx.search = unreachable
    assert client.get("/api/places", params={"q": "london"}).status_code == 502


def test_nominatim_rows_become_places() -> None:
    row = {"display_name": "London, England", "boundingbox": ["51.28", "51.69", "-0.51", "0.33"]}
    assert geocode._place(row) == {"name": "London, England", "bounds": [-0.51, 51.28, 0.33, 51.69]}
