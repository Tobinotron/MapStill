"""Running the API server in a background thread (desktop shell, tests)."""

from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass

import uvicorn
from fastapi import FastAPI

HOST = "127.0.0.1"


@dataclass
class RunningServer:
    server: uvicorn.Server
    thread: threading.Thread
    port: int

    @property
    def url(self) -> str:
        return f"http://{HOST}:{self.port}"

    def stop(self, timeout: float = 10.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind((HOST, 0))
        return int(s.getsockname()[1])


def start_server(app: FastAPI, port: int | None = None, timeout: float = 15.0) -> RunningServer:
    """Serve ``app`` on 127.0.0.1 (a free port by default) until ``stop()``."""
    port = port or _free_port()
    config = uvicorn.Config(app, host=HOST, port=port, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="api-server", daemon=True)
    thread.start()
    deadline = time.monotonic() + timeout
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError(f"the API server did not start on port {port}")
        time.sleep(0.02)
    return RunningServer(server, thread, port)
