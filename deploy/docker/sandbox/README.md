# Optional Docker sandbox profile

Barney’s **default** Constrain layer is host OS sandboxing:

| Platform | Mechanism |
|---|---|
| macOS | `sandbox-exec` (writable only under the session worktree) |
| Linux | `bwrap` with read-only root, unshared pid/ipc/uts, `--cap-drop ALL` |

This Docker profile is for operators who want an extra container boundary.
It does **not** claim absolute isolation (kernel exploits, privileged mounts, and
Docker misconfiguration can still escape). Prefer it for CI / untrusted goals.

```bash
docker build -t barney-sandbox -f deploy/docker/sandbox/Dockerfile .
docker run --rm -v "$PWD:/work:rw" -w /work barney-sandbox sh -c 'id && pwd'
```

Wire into evals by wrapping shell invocations; the kernel still uses OS sandbox
when `bwrap` / `sandbox-exec` is present on the host.
