"""La PWA de la estación no puede controlar AgroPack ni devolver el HTML del SPA."""
import json
import pathlib
import struct

RAIZ = pathlib.Path(__file__).resolve().parents[3]
PUBLIC = RAIZ / "frontend" / "public" / "estacion"
RENDER = (RAIZ / "render.yaml").read_text(encoding="utf-8")


def _png(path):
    b = path.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", b[16:24])


def test_no_hay_service_worker_en_la_raiz():
    assert not (RAIZ / "frontend" / "public" / "sw.js").exists()
    assert not (RAIZ / "frontend" / "public" / "manifest.webmanifest").exists()


def test_manifest_acotado_a_estacion():
    man = json.loads((PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert man["scope"] == "/estacion/"
    assert man["start_url"].startswith("/estacion/")
    assert man["display"] == "standalone"
    fines = {i["purpose"] for i in man["icons"]}
    assert "any" in fines and "maskable" in fines
    for icono in man["icons"]:
        ruta = PUBLIC / icono["src"]
        assert ruta.is_file(), icono["src"]
        w, h = _png(ruta)
        assert f"{w}x{h}" == icono["sizes"]
    assert _png(PUBLIC / "icons" / "apple-touch-icon.png") == (180, 180)


def test_worker_no_amplia_el_scope_ni_cachea_la_api():
    js = (PUBLIC / "sw.js").read_text(encoding="utf-8")
    assert "Service-Worker-Allowed" not in js
    assert "scope" not in js.lower() or "/estacion/" in js
    assert "/api/" in js
    assert "authorization" in js
    assert "text/html" in js
    reg = (RAIZ / "frontend" / "src" / "estacion" / "pwa.ts").read_text(encoding="utf-8")
    assert "scope: '/estacion/'" in reg
    assert "/estacion/sw.js" in reg
    html = (RAIZ / "frontend" / "index.html").read_text(encoding="utf-8")
    assert "manifest" not in html
    assert "serviceWorker" not in html


def test_render_no_abre_el_scope_del_worker():
    assert "Service-Worker-Allowed" not in RENDER
    assert "application/javascript" in RENDER
    assert "application/manifest+json" in RENDER
    assert "/estacion/sw.js" in RENDER
