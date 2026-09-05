// multiformats v9 publishes declarations outside its export map. Keep this
// narrow compatibility shim until the project upgrades to a newer release.
declare module "multiformats/cid" {
  export class CID {
    static parse(source: string): CID;
    toV1(): CID;
    toString(): string;
  }
}
