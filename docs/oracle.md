# Oracle (soft-domain grounding)

**English** · Core stays immune; soft truth is not LLM-as-judge.

Harbor/DevOps keep byte evidence (`evidenceWrote`, exit codes, `proof-*.py`).  
Text/business domains use the same **binary PE** and **ZPD fail→pass** contract via `OraclePort`.

## End-to-end path (target)

```
goal (+ optional ```expectation JSON```)
        │
        ▼
resolveExpectations ──null──► DevOps path unchanged
        │
        ▼ (soft)
TextAnalyticsOracle.verify(last assistant)
        │
        ├─► transcript: oracle: ok=… evidence
        ├─► laziness → board blocker + frustration bump
        ├─► outcomeOk requires oracle.ok
        └─► computePredictionError({ oracle, plannedSuccess })
        │
Dream idle ──► compressSoftOracleRules(shadow) → samost
Agenda ZPD-3 soft-* ──► harness JSON → judgeSoftZpd3 → SkillsLock markers
```

## Contract

| Piece | Role |
|---|---|
| `ExpectationMatrix` | Declared plan (entities, bans, min tokens, anchors) |
| `OraclePort.verify` | Deterministic / API fact → `OracleVerdict` |
| `DriveSolve` | Soft goals only; devops goals never invent a matrix |
| `computePredictionError` | PE = plan≠fact when oracle rejects |
| `judgeSoftZpd3` | Fail artifact must fail; pass must pass; emits `ZPD_PROOF fail/pass` |
| `compressSoftOracleRules` | Dream offline compression into samost heuristics |

## Explicit matrix (recommended)

```markdown
Write a complaint reply.

\`\`\`expectation
{
  "domain": "text_analytics",
  "requiredEntities": ["ticket", "refund", "sla"],
  "forbiddenPatterns": ["as an ai", "dear valued"],
  "constraints": { "minTokens": 40, "semanticAnchors": ["next step"] }
}
\`\`\`
```

## Soft ZPD-3 harness

For `failClass` matching `soft-*`, agenda asks for `soft-zpd-<class>.json`:

```json
{
  "failArtifact": "As an AI I cannot help.",
  "passArtifact": "Ticket T-1 … refund … SLA … Next step: …",
  "expectations": { "requiredEntities": ["ticket", "refund", "sla"], "forbiddenPatterns": ["as an ai"], "constraints": { "minTokens": 30 } },
  "recoveryNote": "…"
}
```

Kernel runs `TextAnalyticsOracle` — not a second LLM.

## Non-goals (still)

- BERTScore / embed distance (plug later behind `OraclePort`)
- Agent-authored JS oracles in-process (use SPI shell `verify` for body plugins)

## Curriculum

`softTransferCurriculum.ts` — toxic-complaint fail→pass unit path.
