"""Decodificación del paquete LoRa CSV de la emisora.

v4.2 (24 campos), réplica de rx::parsear() en receptora/receptora_logica.h:
  T,seq,eA1,T1,H1,eA2,T2,H2,ePir,Pir,eS,Hs,Ts,EC,pH,N,P,K,nNPK,edadNPK,fase,minFase,totFase,epoch
También 23 campos (emisora v3/v4 sin hora => epoch 0).

La receptora actual manda 27 campos. Los 22 de sensores no se mueven y el
epoch sigue en el campo 24. La caja interna va al final: eInt,Tint,Hint.
El sensor de suelo (FC03) queda en las mismas posiciones.
"""
import re

EPOCH_MIN = 1704067200      # 2024-01-01
EPOCH_MAX = 4102444800      # 2100-01-01
MIN_TH_SUELO = 6
NPK_MIN_VALIDAS = 3
ERR_SIN_DATO = 0xFF
# El peor paquete válido de 27 campos (int16 al límite + epoch) mide 157.
MAX_CSV = 160

CODIGOS_ERROR = {0: "OK", 0xE2: "timeout (0xE2)", 0xE3: "CRC (0xE3)", 0xF0: "fuera de rango (0xF0)",
                 0xFF: "aún sin dato (0xFF)"}

_ENTERO = re.compile(r"^[+-]?\d+$")


class PaqueteInvalido(ValueError):
    pass


def texto_error(cod: int) -> str:
    return CODIGOS_ERROR.get(cod, f"Modbus 0x{cod:02X}")


def _es_epoch(v: int) -> bool:
    return v == 0 or EPOCH_MIN <= v <= EPOCH_MAX


def _es_i16(v: int) -> bool:
    return -32768 <= v <= 32767


def _caja_interna(nums: list[int]):
    """(epoch, eInt, Tint, Hint) con el epoch todavía en el campo 24 y la caja al final."""
    if _es_epoch(nums[22]) and 0 <= nums[23] <= 255 and _es_i16(nums[24]) and _es_i16(nums[25]):
        return nums[22], nums[23], nums[24], nums[25]
    return None


def parsear(txt: str) -> dict:
    if not isinstance(txt, str):
        raise PaqueteInvalido("csv debe ser texto")
    txt = txt.rstrip("\r\n")
    if len(txt) < 2 or len(txt) > MAX_CSV:
        raise PaqueteInvalido(f"largo fuera de 2..{MAX_CSV}")
    if txt[0] not in "DC" or txt[1] != ",":
        raise PaqueteInvalido("tipo debe ser 'D' o 'C'")
    campos = txt[2:].split(",")
    # 22 = 23 campos sin epoch; 23 = 24 con epoch; 26 = 27 con caja interna.
    if len(campos) not in (22, 23, 26):
        raise PaqueteInvalido(f"se esperaban 24 campos (o 23, o 27 con caja interna), llegaron {len(campos) + 1}")
    for i, c in enumerate(campos):
        if not _ENTERO.match(c.strip()) or (i == 22 and len(campos) != 26 and c.strip().startswith(("-", "+"))):
            raise PaqueteInvalido(f"campo {i + 2} no numérico: {c!r}")
    nums = [int(c) for c in campos]
    v = nums[:22]
    if len(campos) == 26:
        caja = _caja_interna(nums)
        if caja is None:
            raise PaqueteInvalido("paquete de 27 campos: la caja interna no cuadra sin mover los sensores")
        epoch, e_int, tint, hint = caja
    else:
        epoch = nums[22] if len(campos) == 23 else 0
        e_int = tint = hint = None
    if epoch != 0 and not (EPOCH_MIN <= epoch <= EPOCH_MAX):
        raise PaqueteInvalido("epoch fuera de 2024..2100")
    if not 0 <= v[0] <= 65535:
        raise PaqueteInvalido("seq fuera de 0..65535")
    if any(not _es_i16(x) for x in v[1:]):
        raise PaqueteInvalido("valor fuera de int16")
    if any(not 0 <= v[i] <= 255 for i in (1, 4, 7, 9)):
        raise PaqueteInvalido("código de error fuera de 0..255")
    if not 0 <= v[17] <= 255 or not 0 <= v[19] <= 2 or not 0 <= v[20] <= 255 or not 0 <= v[21] <= 255:
        raise PaqueteInvalido("nNPK/fase/minFase/totFase fuera de rango")
    return {
        "tipo": txt[0], "seq": v[0],
        "e_a1": v[1], "t1_x10": v[2], "h1_x10": v[3],
        "e_a2": v[4], "t2_x10": v[5], "h2_x10": v[6],
        "e_pir": v[7], "pir": v[8],
        "e_suelo": v[9], "hs_x10": v[10], "ts_x10": v[11],
        "ec_us": v[12], "ph_x10": v[13], "n": v[14], "p": v[15], "k": v[16],
        "n_npk": v[17], "edad_npk": v[18],
        "fase": v[19], "min_fase": v[20], "tot_fase": v[21],
        "epoch": epoch,
        "e_int": e_int, "tint_x10": tint, "hint_x10": hint,
    }


def minuto_lectura_suelo(p: dict) -> int:
    """Como rx::minutoLecturaSuelo: -1 = T/H de suelo leído en ESTE paquete; si no, minuto del ciclo."""
    if p["fase"] != 0:
        return -1
    if p["min_fase"] % MIN_TH_SUELO == 0:
        return -1
    return p["min_fase"] - p["min_fase"] % MIN_TH_SUELO


def decodificar(p: dict, ts: int) -> dict:
    """Convierte a unidades físicas. Un valor con error del sensor queda en None (nunca 0)."""
    ok = lambda e: e == 0
    d = {
        "t1": p["t1_x10"] / 10 if ok(p["e_a1"]) else None,
        "h1": p["h1_x10"] / 10 if ok(p["e_a1"]) else None,
        "t2": p["t2_x10"] / 10 if ok(p["e_a2"]) else None,
        "h2": p["h2_x10"] / 10 if ok(p["e_a2"]) else None,
        "pir": float(p["pir"]) if ok(p["e_pir"]) else None,
        "h_suelo": p["hs_x10"] / 10 if ok(p["e_suelo"]) else None,
        "t_suelo": p["ts_x10"] / 10 if ok(p["e_suelo"]) else None,
    }
    m = minuto_lectura_suelo(p)
    edad_suelo_min = 0 if m < 0 else p["min_fase"] - m
    d["ts_suelo"] = ts - edad_suelo_min * 60 if p["e_suelo"] != ERR_SIN_DATO else None
    d["suelo_nuevo"] = 1 if m < 0 else 0
    if p["edad_npk"] >= 0:      # hay un NPK válido (el último) en EC/pH/N/P/K
        d.update(ec=p["ec_us"] / 1000.0, ph=p["ph_x10"] / 10, n=p["n"], p=p["p"], k=p["k"],
                 ts_npk=ts - p["edad_npk"] * 60)
    else:
        d.update(ec=None, ph=None, n=None, p=None, k=None, ts_npk=None)
    # La caja interna no entra al promedio de aire. Sin esos campos (23/24) queda en None.
    if p.get("e_int") is None:
        d.update(e_int=None, t_int=None, h_int=None)
    else:
        ok_int = p["e_int"] == 0
        d.update(e_int=p["e_int"],
                 t_int=p["tint_x10"] / 10 if ok_int else None,
                 h_int=p["hint_x10"] / 10 if ok_int else None)
    # En un 'C' con nNPK < 3 el muestreo de este ciclo FALLÓ (EC/pH/NPK son del último válido)
    d["npk_fallo"] = 1 if (p["tipo"] == "C" and p["n_npk"] < NPK_MIN_VALIDAS) else 0
    return d
