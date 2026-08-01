"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blogPathContains = blogPathContains;
exports.coleccionesPathContains = coleccionesPathContains;
exports.fetchGa4VisitasDaily = fetchGa4VisitasDaily;
exports.ga4Configured = ga4Configured;
const data_1 = require("@google-analytics/data");
const googleAuth_1 = require("./googleAuth");
function client_() {
    const sa = (0, googleAuth_1.loadServiceAccountJson)();
    if (!sa?.client_email || !sa?.private_key) {
        throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON para leer Google Analytics");
    }
    return new data_1.BetaAnalyticsDataClient({
        credentials: {
            client_email: sa.client_email,
            private_key: sa.private_key,
        },
    });
}
function parseRows_(rows) {
    const out = [];
    for (const row of rows || []) {
        const date = String(row.dimensionValues?.[0]?.value || "");
        const sessions = Number(row.metricValues?.[0]?.value || 0);
        if (/^\d{8}$/.test(date)) {
            out.push({ date, sessions: Number.isFinite(sessions) ? sessions : 0 });
        }
    }
    return out;
}
async function runSessionsReport_(opts) {
    const propertyId = (0, googleAuth_1.ga4PropertyId)();
    const analytics = client_();
    const [response] = await analytics.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        dimensionFilter: opts.dimensionFilter,
        limit: 100000,
    });
    return parseRows_(response.rows);
}
function pathContainsFilter_(paths) {
    const cleaned = paths.map((p) => p.trim()).filter(Boolean);
    if (!cleaned.length)
        return undefined;
    if (cleaned.length === 1) {
        return {
            filter: {
                fieldName: "pagePath",
                stringFilter: {
                    matchType: "CONTAINS",
                    value: cleaned[0],
                    caseSensitive: false,
                },
            },
        };
    }
    return {
        orGroup: {
            expressions: cleaned.map((value) => ({
                filter: {
                    fieldName: "pagePath",
                    stringFilter: {
                        matchType: "CONTAINS",
                        value,
                        caseSensitive: false,
                    },
                },
            })),
        },
    };
}
function andFilters_(...parts) {
    const exprs = parts.filter(Boolean);
    if (!exprs.length)
        return undefined;
    if (exprs.length === 1)
        return exprs[0];
    return { andGroup: { expressions: exprs } };
}
const ORGANIC_FILTER = {
    filter: {
        fieldName: "sessionDefaultChannelGroup",
        stringFilter: {
            matchType: "EXACT",
            value: "Organic Search",
            caseSensitive: false,
        },
    },
};
function blogPathContains() {
    const raw = process.env.GA4_BLOG_PATH_CONTAINS || "/blog";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function coleccionesPathContains() {
    const raw = process.env.GA4_COLECCIONES_PATH_CONTAINS ||
        "/coleccion,/collections,/catalogo,/tienda";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
/**
 * Trae sesiones diarias para llenar Metricas:
 * - site: todas
 * - organic: Organic Search
 * - blogs: organic + path blog
 * - colecciones: organic + path colecciones
 */
async function fetchGa4VisitasDaily(opts) {
    const propertyId = (0, googleAuth_1.ga4PropertyId)();
    const blogFilter = andFilters_(ORGANIC_FILTER, pathContainsFilter_(blogPathContains()));
    const colFilter = andFilters_(ORGANIC_FILTER, pathContainsFilter_(coleccionesPathContains()));
    const [site, organic, blogs, colecciones] = await Promise.all([
        runSessionsReport_({
            startDate: opts.startDate,
            endDate: opts.endDate,
        }),
        runSessionsReport_({
            startDate: opts.startDate,
            endDate: opts.endDate,
            dimensionFilter: ORGANIC_FILTER,
        }),
        runSessionsReport_({
            startDate: opts.startDate,
            endDate: opts.endDate,
            dimensionFilter: blogFilter,
        }),
        runSessionsReport_({
            startDate: opts.startDate,
            endDate: opts.endDate,
            dimensionFilter: colFilter,
        }),
    ]);
    return { site, organic, blogs, colecciones, propertyId };
}
function ga4Configured() {
    const missing = [];
    if (!process.env.GA4_PROPERTY_ID?.trim())
        missing.push("GA4_PROPERTY_ID");
    try {
        if (!(0, googleAuth_1.loadServiceAccountJson)()) {
            missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
        }
    }
    catch {
        missing.push("GOOGLE_SERVICE_ACCOUNT_JSON (inválido)");
    }
    return { ok: missing.length === 0, missing };
}
//# sourceMappingURL=ga4Client.js.map