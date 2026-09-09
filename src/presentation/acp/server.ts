import * as acp from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { AgentSessionApplication } from "../../application/surfaces/AgentSessionApplication.ts";
import type { RunSnapshot, TranscriptItem } from "../../domain/run/Run.ts";
import { visibleAssistantText } from "../../infrastructure/llm/visibleReply.ts";

type AcpSession = {
  cwd: string;
  runId?: string;
  cancelled: boolean;
  activePrompt: boolean;
};

type UpdateContext = {
  notify(method: "session/update", params: acp.SessionNotification): Promise<void>;
};

export class BarneyAcpAgent {
  private readonly sessions = new Map<string, AcpSession>();

  constructor(private readonly application: AgentSessionApplication) {}

  initialize(_params: acp.InitializeRequest): acp.InitializeResponse {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
      },
      agentInfo: { name: "Barney", version: "0.2.1" },
    };
  }

  newSession(params: acp.NewSessionRequest): acp.NewSessionResponse {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { cwd: params.cwd, cancelled: false, activePrompt: false });
    return { sessionId };
  }

  async prompt(params: acp.PromptRequest, context: UpdateContext): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw acp.RequestError.invalidParams(`ACP session not found: ${params.sessionId}`);
    if (session.activePrompt) {
      throw acp.RequestError.invalidRequest(`ACP session ${params.sessionId} already has an active prompt`);
    }
    session.activePrompt = true;
    session.cancelled = false;

    let off: (() => void) | undefined;
    let before = 0;
    try {
      const text = promptText(params.prompt);
      if (!text.trim()) {
        throw acp.RequestError.invalidParams("ACP prompt must contain text or a resource link");
      }

      if (!session.runId) {
        const created = await this.application.create({ goal: text, cwd: session.cwd });
        session.runId = created.id;
        before = created.transcript.length;
      } else {
        const current = await this.application.get(session.runId);
        if (!current) throw acp.RequestError.invalidParams(`Barney session not found: ${session.runId}`);
        before = current.transcript.length;
      }

      const runId = session.runId;
      off = this.application.subscribe((event) => {
        if (event.type !== "run.thinking_delta" || event.payload.runId !== runId) return;
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        if (!delta) return;
        void notifyText(context, params.sessionId, "agent_thought_chunk", delta);
      });
      const result = await this.application.prompt(runId, text);
      await emitTranscript(context, params.sessionId, result, before);
      return {
        stopReason: session.cancelled ? "cancelled" : "end_turn",
      };
    } catch (error) {
      if (session.runId && !this.application.isRunning(session.runId)) {
        const current = await this.application.get(session.runId);
        if (current) await emitTranscript(context, params.sessionId, current, before);
      }
      throw error;
    } finally {
      off?.();
      session.activePrompt = false;
    }
  }

  cancel(params: acp.CancelNotification): void {
    const session = this.sessions.get(params.sessionId);
    if (session) session.cancelled = true;
    const runId = session?.runId;
    if (runId) this.application.cancel(runId);
  }
}

export function createAcpAgent(application: AgentSessionApplication): acp.AgentApp {
  const implementation = new BarneyAcpAgent(application);
  return acp
    .agent({ name: "barney" })
    .onRequest("initialize", (context) => implementation.initialize(context.params))
    .onRequest("session/new", (context) => implementation.newSession(context.params))
    .onRequest("authenticate", () => ({}))
    .onRequest("session/prompt", (context) => implementation.prompt(context.params, context.client))
    .onNotification("session/cancel", (context) => implementation.cancel(context.params));
}

export async function runAcp(application: AgentSessionApplication): Promise<void> {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const connection = createAcpAgent(application).connect(acp.ndJsonStream(output, input));
  await connection.closed;
}

function promptText(blocks: acp.ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "resource_link") {
        return `[Context: ${block.name || block.uri}](${block.uri})`;
      }
      throw acp.RequestError.invalidParams(`Unsupported ACP content block: ${block.type}`);
    })
    .filter(Boolean)
    .join("\n\n");
}

async function emitTranscript(
  context: UpdateContext,
  sessionId: string,
  run: RunSnapshot,
  offset: number,
): Promise<void> {
  for (const item of run.transcript.slice(offset)) {
    const mapped = transcriptUpdate(item);
    if (mapped) await notifyText(context, sessionId, mapped.kind, mapped.text, item.id);
  }
}

function transcriptUpdate(item: TranscriptItem): {
  kind: "agent_message_chunk" | "agent_thought_chunk";
  text: string;
} | null {
  if (item.kind === "assistant") {
    const text = visibleAssistantText(item.text);
    return text.trim() ? { kind: "agent_message_chunk", text } : null;
  }
  if (item.kind === "review" || item.kind === "research") {
    return { kind: "agent_thought_chunk", text: item.text };
  }
  return null;
}

async function notifyText(
  context: UpdateContext,
  sessionId: string,
  kind: "agent_message_chunk" | "agent_thought_chunk",
  text: string,
  messageId?: string,
): Promise<void> {
  await context.notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: kind,
      content: { type: "text", text },
      messageId,
    },
  });
}
