/**
 * Cross-agent mailbox — parent/child coordination without stuffing operator steer lines.
 */

export type MailKind = "task" | "result" | "notice" | "interrupt";

export type MailMessage = {
  id: string;
  from: string;
  to: string;
  kind: MailKind;
  body: string;
  createdAt: string;
  read: boolean;
};

export function mailboxMemoryKey(agentId: string): string {
  return `mailbox/${agentId}`;
}

export function emptyMailbox(): MailMessage[] {
  return [];
}

export function parseMailbox(body: string): MailMessage[] {
  try {
    const parsed = JSON.parse(body) as { messages?: MailMessage[] } | MailMessage[];
    const rows = Array.isArray(parsed) ? parsed : parsed.messages;
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeMail).filter(Boolean) as MailMessage[];
  } catch {
    return [];
  }
}

export function formatMailbox(messages: MailMessage[]): string {
  return JSON.stringify({ messages: messages.slice(-100) }, null, 2);
}

function normalizeMail(row: MailMessage): MailMessage | null {
  if (!row || !row.body) return null;
  return {
    id: String(row.id || `mail_${Date.now().toString(36)}`),
    from: String(row.from || "unknown"),
    to: String(row.to || ""),
    kind: row.kind === "result" || row.kind === "notice" || row.kind === "interrupt" ? row.kind : "task",
    body: String(row.body).slice(0, 8_000),
    createdAt: row.createdAt || new Date().toISOString(),
    read: Boolean(row.read),
  };
}

export function enqueueMail(messages: MailMessage[], mail: Omit<MailMessage, "id" | "createdAt" | "read"> & Partial<Pick<MailMessage, "id" | "createdAt" | "read">>): MailMessage[] {
  const next: MailMessage = {
    id: mail.id || `mail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    from: mail.from,
    to: mail.to,
    kind: mail.kind,
    body: mail.body.slice(0, 8_000),
    createdAt: mail.createdAt || new Date().toISOString(),
    read: mail.read ?? false,
  };
  return [...messages, next].slice(-100);
}

export function drainMail(messages: MailMessage[], opts?: { limit?: number; unreadOnly?: boolean }): {
  remaining: MailMessage[];
  drained: MailMessage[];
} {
  const limit = opts?.limit ?? 8;
  const unreadOnly = opts?.unreadOnly ?? true;
  const drained: MailMessage[] = [];
  const remaining: MailMessage[] = [];
  for (const row of messages) {
    if (drained.length < limit && (!unreadOnly || !row.read)) {
      drained.push({ ...row, read: true });
    } else {
      remaining.push(row);
    }
  }
  return { remaining, drained };
}

export function formatMailForPrompt(messages: MailMessage[]): string {
  if (!messages.length) return "";
  const lines = messages.map((m) => `- [${m.kind}] from=${m.from}: ${m.body.replace(/\s+/g, " ").slice(0, 240)}`);
  return `<agent_mail>\n${lines.join("\n")}\n</agent_mail>`;
}

/** In-memory fan-out for a process lifetime; persist via memory keys separately. */
export class AgentMailboxBus {
  private readonly boxes = new Map<string, MailMessage[]>();

  get(agentId: string): MailMessage[] {
    return [...(this.boxes.get(agentId) ?? [])];
  }

  set(agentId: string, messages: MailMessage[]): void {
    this.boxes.set(agentId, messages.slice(-100));
  }

  send(mail: Omit<MailMessage, "id" | "createdAt" | "read"> & Partial<Pick<MailMessage, "id" | "createdAt" | "read">>): MailMessage {
    const list = this.get(mail.to);
    const next = enqueueMail(list, mail);
    this.set(mail.to, next);
    return next[next.length - 1]!;
  }

  drain(agentId: string, limit = 8): MailMessage[] {
    const { remaining, drained } = drainMail(this.get(agentId), { limit });
    this.set(agentId, remaining);
    return drained;
  }
}
