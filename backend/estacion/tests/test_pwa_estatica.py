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
    assert not (RAIZ / "frontend" / "public" / "manifest.json").exists()


def test_manifest_acotado_a_estacion():
    texto = (PUBLIC / "manifest.json").read_text(encoding="utf-8")
    assert json.loads(texto) == json.loads((PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    man = json.loads(texto)
    assert man["id"] == "/estacion/"
    assert man["scope"] == "/estacion/"
    assert man["start_url"] == "/estacion/#inicio"
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
    assert "const MANIFEST = '/estacion/manifest.json'" in reg
    assert "emsif-shell-v3" in js
    assert "/estacion/manifest.json" in js
    html = (RAIZ / "frontend" / "index.html").read_text(encoding="utf-8")
    assert "manifest" not in html
    assert "serviceWorker" not in html


def test_worker_ajeno_en_raiz_nunca_se_desregistra():
    """Un worker de AgroPack en scope / no recibe unregister. El único registro es el de la estación."""
    reg = (RAIZ / "frontend" / "src" / "estacion" / "pwa.ts").read_text(encoding="utf-8")
    app = (RAIZ / "frontend" / "src" / "estacion" / "EstacionApp.tsx").read_text(encoding="utf-8")
    assert ".unregister(" not in reg
    assert "getRegistrations(" not in reg
    assert "soltarWorkerRaiz" not in reg and "soltarWorkerRaiz" not in app
    assert "caches.delete" not in reg and "caches.keys" not in reg
    assert reg.count("serviceWorker.register(") == 1
    assert "register('/estacion/sw.js', { scope: '/estacion/' })" in reg
    js = (PUBLIC / "sw.js").read_text(encoding="utf-8")
    assert js.count("caches.delete") == 1
    assert "ks.filter(k => k.startsWith('emsif-') && k !== VERSION).map(k => caches.delete(k))" in js


def test_render_no_abre_el_scope_del_worker():
    assert "Service-Worker-Allowed" not in RENDER
    assert "application/javascript" in RENDER
    assert "application/manifest+json" in RENDER
    assert "/estacion/sw.js" in RENDER
