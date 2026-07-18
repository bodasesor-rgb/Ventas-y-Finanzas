# Enlace completo del Sheet (Eventos → Metricas → P&L)

## Cómo aplicar (recomendado)

1. Pega el Apps Script actual (`apps-script/Codigo.gs`, VERSION `2026-07-18-v8`).
2. Guarda.
3. En el editor: selecciona la función **`setupAll_`** → ▶ Ejecutar → autoriza (solo 1ª vez).
4. **Implementar → Administrar implementaciones → Editar → Nueva versión → Implementar** (misma URL `/exec`).
5. La primera vez con v8 Google pedirá permiso de **Drive** (PDFs persistentes).
6. Confirma en un sync / envío que `version` sea `2026-07-18-v8`.

Eso hace:

| Qué | Dónde |
|-----|--------|
| Fórmulas Por pagar / Ganancia / Margen | Eventos 2026 cols M/N/O |
| Tabla mensual viva (SUMIF) | Eventos 2026 `W3:AB16` |
| Mirror mensual | Metricas 2026 |
| Ingresos / Costo / Ganancia / Margen | P&L 2026 |

El bot **sigue escribiendo solo** en Eventos YYYY. Metricas y P&L son fórmulas.

---

## Mapa Eventos 2026 (A–T)

| Col | Campo | Quién |
|-----|--------|--------|
| A–J, P–R, T | datos Kommo / logística | bot (+ Jotform luego) |
| K Costo, L Pagado, S IVA | manual | tú |
| M Por pagar, N Ganancia, O Margen | fórmula | Sheet / setup |

---

## Fórmulas (si las pegas a mano)

### Por fila
```
M2 =IF(J2="","",J2-IF(L2="",0,L2))
N2 =IF(J2="","",J2-IF(K2="",0,K2))
O2 =IF(OR(J2="",J2=0),"",N2/J2)
```

### Tabla mensual (W4 con mes=1)
```
X4  =SUMIF($Q:$Q,W4,$L:$L)
Y4  =SUMIF($Q:$Q,W4,$M:$M)
Z4  =SUMIF($Q:$Q,W4,$J:$J)
AA4 =SUMIF($Q:$Q,W4,$N:$N)
AB4 =COUNTIFS($Q:$Q,W4,$A:$A,"<>")
```

### Metricas (ejemplo mes 1)
```
B4 ='Eventos 2026'!X4
```

### P&L costo mes 1
```
C4 =SUMIF('Eventos 2026'!$Q:$Q,A4,'Eventos 2026'!$K:$K)
```
