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

function renderRun(run) {
  currentRun = run;
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
  if (runs.runs?.[0]) renderRun(runs.runs[0]);

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
      status.textContent = `OK: ${data.stats.lines} movimientos · ${data.stats.matched} con regla · ${data.stats.needsReview} a revisar · texto ${data.run.parseDebug?.textLength || "?"} chars`;
      renderRun(data.run);
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
    fileName.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB)";
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
  // también en window para que no abra el PDF en otra pestaña
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
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
        status.textContent = `Reparse OK: ${data.stats.lines} movimientos`;
        renderRun(data.run);
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
