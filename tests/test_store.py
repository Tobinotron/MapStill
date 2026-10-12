from __future__ import annotations

from pathlib import Path

import pytest

from mapstill.store import NameTaken, Store, adopt_former_app_dir, slug


def test_settings_round_trip(tmp_path: Path) -> None:
    store = Store(tmp_path)
    assert store.settings() is None
    store.save_settings({"styleId": "dark", "bounds": [1, 2, 3, 4]})
    assert Store(tmp_path).settings() == {"styleId": "dark", "bounds": [1, 2, 3, 4]}


def test_presets_are_files_sorted_by_name(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_preset("London night", {"styleId": "dark"})
    store.save_preset("alps", {"styleId": "hiking"})
    assert [p["name"] for p in store.presets()] == ["alps", "London night"]
    assert (tmp_path / "presets" / "london-night.json").is_file()


def test_saving_under_the_same_name_replaces(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_preset("London", {"v": 1})
    store.save_preset("london!", {"v": 2})
    assert store.presets() == [{"name": "london!", "settings": {"v": 2}}]


def test_delete(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_preset("London", {})
    assert store.delete_preset("London")
    assert not store.delete_preset("London")
    assert not store.delete_preset("...")
    assert store.presets() == []


def test_a_name_needs_something_to_name_the_file(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="letter or digit"):
        Store(tmp_path).save_preset(" !? ", {})


def test_damaged_files_are_skipped(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_preset("good", {})
    (tmp_path / "presets" / "broken.json").write_text("{", encoding="utf-8")
    (tmp_path / "presets" / "other.json").write_text('["a list"]', encoding="utf-8")
    (tmp_path / "settings.json").write_text("nonsense", encoding="utf-8")
    assert [p["name"] for p in store.presets()] == ["good"]
    assert store.settings() is None


def test_styles_are_kept_like_presets(tmp_path: Path) -> None:
    store = Store(tmp_path)
    assert store.styles() == []
    store.save_style("Night", {"rules": [1]})
    store.save_style("blueprint 2", {"rules": []})
    assert [s["name"] for s in store.styles()] == ["blueprint 2", "Night"]
    assert (tmp_path / "styles" / "night.json").is_file()
    assert store.presets() == []  # styles and presets do not mix


def test_a_taken_style_name_is_only_replaced_on_request(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_style("Night", {"v": 1})
    with pytest.raises(NameTaken) as taken:
        store.save_style("night!", {"v": 2})
    assert taken.value.existing == "Night"
    assert store.styles() == [{"name": "Night", "style": {"v": 1}}]
    store.save_style("night!", {"v": 2}, overwrite=True)
    assert store.styles() == [{"name": "night!", "style": {"v": 2}}]


def test_delete_style(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_style("Night", {})
    assert store.delete_style("NIGHT")
    assert not store.delete_style("Night")
    with pytest.raises(ValueError, match="letter or digit"):
        store.save_style("…", {})


def test_the_window_is_remembered_apart_from_the_settings(tmp_path: Path) -> None:
    store = Store(tmp_path)
    assert store.window() is None
    store.save_window({"sections": {"Area": False}})
    assert Store(tmp_path).window() == {"sections": {"Area": False}}
    assert store.settings() is None


def former(tmp_path: Path) -> Path:
    """The app's folder as it was under its former name."""
    old = tmp_path / "stylized-maps"
    Store(old).save_settings({"styleMode": "base"})
    Store(old).save_preset("London", {"a": 1})
    Store(old).save_style("Night", {"rules": []})
    (old / "webview").mkdir()
    (old / "webview" / "cache").write_text("x", encoding="utf-8")
    return old


def test_the_former_folder_is_taken_over(tmp_path: Path) -> None:
    old, new = former(tmp_path), tmp_path / "mapstill"
    assert adopt_former_app_dir(new) == old
    assert not old.exists()
    store = Store(new)
    assert store.settings() == {"styleMode": "base"}
    assert [p["name"] for p in store.presets()] == ["London"]
    assert [s["name"] for s in store.styles()] == ["Night"]
    assert (new / "webview" / "cache").is_file()


def test_it_is_taken_over_only_once(tmp_path: Path) -> None:
    old, new = former(tmp_path), tmp_path / "mapstill"
    Store(new).save_settings({"styleMode": "custom"})  # the app has run under its new name
    assert adopt_former_app_dir(new) is None
    assert old.is_dir()
    assert Store(new).settings() == {"styleMode": "custom"}
    assert Store(new).presets() == []


def test_without_a_former_folder_nothing_happens(tmp_path: Path) -> None:
    new = tmp_path / "mapstill"
    assert adopt_former_app_dir(new) is None
    assert not new.exists()


def test_a_former_folder_in_use_is_copied_from(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    old, new = former(tmp_path), tmp_path / "mapstill"

    def in_use(self: Path, target: Path) -> Path:
        raise PermissionError("the former program is running")

    monkeypatch.setattr(Path, "rename", in_use)
    assert adopt_former_app_dir(new) == old
    store = Store(new)
    assert store.settings() == {"styleMode": "base"}
    assert [p["name"] for p in store.presets()] == ["London"]
    assert [s["name"] for s in store.styles()] == ["Night"]
    assert not (new / "webview").exists()  # the cache is left behind: it fills again
    assert old.is_dir()


def test_a_folder_chosen_on_purpose_takes_over_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    former(tmp_path)
    monkeypatch.setenv("MAPSTILL_APP_DIR", str(tmp_path / "mapstill"))
    assert adopt_former_app_dir() is None
    assert (tmp_path / "stylized-maps").is_dir()


def test_slug() -> None:
    assert slug("  London — Night (v2) ") == "london-night-v2"
    assert slug("../../etc") == "etc"
