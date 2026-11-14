from fastapi.testclient import TestClient

from spherex_explorer import __version__
from spherex_explorer.api.app import create_app
from spherex_explorer.config import Settings


def make_client(**overrides: str) -> TestClient:
    app = create_app(Settings(_env_file=None, **overrides))
    return TestClient(app, raise_server_exceptions=False)


def test_health_reports_status_and_version():
    response = make_client().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}
    assert response.headers["cache-control"] == "no-store"


def test_unknown_route_returns_json_error():
    response = make_client().get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"


def test_unexpected_error_returns_json_without_internals():
    app = create_app(Settings(_env_file=None))

    @app.get("/api/boom")
    def boom() -> None:
        raise RuntimeError("secret detail")

    response = TestClient(app, raise_server_exceptions=False).get("/api/boom")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret detail" not in response.text


def test_allowed_origin_gets_cors_header():
    client = make_client(allowed_origins="https://site.example")

    response = client.get("/api/health", headers={"Origin": "https://site.example"})

    assert response.headers["access-control-allow-origin"] == "https://site.example"


def test_other_origin_gets_no_cors_header():
    client = make_client(allowed_origins="https://site.example")

    response = client.get("/api/health", headers={"Origin": "https://other.example"})

    assert "access-control-allow-origin" not in response.headers
