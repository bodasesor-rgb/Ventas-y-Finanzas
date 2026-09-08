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
import { kommoGetJson_ } from "./kommoApi";
import type { FilaVentas, KommoLead } from "./types";

const MX_TZ = "America/Mexico_City";
/** Hora local a la que vence el recordatorio. */
const REMINDER_HOUR = 9;
/** Marca en el texto para no duplicar tareas al re-sincronizar el deal. */
const TASK_TAG = "[evt";

export type ReminderKind = "semana" | "vispera";

export interface KommoTaskResult {
  ok: boolean;
  dealId: string;
  skipped?: string;
  created: Array<{ kind: ReminderKind; completeTill: string; text: string }>;
  alreadyThere: ReminderKind[];
  tooLate: ReminderKind[];
  error?: string;
}

function kommoAuth_(): { base: string; token: string } {
  const base = process.env.KOMMO_BASE_URL?.replace(/\/$/, "");
  const token = process.env.KOMMO_ACCESS_TOKEN;
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
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

/**
 * Crea las tareas de recordatorio que falten para un deal cerrado.
 * Idempotente: relee las tareas del lead y salta las que ya tienen la marca.
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
