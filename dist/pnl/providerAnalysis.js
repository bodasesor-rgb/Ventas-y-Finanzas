"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildYearAnalysis = buildYearAnalysis;
const counterparties_1 = require("./counterparties");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function absGasto(n) {
    return Math.abs(Math.min(0, n));
}
function lineCounterparty(line) {
    if (line.counterparty && line.counterpartyKind) {
        return { name: line.counterparty, kind: line.counterpartyKind };
    }
    if (line.category === "socio") {
        const hit = (0, counterparties_1.classifyCounterparty)(line.description);
        return {
            name: hit?.name || counterparties_1.PARTNER_NAMES[0],
            kind: "socio",
        };
    }
    if (line.category === "proveedor") {
        const hit = (0, counterparties_1.classifyCounterparty)(line.description);
        return {
            name: hit?.name || line.description.slice(0, 40),
            kind: "proveedor",
        };
    }
    const hit = (0, counterparties_1.classifyCounterparty)(line.description);
    if (!hit)
        return null;
    return { name: hit.name, kind: hit.kind };
}
function buildYearAnalysis(runs, year = 2026) {
    const yearRuns = runs.filter((r) => String(r.periodKey || "").startsWith(`${year}-`));
    const byProvider = new Map();
    const catTotals = new Map();
    const monthMap = new Map();
    for (const run of yearRuns) {
        const key = run.periodKey || "sin-mes";
        if (!monthMap.has(key)) {
            monthMap.set(key, {
                periodKey: key,
                periodLabel: run.periodLabel || key,
                ingresos: 0,
                gastos: 0,
                neto: 0,
                socios: 0,
                proveedores: 0,
                ads: 0,
                apps: 0,
                comisiones: 0,
                servicios: 0,
                otrosGastos: 0,
                topProveedores: [],
                cuadra: run.reconciliation?.matchCompleto ?? null,
            });
        }
        const m = monthMap.get(key);
        const t = run.totals || { ingresos: 0, gastos: 0, neto: 0 };
        // Un run por mes: tomar totales del run (no sumar duplicados)
        m.ingresos = t.ingresos;
        m.gastos = t.gastos;
        m.neto = t.neto;
        m.cuadra = run.reconciliation?.matchCompleto ?? m.cuadra;
        m.ads = run.summaryByCategory?.ads || 0;
        m.apps = run.summaryByCategory?.apps || 0;
        m.comisiones = run.summaryByCategory?.comisiones || 0;
        m.servicios = run.summaryByCategory?.servicios || 0;
        for (const [cid, amt] of Object.entries(run.summaryByCategory || {})) {
            catTotals.set(cid, (catTotals.get(cid) || 0) + amt);
        }
        const monthProv = new Map();
        let socios = 0;
        let proveedores = 0;
        let otrosGastos = 0;
        for (const line of run.lines || []) {
            if (line.direction === "abono" || line.amount >= 0)
                continue;
            const spend = absGasto(line.amount);
            const cp = lineCounterparty(line);
            if (cp) {
                const agg = byProvider.get(cp.name) || {
                    name: cp.name,
                    kind: cp.kind,
                    total: 0,
                    payments: 0,
                    byMonth: {},
                };
                agg.total += spend;
                agg.payments += 1;
                agg.byMonth[key] = (agg.byMonth[key] || 0) + spend;
                byProvider.set(cp.name, agg);
                if (cp.kind === "socio")
                    socios += spend;
                else {
                    proveedores += spend;
                    const mp = monthProv.get(cp.name) || { total: 0, payments: 0 };
                    mp.total += spend;
                    mp.payments += 1;
                    monthProv.set(cp.name, mp);
                }
            }
            else if (!["ads", "apps", "pass", "comisiones", "servicios"].includes(line.category)) {
                otrosGastos += spend;
            }
        }
        m.socios = round2(socios);
        m.proveedores = round2(proveedores);
        m.otrosGastos = round2(otrosGastos);
        m.topProveedores = Array.from(monthProv.entries())
            .map(([name, v]) => ({
            name,
            total: round2(v.total),
            payments: v.payments,
        }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);
    }
    const providers = Array.from(byProvider.values()).filter((p) => p.kind === "proveedor");
    const socios = Array.from(byProvider.values()).filter((p) => p.kind === "socio");
    const proveedoresTotal = providers.reduce((s, p) => s + p.total, 0);
    const sociosTotal = socios.reduce((s, p) => s + p.total, 0);
    const topProveedores = providers
        .map((p) => ({
        name: p.name,
        kind: p.kind,
        total: round2(p.total),
        payments: p.payments,
        shareOfProviders: proveedoresTotal > 0
            ? round2((p.total / proveedoresTotal) * 100) / 100
            : 0,
        byMonth: Object.fromEntries(Object.entries(p.byMonth).map(([k, v]) => [k, round2(v)])),
    }))
        .sort((a, b) => b.total - a.total);
    const top5 = topProveedores.slice(0, 5);
    const top1 = top5[0]?.total || 0;
    const top3 = top5.slice(0, 3).reduce((s, p) => s + p.total, 0);
    const top5Sum = top5.reduce((s, p) => s + p.total, 0);
    const byMonth = Array.from(monthMap.values()).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    const ingresos = round2(byMonth.reduce((s, m) => s + m.ingresos, 0));
    const gastos = round2(byMonth.reduce((s, m) => s + m.gastos, 0));
    return {
        year,
        monthsPresent: byMonth.map((m) => m.periodKey),
        runsCount: yearRuns.length,
        ingresos,
        gastos,
        neto: round2(ingresos + gastos),
        sociosTotal: round2(sociosTotal),
        proveedoresTotal: round2(proveedoresTotal),
        topProveedores,
        top5Proveedores: top5,
        socios: socios
            .map((p) => ({
            name: p.name,
            kind: "socio",
            total: round2(p.total),
            payments: p.payments,
            shareOfProviders: 0,
            byMonth: Object.fromEntries(Object.entries(p.byMonth).map(([k, v]) => [k, round2(v)])),
        }))
            .sort((a, b) => b.total - a.total),
        concentracion: {
            top1Share: proveedoresTotal > 0
                ? round2((top1 / proveedoresTotal) * 100) / 100
                : 0,
            top3Share: proveedoresTotal > 0
                ? round2((top3 / proveedoresTotal) * 100) / 100
                : 0,
            top5Share: proveedoresTotal > 0
                ? round2((top5Sum / proveedoresTotal) * 100) / 100
                : 0,
        },
        byMonth,
        byCategory: Array.from(catTotals.entries())
            .map(([id, total]) => ({ id, total: round2(total) }))
            .sort((a, b) => a.total - b.total),
    };
}
//# sourceMappingURL=providerAnalysis.js.map