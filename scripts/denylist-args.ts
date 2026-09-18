// Pure argv parsing for the denylist CLI, split from the IO in denylist.ts so
// it can be tested without a database -- the same split migrate-plan.ts uses.

export type DenylistCommand =
  | { kind: "add"; faContract: string; tokenId: string | null; reason: string }
  | { kind: "remove"; faContract: string; tokenId: string | null }
  | { kind: "list" };

function flagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function assertContract(address: string): string {
  if (!address.startsWith("KT1")) {
    throw new Error(`"${address}" must be a KT1 contract address`);
  }
  return address;
}

export function parseDenylistArgs(argv: readonly string[]): DenylistCommand {
  if (argv.includes("--list")) return { kind: "list" };

  const tokenId = flagValue(argv, "--token");

  const add = flagValue(argv, "--add");
  if (add !== null) {
    const reason = flagValue(argv, "--reason");
    if (reason === null) throw new Error("--reason is required when adding an entry");
    return { kind: "add", faContract: assertContract(add), tokenId, reason };
  }

  const remove = flagValue(argv, "--remove");
  if (remove !== null) {
    return { kind: "remove", faContract: assertContract(remove), tokenId };
  }

  throw new Error("Specify one of --add, --remove, --list");
}
