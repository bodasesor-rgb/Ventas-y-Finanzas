"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATEMENTS_ROOT = void 0;
exports.ensureStatementsRoot = ensureStatementsRoot;
exports.saveStatementPdf = saveStatementPdf;
exports.resolveStatementFile = resolveStatementFile;
exports.deleteStatementPdf = deleteStatementPdf;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.STATEMENTS_ROOT = path_1.default.join(process.cwd(), "data", "statements");
function ensureStatementsRoot() {
    if (!fs_1.default.existsSync(exports.STATEMENTS_ROOT)) {
        fs_1.default.mkdirSync(exports.STATEMENTS_ROOT, { recursive: true });
    }
}
/**
 * Guarda el PDF como data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Un solo archivo por mes: sobrescribe y borra variantes _2, _3…
 */
function saveStatementPdf(tempPath, period) {
    ensureStatementsRoot();
    const dir = path_1.default.join(exports.STATEMENTS_ROOT, period.key);
    fs_1.default.mkdirSync(dir, { recursive: true });
    const storedName = period.fileTitle;
    const dest = path_1.default.join(dir, storedName);
    fs_1.default.copyFileSync(tempPath, dest);
    try {
        for (const f of fs_1.default.readdirSync(dir)) {
            if (f === storedName)
                continue;
            if (f.startsWith(`${period.key}_estado-cuenta`) &&
                f.toLowerCase().endsWith(".pdf")) {
                try {
                    fs_1.default.unlinkSync(path_1.default.join(dir, f));
                }
                catch {
                    /* ignore */
                }
            }
        }
    }
    catch {
        /* ignore cleanup */
    }
    try {
        fs_1.default.unlinkSync(tempPath);
    }
    catch {
        /* ignore */
    }
    const relativePath = path_1.default.join(period.key, storedName);
    return { storedPath: dest, storedName, relativePath };
}
function resolveStatementFile(relativePath) {
    if (!relativePath || relativePath.includes(".."))
        return null;
    const full = path_1.default.join(exports.STATEMENTS_ROOT, relativePath);
    if (!full.startsWith(exports.STATEMENTS_ROOT))
        return null;
    if (!fs_1.default.existsSync(full))
        return null;
    return full;
}
/** Borra PDF local del mes (archivo y carpeta si queda vacía). */
function deleteStatementPdf(periodKey, relativePath) {
    if (relativePath && !relativePath.includes("..")) {
        const full = path_1.default.join(exports.STATEMENTS_ROOT, relativePath);
        if (full.startsWith(exports.STATEMENTS_ROOT) && fs_1.default.existsSync(full)) {
            try {
                fs_1.default.unlinkSync(full);
            }
            catch {
                /* ignore */
            }
        }
    }
    if (periodKey && /^\d{4}-\d{2}$/.test(periodKey)) {
        const dir = path_1.default.join(exports.STATEMENTS_ROOT, periodKey);
        if (!dir.startsWith(exports.STATEMENTS_ROOT) || !fs_1.default.existsSync(dir))
            return;
        try {
            for (const f of fs_1.default.readdirSync(dir)) {
                try {
                    fs_1.default.unlinkSync(path_1.default.join(dir, f));
                }
                catch {
                    /* ignore */
                }
            }
            fs_1.default.rmdirSync(dir);
        }
        catch {
            /* ignore */
        }
    }
}
//# sourceMappingURL=statementFiles.js.map