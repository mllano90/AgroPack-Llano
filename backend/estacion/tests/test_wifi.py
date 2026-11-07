"""v4.4: cambio de red WiFi de la receptora desde la web (comando "wifi" cifrado, un solo uso)."""
import json

import pytest
from conftest import TOKEN, auth, cx, login

from estacion import servicio as sv
from estacion import wifi_cmd

API = "/api/estacion"
CLAVE = "clave-super-secreta-123"


def _filas(c):
    k = cx(c)
    try:
        return k.todos("SELECT * FROM estacion_comandos WHERE tipo = 'wifi' ORDER BY id")
    finally:
        k.s.close()


def _todo_bd(c):
    """Todo el texto de las tablas que tocan los comandos (para buscar la clave en claro)."""
    k = cx(c)
    try:
        t = json.dumps(k.todos("SELECT * FROM estacion_comandos")) + json.dumps(k.todos("SELECT * FROM estacion_alertas"))
        return t + json.dumps(k.todos("SELECT * FROM estacion_config"))
    finally:
        k.s.close()


def test_cifrado_ida_y_vuelta_y_firma():
    s = wifi_cmd.cifrar(TOKEN, 7, "Casa Sombra", CLAVE, "https://x.onrender.com")
    assert CLAVE.encode().hex() not in s["datos"] and len(s["nonce"]) == 32 and len(s["mac"]) == 32
    d = wifi_cmd.descifrar(TOKEN, 7, s)
    assert d == {"conservar": False, "ssid": "Casa Sombra", "clave": CLAVE, "url": "https://x.onrender.com"}
    with pytest.raises(wifi_cmd.WifiInvalido):
        wifi_cmd.descifrar(TOKEN, 8, s)                      # el MAC liga el sobre a su id
    with pytest.raises(wifi_cmd.WifiInvalido):
        wifi_cmd.descifrar("otro-token", 7, s)
    malo = dict(s, datos=("0" if s["datos"][0] != "0" else "1") + s["datos"][1:])
    with pytest.raises(wifi_cmd.WifiInvalido):
        wifi_cmd.descifrar(TOKEN, 7, malo)
    assert wifi_cmd.cifrar(TOKEN, 7, "a", "b" * 8, "")["nonce"] != wifi_cmd.cifrar(TOKEN, 7, "a", "b" * 8, "")["nonce"]


@pytest.mark.parametrize("cuerpo,texto", [
    ({"ssid": "", "clave": CLAVE}, "SSID"),
    ({"ssid": "x" * 33, "clave": CLAVE}, "32 bytes"),
    ({"ssid": "Red", "clave": "corta"}, "8 a 63"),
    ({"ssid": "Red", "clave": "z" * 64}, "hexadecimal"),
    ({"ssid": "Red", "clave": "ñandú-123"}, "ASCII"),
    ({"ssid": "Red", "clave": ""}, "Red abierta"),
    ({"ssid": "Red", "clave": CLAVE, "url": "ftp://x"}, "http"),
    ({"ssid": "Red", "clave": CLAVE, "url": "http://a b"}, "http"),
])
def test_validacion(cliente, cuerpo, texto):
    login(cliente)
    r = cliente.post(f"{API}/wifi", json=cuerpo)
    assert r.status_code == 400 and texto in r.json()["error"], r.text


def test_requiere_sesion(cliente):
    assert cliente.get(f"{API}/wifi").status_code == 401
    assert cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE}).status_code == 401
    assert cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE}, headers=auth()).status_code == 401   # token de dispositivo no sirve


def test_flujo_completo_un_solo_uso(cliente):
    login(cliente)
    r = cliente.post(f"{API}/wifi", json={"ssid": "Casa Sombra 2", "clave": CLAVE, "url": "https://em-sif.onrender.com/"})
    assert r.status_code == 200, r.text
    c = r.json()["comando"]
    assert c["tipo"] == "wifi" and c["estado"] == "pendiente"
    assert c["parametros"] == {"ssid": "Casa Sombra 2", "url": "https://em-sif.onrender.com", "clave": "nueva"}
    assert CLAVE not in r.text and "sobre" not in r.text
    assert CLAVE not in _todo_bd(cliente)                    # en la BD solo va cifrada
    assert "sobre" in json.loads(_filas(cliente)[0]["parametros"])
    # un segundo cambio mientras hay uno abierto: 409; un OTA sí se puede a la vez
    assert cliente.post(f"{API}/wifi", json={"ssid": "Otra", "clave": CLAVE}).status_code == 409
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 10}).status_code == 200
    # la receptora lo recibe en el latido junto con el OTA
    resp = cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}, headers=auth()).json()
    w = [x for x in resp["comandos"] if x["tipo"] == "wifi"]
    assert len(w) == 1 and set(w[0]) == {"id", "tipo", "nonce", "datos", "mac"}
    assert {x["tipo"] for x in resp["comandos"]} == {"wifi", "ota"}
    assert wifi_cmd.descifrar(TOKEN, w[0]["id"], w[0])["clave"] == CLAVE
    assert cliente.get(f"{API}/wifi").json()["comandos"][0]["estado"] == "entregado_receptora"
    # la receptora avisa "activo" (probando): el sobre se borra del servidor
    u = f"{API}/v1/comandos/{c['id']}/estado"
    assert cliente.post(u, json={"estado": "enviado_emisora"}, headers=auth()).status_code == 409
    assert cliente.post(u, json={"estado": "activo", "detalle": "probando"}, headers=auth()).status_code == 200
    assert "sobre" not in json.loads(_filas(cliente)[0]["parametros"])
    assert cliente.post(u, json={"estado": "completado", "detalle": "conectado a Casa Sombra 2"}, headers=auth()).status_code == 200
    # el latido de la receptora informa la red nueva (sin clave)
    cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1", "firmware": "receptora-4.4.0", "wifi_ssid": "Casa Sombra 2",
                                          "wifi_fuente": "nvs", "wifi_con_clave": True}, headers=auth())
    e = cliente.get(f"{API}/wifi").json()
    assert e["receptora"]["ssid"] == "Casa Sombra 2" and e["receptora"]["clave"] == "configurada" and e["receptora"]["fuente"] == "nvs"
    assert e["comandos"][0]["estado"] == "completado" and "ya usa la red nueva" in e["comandos"][0]["estado_texto"]
    assert CLAVE not in json.dumps(e)
    # la lista de OTA (Mantenimiento) puede filtrar por tipo
    assert all(x["tipo"] == "ota" for x in cliente.get(f"{API}/comandos?tipo=ota").json()["comandos"])


def test_fallido_completado_directo_y_reentrega(cliente):
    login(cliente)
    c = cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE}).json()["comando"]
    k = cx(cliente)
    t = c["creado"]
    assert sv.comandos_para_entrega(k, "nodo1", t)["comandos"][0]["id"] == c["id"]
    assert sv.comandos_para_entrega(k, "nodo1", t + 60)["comandos"] == []
    assert sv.comandos_para_entrega(k, "nodo1", t + 301)["comandos"][0]["mac"]          # respuesta perdida: re-entrega
    k.commit()
    k.s.close()
    u = f"{API}/v1/comandos/{c['id']}/estado"
    assert cliente.post(u, json={"estado": "fallido", "detalle": "no conecto; se volvio a Vieja"}, headers=auth()).status_code == 200
    assert "sobre" not in json.loads(_filas(cliente)[0]["parametros"])
    # el siguiente puede ir directo a completado (si el "activo" se perdió)
    c2 = cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": "", "conservar_clave": True}).json()["comando"]
    assert c2["parametros"]["clave"] == "conservar"
    cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}, headers=auth())
    u2 = f"{API}/v1/comandos/{c2['id']}/estado"
    assert cliente.post(u2, json={"estado": "completado"}, headers=auth()).status_code == 200


def test_cancelar_y_expirar_borran_el_sobre(cliente):
    login(cliente)
    c = cliente.post(f"{API}/wifi", json={"ssid": "Abierta", "clave": "", "red_abierta": True}).json()["comando"]
    assert c["parametros"]["clave"] == "vacía"
    assert cliente.post(f"{API}/comandos/{c['id']}/cancelar").json()["comando"]["estado"] == "cancelado"
    assert "sobre" not in json.loads(_filas(cliente)[0]["parametros"])
    c2 = cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE}).json()["comando"]
    k = cx(cliente)
    sv.expirar_comandos(k, c2["creado"] + sv.EXPIRA_WIFI_S + 1)
    k.commit()
    k.s.close()
    f = _filas(cliente)[1]
    assert f["estado"] == "expirado" and "sobre" not in json.loads(f["parametros"])
    assert CLAVE not in _todo_bd(cliente)


def test_sin_token_no_se_puede_cifrar(cliente):
    login(cliente)
    from estacion.ajustes import ajustes
    viejo, ajustes.ingest_token = ajustes.ingest_token, ""
    try:
        r = cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE})
        assert r.status_code == 409 and "INGEST_TOKEN" in r.json()["error"]
    finally:
        ajustes.ingest_token = viejo


def test_firmware_viejo_lo_rechaza_y_no_rompe_ota(cliente):
    """Una receptora v4.3 contesta 'fallido' (tipo no soportado) y el OTA sigue funcionando."""
    login(cliente)
    c = cliente.post(f"{API}/wifi", json={"ssid": "Red", "clave": CLAVE}).json()["comando"]
    cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}, headers=auth())
    u = f"{API}/v1/comandos/{c['id']}/estado"
    assert cliente.post(u, json={"estado": "fallido", "detalle": "tipo de comando no soportado por la receptora"},
                        headers=auth()).status_code == 200
    o = cliente.post(f"{API}/comandos", json={"duracion_min": 15}).json()["comando"]
    assert o["tipo"] == "ota" and o["estado"] == "pendiente"
