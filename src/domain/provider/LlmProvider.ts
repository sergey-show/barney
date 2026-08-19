import { detectDialect, type DialectId } from "./dialect.ts";
import { InvariantError } from "../shared/DomainError.ts";
import { newId } from "../shared/Id.ts";

export type ProviderKind = "openai-compat" | "anthropic" | "stub";

export type ProviderView = {
  id: string;
  name: string;
  kind: ProviderKind;
  dialect: DialectId;
  baseUrl: string;
  hasKey: boolean;
  defaultModel: string | null;
};

export class LlmProvider {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly kind: ProviderKind,
    readonly baseUrl: string,
    readonly apiKey: string | null,
    public defaultModel: string | null,
    readonly dialect: DialectId,
  ) {
    if (!name.trim()) throw new InvariantError("provider name is required");
    if (kind === "openai-compat" && !baseUrl.trim()) throw new InvariantError("openai-compat provider needs a host");
  }

  static create(input: {
    id?: string;
    name: string;
    kind: ProviderKind;
    host?: string;
    apiKey?: string | null;
    defaultModel?: string | null;
    dialect?: string | null;
  }): LlmProvider {
    const baseUrl = input.kind === "openai-compat"
      ? normalizeOpenAiRoot(input.host ?? "")
      : (input.host ?? "").replace(/\/$/, "");
    return new LlmProvider(
      input.id ?? newId("prov"),
      input.name.trim(),
      input.kind,
      baseUrl,
      input.apiKey?.trim() || null,
      input.defaultModel ?? null,
      detectDialect({
        name: input.name,
        host: baseUrl,
        kind: input.kind,
        dialect: input.dialect,
      }),
    );
  }

  view(): ProviderView {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      dialect: this.dialect,
      baseUrl: this.baseUrl,
      hasKey: Boolean(this.apiKey),
      defaultModel: this.defaultModel,
    };
  }
}

export function normalizeOpenAiRoot(host: string): string {
  let url = host.trim();
  if (!url) throw new InvariantError("host is required");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, "");
  if (!/\/v\d+$/i.test(url)) url = `${url}/v1`;
  return url;
}

export type RoleBinding = {
  role: string;
  providerId: string;
  model: string;
};
