const CATEGORIES = [
  "ads",
  "pass",
  "nomina",
  "proveedor",
  "renta",
  "servicios",
  "transferencia_persona",
  "ingreso",
  "otro",
  "revisar",
];

let rules = [];
let currentRun = null;
let selectedFile = null;
let runsCache = [];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

function money(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n || 0);
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
          ${CATEGORIES.map(
            (c) =>
              `<option value="${c}" ${c === r.category ? "selected" : ""}>${c}</option>`
          ).join("")}
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

function renderRun(run) {
  currentRun = run;
  const meta = document.getElementById("currentRunMeta");
  if (meta) {
    const parts = [
      run.periodLabel ? `Mes: ${run.periodLabel}` : null,
      run.storedName ? `Archivo: ${run.storedName}` : null,
      run.filename ? `Original: ${run.filename}` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
  }

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
      chip.className =
        "chip" +
        (cat === "revisar" || cat === "transferencia_persona" ? " warn" : "");
      chip.textContent = `${cat}: ${money(total)}`;
      summary.appendChild(chip);
    }
  }

  const tbody = document.querySelector("#linesTable tbody");
  tbody.innerHTML = "";
  for (const line of run.lines || []) {
    const tr = document.createElement("tr");
    if (line.needsReview) tr.classList.add("review");
    tr.innerHTML = `
      <td>${escapeAttr(line.date || "")}</td>
      <td>${escapeAttr(line.description)}</td>
      <td class="amount">${money(line.amount)}</td>
      <td>
        <select data-line="${line.id}">
          ${CATEGORIES.map(
            (c) =>
              `<option value="${c}" ${c === line.category ? "selected" : ""}>${c}</option>`
          ).join("")}
        </select>
      </td>
      <td>${line.needsReview ? "sí" : ""}</td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("select[data-line]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await api(`/api/pnl/runs/${run.id}/lines/${sel.dataset.line}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: sel.value }),
        });
        const fresh = await api(`/api/pnl/runs/${run.id}`);
        renderRun(fresh.run);
        refreshLibrary();
      } catch (e) {
        alert(e.message);
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

async function init() {
  const data = await api("/api/pnl/rules");
  rules = data.rules;
  renderRules();

  const runs = await api("/api/pnl/runs");
  runsCache = runs.runs || [];
  if (runsCache[0]) renderRun(runsCache[0]);
  await refreshLibrary();

  document.getElementById("btnClosePdf")?.addEventListener("click", () => {
    const box = document.getElementById("pdfViewer");
    const frame = document.getElementById("pdfFrame");
    if (frame) frame.src = "about:blank";
    if (box) box.hidden = true;
  });

  document.getElementById("addRule").onclick = () => {
    rules.push({
      id: "new-" + Date.now(),
      match: "",
      label: "",
      category: "otro",
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
      status.textContent = `OK: ${data.stats.lines} movs · mes ${period} · guardado como ${savedAs} · ${data.stats.needsReview} a revisar`;
      renderRun(data.run);
      await refreshLibrary();
      const runsRes = await api("/api/pnl/runs");
      runsCache = runsRes.runs || [];
    } catch (e) {
      status.textContent = "Error: " + e.message;
    } finally {
      processBtn.disabled = false;
      processBtn.textContent = "Procesar PDF";
    }
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
        status.textContent = `Reparse OK: ${data.stats.lines} movs · mes ${
          data.stats.period || ""
        }`;
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
