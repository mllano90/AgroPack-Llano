"""Comando enlace (prueba de canales LoRa, contrato v4.5.3) y latido canal_lora/prueba_enlace."""
import json

from conftest import auth, cx, login

from estacion import enlace_cmd
from estacion import servicio as sv

API = "/api/estacion"
NONCE = bytes.fromhex("000102030405060708090a0b0c0d0e0f")


def test_vector_de_cifrado_del_contrato():
    s = enlace_cmd.cifrar("token-de-prueba-no-real", 123, "usar", 9, NONCE)
    assert s["nonce"] == NONCE.hex()
    assert s["datos"] == "55fa137a6bb2626597aa70"
    assert s["mac"] == "0b62c65dffcb9caa529ca18e5ae179fa"
    try:
        enlace_cmd.validar("prueba", 5)
        raise AssertionError("n debía rechazarse")
    except enlace_cmd.EnlaceInvalido:
        pass


def test_crear_entrega_y_no_publica_el_sobre(cliente):
    login(cliente)
    r = cliente.post(f"{API}/enlace", json={"accion": "usar", "n": 7})
    assert r.status_code == 200, r.text
    pub = r.json()["comando"]
    assert pub["tipo"] == "enlace" and pub["parametros"] == {"accion": "usar", "n": 7}
    assert "sobre" not in json.dumps(pub)
    k = cx(cliente)
    try:
        fila = k.uno("SELECT parametros FROM estacion_comandos WHERE id = ?", (pub["id"],))
        sobre = json.loads(fila["parametros"])["sobre"]
        assert sobre["mac"] and "ENL1" not in sobre["datos"]
        ent = sv.comandos_para_entrega(k, "nodo1", pub["creado"])
        cmd = ent["comandos"][0]
        assert cmd == {"id": pub["id"], "tipo": "enlace", "nonce": sobre["nonce"], "datos": sobre["datos"], "mac": sobre["mac"]}
    finally:
        k.s.close()


def test_reglas_de_comandos_abiertos(cliente):
    login(cliente)
    a = cliente.post(f"{API}/enlace", json={"accion": "prueba", "n": 0}).json()["comando"]
    assert cliente.post(f"{API}/enlace", json={"accion": "usar", "n": 3}).status_code == 409
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 15}).status_code == 409
    ok = cliente.post(f"{API}/enlace", json={"accion": "cancelar", "n": 0})
    assert ok.status_code == 200 and ok.json()["comando"]["parametros"]["accion"] == "cancelar"
    assert cliente.post(f"{API}/enlace", json={"accion": "fabrica", "n": 0}).status_code == 409
    assert a["id"]


def test_vencimiento_sin_activo_y_activo(cliente):
    login(cliente)
    c = cliente.post(f"{API}/enlace", json={"accion": "prueba", "n": 0}).json()["comando"]
    k = cx(cliente)
    try:
        sv.expirar_comandos(k, c["creado"] + sv.EXPIRA_ENLACE_SIN_ACTIVO_S - 1)
        assert k.uno("SELECT estado FROM estacion_comandos WHERE id = ?", (c["id"],))["estado"] == "pendiente"
        sv.expirar_comandos(k, c["creado"] + sv.EXPIRA_ENLACE_SIN_ACTIVO_S + 1)
        assert k.uno("SELECT estado FROM estacion_comandos WHERE id = ?", (c["id"],))["estado"] == "expirado"
        otro = sv.crear_comando_enlace(k, "nodo1", "usar", 2, "admin", t=c["creado"] + 100)
        sv.comandos_para_entrega(k, "nodo1", otro["creado"])
        assert sv.reportar_comando(k, otro["id"], {"estado": "enviado_emisora"}, otro["creado"] + 10)[0] == 200
        assert sv.reportar_comando(k, otro["id"], {"estado": "activo", "detalle": "prueba en curso: combinacion 1/10 (~87 s)"},
                                   otro["creado"] + 20)[0] == 200
        sv.expirar_comandos(k, otro["creado"] + 20 + sv.EXPIRA_ENLACE_ACTIVO_S - 1)
        assert k.uno("SELECT estado FROM estacion_comandos WHERE id = ?", (otro["id"],))["estado"] == "activo"
        sv.expirar_comandos(k, otro["creado"] + 20 + sv.EXPIRA_ENLACE_ACTIVO_S + 1)
        assert k.uno("SELECT estado FROM estacion_comandos WHERE id = ?", (otro["id"],))["estado"] == "expirado"
        guardado = k.uno("SELECT parametros FROM estacion_comandos WHERE id = ?", (otro["id"],))
        assert "sobre" not in guardado["parametros"]
    finally:
        k.s.close()


def _latido(canal, prueba):
    return {"nodo": "nodo1", "ts": 1794000000, "recibidos": 3, "canal_lora": canal, "prueba_enlace": prueba}


_CANAL = {"activo": 4, "fabrica": False, "mhz": 923.3, "sf": 7, "bw_khz": 125.0, "confirmado": True,
          "anterior": 0, "sin_paquetes_s": 40, "fallback": None}
_PRUEBA = {"estado": "terminada", "comando_id": 41, "combinacion": 10, "total": 10, "recomendada": 4,
           "tabla": [{"n": 4, "mhz": 923.3, "sf": 7, "bw_khz": 125.0, "toa_ms": 46.3, "enviados": 20,
                      "recibidos": 20, "perdida_pct": 0.0, "rssi_prom": -95, "snr_prom": 8.0,
                      "margen_snr_db": 15.5, "apta": "apta", "probada": True}]}


def test_latido_guarda_canal_y_prueba(cliente):
    assert cliente.post(f"{API}/v1/estado", json=_latido(_CANAL, _PRUEBA), headers=auth()).status_code == 200
    login(cliente)
    e = cliente.get(f"{API}/enlace").json()
    assert e["canal_lora"]["activo"] == 4 and e["canal_lora"]["mhz"] == 923.3
    assert e["prueba_enlace"]["recomendada"] == 4 and e["prueba_enlace"]["tabla"][0]["n"] == 4
    malo = _latido({"activo": 99, "fabrica": False}, _PRUEBA)
    assert cliente.post(f"{API}/v1/estado", json=malo, headers=auth()).status_code == 400
    enorme = dict(_PRUEBA, tabla=[{"n": 1, "nota": "x" * 5000}])
    assert cliente.post(f"{API}/v1/estado", json=_latido(_CANAL, enorme), headers=auth()).status_code == 400
