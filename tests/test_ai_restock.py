from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_ai_paths_exist():
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    assert "/ai/restock/recommend" in paths
    assert "/ai/restock/apply" in paths

def test_recommend_requires_auth():
    r = client.get("/ai/restock/recommend?threshold=14&limit=200")
    assert r.status_code == 401

def test_apply_requires_auth():
    r = client.post("/ai/restock/apply?threshold=14&limit=200&dry_run=true")
    assert r.status_code == 401