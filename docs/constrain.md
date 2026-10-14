# Constrain (sandbox)

**English** · [Русский](constrain.ru.md)

Shell tools run under an OS sandbox when available. This limits blast radius of
hallucinated `rm` / writes — it is **not** a formal security boundary and not
marketed as absolute isolation.

## Default behavior

| Platform | Tool | Policy |
|---|---|---|
| macOS | `sandbox-exec` | Deny default; allow exec/fork; file write only under session `cwd`; network outbound allowed |
| Linux | `bwrap` | `--ro-bind / /`, writable bind of `cwd`, `--tmpfs /tmp`, `--unshare-pid/ipc/uts`, `--cap-drop ALL`, `--chdir cwd` |
| Other / missing tool | passthrough | Command runs unsandboxed (logged by absence of wrapper) |

Implementation: `src/infrastructure/sandbox/OsSandbox.ts`.

## Optional Docker profile

For stronger containment in CI, see [`deploy/docker/sandbox/`](../deploy/docker/sandbox/README.md).

## Related

- Outside worktree paths still need operator grant ([Tools](tools.md))
- Shadow recall redacts live secrets before prompt injection ([Experience](experience.md))
