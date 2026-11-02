"""Configuración editable (guardada en la tabla config como JSON)."""
import json

VARIABLES = {
    # clave: (nombre, unidad, min, max por defecto)
    "pir":     ("Radiación solar", "W/m²", 0, 1100),
    "t_aire":  ("Temperatura aire", "°C", 8, 35),
    "h_aire":  ("Humedad aire", "%", 25, 85),
    "t_suelo": ("Temperatura suelo", "°C", 15, 30),
    "h_suelo": ("Humedad suelo", "%", 35, 90),
    "ph":      ("pH suelo", "", 5.5, 7.5),
    "ec":      ("Conductividad", "dS/m", 0.5, 3.0),
    "n":       ("Nitrógeno (N)", "mg/kg", 20, 300),
    "p":       ("Fósforo (P)", "mg/kg", 10, 200),
    "k":       ("Potasio (K)", "mg/kg", 50, 400),
}

DEFAULT = {
    "nombre_nodo": "Nodo Cultivo – Casa Sombra",
    "sin_datos_min": 10,          # alerta "sin datos" tras X minutos
    "offline_min": 6,             # indicador "Sin conexión" en el header
    "bateria_min_v": 3.4,         # placeholder (futuro)
    "umbrales": {k: {"min": v[2], "max": v[3], "activo": k != "pir"} for k, v in VARIABLES.items()},
}


def leer(cx) -> dict:
    r = cx.uno("SELECT valor FROM estacion_config WHERE clave = ?", ("general",))
    cfg = json.loads(json.dumps(DEFAULT))
    if r:
        guardado = json.loads(r["valor"])
        umb = guardado.pop("umbrales", {})
        cfg.update({k: v for k, v in guardado.items() if k in DEFAULT})
        for k, u in umb.items():
            if k in cfg["umbrales"]:
                cfg["umbrales"][k].update(u)
    return cfg


def validar(nuevo: dict) -> dict:
    cfg = json.loads(json.dumps(DEFAULT))
    nombre = str(nuevo.get("nombre_nodo", cfg["nombre_nodo"])).strip()[:60]
    if not nombre:
        raise ValueError("El nombre del nodo no puede quedar vacío")
    cfg["nombre_nodo"] = nombre
    for k, (lo, hi) in {"sin_datos_min": (3, 1440), "offline_min": (3, 120)}.items():
        v = int(nuevo.get(k, cfg[k]))
        if not lo <= v <= hi:
            raise ValueError(f"{k} debe estar entre {lo} y {hi}")
        cfg[k] = v
    cfg["bateria_min_v"] = float(nuevo.get("bateria_min_v", cfg["bateria_min_v"]))
    for k, u in (nuevo.get("umbrales") or {}).items():
        if k not in cfg["umbrales"]:
            continue
        mn, mx = float(u.get("min")), float(u.get("max"))
        if mn >= mx:
            raise ValueError(f"{VARIABLES[k][0]}: el mínimo debe ser menor que el máximo")
        cfg["umbrales"][k] = {"min": mn, "max": mx, "activo": bool(u.get("activo", True))}
    return cfg


def guardar(cx, cfg: dict):
    v = json.dumps(cfg, ensure_ascii=False)
    if cx.ejecutar("UPDATE estacion_config SET valor = ? WHERE clave = ?", (v, "general")) == 0:
        cx.ejecutar("INSERT INTO estacion_config (clave, valor) VALUES (?, ?)", ("general", v))
