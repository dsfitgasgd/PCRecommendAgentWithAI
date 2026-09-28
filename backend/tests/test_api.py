from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    test_engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(test_engine)
    sessions = sessionmaker(bind=test_engine)

    def override_db():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    test_engine.dispose()


def register(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "display_name": "测试用户", "password": "secure-pass-123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_user_data_isolation_and_knowledge_upload(client: TestClient):
    alice = register(client, "alice@example.com")
    bob = register(client, "bob@example.com")
    upload = client.post(
        "/api/knowledge",
        files={"file": ("preferences.md", "预算 5000 元，喜欢轻薄笔记本".encode(), "text/markdown")},
        headers=alice,
    )
    assert upload.status_code == 201, upload.text
    doc_id = upload.json()["id"]
    assert len(client.get("/api/knowledge", headers=alice).json()) == 1
    assert client.get("/api/knowledge", headers=bob).json() == []
    assert client.delete(f"/api/knowledge/{doc_id}", headers=bob).status_code == 404

    favorite = client.post(
        "/api/favorites",
        json={"title": "某款笔记本", "source_url": "https://item.jd.com/123.html", "source_name": "item.jd.com"},
        headers=alice,
    )
    assert favorite.status_code == 201, favorite.text
    assert client.get("/api/favorites", headers=bob).json() == []
    assert client.delete(f"/api/favorites/{favorite.json()['id']}", headers=bob).status_code == 404
    assert client.post("/api/favorites", json={"title": "重复", "source_url": "https://item.jd.com/123.html", "source_name": "JD"}, headers=alice).status_code == 409


def test_live_research_labels_only_merchant_links(client: TestClient, monkeypatch):
    from app import live_search

    monkeypatch.setattr(live_search, "get_settings", lambda: SimpleNamespace(tavily_api_key="test-key"))

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": [
                {"title": "轻薄本 ¥5,999", "url": "https://item.jd.com/123.html", "content": "售价 ¥5,999"},
                {"title": "规格", "url": "https://example.com/spec", "content": "重量 1.2 kg"},
            ]}

    monkeypatch.setattr(live_search.httpx, "post", lambda *args, **kwargs: FakeResponse())
    headers = register(client, "reader@example.com")
    response = client.get("/api/research?query=轻薄笔记本", headers=headers)
    assert response.status_code == 200, response.text
    sources = response.json()["sources"]
    shopping = [source for source in sources if source["kind"] == "shopping"]
    assert shopping[0]["price_text"] == "¥5,999"
    assert shopping[0]["is_purchase_link"] is True
    assert shopping[1]["is_purchase_link"] is False
    assert all(source["observed_at"] for source in sources)


def test_auth_required_and_unsupported_document(client: TestClient):
    assert client.get("/api/favorites").status_code == 401
    headers = register(client, "upload@example.com")
    response = client.post("/api/knowledge", files={"file": ("old.doc", b"old", "application/msword")}, headers=headers)
    assert response.status_code == 422
    assert ".docx" in response.json()["detail"]
