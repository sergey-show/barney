import type { Database } from "bun:sqlite";
import type { ProviderCatalog } from "../../application/ports.ts";
import { LlmProvider, type RoleBinding } from "../../domain/provider/LlmProvider.ts";
import { ROLES, type Role } from "../../domain/provider/Role.ts";

export class SqliteProviderCatalog implements ProviderCatalog {
  constructor(private readonly db: Database) {}

  async list(): Promise<LlmProvider[]> {
    const rows = this.db.query<Row, []>("SELECT * FROM providers").all();
    return rows.map(fromRow);
  }

  async get(id: string): Promise<LlmProvider | null> {
    const row = this.db.query<Row, [string]>("SELECT * FROM providers WHERE id = ?").get(id);
    return row ? fromRow(row) : null;
  }

  async findByName(name: string): Promise<LlmProvider | null> {
    const row = this.db.query<Row, [string]>("SELECT * FROM providers WHERE name = ?").get(name);
    return row ? fromRow(row) : null;
  }

  async save(provider: LlmProvider): Promise<void> {
    this.db.run(
      `INSERT INTO providers (id, name, kind, dialect, base_url, api_key, default_model)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         dialect = excluded.dialect,
         base_url = excluded.base_url,
         api_key = excluded.api_key,
         default_model = excluded.default_model`,
      [provider.id, provider.name, provider.kind, provider.dialect, provider.baseUrl, provider.apiKey, provider.defaultModel],
    );
  }

  async remove(id: string): Promise<void> {
    this.db.run("DELETE FROM providers WHERE id = ?", [id]);
    this.db.run("DELETE FROM role_bindings WHERE provider_id = ?", [id]);
  }

  async bindings(): Promise<RoleBinding[]> {
    return this.db.query<RoleBinding, []>("SELECT role, provider_id as providerId, model FROM role_bindings").all();
  }

  async setBinding(role: Role, providerId: string, model: string): Promise<void> {
    this.db.run(
      `INSERT INTO role_bindings (role, provider_id, model) VALUES (?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model`,
      [role, providerId, model],
    );
  }

  async setDefault(providerId: string, model: string): Promise<void> {
    for (const role of ROLES) await this.setBinding(role, providerId, model);
    const provider = await this.get(providerId);
    if (provider) {
      provider.defaultModel = model;
      await this.save(provider);
    }
  }
}

type Row = {
  id: string;
  name: string;
  kind: LlmProvider["kind"];
  dialect?: string | null;
  base_url: string;
  api_key: string | null;
  default_model: string | null;
};

function fromRow(row: Row): LlmProvider {
  return LlmProvider.create({
    id: row.id,
    name: row.name,
    kind: row.kind,
    host: row.base_url,
    apiKey: row.api_key,
    defaultModel: row.default_model,
    dialect: row.dialect,
  });
}
