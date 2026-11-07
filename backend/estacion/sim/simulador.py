"""Serie de 7 días para test_simulador_7_dias.

El tarball no traía el simulador original. Esta serie cabe en la retención,
incluye un hueco, errores de sensor, un NPK fallido, un solo reinicio y
algunos duplicados.
"""
import time


def _csv(seq, epoch, tipo="D", e_a2=0, e_pir=0, e_suelo=0, n_npk=6):
    return (
        f"{tipo},{seq},0,253,550,{e_a2},257,540,{e_pir},420,{e_suelo},"
        f"612,241,1830,62,120,80,100,{n_npk},5,0,2,30,{epoch}"
    )


def generar(dias=7):
    ahora = int(time.time())
    fin = ahora - 3600
    inicio = fin - int(dias) * 86400
    regs = []
    seq = 1
    t = inicio
    gap_en = inicio + 2 * 86400
    error_en = inicio + 3 * 86400
    npk_en = inicio + 4 * 86400
    reinicio_en = inicio + 5 * 86400
    ya_reinicio = False
    while t <= fin:
        if gap_en <= t < gap_en + 300:
            t += 1200
            continue
        tipo, e_a2, e_pir, e_suelo, n_npk, s = "D", 0, 0, 0, 6, seq
        if error_en <= t < error_en + 300:
            e_a2, e_pir, e_suelo = 0xE2, 0xE3, 0xF0
        if npk_en <= t < npk_en + 300:
            tipo, n_npk = "C", 1
        if not ya_reinicio and t >= reinicio_en:
            s = 0
            ya_reinicio = True
            seq = 0
        regs.append({"csv": _csv(s, t, tipo, e_a2, e_pir, e_suelo, n_npk), "rssi": -80, "snr": 7})
        seq = (seq + 1) & 0xFFFF
        if seq == 0:
            seq = 1
        t += 300
    regs.extend(regs[:40])
    return regs
