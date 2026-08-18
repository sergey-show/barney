export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  ui?: string;
};

export type SkillInfo = SkillManifest & {
  dir: string;
  prompt: string;
};
