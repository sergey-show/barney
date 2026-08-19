import type { Database } from "bun:sqlite";
import type { ExperienceGraph } from "../../application/ports.ts";
import {
  memoryShelf,
  nodeKindFromKey,
  titleFromKey,
  type ExperienceEdge,
  type ExperienceKind,
  type ExperienceNode,
} from "../../domain/memory/experienceGraph.ts";

export class SqliteExperienceGraph implements ExperienceGraph {
  constructor(private readonly db: Database) {}

  async link(src: string, dst: string, kind: ExperienceKind): Promise<void> {
    const from = src.trim();
    const to = dst.trim();
    if (!from || !to || from === to) return;
    this.db.run(
      `INSERT INTO experience_edges (src, dst, kind, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(src, dst, kind) DO NOTHING`,
      [from, to, kind, new Date().toISOString()],
    );
  }

  async neighborhood(keys: string[], hops = 2): Promise<string[]> {
    const seeds = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    if (!seeds.length || hops < 1) return [];
    const rows = this.db.query<{ key: string }, [string, number]>(
      `WITH RECURSIVE walk(key, dist) AS (
         SELECT value, 0 FROM json_each(?)
         UNION
         SELECT CASE WHEN e.src = walk.key THEN e.dst ELSE e.src END, walk.dist + 1
         FROM walk
         JOIN experience_edges e ON e.src = walk.key OR e.dst = walk.key
         WHERE walk.dist < ?
       )
       SELECT DISTINCT key FROM walk WHERE dist > 0`,
    ).all(JSON.stringify(seeds), hops);
    return rows.map((row) => row.key);
  }

  async snapshot(limit = 80): Promise<{ nodes: ExperienceNode[]; edges: ExperienceEdge[] }> {
    const edgeRows = this.db.query<EdgeRow, [number]>(
      "SELECT src, dst, kind, created_at FROM experience_edges ORDER BY created_at DESC LIMIT ?",
    ).all(limit);
    const edges: ExperienceEdge[] = edgeRows.map((row) => ({
      src: row.src,
      dst: row.dst,
      kind: row.kind,
      createdAt: row.created_at,
    }));
    const ids = [...new Set(edges.flatMap((edge) => [edge.src, edge.dst]))];
    const notes = new Map<string, { title: string; tags: string }>();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const found = this.db.query<{ key: string; title: string; tags: string }, string[]>(
        `SELECT key, title, tags FROM memories WHERE key IN (${placeholders})`,
      ).all(...ids);
      for (const row of found) notes.set(row.key, { title: row.title, tags: row.tags });
    }
    const nodes: ExperienceNode[] = ids.map((id) => {
      const note = notes.get(id);
      let tags: string[] = [];
      try {
        tags = note ? JSON.parse(note.tags) as string[] : [];
      } catch {
        tags = [];
      }
      return {
        id,
        kind: nodeKindFromKey(id),
        title: note?.title || titleFromKey(id),
        shelf: note ? memoryShelf({ key: id, tags }) : (id.startsWith("class/") ? "learned" : "internal"),
      };
    });
    return { nodes, edges };
  }
}

type EdgeRow = {
  src: string;
  dst: string;
  kind: ExperienceKind;
  created_at: string;
};
