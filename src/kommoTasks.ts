/**
 * Recordatorios de eventos cerrados en el calendario de Kommo.
 *
 * Kommo no tiene "eventos": lo que aparece en su calendario son tareas con
 * complete_till. Por cada evento cerrado se crean dos:
 *   - 7 días antes  → "hay evento esta semana"
 *   - 1 día antes   → "mañana es el evento"
 * Google Calendar lleva el evento en sí; esto es para que el equipo lo vea
 * dentro de Kommo sin salir del CRM.
 */
import { fetchLeadWithContact, kommoGetJson_ } from "./kommoApi";
import { mapDealToFilaVentas } from "./mapDealToFila";
import { findEventoInSheet, loadEventosProximos } from "./sheetEventosReader";
import type { FilaVentas, KommoLead } from "./types";

const MX_TZ = "America/Mexico_City";
/** Hora local a la que vence el recordatorio. */
const REMINDER_HOUR = 9;
/** Marca en el texto para no duplicar tareas al re-sincronizar el deal. */
const TASK_TAG = "[evt";
/** Solo status ganado de Kommo/amoCRM (evitar import circular con pollClosedDeals). */
const WON_STATUS_ID = 142;
const LOST_STATUS_ID = 143;

function isWonLead_(lead: KommoLead): boolean {
  if (lead.status_id === LOST_STATUS_ID) return false;
  return lead.status_id === WON_STATUS_ID;
}

export type ReminderKind = "semana" | "vispera";

export interface KommoTaskResult {
  ok: boolean;
  dealId: string;
  skipped?: string;
  /** "kommo" o "sheet": de dónde salió la fecha del evento. */
  fechaSource?: string;
  fechaDelEvento?: string;
  created: Array<{ kind: ReminderKind; completeTill: string; text: string }>;
  alreadyThere: ReminderKind[];
  tooLate: ReminderKind[];
  error?: string;
}

function kommoAuth_(): { base: string; token: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getKommoAccessToken, getKommoBaseUrl } = require("./kommoAuth") as typeof import("./kommoAuth");
  const base = getKommoBaseUrl();
  const token = getKommoAccessToken();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN (env o data/kommo-token.json)"
    );
  }
  return { base, token };
}

/** Offset real de México en esa fecha (no asumir -6 fijo). */
function mxOffsetMinutes_(whenMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(whenMs));
  const name =
    parts.find((p) => p.type === "timeZoneName")?.value || "GMT-06:00";
  const m = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return -360;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** "DD/MM/YYYY" + hora local México → unix segundos. */
export function mxUnixAt_(fechaDMY: string, hour: number): number | null {
  const m = fechaDMY.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const naive = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hour);
  if (!Number.isFinite(naive)) return null;
  return Math.floor((naive - mxOffsetMinutes_(naive) * 60_000) / 1000);
}

function fmtMx_(unixSeconds: number): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: MX_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function tagFor_(kind: ReminderKind, dealId: string): string {
  return `${TASK_TAG}:${kind}:${dealId}]`;
}

function textFor_(
  kind: ReminderKind,
  fila: FilaVentas
): string {
  const partes = [fila.cliente || "Cliente sin nombre"];
  if (fila.tipoDeEvento) partes.push(fila.tipoDeEvento);
  if (fila.horario) partes.push(fila.horario);
  if (fila.invitados) partes.push(`${fila.invitados} invitados`);
  if (fila.direccionDeEvento) partes.push(fila.direccionDeEvento);
  const detalle = partes.join(" — ");
  const cabeza =
    kind === "semana"
      ? `Evento esta semana (${fila.fechaDelEvento})`
      : `MAÑANA es el evento (${fila.fechaDelEvento})`;
  return `${cabeza}: ${detalle} ${tagFor_(kind, fila.kommoDealId)}`;
}

interface KommoTask {
  id?: number;
  text?: string;
  complete_till?: number;
  is_completed?: boolean;
}

async function fetchLeadTasks_(leadId: number): Promise<KommoTask[]> {
  const data = (await kommoGetJson_(
    `/api/v4/tasks?limit=250&filter[entity_type]=leads&filter[entity_id][]=${leadId}`,
    `Kommo tasks lead ${leadId}`
  )) as { _embedded?: { tasks?: KommoTask[] } } | null;
  return data?._embedded?.tasks || [];
}

async function postTasks_(payload: Record<string, unknown>[]): Promise<void> {
  const { base, token } = kommoAuth_();
  const res = await fetch(`${base}/api/v4/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kommo crear tarea HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function deleteTasksById_(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { base, token } = kommoAuth_();
  const res = await fetch(`${base}/api/v4/tasks`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ids.map((id) => ({ id }))),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(
      `Kommo borrar tareas HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }
}

/** Si el token no puede DELETE (scope), marcar completadas las saca del calendario activo. */
async function completeTasksById_(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { base, token } = kommoAuth_();
  const res = await fetch(`${base}/api/v4/tasks`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ids.map((id) => ({ id, is_completed: true }))),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Kommo completar tareas HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }
}

function isOurReminderTask_(text: string): boolean {
  return text.includes(TASK_TAG + ":") && text.includes("]");
}

/**
 * Quita las tareas de recordatorio Bodasesor ([evt:semana|vispera:dealId])
 * de un lead. Intenta borrar; si el token no tiene scope DELETE, las completa.
 */
export async function deleteEventReminderTasks(
  leadId: number
): Promise<{
  ok: boolean;
  dealId: string;
  deleted: number;
  completed?: number;
  method?: "deleted" | "completed";
  texts: string[];
  error?: string;
}> {
  const dealId = String(leadId);
  try {
    const tasks = await fetchLeadTasks_(leadId);
    const ours = tasks.filter(
      (t) =>
        t.id &&
        !t.is_completed &&
        isOurReminderTask_(String(t.text || ""))
    );
    if (!ours.length) {
      return { ok: true, dealId, deleted: 0, texts: [] };
    }
    const ids = ours.map((t) => Number(t.id));
    const texts = ours.map((t) => String(t.text || ""));
    try {
      await deleteTasksById_(ids);
      return { ok: true, dealId, deleted: ids.length, method: "deleted", texts };
    } catch (delErr) {
      // Token largo-plazo a veces no trae scope de DELETE; completar basta.
      console.warn(
        "[kommo-tasks] DELETE falló, completando:",
        delErr instanceof Error ? delErr.message : delErr
      );
      await completeTasksById_(ids);
      return {
        ok: true,
        dealId,
        deleted: ids.length,
        completed: ids.length,
        method: "completed",
        texts,
      };
    }
  } catch (err) {
    return {
      ok: false,
      dealId,
      deleted: 0,
      texts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Crea las tareas de recordatorio que falten para un deal cerrado.
 * Idempotente: relee las tareas del lead y salta las que ya tienen la marca.
 * NUNCA crea tareas en leads que no estén ganados (status 142).
 */
export async function ensureEventReminderTasks(
  lead: KommoLead,
  fila: FilaVentas
): Promise<KommoTaskResult> {
  const dealId = fila.kommoDealId || String(lead.id);
  const base: KommoTaskResult = {
    ok: true,
    dealId,
    created: [],
    alreadyThere: [],
    tooLate: [],
  };

  if (!isWonLead_(lead)) {
    return { ...base, skipped: "no_ganado" };
  }

  // Kommo suele traer la fecha vacía o como "viernes"; el Sheet es donde se
  // corrige a mano, así que ahí buscamos antes de rendirnos.
  let fechaSource = "kommo";
  if (!fila.fechaDelEvento) {
    const enSheet = await findEventoInSheet(dealId);
    if (enSheet?.fechaDelEvento) {
      fechaSource = "sheet";
      fila = {
        ...fila,
        fechaDelEvento: enSheet.fechaDelEvento,
        tipoDeEvento: fila.tipoDeEvento || enSheet.tipoDeEvento,
        invitados: fila.invitados || enSheet.invitados,
        direccionDeEvento: fila.direccionDeEvento || enSheet.direccionDeEvento,
        horario: fila.horario || enSheet.horario,
      };
    }
  }
  base.fechaSource = fechaSource;
  base.fechaDelEvento = fila.fechaDelEvento;

  if (!fila.fechaDelEvento) {
    return { ...base, skipped: "sin_fecha_evento" };
  }
  const eventoUnix = mxUnixAt_(fila.fechaDelEvento, REMINDER_HOUR);
  if (!eventoUnix) {
    return { ...base, skipped: "fecha_evento_no_parseable" };
  }

  const ahora = Math.floor(Date.now() / 1000);
  const planes: Array<{ kind: ReminderKind; completeTill: number }> = [
    { kind: "semana", completeTill: eventoUnix - 7 * 86400 },
    { kind: "vispera", completeTill: eventoUnix - 86400 },
  ];

  let existentes: KommoTask[];
  try {
    existentes = await fetchLeadTasks_(lead.id);
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const nuevas: Record<string, unknown>[] = [];
  for (const plan of planes) {
    // Un recordatorio vencido no sirve de nada y ensucia la lista de tareas.
    if (plan.completeTill <= ahora) {
      base.tooLate.push(plan.kind);
      continue;
    }
    const tag = tagFor_(plan.kind, dealId);
    if (existentes.some((t) => (t.text || "").includes(tag))) {
      base.alreadyThere.push(plan.kind);
      continue;
    }
    const text = textFor_(plan.kind, fila);
    nuevas.push({
      text,
      complete_till: plan.completeTill,
      entity_id: lead.id,
      entity_type: "leads",
      task_type_id: 1,
      ...(lead.responsible_user_id
        ? { responsible_user_id: lead.responsible_user_id }
        : {}),
    });
    base.created.push({
      kind: plan.kind,
      completeTill: fmtMx_(plan.completeTill),
      text,
    });
  }

  if (!nuevas.length) return base;

  try {
    await postTasks_(nuevas);
  } catch (err) {
    return {
      ...base,
      ok: false,
      created: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return base;
}

export interface BackfillResult {
  eventosFuturos: number;
  creadas: number;
  items: Array<Record<string, unknown>>;
}

/**
 * Repasa los eventos futuros del Sheet y crea las tareas que falten.
 *
 * Se parte del Sheet y no de los cierres de Kommo por dos razones: Kommo
 * ignora order[closed_at]=desc (devuelve los más viejos de la ventana) y
 * muchas fechas de evento solo existen en el Sheet porque se corrigen a mano.
 *
 * Es el reintento que hace que una caída de la API de Kommo durante el cierre
 * no deje al evento sin recordatorio para siempre.
 */
export async function backfillEventReminderTasks(): Promise<BackfillResult> {
  const proximos = await loadEventosProximos();
  const items: Array<Record<string, unknown>> = [];
  let creadas = 0;

  for (const evento of proximos) {
    if (!evento.dealId) {
      items.push({
        row: evento.row,
        cliente: evento.cliente,
        fechaDelEvento: evento.fechaDelEvento,
        ok: true,
        skipped: "fila_sin_kommo_deal_id",
      });
      continue;
    }
    try {
      const lead = await fetchLeadWithContact(Number(evento.dealId));
      const fila = mapDealToFilaVentas(lead);
      const res = await ensureEventReminderTasks(lead, fila);
      creadas += res.created.length;
      items.push({ row: evento.row, cliente: evento.cliente, ...res });
    } catch (leadErr) {
      items.push({
        row: evento.row,
        cliente: evento.cliente,
        dealId: evento.dealId,
        ok: false,
        error: leadErr instanceof Error ? leadErr.message : String(leadErr),
      });
    }
  }

  return { eventosFuturos: proximos.length, creadas, items };
}
