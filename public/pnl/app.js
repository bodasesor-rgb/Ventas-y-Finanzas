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

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderRun(run) {
  currentRun = run;
  const summary = document.getElementById("summary");
  summary.innerHTML = "";
  const entries = Object.entries(run.summaryByCategory || {});
  if (!entries.length) {
    summary.innerHTML =
      '<span class="chip warn">No se detectaron líneas con fecha+monto. Revisa el formato del PDF.</span>';
  } else {
    for (const [cat, total] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
      const chip = document.createElement("span");
      chip.className = "chip" + (cat === "revisar" || cat === "transferencia_persona" ? " warn" : "");
      chip.textContent = `${cat}: ${money(total)}`;
      summary.appendChild(chip);
    }
  }

  const tbody = document.querySelector("#linesTable tbody");
  tbody.innerHTML = "";
  for (const line of run.lines) {
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

  function setFile(file) {
    if (!isPdf(file)) {
      status.textContent = "Solo se aceptan archivos PDF.";
      processBtn.disabled = true;
      dropZone.classList.remove("has-file");
      fileName.textContent = "";
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileName.textContent = file.name;
    dropZone.classList.add("has-file");
    processBtn.disabled = false;
    status.textContent = "PDF listo. Se procesará ahora…";
    uploadFile(file);
  }

  async function uploadFile(file) {
    status.textContent = "Procesando…";
    processBtn.disabled = true;
    const fd = new FormData();
    fd.append("statement", file);
    try {
      const res = await fetch("/api/pnl/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error upload");
      status.textContent = `OK: ${data.stats.lines} líneas · ${data.stats.matched} con regla · ${data.stats.needsReview} a revisar`;
      renderRun(data.run);
    } catch (e) {
      status.textContent = e.message;
    } finally {
      processBtn.disabled = !fileInput.files[0];
    }
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
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) setFile(file);
  });

  document.getElementById("uploadForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;
    await uploadFile(file);
  };
}

init().catch((e) => alert(e.message));
