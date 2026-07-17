let categories = [];
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
      </td>
      <td class="amount ${income ? "income" : ""}">
        <input class="amount-edit" type="number" step="0.01" data-field="amount" data-line="${escapeAttr(
          line.id
        )}" value="${escapeAttr(String(line.amount))}" style="${
      income ? "color:#0b6b3a;font-weight:700" : ""
    }" />
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
        <input type="checkbox" data-field="needsReview" data-line="${escapeAttr(
          line.id
        )}" ${line.needsReview ? "checked" : ""} title="Marcar para revisar" />
      </td>
    `;
    tbody.appendChild(tr);
  }

  async function patchLine(lineId, body) {
    await api(`/api/pnl/runs/${run.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const fresh = await api(`/api/pnl/runs/${run.id}`);
    renderRun(fresh.run);
    refreshLibrary();
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
      const n = Number(el.value);
      if (!Number.isFinite(n)) {
        alert("Monto inválido");
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

async function init() {
  // Botones deben funcionar aunque falle alguna API
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
      const created = (data.stats.categoriesCreated || []).join(", ");
      status.textContent = `OK: ${data.stats.lines} movs · mes ${period} · ${savedAs} · ${data.stats.needsReview} a revisar${
        created ? ` · categorías nuevas: ${created}` : ""
      }`;
      if (data.categories) {
        categories = data.categories;
        renderCategories();
        renderRules();
      } else {
        try {
          const catData = await api("/api/pnl/categories");
          categories = catData.categories || categories;
          renderCategories();
        } catch (_) {}
      }
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
        const created = (data.stats.categoriesCreated || []).join(", ");
        status.textContent = `Reparse OK: ${data.stats.lines} movs · mes ${
          data.stats.period || ""
        }${created ? ` · nuevas: ${created}` : ""}`;
        if (data.categories) {
          categories = data.categories;
          renderCategories();
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
