export type GuardPolicyProps = {
  onDetect: "mask" | "block";
  entropyThreshold: number;
  denyPathGlobs: string[];
  allowlist: string[];
};

export class GuardPolicy {
  readonly onDetect: "mask" | "block";
  readonly entropyThreshold: number;
  readonly denyPathGlobs: string[];
  readonly allowlist: string[];

  constructor(props: Partial<GuardPolicyProps> = {}) {
    this.onDetect = props.onDetect ?? "mask";
    this.entropyThreshold = props.entropyThreshold ?? 4.5;
    this.denyPathGlobs = props.denyPathGlobs ?? [
      "**/.env",
      "**/.env.*",
      "**/*.pem",
      "**/id_rsa",
      "**/id_ed25519",
      "**/credentials.json",
      "**/*.p12",
    ];
    this.allowlist = props.allowlist ?? ["sk-test-example", "ghp_example"];
  }

  isDeniedPath(path: string): boolean {
    const normalized = path.replaceAll("\\", "/");
    return this.denyPathGlobs.some((glob) => matchGlob(normalized, glob));
  }

  isAllowed(value: string): boolean {
    return this.allowlist.some((item) => value.includes(item));
  }
}

function matchGlob(path: string, glob: string): boolean {
  const escaped = glob
    .replaceAll(".", "\\.")
    .replaceAll("**/", "(.*/)?")
    .replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`, "i").test(path) || new RegExp(`${escaped}$`, "i").test(path);
}
