# Optional stronger containment for Barney shell tools.
# Not the default local path — OS sandbox (sandbox-exec / bwrap) remains primary.
#
# Build:
#   docker build -t barney-sandbox -f deploy/docker/sandbox/Dockerfile .
# Run a one-shot command against a mounted worktree:
#   docker run --rm -v "$PWD:/work:rw" -w /work barney-sandbox sh -c 'echo ok'

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    git \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
# Drop privileges: run as nobody inside the container by default.
USER nobody:nogroup

ENTRYPOINT ["bwrap", \
  "--die-with-parent", \
  "--unshare-pid", \
  "--unshare-ipc", \
  "--unshare-uts", \
  "--hostname", "barney-sandbox", \
  "--new-session", \
  "--cap-drop", "ALL", \
  "--ro-bind", "/", "/", \
  "--dev", "/dev", \
  "--proc", "/proc", \
  "--tmpfs", "/tmp", \
  "--bind", "/work", "/work", \
  "--chdir", "/work", \
  "--"]
