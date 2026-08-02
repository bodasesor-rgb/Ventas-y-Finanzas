"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrevoApiKey = getBrevoApiKey;
exports.saveBrevoApiKey = saveBrevoApiKey;
exports.brevoConfigured = brevoConfigured;
exports.brevoStatus = brevoStatus;
exports.fetchBrevoAccount = fetchBrevoAccount;
exports.fetchBrevoContactsCount = fetchBrevoContactsCount;
exports.fetchBrevoSentCampaigns = fetchBrevoSentCampaigns;
exports.fetchBrevoSmtpAggregated = fetchBrevoSmtpAggregated;
exports.fetchBrevoWeekStats = fetchBrevoWeekStats;
exports.probeBrevo = probeBrevo;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const BREVO_FILE = path_1.default.join(process.cwd(), "data", "brevo.json");
const BREVO_API = "https://api.brevo.com/v3";
function readStore_() {
    try {
        if (fs_1.default.existsSync(BREVO_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(BREVO_FILE, "utf8"));
        }
    }
    catch {
        // ignore
    }
    return null;
}
function getBrevoApiKey() {
    const fromEnv = (process.env.BREVO_AUTH ||
        process.env.BREVO_API_KEY ||
        process.env.BREVO ||
        process.env.SENDINBLUE_API_KEY ||
        "").trim();
    if (fromEnv)
        return fromEnv;
    return String(readStore_()?.api_key || "").trim();
}
function saveBrevoApiKey(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key)
        throw new Error("Falta api_key de Brevo");
    fs_1.default.mkdirSync(path_1.default.dirname(BREVO_FILE), { recursive: true });
    const next = {
        api_key: key,
        updated_at: new Date().toISOString(),
    };
    fs_1.default.writeFileSync(BREVO_FILE, JSON.stringify(next, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    return next;
}
function brevoConfigured() {
    if (getBrevoApiKey())
        return { ok: true, missing: [] };
    return {
        ok: false,
        missing: ["BREVO_API_KEY o data/brevo.json"],
    };
}
function brevoStatus() {
    const cfg = brevoConfigured();
    const keys = [
        "BREVO_API_KEY",
        "BREVO",
        "SENDINBLUE_API_KEY",
    ].filter((k) => Boolean(String(process.env[k] || "").trim()));
    if (fs_1.default.existsSync(BREVO_FILE))
        keys.push("FILE:data/brevo.json");
    return {
        configured: cfg.ok,
        missing: cfg.missing,
        hasFile: fs_1.default.existsSync(BREVO_FILE),
        envKeysPresent: keys,
    };
}
async function brevoGet_(pathAndQuery) {
    const key = getBrevoApiKey();
    if (!key)
        throw new Error("Falta BREVO_API_KEY");
    const url = pathAndQuery.startsWith("http")
        ? pathAndQuery
        : `${BREVO_API}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
    const res = await fetch(url, {
        headers: {
            "api-key": key,
            Accept: "application/json",
        },
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        throw new Error(`Brevo HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
        const msg = data?.message ||
            `Brevo HTTP ${res.status}: ${text.slice(0, 300)}`;
        throw new Error(msg);
    }
    return data;
}
async function fetchBrevoAccount() {
    return brevoGet_("/account");
}
async function fetchBrevoContactsCount() {
    const data = await brevoGet_("/contacts?limit=1&offset=0");
    return Number(data.count || 0);
}
/** Campañas enviadas en rango (por sentDate). */
async function fetchBrevoSentCampaigns(opts) {
    const start = encodeURIComponent(`${opts.startDate}T00:00:00.000Z`);
    const end = encodeURIComponent(`${opts.endDate}T23:59:59.999Z`);
    const out = [];
    let offset = 0;
    const limit = 50;
    for (let page = 0; page < 40; page++) {
        const data = await brevoGet_(`/emailCampaigns?type=classic&status=sent&statistics=globalStats` +
            `&startDate=${start}&endDate=${end}&limit=${limit}&offset=${offset}`);
        const batch = data.campaigns || [];
        if (!batch.length)
            break;
        out.push(...batch);
        offset += batch.length;
        if (batch.length < limit)
            break;
    }
    return out;
}
/**
 * SMTP / transactional aggregated (opcional, suma a correos si hay volumen).
 * GET /smtp/statistics/aggregatedReport
 */
async function fetchBrevoSmtpAggregated(opts) {
    try {
        return await brevoGet_(`/smtp/statistics/aggregatedReport?startDate=${opts.startDate}&endDate=${opts.endDate}&days=90`);
    }
    catch {
        return {};
    }
}
function num_(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function campaignInWeek_(sentDate, since, until) {
    if (!sentDate)
        return false;
    const day = sentDate.slice(0, 10);
    return day >= since && day <= until;
}
/** Agrega stats de campañas (+ SMTP) por semana. */
async function fetchBrevoWeekStats(weeks, opts) {
    if (!weeks.length)
        return [];
    const rangeStart = weeks[0].since;
    const rangeEnd = weeks[weeks.length - 1].until;
    const [contactos, campaigns] = await Promise.all([
        fetchBrevoContactsCount(),
        fetchBrevoSentCampaigns({ startDate: rangeStart, endDate: rangeEnd }),
    ]);
    let smtpByWeek = null;
    if (opts?.includeSmtp !== false) {
        smtpByWeek = [];
        for (const w of weeks) {
            const smtp = await fetchBrevoSmtpAggregated({
                startDate: w.since,
                endDate: w.until,
            });
            smtpByWeek.push({
                since: w.since,
                until: w.until,
                sent: num_(smtp.requests || smtp.delivered),
                opens: num_(smtp.uniqueOpens || smtp.opens),
                clicks: num_(smtp.uniqueClicks || smtp.clicks),
            });
        }
    }
    return weeks.map((w) => {
        let sent = 0;
        let opens = 0;
        let clicks = 0;
        let nCamp = 0;
        for (const c of campaigns) {
            if (!campaignInWeek_(c.sentDate, w.since, w.until))
                continue;
            const g = c.statistics?.globalStats || {};
            sent += num_(g.sent || g.delivered);
            opens += num_(g.uniqueViews || g.viewed || g.trackableViews);
            clicks += num_(g.uniqueClicks || g.clickers);
            nCamp++;
        }
        const smtp = smtpByWeek?.find((s) => s.since === w.since && s.until === w.until);
        // Si SMTP aporta mucho más que campañas (transaccional), sumar
        if (smtp && smtp.sent > sent) {
            // Preferir el mayor bloque (normalmente campañas semanales ~6k)
            // Si SMTP es el canal principal, úsalo; si no, campañas.
            if (sent === 0) {
                sent = smtp.sent;
                opens = smtp.opens;
                clicks = smtp.clicks;
            }
        }
        const ctr = sent > 0 ? clicks / sent : 0;
        return {
            since: w.since,
            until: w.until,
            contactos,
            correosMandados: sent,
            aperturas: opens,
            clicks,
            ctr,
            campaigns: nCamp,
        };
    });
}
async function probeBrevo() {
    const status = brevoStatus();
    if (!status.configured) {
        return { ok: false, status, error: "Falta API key Brevo" };
    }
    try {
        const account = await fetchBrevoAccount();
        const contactos = await fetchBrevoContactsCount();
        return {
            ok: true,
            status,
            account: {
                email: account.email,
                companyName: account.companyName,
            },
            contactos,
        };
    }
    catch (e) {
        return {
            ok: false,
            status,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}
//# sourceMappingURL=brevoClient.js.map