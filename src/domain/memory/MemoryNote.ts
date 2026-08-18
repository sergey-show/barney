import { InvariantError } from "../shared/DomainError.ts";
import { newId } from "../shared/Id.ts";

export type MemoryNoteProps = {
  id?: string;
  key: string;
  title: string;
  body: string;
  tags?: string[];
  sourceRunId?: string;
  sourceAgentId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export class MemoryNote {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly tags: string[];
  readonly sourceRunId: string;
  readonly sourceAgentId: string;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(props: MemoryNoteProps) {
    const key = slugKey(props.key || props.title);
    const title = props.title.trim();
    const body = props.body.trim();
    if (!key) throw new InvariantError("memory key is required");
    if (!title) throw new InvariantError("memory title is required");
    if (!body) throw new InvariantError("memory body is required");
    const now = new Date().toISOString();
    this.id = props.id ?? newId("mem");
    this.key = key;
    this.title = title;
    this.body = body;
    this.tags = [...new Set((props.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    this.sourceRunId = props.sourceRunId ?? "";
    this.sourceAgentId = props.sourceAgentId ?? "";
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
  }

  view() {
    return {
      id: this.id,
      key: this.key,
      title: this.title,
      body: this.body,
      tags: this.tags,
      sourceRunId: this.sourceRunId,
      sourceAgentId: this.sourceAgentId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9:./_-]+/g, "-").replace(/^[-./]+|[-./]+$/g, "").slice(0, 96);
}
