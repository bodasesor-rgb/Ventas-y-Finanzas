# Enlace Sheet (Eventos · Banco · P&L · Metricas)

## Cómo aplicar (v15)

1. Pega `apps-script/Codigo.gs` (VERSION `2026-07-18-v15`).
2. Guarda.
3. **`authorizeDrive_`** → ▶ Ejecutar (si usas archive PDFs).
4. **`restorePnLBanco_`** → ▶ Ejecutar (solo P&L de estados de cuenta; **no toca Metricas**).
5. Implementar → Nueva versión → misma URL `/exec`.
6. Confirma en `/exec` que `version` sea `2026-07-18-v15`.

**Regla v15**

| Acción | Qué escribe / toca |
|--------|---------------------|
| Enviar al P&L (`/pnl/`) | Solo fila en **Banco YYYY** (1 mes) |
| Fórmulas P&L | **P&L YYYY** lee Banco por mes |
| Metricas | **Nunca** la toca el bot |
| Kommo cierres | Solo **Eventos YYYY** |

No ejecutes `setupMetricas_` ni la vieja `restoreMetricasPnL_` si quieres conservar tu dashboard restaurado. En v15, `restoreMetricasPnL_` solo regenera el P&L banco.

---

## Flujo P&L banco

```
PDF Banamex → /pnl/ parse → Enviar al P&L
       ↓
  Banco 2026 (1 fila / mes: ingresos, gastos, categorías, socios, proveedores)
       ↓  fórmulas SUMIF
  P&L 2026 (columnas Ene…Dic + Total)
```

---

## Mapa Eventos 2026 (A–T)

| Col | Campo | Quién |
|-----|--------|--------|
| A–J, P–R, T | datos Kommo / logística | bot (+ Jotform luego) |
| K Costo, L Pagado, S IVA | manual | tú |
| M Por pagar, N Ganancia, O Margen | fórmula | Sheet / setup |

### Por fila
```
M2 =IF(J2="","",J2-IF(L2="",0,L2))
N2 =IF(J2="","",J2-IF(K2="",0,K2))
O2 =IF(OR(J2="",J2=0),"",N2/J2)
```

### Tabla mensual Eventos (W4 con mes=1)
```
X4  =SUMIF($Q:$Q,W4,$L:$L)
Y4  =SUMIF($Q:$Q,W4,$M:$M)
Z4  =SUMIF($Q:$Q,W4,$J:$J)
AA4 =SUMIF($Q:$Q,W4,$N:$N)
AB4 =COUNTIFS($Q:$Q,W4,$A:$A,"<>")
```

### P&L banco (ejemplo Ingresos, mes 1 = col B fila 6)
```
B6 =IFERROR(SUMIF('Banco 2026'!$A:$A,1,'Banco 2026'!$D:$D),0)
```
