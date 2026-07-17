# Fase 3 — Fórmulas del Sheet (pegar a mano)

Pestaña de datos: **Eventos 2026**  
El bot **no** escribe estas fórmulas en Metricas/P&L; solo documentadas aquí.

## Mapa de columnas (Eventos 2026)

| Col | Campo | Quién |
|-----|--------|--------|
| A | Cliente | bot |
| B | Fecha del evento | manual / Jotform |
| C | Fecha de cierre | bot |
| D | Telefono | bot |
| E | Correo | bot |
| F | Tipo de evento | bot |
| G | Invitados | manual / Jotform |
| H | Dirección de evento | manual / Jotform |
| I | Horario | manual / Jotform |
| J | Venta | bot |
| K | Costo | **manual** |
| L | Pagado | **manual** |
| M | Por pagar | **fórmula** |
| N | Ganancia | **fórmula** |
| O | Margen | **fórmula** |
| P | Link cotización | bot |
| Q | Mes cierre | bot |
| R | Forma de Pago | bot |
| S | IVA | manual |
| T | Kommo Deal ID | bot |

---

## 1) Fórmulas por fila (Eventos 2026)

En la **fila 2** (y arrastra hacia abajo):

**M2 — Por pagar** (`Venta − Pagado`):
```
=IF(J2="","",J2-IF(L2="",0,L2))
```

**N2 — Ganancia** (`Venta − Costo`):
```
=IF(J2="","",J2-IF(K2="",0,K2))
```

**O2 — Margen** (`Ganancia / Venta`):
```
=IF(OR(J2="",J2=0),"",N2/J2)
```
Formato de O: **Porcentaje**.

> Tip: selecciona M2:O2 → doble clic en el tirador para rellenar todas las filas con datos.

El Apps Script nuevo también pone estas 3 fórmulas al **append** de una fila nueva.

---

## 2) Tabla mensual (resumen)

Puede vivir a la derecha de Eventos (como ya tienes en W) o en **Metricas 2026**.  
Encabezados sugeridos en `W3:AB3`:

| W | X | Y | Z | AA | AB |
|---|---|---|---|----|----|
| Mes | Pagado | Por pagar | Valor total | Ganancia total | # Eventos |

En `W4:W15` pon los meses `1` … `12`.

Fila del mes **1** (`W4=1`):

**X4 — Pagado** (suma Pagado donde Mes cierre = 1):
```
=SUMIF($Q:$Q,W4,$L:$L)
```

**Y4 — Por pagar**:
```
=SUMIF($Q:$Q,W4,$M:$M)
```

**Z4 — Valor total** (suma Venta):
```
=SUMIF($Q:$Q,W4,$J:$J)
```

**AA4 — Ganancia total**:
```
=SUMIF($Q:$Q,W4,$N:$N)
```

**AB4 — # Eventos** (filas con ese mes y con Cliente no vacío):
```
=COUNTIFS($Q:$Q,W4,$A:$A,"<>")
```

Copia `X4:AB4` hacia abajo hasta el mes 12 (`W15`).

**Total anual** (ej. fila 16):
```
=SUM(X4:X15)   → Pagado
=SUM(Y4:Y15)   → Por pagar
=SUM(Z4:Z15)   → Valor total
=SUM(AA4:AA15) → Ganancia total
=SUM(AB4:AB15) → # Eventos
```

---

## 3) Metricas 2026 / P&L 2026

El bot **no** escribe ahí. Si quieres los mismos totales en otra pestaña, referencia Eventos:

Ejemplo en Metricas, celda de “Venta mes 1”:
```
=SUMIF('Eventos 2026'!$Q:$Q,1,'Eventos 2026'!$J:$J)
```

O enlaza a la tabla mensual de Eventos:
```
='Eventos 2026'!Z4
```

---

## 4) Importante sobre Costo / Pagado

- Tú los editas a mano.
- El bot **nunca** los pisa en un update (solo escribe A–J, P–R, T).
- Por eso Por pagar / Ganancia / Margen deben ser **fórmulas**, no valores fijos del bot.
