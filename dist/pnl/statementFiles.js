"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATEMENTS_ROOT = void 0;
exports.ensureStatementsRoot = ensureStatementsRoot;
exports.saveStatementPdf = saveStatementPdf;
exports.resolveStatementFile = resolveStatementFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.STATEMENTS_ROOT = path_1.default.join(process.cwd(), "data", "statements");
function ensureStatementsRoot() {
    if (!fs_1.default.existsSync(exports.STATEMENTS_ROOT)) {
        fs_1.default.mkdirSync(exports.STATEMENTS_ROOT, { recursive: true });
    }
}
/**
 * Guarda el PDF en data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Si ya existe, agrega sufijo _2, _3…
 */
function saveStatementPdf(tempPath, period) {
    ensureStatementsRoot();
    const dir = path_1.default.join(exports.STATEMENTS_ROOT, period.key);
    fs_1.default.mkdirSync(dir, { recursive: true });
    let storedName = period.fileTitle;
    let dest = path_1.default.join(dir, storedName);
    let n = 2;
    while (fs_1.default.existsSync(dest)) {
        storedName = `${period.key}_estado-cuenta_${n}.pdf`;
        dest = path_1.default.join(dir, storedName);
        n += 1;
    }
    fs_1.default.copyFileSync(tempPath, dest);
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
//# sourceMappingURL=statementFiles.js.map