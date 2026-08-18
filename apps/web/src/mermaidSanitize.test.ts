import { sanitizeMermaid } from "./mermaidSanitize.ts";

const src = `flowchart TD
  subgraph "Узел 1 (Primary)"
    PG1[PostgreSQL<br/>(Primary)]
    LB[HAProxy / NGINX]
  end
  A -->|6432 (PgBouncer)| B
`;

const out = sanitizeMermaid(src);
if (!out.includes('PG1["PostgreSQL<br>(Primary)"]')) throw new Error(out);
if (!out.includes('LB["HAProxy / NGINX"]')) throw new Error(out);
if (!out.includes('|"6432 (PgBouncer)"|')) throw new Error(out);
if (out.includes("<br/>")) throw new Error(out);
console.log("mermaid sanitize ok");
