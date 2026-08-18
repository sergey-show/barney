export type SecretHit = {
  kind: string;
  placeholder: string;
};

export class MaskedText {
  constructor(
    readonly text: string,
    readonly hits: SecretHit[],
  ) {}

  get masked(): boolean {
    return this.hits.length > 0;
  }
}
