let categories = [];
let rules = [];
let currentRun = null;
let selectedFile = null;
let runsCache = [];
/** Año seleccionado para el análisis (nunca mezcla años). */
let selectedAnalysisYear = null;
let analysisYears = [];

function isRunMissingError(msg) {
  return /run no encontrado/i.test(String(msg || ""));
}

function runMissingHint() {
  return (
    "Ese estado ya no está en el servidor (se borró con el deploy). " +
    "Sube de nuevo el PDF y luego cambia categoría o envía al Sheet."
  );
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const err = data.error || res.statusText;
    if (isRunMissingError(err)) throw new Error(runMissingHint());
    throw new Error(data.hint ? `${err} — ${data.hint}` : err);
  }
  return data;
}

/** Si el run en pantalla ya no existe en el server, limpia la UI. */
async function ensureCurrentRunAlive() {
  if (!currentRun?.id) return false;
  try {
    const data = await api(`/api/pnl/runs/${encodeURIComponent(currentRun.id)}`);
    if (data.run) {
      currentRun = data.run;
      return true;
    }
  } catch (e) {
    if (isRunMissingError(e.message) || /Sube de nuevo/.test(e.message)) {
      currentRun = null;
      const meta = document.getElementById("currentRunMeta");
      if (meta) meta.textContent = runMissingHint();
      const tbody = document.querySelector("#linesTable tbody");
      if (tbody) tbody.innerHTML = "";
      return false;
    }
  }
  return Boolean(currentRun?.id);
}

function money(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n || 0);
}

/** Para el input editable: siempre con signo y aspecto de dinero */
function moneyInputValue(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num).toFixed(2);
  return num < 0 ? `-${abs}` : abs;
}

function parseMoneyInput(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[$\s]/g, "").replace(/,/g, "");
  if (!s) return NaN;
  // permitir "(1500)" como negativo
  const paren = s.match(/^\((.+)\)$/);
  if (paren) s = "-" + paren[1];
  return Number(s);
}

function computeTotals(lines) {
  let ingresos = 0;
  let gastos = 0;
  for (const line of lines || []) {
    const a = Number(line.amount) || 0;
    if (a >= 0) ingresos += a;
    else gastos += a;
  }
  return {
    ingresos: Math.round(ingresos * 100) / 100,
    gastos: Math.round(gastos * 100) / 100,
    neto: Math.round((ingresos + gastos) * 100) / 100,
  };
}

function renderSendSheetStatus(run) {
  const status = document.getElementById("sendToSheetStatus");
  const btn = document.getElementById("sendToSheetBtn");
  if (btn) btn.disabled = !run?.id;
  if (!status) return;
  if (run?.sentToSheet?.ok && run.sentToSheetAt) {
    status.textContent = `En Sheet: ${
      run.sentToSheet.sheetName || "Estado de Resultados"
    } · Banco fila ${run.sentToSheet.row || "?"} · ${fmtDate(
      run.sentToSheetAt
    )}`;
  } else if (run?.sentToSheet?.ok === false) {
    status.textContent = "Último envío falló: " + (run.sentToSheet.error || "");
  } else {
    status.textContent =
      "Cuando cuadre, envía el mes a Estado de Resultados (columnas enero…diciembre) + Banco.";
  }
}

function renderTotals(run) {
  const bar = document.getElementById("totalsBar");
  if (!bar) return;
  const t = run.totals || computeTotals(run.lines);
  const rec = run.reconciliation;
  bar.hidden = false;
  renderSendSheetStatus(run);
  const ing = document.getElementById("totalIngresos");
  const gas = document.getElementById("totalGastos");
  const net = document.getElementById("totalNeto");
  const oIng = document.getElementById("oficialIngresos");
  const oGas = document.getElementById("oficialGastos");
  const status = document.getElementById("reconcileStatus");
  const msg = document.getElementById("reconcileMsg");

  if (ing) ing.textContent = money(t.ingresos);
  if (gas) gas.textContent = money(t.gastos);
  if (net) {
    net.textContent = money(t.neto);
    net.style.color = t.neto >= 0 ? "#0b6b3a" : "#9a3412";
  }

  const ingCard = ing?.closest(".total-card");
  const gasCard = gas?.closest(".total-card");
  ingCard?.classList.remove("ok-match", "bad-match");
  gasCard?.classList.remove("ok-match", "bad-match");

  if (rec?.oficial) {
    if (oIng) {
      oIng.textContent =
        rec.oficial.ingresosOficiales != null
          ? `Estado: ${money(rec.oficial.ingresosOficiales)} (Depósitos)${
              rec.diffIngresos != null
                ? ` · diff ${money(rec.diffIngresos)}`
                : ""
            }`
          : "Estado: (sin leer Depósitos)";
    }
    if (oGas) {
      oGas.textContent =
        rec.oficial.gastosOficiales != null
          ? `Estado: ${money(rec.oficial.gastosOficiales)} (Otros cargos)${
              rec.diffGastos != null ? ` · diff ${money(rec.diffGastos)}` : ""
            }`
          : "Estado: (sin leer Otros cargos)";
    }
    if (ingCard) {
      ingCard.classList.add(rec.matchIngresos ? "ok-match" : "bad-match");
    }
    if (gasCard) {
      gasCard.classList.add(rec.matchGastos ? "ok-match" : "bad-match");
    }
    if (status) {
      status.textContent = rec.matchCompleto
        ? "✓ Cuadra con el PDF"
        : "✗ No cuadra — revisa movimientos";
      status.style.color = rec.matchCompleto ? "#0b6b3a" : "#9a3412";
    }
    if (msg) {
      msg.hidden = false;
      msg.className =
        "reconcile-msg " + (rec.matchCompleto ? "ok" : "bad");
      msg.textContent = rec.matchCompleto
        ? "Los totales parseados coinciden con Depósitos y Otros cargos del estado de cuenta."
        : `Falta cuadrar con el PDF. Depósitos estado ${money(
            rec.oficial.ingresosOficiales || 0
          )} vs parseado ${money(t.ingresos)}. Cargos estado ${money(
            rec.oficial.gastosOficiales || 0
          )} vs parseado ${money(t.gastos)}. Corrige montos marcados en Revisar.`;
    }
  } else {
    if (oIng) oIng.textContent = "";
    if (oGas) oGas.textContent = "";
    if (status) status.textContent = "";
    if (msg) msg.hidden = true;
  }
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function categoryIds() {
  return categories.map((c) => c.id);
}

function categoryLabel(id) {
  const c = categories.find((x) => x.id === id);
  return c ? c.label : id;
}

function categoryColor(id) {
  const c = categories.find((x) => x.id === id);
  if (c?.color) return c.color;
  if (id === "ingreso" || id === "venta") return "#0b6b3a";
  if (id === "revisar") return "#9a4d1c";
  // hash simple
  let hash = 0;
  const s = String(id || "x");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  const palette = [
    "#0f6b5c",
    "#1d4ed8",
    "#7c3aed",
    "#b45309",
    "#be123c",
    "#0e7490",
    "#4d7c0f",
    "#c2410c",
  ];
  return palette[hash % palette.length];
}

function contrastText(bg) {
  const hex = String(bg || "").replace("#", "");
  if (hex.length !== 6) return "#fff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1c1914" : "#ffffff";
}

function tintBg(hex, alpha) {
  const h = String(hex || "#888").replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isIncomeCat(id) {
  const c = categories.find((x) => x.id === id);
  if (c) return c.kind === "ingreso";
  return id === "ingreso" || id === "venta";
}

function categoryOptionsHtml(selected) {
  const ids = categoryIds();
  if (selected && !ids.includes(selected)) {
    ids.push(selected);
  }
  return ids
    .map((id) => {
      const label = categoryLabel(id);
      const mark = isIncomeCat(id) ? " (+)" : "";
      return `<option value="${escapeAttr(id)}" ${
        id === selected ? "selected" : ""
      }>${escapeHtml(label)}${mark}</option>`;
    })
    .join("");
}

function renderCategories() {
  const root = document.getElementById("categoriesList");
  if (!root) return;
  if (!categories.length) {
    root.innerHTML = '<p class="muted">Sin categorías.</p>';
    return;
  }
  root.innerHTML = categories
    .map((c) => {
      const canDel = !c.builtin && c.id !== "revisar" && c.id !== "ingreso";
      const color = c.color || categoryColor(c.id);
      const fg = contrastText(color);
      const auto = c.autoCreated ? " · auto" : "";
      return `
        <span class="cat-pill" data-id="${escapeAttr(c.id)}" style="background:${escapeAttr(
          color
        )};color:${escapeAttr(fg)};border-color:${escapeAttr(color)}">
          <span class="cat-dot" style="background:${escapeAttr(fg)}"></span>
          <strong>${escapeHtml(c.label)}</strong>
          <span class="cat-kind" style="color:${escapeAttr(fg)};opacity:.85">${escapeHtml(
            c.kind
          )}${auto}</span>
          ${
            canDel
              ? `<button type="button" data-del-cat="${escapeAttr(
                  c.id
                )}" title="Eliminar" style="color:${escapeAttr(fg)}">✕</button>`
              : ""
          }
        </span>
      `;
    })
    .join("");

  root.querySelectorAll("[data-del-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-cat");
      if (!confirm(`¿Eliminar categoría "${id}"?`)) return;
      try {
        const data = await api(`/api/pnl/categories/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        categories = data.categories;
        renderCategories();
        renderRules();
        if (currentRun) renderRun(currentRun);
        setCatStatus("Categoría eliminada.");
      } catch (e) {
        setCatStatus(e.message, true);
      }
    });
  });
}

function setCatStatus(msg, isErr) {
  const el = document.getElementById("categoriesStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "var(--warn)" : "";
}

async function addCategory(kind) {
  const hint =
    kind === "ingreso"
      ? "Nombre de la categoría de ingreso (ej. Anticipo boda):"
      : "Nombre de la categoría (ej. Decoración, Catering):";
  const label = prompt(hint);
  if (!label || !label.trim()) return;
  try {
    const data = await api("/api/pnl/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), kind }),
    });
    categories = data.categories;
    renderCategories();
    renderRules();
    if (currentRun) renderRun(currentRun);
    setCatStatus(
      kind === "ingreso"
        ? `Categoría de ingreso creada: ${data.category.label}`
        : `Categoría creada: ${data.category.label}`
    );
  } catch (e) {
    setCatStatus(e.message, true);
  }
}

function renderRules() {
  const tbody = document.querySelector("#rulesTable tbody");
  tbody.innerHTML = "";
  rules.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-i="${idx}" data-f="match" value="${escapeAttr(r.match)}" /></td>
      <td><input data-i="${idx}" data-f="label" value="${escapeAttr(r.label)}" /></td>
      <td>
        <select data-i="${idx}" data-f="category">
          ${categoryOptionsHtml(r.category)}
        </select>
      </td>
      <td><input type="checkbox" data-i="${idx}" data-f="frecuente" ${
      r.frecuente ? "checked" : ""
    } /></td>
      <td><button type="button" class="secondary" data-del="${idx}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", () => {
      const i = Number(el.dataset.i);
      const f = el.dataset.f;
      if (f === "frecuente") rules[i][f] = el.checked;
      else rules[i][f] = el.value;
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rules.splice(Number(btn.dataset.del), 1);
      renderRules();
    });
  });
}

function renderLibrary(months) {
  const root = document.getElementById("library");
  if (!root) return;
  if (!months || !months.length) {
    root.innerHTML =
      '<p class="muted">Aún no hay PDFs guardados. Arrastra un estado de cuenta.</p>';
    return;
  }

  root.innerHTML = months
    .map((g) => {
      const stmts = (g.statements || [])
        .map((r) => {
          const title = escapeHtml(r.storedName || r.filename || r.id);
          const when = escapeHtml(fmtDate(r.uploadedAt));
          const count = (r.lines && r.lines.length) || 0;
          const hasPdf = Boolean(r.storedRelativePath);
          return `
            <div class="stmt-row" data-run-id="${escapeAttr(r.id)}">
              <div class="stmt-meta">
                <strong>${title}</strong>
                <span>${when} · ${count} movs · ${escapeHtml(r.filename || "")}</span>
              </div>
              <button type="button" data-act="open">Abrir movimientos</button>
              <button type="button" data-act="send">Enviar al P&amp;L</button>
              <button type="button" class="btn-danger" data-act="delete">Eliminar PDF</button>
              ${
                hasPdf
                  ? `<button type="button" class="secondary" data-act="pdf">Ver PDF</button>
                     <a class="btn secondary" href="/api/pnl/runs/${encodeURIComponent(
                       r.id
                     )}/pdf" target="_blank" rel="noopener">Nueva pestaña</a>`
                  : `<span class="muted">sin PDF en disco</span>`
              }
            </div>
          `;
        })
        .join("");
      return `
        <article class="month-block">
          <h3>${escapeHtml(g.periodLabel || g.periodKey)}
            <span class="month-count">· ${(g.statements || []).length} PDF</span>
          </h3>
          ${stmts}
        </article>
      `;
    })
    .join("");

  root.querySelectorAll(".stmt-row").forEach((el) => {
    const runId = el.getAttribute("data-run-id");
    el.querySelector('[data-act="open"]')?.addEventListener("click", async () => {
      try {
        const data = await api(`/api/pnl/runs/${encodeURIComponent(runId)}`);
        renderRun(data.run);
        document
          .getElementById("linesTable")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        alert(e.message);
      }
    });
    el.querySelector('[data-act="pdf"]')?.addEventListener("click", () => {
      openPdfViewer(runId, el.querySelector("strong")?.textContent || "PDF");
    });
    el.querySelector('[data-act="send"]')?.addEventListener("click", async () => {
      const btn = el.querySelector('[data-act="send"]');
      if (btn) btn.setAttribute("disabled", "true");
      try {
        const data = await api(
          `/api/pnl/runs/${encodeURIComponent(runId)}/send-to-sheet`,
          { method: "POST" }
        );
        alert(data.message || "Enviado al Sheet");
        if (data.run && currentRun?.id === runId) renderRun(data.run);
        await refreshLibrary();
        await refreshAnalysis();
      } catch (e) {
        alert(e.message);
      } finally {
        if (btn) btn.removeAttribute("disabled");
      }
    });
    el.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
      const label =
        el.querySelector("strong")?.textContent ||
        runId.slice(0, 8);
      if (
        !confirm(
          `¿Eliminar este PDF/estado?\n\n${label}\n\nSe borra del panel y del disco. Si Drive está autorizado, también del archivo.`
        )
      ) {
        return;
      }
      const btn = el.querySelector('[data-act="delete"]');
      if (btn) btn.setAttribute("disabled", "true");
      try {
        const data = await api(
          `/api/pnl/runs/${encodeURIComponent(runId)}`,
          { method: "DELETE" }
        );
        if (currentRun?.id === runId) {
          currentRun = null;
          const meta = document.getElementById("currentRunMeta");
          if (meta) meta.textContent = "PDF eliminado. Sube o abre otro.";
          const tbody = document.querySelector("#linesTable tbody");
          if (tbody) tbody.innerHTML = "";
          const bar = document.getElementById("totalsBar");
          if (bar) bar.hidden = true;
        }
        runsCache = data.runs || [];
        await refreshLibrary();
        await refreshAnalysis();
      } catch (e) {
        alert(e.message);
      } finally {
        if (btn) btn.removeAttribute("disabled");
      }
    });
  });
}

function openPdfViewer(runId, title) {
  const frame = document.getElementById("pdfFrame");
  const box = document.getElementById("pdfViewer");
  const titleEl = document.getElementById("pdfViewerTitle");
  if (!frame || !box) return;
  if (titleEl) titleEl.textContent = title || "PDF";
  frame.src = `/api/pnl/runs/${encodeURIComponent(runId)}/pdf`;
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function refreshLibrary() {
  try {
    const data = await api("/api/pnl/library");
    renderLibrary(data.months || []);
  } catch (err) {
    console.error(err);
    const root = document.getElementById("library");
    if (root) {
      root.innerHTML =
        '<p class="muted">No pude cargar la biblioteca de PDFs.</p>';
    }
  }
}

function lineIsIncome(line) {
  if (isIncomeCat(line.category)) return true;
  if (line.direction === "abono") return true;
  if (Number(line.amount) > 0) return true;
  return false;
}

function renderRun(run) {
  currentRun = run;
  const meta = document.getElementById("currentRunMeta");
  if (meta) {
    const parts = [
      run.periodLabel ? `Mes: ${run.periodLabel}` : null,
      run.periodKey ? `Periodo: ${run.periodKey}` : null,
      run.storedName ? `Archivo: ${run.storedName}` : null,
      run.filename ? `Original: ${run.filename}` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
  }
  // Al abrir un PDF, el análisis salta al año de ese estado
  const y = Number(String(run.periodKey || "").slice(0, 4));
  if (Number.isFinite(y) && y >= 2000) {
    selectedAnalysisYear = y;
    const sel = document.getElementById("analysisYearSelect");
    if (sel) {
      sel.dataset.userPicked = "";
      if (![...sel.options].some((o) => Number(o.value) === y)) {
        sel.insertAdjacentHTML(
          "beforeend",
          `<option value="${y}">${y}</option>`
        );
      }
      sel.value = String(y);
    }
  }

  renderTotals(run);

  const summary = document.getElementById("summary");
  summary.innerHTML = "";

  const dbg = run.parseDebug;
  if (dbg) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `Texto PDF: ${dbg.textLength || 0} chars${
      dbg.pagesHint ? " · " + dbg.pagesHint : ""
    }`;
    summary.appendChild(chip);
  }

  const entries = Object.entries(run.summaryByCategory || {});
  if (!run.lines?.length) {
    const warn = document.createElement("span");
    warn.className = "chip warn";
    warn.textContent =
      "0 movimientos detectados. Vuelve a soltar el PDF (parser nuevo) o revisa abajo el texto.";
    summary.appendChild(warn);
  } else {
    for (const [cat, total] of entries.sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const chip = document.createElement("span");
      const color = categoryColor(cat);
      const fg = contrastText(color);
      chip.className = "chip chip-cat";
      chip.style.background = color;
      chip.style.color = fg;
      chip.style.borderColor = color;
      chip.textContent = `${categoryLabel(cat)}: ${money(total)}`;
      summary.appendChild(chip);
    }
  }

  const tbody = document.querySelector("#linesTable tbody");
  tbody.innerHTML = "";
  for (const line of run.lines || []) {
    const tr = document.createElement("tr");
    const income = lineIsIncome(line);
    const color = categoryColor(line.category);
    if (line.needsReview) tr.classList.add("review");
    if (income) tr.classList.add("income");
    tr.style.background = tintBg(color, income ? 0.18 : 0.1);
    tr.style.boxShadow = `inset 4px 0 0 ${color}`;
    tr.innerHTML = `
      <td>${escapeAttr(line.date || "")}</td>
      <td>
        <input class="desc-edit" data-field="description" data-line="${escapeAttr(
          line.id
        )}" value="${escapeAttr(line.description)}" />
        ${
          line.counterparty
            ? `<span class="cp-tag">${escapeHtml(
                line.counterpartyKind === "socio" ? "socio" : "proveedor"
              )}: ${escapeHtml(line.counterparty)}</span>`
            : ""
        }
      </td>
      <td class="amount ${income ? "income" : ""}">
        <span class="money-edit-wrap">
          <span class="money-prefix">$</span>
          <input class="amount-edit" inputmode="decimal" data-field="amount" data-line="${escapeAttr(
            line.id
          )}" value="${escapeAttr(moneyInputValue(line.amount))}" style="${
      income ? "color:#0b6b3a;font-weight:700" : "color:#9a3412;font-weight:700"
    }" title="Negativo = gasto, positivo = ingreso" />
        </span>
      </td>
      <td>
        <select class="cat-select" data-field="category" data-line="${escapeAttr(
          line.id
        )}" style="border-color:${escapeAttr(color)};background:${escapeAttr(
      tintBg(color, 0.15)
    )}">
          ${categoryOptionsHtml(line.category)}
        </select>
      </td>
      <td>
        <label class="review-lab" title="Actívala si el monto o la categoría están mal y quieres corregirlos">
          <input type="checkbox" data-field="needsReview" data-line="${escapeAttr(
            line.id
          )}" ${line.needsReview ? "checked" : ""} />
          <span>${line.needsReview ? "checar" : ""}</span>
        </label>
      </td>
    `;
    tbody.appendChild(tr);
  }

  async function patchLine(lineId, body) {
    try {
      await api(`/api/pnl/runs/${run.id}/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const fresh = await api(`/api/pnl/runs/${run.id}`);
      renderRun(fresh.run);
      refreshLibrary();
    } catch (e) {
      if (/Sube de nuevo|run no encontrado/i.test(e.message)) {
        await ensureCurrentRunAlive();
      }
      throw e;
    }
  }

  tbody.querySelectorAll("select[data-field='category']").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await patchLine(sel.dataset.line, { category: sel.value });
      } catch (e) {
        alert(e.message);
      }
    });
  });

  tbody.querySelectorAll("input[data-field='needsReview']").forEach((el) => {
    el.addEventListener("change", async () => {
      try {
        await patchLine(el.dataset.line, { needsReview: el.checked });
      } catch (e) {
        alert(e.message);
      }
    });
  });

  tbody.querySelectorAll("input[data-field='amount']").forEach((el) => {
    const save = async () => {
      const n = parseMoneyInput(el.value);
      if (!Number.isFinite(n)) {
        alert("Monto inválido. Usa formato como -1500.00 o $1,500.00");
        return;
      }
      try {
        el.classList.add("line-save-ok");
        await patchLine(el.dataset.line, { amount: n });
      } catch (e) {
        alert(e.message);
      }
    };
    el.addEventListener("change", save);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    });
  });

  tbody.querySelectorAll("input[data-field='description']").forEach((el) => {
    const save = async () => {
      try {
        await patchLine(el.dataset.line, { description: el.value });
      } catch (e) {
        alert(e.message);
      }
    };
    el.addEventListener("change", save);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    });
  });

  const previewBox = document.getElementById("textPreview");
  if (previewBox) {
    previewBox.textContent =
      (run.parseDebug && run.parseDebug.sampleMid) ||
      run.textPreview ||
      "(sin texto)";
  }
}

function pct(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);
}

function syncYearSelect(years, preferredYear) {
  const sel = document.getElementById("analysisYearSelect");
  if (!sel) return;
  analysisYears = Array.isArray(years) ? years.slice() : [];
  if (!analysisYears.length) {
    const y = preferredYear || new Date().getFullYear();
    analysisYears = [y];
  }
  const want =
    preferredYear && analysisYears.includes(preferredYear)
      ? preferredYear
      : selectedAnalysisYear && analysisYears.includes(selectedAnalysisYear)
        ? selectedAnalysisYear
        : analysisYears[analysisYears.length - 1];
  selectedAnalysisYear = want;
  sel.innerHTML = analysisYears
    .map(
      (y) =>
        `<option value="${y}" ${y === want ? "selected" : ""}>${y}</option>`
    )
    .join("");
}

function catLabel(id) {
  const c = categories.find((x) => x.id === id);
  return c?.label || id;
}

function renderAnalysis(analysis) {
  const root = document.getElementById("analysisPanel");
  if (!root || !analysis) return;
  const year = analysis.year || selectedAnalysisYear || "?";
  const allProv = analysis.topProveedores || [];
  const top5 = analysis.top5Proveedores || allProv.slice(0, 5);
  const socios = analysis.socios || [];
  const months = analysis.byMonth || [];
  const cats = (analysis.byCategory || []).filter((c) => Number(c.total) !== 0);
  const c = analysis.concentracion || {};
  const top1 = top5[0];

  if (!months.length) {
    root.innerHTML = `
      <section class="analysis-block">
        <p class="muted" style="margin:0">No hay estados de cuenta del año <strong>${escapeHtml(
          String(year)
        )}</strong>. Elige otro año en el selector o sube PDFs de ${escapeHtml(
      String(year)
    )} desde <em>Estados de cuenta</em>.</p>
      </section>`;
    return;
  }

  root.innerHTML = `
    <section class="analysis-block">
      <h3>Resumen ${escapeHtml(String(year))}</h3>
      <p class="muted" style="margin:0 0 0.75rem">Solo este año · meses ${(
        analysis.monthsPresent || []
      )
        .map((m) => escapeHtml(m))
        .join(", ")} · ${analysis.runsCount || 0} estado(s)</p>
      <div class="analysis-grid">
        <div class="analysis-card"><span>Ingresos</span><strong>${money(analysis.ingresos)}</strong></div>
        <div class="analysis-card"><span>Gastos</span><strong>${money(analysis.gastos)}</strong></div>
        <div class="analysis-card"><span>Neto</span><strong>${money(analysis.neto)}</strong></div>
        <div class="analysis-card"><span>A socios</span><strong>${money(analysis.sociosTotal)}</strong></div>
        <div class="analysis-card"><span>A proveedores</span><strong>${money(analysis.proveedoresTotal)}</strong></div>
        <div class="analysis-card"><span>Concentración top1 / top3 / top5</span><strong>${pct(c.top1Share)} / ${pct(c.top3Share)} / ${pct(c.top5Share)}</strong></div>
      </div>
      ${
        top1
          ? `<p class="analysis-insight"><strong>Negociación:</strong> ${escapeHtml(
              top1.name
            )} concentra el ${pct(
              top1.shareOfProviders
            )} del gasto a proveedores (${money(
              top1.total
            )} en ${top1.payments} pago(s)).</p>`
          : ""
      }
    </section>

    <div class="analysis-two-col">
      <section class="analysis-block">
        <h3>Top proveedores ${escapeHtml(String(year))}</h3>
        <div class="table-wrap">
          <table class="analysis-table">
            <thead><tr><th>#</th><th>Proveedor</th><th>Gasto</th><th>%</th><th>Pagos</th></tr></thead>
            <tbody>
              ${
                allProv.length
                  ? allProv
                      .map(
                        (p, i) =>
                          `<tr${i < 5 ? ' style="font-weight:600"' : ""}>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(p.name)}</td>
                            <td>${money(p.total)}</td>
                            <td>${pct(p.shareOfProviders)}</td>
                            <td>${p.payments}</td>
                          </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="5">Sin proveedores en ${escapeHtml(
                      String(year)
                    )}.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="analysis-block">
        <h3>Socios (traspasos)</h3>
        <div class="table-wrap">
          <table class="analysis-table">
            <thead><tr><th>Socio</th><th>Total</th><th>Pagos</th></tr></thead>
            <tbody>
              ${
                socios.length
                  ? socios
                      .map(
                        (p) =>
                          `<tr>
                            <td>${escapeHtml(p.name)}</td>
                            <td>${money(p.total)}</td>
                            <td>${p.payments}</td>
                          </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="3">Sin traspasos a socios.</td></tr>`
              }
            </tbody>
          </table>
        </div>
        <h3 style="margin-top:1.25rem">Gasto por categoría</h3>
        <div class="table-wrap">
          <table class="analysis-table">
            <thead><tr><th>Categoría</th><th>Total</th></tr></thead>
            <tbody>
              ${
                cats.length
                  ? cats
                      .map(
                        (row) =>
                          `<tr>
                            <td>${escapeHtml(catLabel(row.id))}</td>
                            <td>${money(row.total)}</td>
                          </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="2">Sin datos.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="analysis-block">
      <h3>Mensual ${escapeHtml(String(year))}</h3>
      <div class="table-wrap">
        <table class="analysis-table">
          <thead>
            <tr>
              <th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Neto</th>
              <th>Socios</th><th>Proveedores</th><th>Ads</th><th>Apps</th>
              <th>Comisiones</th><th>Cuadra</th><th>Top proveedor</th>
            </tr>
          </thead>
          <tbody>
            ${months
              .map((m) => {
                const t0 = (m.topProveedores || [])[0];
                return `<tr>
                  <td>${escapeHtml(m.periodLabel || m.periodKey)}</td>
                  <td>${money(m.ingresos)}</td>
                  <td>${money(m.gastos)}</td>
                  <td>${money(m.neto)}</td>
                  <td>${money(m.socios)}</td>
                  <td>${money(m.proveedores)}</td>
                  <td>${money(m.ads)}</td>
                  <td>${money(m.apps)}</td>
                  <td>${money(m.comisiones)}</td>
                  <td>${
                    m.cuadra === true ? "SI" : m.cuadra === false ? "NO" : "—"
                  }</td>
                  <td>${
                    t0
                      ? `${escapeHtml(t0.name)} (${money(t0.total)})`
                      : "—"
                  }</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="analysis-block">
      <h3>Top proveedores por mes</h3>
      <div class="analysis-month-cards">
        ${months
          .map((m) => {
            const list = m.topProveedores || [];
            return `<article class="analysis-month-card">
              <h4>${escapeHtml(m.periodLabel || m.periodKey)}</h4>
              <div class="muted">Ingresos ${money(m.ingresos)} · Gastos ${money(
              m.gastos
            )} · Neto ${money(m.neto)}</div>
              <div class="muted">Socios ${money(m.socios)} · Proveedores ${money(
              m.proveedores
            )}</div>
              <ul>
                ${
                  list.length
                    ? list
                        .map(
                          (p, i) =>
                            `<li><strong>${i + 1}.</strong> ${escapeHtml(
                              p.name
                            )} — ${money(p.total)} (${p.payments})</li>`
                        )
                        .join("")
                    : "<li>Sin proveedores con nombre este mes.</li>"
                }
              </ul>
            </article>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function showView(view) {
  const name = view === "analisis" ? "analisis" : "estados";
  document.querySelectorAll(".subnav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-view") === name);
  });
  document.querySelectorAll("[data-view-pane]").forEach((pane) => {
    const on = pane.getAttribute("data-view-pane") === name;
    pane.hidden = !on;
    pane.classList.toggle("is-active", on);
  });
  if (name === "analisis") {
    refreshAnalysis();
    try {
      history.replaceState(null, "", "#analisis");
    } catch (_) {}
  } else {
    try {
      history.replaceState(null, "", "#estados");
    } catch (_) {}
  }
}

async function refreshAnalysis() {
  const el = document.getElementById("analysisStatus");
  const sel = document.getElementById("analysisYearSelect");
  try {
    // Primero pedimos lista de años (sin forzar) si aún no hay selección
    let year = selectedAnalysisYear;
    if (sel?.value) year = Number(sel.value);
    if (currentRun?.periodKey) {
      const fromRun = Number(String(currentRun.periodKey).slice(0, 4));
      if (
        Number.isFinite(fromRun) &&
        (!year || (sel && !sel.dataset.userPicked))
      ) {
        // Si el usuario no eligió manualmente, alinear al PDF abierto
        if (!sel?.dataset.userPicked) year = fromRun;
      }
    }
    const q = year ? `?year=${encodeURIComponent(year)}` : "";
    const data = await api(`/api/pnl/analysis${q}`);
    syncYearSelect(data.years || [], data.year || year);
    if (sel && selectedAnalysisYear) sel.value = String(selectedAnalysisYear);
    renderAnalysis(data.analysis);
    if (el) {
      const empty = data.emptyYear || !data.analysis?.monthsPresent?.length;
      el.textContent = empty
        ? `Año ${data.year}: sin PDFs. Años con datos: ${(
            data.years || []
          ).join(", ") || "ninguno"}`
        : `OK · solo año ${data.analysis?.year} · ${
            data.analysis?.runsCount || 0
          } run(s) · ${
            (data.analysis?.monthsPresent || []).join(", ") || "sin meses"
          } → Sheet Analisis ${data.analysis?.year}`;
    }
    return data;
  } catch (e) {
    if (el) el.textContent = "Error: " + e.message;
    return null;
  }
}

async function init() {
  document.querySelectorAll(".subnav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.getAttribute("data-view"));
    });
  });

  document.getElementById("analysisYearSelect")?.addEventListener("change", (ev) => {
    const sel = ev.target;
    sel.dataset.userPicked = "1";
    selectedAnalysisYear = Number(sel.value);
    refreshAnalysis();
  });
  document.getElementById("refreshAnalysisBtn")?.addEventListener("click", () => {
    refreshAnalysis();
  });
  document.getElementById("sendAnalysisBtn")?.addEventListener("click", async () => {
    const el = document.getElementById("analysisStatus");
    const btn = document.getElementById("sendAnalysisBtn");
    const year =
      selectedAnalysisYear ||
      Number(document.getElementById("analysisYearSelect")?.value);
    if (!year) {
      if (el) el.textContent = "Elige un año antes de enviar.";
      return;
    }
    if (btn) btn.disabled = true;
    if (el) el.textContent = `Enviando Análisis ${year} al Sheet…`;
    try {
      const data = await api("/api/pnl/analysis/send-to-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      if (data.analysis) renderAnalysis(data.analysis);
      if (el) {
        el.textContent = `OK → Analisis ${year} (${data.sheetName || "?"}) v${
          data.version || "?"
        }`;
      }
    } catch (e) {
      if (el) el.textContent = "Error: " + e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("addCategory")?.addEventListener("click", () => {
    addCategory("gasto");
  });
  document.getElementById("addIncomeCategory")?.addEventListener("click", () => {
    addCategory("ingreso");
  });
  document.getElementById("btnClosePdf")?.addEventListener("click", () => {
    const box = document.getElementById("pdfViewer");
    const frame = document.getElementById("pdfFrame");
    if (frame) frame.src = "about:blank";
    if (box) box.hidden = true;
  });

  try {
    const catData = await api("/api/pnl/categories");
    categories = catData.categories || [];
  } catch (e) {
    console.error(e);
    setCatStatus("No pude cargar categorías: " + e.message, true);
    categories = [
      { id: "ingreso", label: "Ingreso", kind: "ingreso" },
      { id: "otro", label: "Otro", kind: "neutro" },
      { id: "revisar", label: "Revisar", kind: "neutro" },
      { id: "socio", label: "Socio", kind: "neutro" },
      { id: "proveedor", label: "Proveedor", kind: "gasto" },
    ];
  }
  renderCategories();

  try {
    const rulesData = await api("/api/pnl/rules");
    rules = rulesData.rules || [];
  } catch (e) {
    console.error(e);
    rules = [];
  }
  renderRules();

  try {
    const runs = await api("/api/pnl/runs");
    runsCache = runs.runs || [];
    if (runsCache[0]) renderRun(runsCache[0]);
  } catch (e) {
    console.error(e);
  }
  await refreshLibrary();

  const hash = (location.hash || "").replace("#", "");
  showView(hash === "analisis" ? "analisis" : "estados");

  document.getElementById("addRule").onclick = () => {
    rules.push({
      id: "new-" + Date.now(),
      match: "",
      label: "",
      category: categories[0]?.id || "otro",
      frecuente: true,
    });
    renderRules();
  };

  document.getElementById("saveRules").onclick = async () => {
    try {
      const saved = await api("/api/pnl/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      rules = saved.rules;
      renderRules();
      document.getElementById("rulesStatus").textContent = "Reglas guardadas.";
    } catch (e) {
      document.getElementById("rulesStatus").textContent = e.message;
    }
  };

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("file");
  const fileName = document.getElementById("fileName");
  const processBtn = document.getElementById("processBtn");
  const status = document.getElementById("uploadStatus");
  let uploading = false;

  function isPdf(file) {
    if (!file) return false;
    const name = (file.name || "").toLowerCase();
    return file.type === "application/pdf" || name.endsWith(".pdf");
  }

  async function uploadFile(file) {
    if (!file) {
      status.textContent = "No hay PDF seleccionado.";
      return;
    }
    if (uploading) return;
    uploading = true;
    status.textContent = "Procesando PDF…";
    processBtn.disabled = true;
    processBtn.textContent = "Procesando…";
    const fd = new FormData();
    fd.append("statement", file);
    try {
      const res = await fetch("/api/pnl/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error upload");
      const period = data.stats.period || data.run.periodLabel || "";
      const savedAs = data.stats.savedAs || data.run.storedName || "";
      const rulesNew = (data.stats.rulesCreated || []).join(", ");
      const rec = data.stats.reconciliation;
      const quadra = rec?.matchCompleto ? " · ✓ cuadra con PDF" : " · ✗ no cuadra aún";
      const arch = data.stats.archive;
      let driveMsg = "";
      if (arch?.ok) {
        driveMsg = " · ✓ Drive guardado";
      } else if (arch?.error) {
        const err = String(arch.error);
        driveMsg =
          err.includes("DriveApp") || err.includes("permission")
            ? " · ✗ Drive SIN PERMISO — en Apps Script ejecuta authorizeDrive_ y republica"
            : ` · ✗ Drive: ${err.slice(0, 120)}`;
      }
      status.textContent = `OK: ${data.stats.lines} movs · mes ${period} · ${savedAs} · ${data.stats.needsReview} a revisar${
        rulesNew ? ` · reglas/match: ${rulesNew}` : ""
      }${quadra}${driveMsg}`;
      if (data.categories) {
        categories = data.categories;
        renderCategories();
      }
      if (data.rules) {
        rules = data.rules;
        renderRules();
      }
      renderRun(data.run);
      await refreshLibrary();
      await refreshAnalysis();
      const runsRes = await api("/api/pnl/runs");
      runsCache = runsRes.runs || [];
    } catch (e) {
      status.textContent = "Error: " + e.message;
    } finally {
      uploading = false;
      processBtn.disabled = false;
      processBtn.textContent = "Procesar PDF";
    }
  }

  const restoreBtn = document.getElementById("restoreDriveBtn");
  if (restoreBtn) {
    restoreBtn.onclick = async () => {
      const el = document.getElementById("restoreDriveStatus");
      restoreBtn.disabled = true;
      if (el) el.textContent = "Restaurando desde Google Drive…";
      try {
        const data = await api("/api/pnl/restore-from-drive", {
          method: "POST",
        });
        if (el) {
          const nRest = (data.restored || []).length;
          const nSkip = (data.skipped || []).length;
          const errs = data.errors || [];
          if (!nRest && !nSkip && !errs.length) {
            el.textContent =
              "Drive vacío: aún no hay PDFs archivados. Sube un PDF (si falla permiso, en Apps Script ejecuta authorizeDrive_ y republica v11).";
          } else {
            el.textContent = `OK: ${nRest} restaurados · ${nSkip} ya estaban · ${errs.length} errores${
              errs[0] ? " · " + String(errs[0]).slice(0, 100) : ""
            }`;
          }
        }
        await refreshLibrary();
        const runsRes = await api("/api/pnl/runs");
        runsCache = runsRes.runs || [];
        if (runsCache[0]) renderRun(runsCache[0]);
      } catch (e) {
        if (el) el.textContent = "Error: " + e.message;
      } finally {
        restoreBtn.disabled = false;
      }
    };
  }

  const sendBtn = document.getElementById("sendToSheetBtn");
  if (sendBtn) {
    sendBtn.onclick = async () => {
      if (!currentRun?.id) {
        const el = document.getElementById("sendToSheetStatus");
        if (el) el.textContent = "Abre un estado de cuenta primero (o sube el PDF).";
        return;
      }
      sendBtn.disabled = true;
      const el = document.getElementById("sendToSheetStatus");
      if (el) el.textContent = "Enviando al Sheet…";
      try {
        const alive = await ensureCurrentRunAlive();
        if (!alive || !currentRun?.id) {
          throw new Error(runMissingHint());
        }
        const data = await api(
          `/api/pnl/runs/${encodeURIComponent(currentRun.id)}/send-to-sheet`,
          { method: "POST" }
        );
        if (data.run) renderRun(data.run);
        if (el) el.textContent = data.message || "Enviado.";
        await refreshLibrary();
      } catch (e) {
        if (el) el.textContent = "Error: " + e.message;
      } finally {
        sendBtn.disabled = false;
      }
    };
  }

  function setFile(file, autoUpload) {
    if (!isPdf(file)) {
      status.textContent = "Solo se aceptan archivos PDF.";
      selectedFile = null;
      processBtn.disabled = true;
      dropZone.classList.remove("has-file");
      fileName.textContent = "";
      return;
    }
    selectedFile = file;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch (_) {
      /* algunos navegadores bloquean DataTransfer; usamos selectedFile */
    }
    fileName.textContent =
      file.name + " (" + Math.round(file.size / 1024) + " KB)";
    dropZone.classList.add("has-file");
    processBtn.disabled = false;
    status.textContent = autoUpload
      ? "PDF capturado. Procesando…"
      : "PDF listo. Pulsa Procesar PDF.";
    if (autoUpload) uploadFile(file);
  }

  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  dropZone.addEventListener("drop", (e) => {
    const file =
      e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setFile(file, true);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) setFile(file, true);
  });

  processBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const file = selectedFile || (fileInput.files && fileInput.files[0]);
    await uploadFile(file);
  });

  document.getElementById("uploadForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const file = selectedFile || (fileInput.files && fileInput.files[0]);
    await uploadFile(file);
  });

  const reparseBtn = document.getElementById("reparseBtn");
  if (reparseBtn) {
    reparseBtn.onclick = async () => {
      if (!currentRun) {
        status.textContent = "No hay PDF previo. Suéltalo en la zona.";
        return;
      }
      status.textContent = "Reprocesando texto guardado…";
      try {
        const data = await api(`/api/pnl/runs/${currentRun.id}/reparse`, {
          method: "POST",
        });
        const rulesNew = (data.stats.rulesCreated || []).join(", ");
        const rec = data.stats.reconciliation;
        status.textContent = `Reparse OK: ${data.stats.lines} movs · mes ${
          data.stats.period || ""
        }${rulesNew ? ` · match: ${rulesNew}` : ""}${
          rec?.matchCompleto ? " · ✓ cuadra" : " · ✗ no cuadra"
        }`;
        if (data.categories) {
          categories = data.categories;
          renderCategories();
        }
        if (data.rules) {
          rules = data.rules;
          renderRules();
        }
        renderRun(data.run);
        await refreshLibrary();
      } catch (e) {
        status.textContent = e.message;
      }
    };
  }
}

init().catch((e) => {
  console.error(e);
  alert("Error al cargar UI: " + e.message);
});
