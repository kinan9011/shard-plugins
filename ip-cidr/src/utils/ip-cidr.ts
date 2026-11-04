/**
 * IPv4 and IPv6 address and CIDR math. Addresses are BigInts, so IPv6 math is exact.
 * Everything runs offline with no dependencies.
 */
import { t, formatNumber, type TKey } from "@/lib/i18n";

export type IpVersion = 4 | 6;

export type Failure = { ok: false; error: string };

export type Parsed<T> = { ok: true; value: T; error?: undefined } | Failure;

/** A type guard. The app compiles without strict mode, so `!result.ok` alone does not narrow. */
export const failed = <T>(result: Parsed<T>): result is Failure => !result.ok;

export interface IpAddress {
  version: IpVersion;
  value: bigint;
}

export interface Cidr extends IpAddress {
  prefix: number;
}

export interface AddressType {
  label: string;
  detail: string;
}

export interface CidrInfo {
  version: IpVersion;
  bits: number;
  /** The address as entered, in canonical form. */
  address: bigint;
  prefix: number;
  /** True when the entered address is not the network address. */
  hostBitsSet: boolean;
  network: bigint;
  /** The last address in the block. */
  last: bigint;
  /** IPv4 only. Null for /31, /32, and all IPv6 blocks. */
  broadcast: bigint | null;
  firstHost: bigint;
  lastHost: bigint;
  netmask: bigint;
  wildcard: bigint;
  total: bigint;
  usable: bigint;
  /** A short note on how usable hosts are counted for this prefix. */
  hostNote: string;
  type: AddressType;
  /** Historical IPv4 class, A to E. */
  ipv4Class: string | null;
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Failure => ({ ok: false, error });

export const bitsOf = (version: IpVersion) => (version === 4 ? 32 : 128);

const allOnes = (bits: number) => (1n << BigInt(bits)) - 1n;

/** The mask with `prefix` 1 bits on the left. */
export const prefixMask = (prefix: number, bits: number) => allOnes(bits) ^ allOnes(bits - prefix);

const ORDINALS: TKey[] = ["ordinal.first", "ordinal.second", "ordinal.third", "ordinal.fourth"];
const ordinal = (n: number) => t(ORDINALS[n]);

export function parseIPv4(text: string): Parsed<bigint> {
  const parts = text.split(".");
  if (parts.length !== 4) return fail(t("error.ipv4Parts", { text, parts: parts.length }));
  let value = 0n;
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (part === "") return fail(t("error.ipv4Empty", { ordinal: ordinal(i), text }));
    if (!/^\d+$/.test(part)) return fail(t("error.ipv4NotNumber", { ordinal: ordinal(i), part }));
    if (part.length > 1 && part.startsWith("0")) {
      return fail(t("error.ipv4LeadingZero", { ordinal: ordinal(i), part }));
    }
    const octet = Number(part);
    if (octet > 255) return fail(t("error.ipv4TooBig", { ordinal: ordinal(i), part }));
    value = (value << 8n) | BigInt(octet);
  }
  return ok(value);
}

export function parseIPv6(text: string): Parsed<bigint> {
  if (text.includes("%")) return fail(t("error.ipv6Zone", { zone: text.slice(text.indexOf("%")) }));
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const doubles = text.split("::").length - 1;
  if (doubles > 1) return fail(t("error.ipv6OneDouble"));
  if (/:::/.test(text)) return fail(t("error.ipv6TripleColon"));
  if (/^:[^:]/.test(text)) return fail(t("error.ipv6StartColon"));
  if (/[^:]:$/.test(text)) return fail(t("error.ipv6EndColon"));

  const [head, tail] = doubles ? text.split("::") : [text, undefined];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];

  // An IPv4 address can fill the last 32 bits, as in ::ffff:192.0.2.1. It must be the last part,
  // so an address that ends in "::" has no IPv4 part.
  let embedded: bigint | null = null;
  const lastGroups = doubles ? tailGroups : headGroups;
  const lastGroup = lastGroups[lastGroups.length - 1];
  if (lastGroup?.includes(".")) {
    const v4 = parseIPv4(lastGroup);
    if (!v4.ok) return fail(t("error.ipv6BadIpv4", { error: v4.error }));
    embedded = v4.value;
    lastGroups.pop();
  }
  for (const group of [...headGroups, ...tailGroups]) {
    if (group.includes(".")) return fail(t("error.ipv6Ipv4NotLast"));
    if (group === "") return fail(t("error.ipv6EmptyGroup"));
    if (group.length > 4) return fail(t("error.ipv6LongGroup", { group }));
    const bad = group.match(/[^0-9a-f]/i);
    if (bad) return fail(t("error.ipv6BadHex", { char: bad[0], group }));
  }

  const needed = embedded === null ? 8 : 6;
  const given = headGroups.length + tailGroups.length;
  const shown = embedded === null ? String(given) : t("error.ipv6GivenWithIpv4", { given });
  if (doubles) {
    if (given >= needed) return fail(t("error.ipv6DoubleNeedsGap", { shown }));
  } else if (given !== needed) {
    return fail(t(given > needed ? "error.ipv6TooManyGroups" : "error.ipv6TooFewGroups", { shown }));
  }

  const groups = [...headGroups, ...Array<string>(needed - given).fill("0"), ...tailGroups];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(parseInt(group, 16));
  if (embedded !== null) value = (value << 32n) | embedded;
  return ok(value);
}

/** Reads an IPv4 or IPv6 address. A colon means IPv6. */
export function parseAddress(raw: string): Parsed<IpAddress> {
  const text = raw.trim();
  if (!text) return fail(t("error.enterIp"));
  if (text.includes(":")) {
    const value = parseIPv6(text);
    return failed(value) ? value : ok({ version: 6 as const, value: value.value });
  }
  if (/^[0-9a-f]+$/i.test(text) && /[a-f]/i.test(text)) return fail(t("error.notIp", { text }));
  const value = parseIPv4(text);
  return failed(value) ? value : ok({ version: 4 as const, value: value.value });
}

/** Converts a dotted netmask such as 255.255.255.0 to a prefix length. */
export function netmaskToPrefix(text: string): Parsed<number> {
  const mask = parseIPv4(text);
  if (!mask.ok) return fail(t("error.netmaskInvalid", { error: mask.error }));
  const value = mask.value;
  const inverted = ~value & allOnes(32);
  // A valid mask is 1 bits then 0 bits, so its inverse plus one is a power of two.
  if ((inverted & (inverted + 1n)) !== 0n) return fail(t("error.netmaskGaps", { text }));
  return ok(inverted === 0n ? 32 : 32 - inverted.toString(2).length);
}

/**
 * Reads "10.0.0.0/8", "2001:db8::/32", "192.168.1.10/255.255.255.0", or "192.168.1.10 255.255.255.0".
 * A bare address is a /32 or a /128.
 */
export function parseCidr(raw: string): Parsed<Cidr> {
  const text = raw.trim();
  if (!text) return fail(t("error.enterCidr"));
  const match = text.match(/^(\S+?)\s*(?:\/\s*(\S*)|\s+(\S+))?$/);
  if (!match) return fail(t("error.notCidr", { text }));
  const [, addressText, slashPart, spacePart] = match;
  const address = parseAddress(addressText);
  if (failed(address)) return address;
  const bits = bitsOf(address.value.version);
  const prefixText = slashPart ?? spacePart;
  if (prefixText === undefined) return ok({ ...address.value, prefix: bits });
  if (prefixText === "") return fail(t("error.prefixMissing"));

  let prefix: number;
  if (prefixText.includes(".")) {
    if (address.value.version === 6) return fail(t("error.ipv6Netmask"));
    const fromMask = netmaskToPrefix(prefixText);
    if (failed(fromMask)) return fromMask;
    prefix = fromMask.value;
  } else {
    if (!/^\d+$/.test(prefixText)) return fail(t("error.prefixNotNumber", { prefix: prefixText }));
    prefix = Number(prefixText);
    if (prefix > bits) return fail(t("error.prefixRange", { version: address.value.version, bits, prefix: prefixText }));
  }
  return ok({ ...address.value, prefix });
}

export function formatIPv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 255n).toString()).join(".");
}

const ipv6Groups = (value: bigint) => Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn));

const MAPPED_PREFIX = 0xffffn << 32n;

export const isIPv4Mapped = (value: bigint) => value >> 32n === 0xffffn;

/**
 * RFC 5952 text: lower case, no leading zeros, and "::" for the longest run of two or more
 * zero groups (the first run on a tie). An IPv4-mapped address ends in dotted form.
 */
export function formatIPv6(value: bigint, mixed = true): string {
  const groups = ipv6Groups(value).map((group) => group.toString(16));
  let tail = "";
  if (mixed && isIPv4Mapped(value)) {
    groups.splice(6, 2);
    tail = formatIPv4(value & allOnes(32));
  }
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const join = (parts: string[]) => parts.join(":");
  let text: string;
  if (bestStart < 0) {
    text = join(groups) + (tail ? `:${tail}` : "");
  } else {
    const left = join(groups.slice(0, bestStart));
    const right = join(groups.slice(bestStart + bestLength));
    text = `${left}::${right}${tail ? (right ? ":" : "") + tail : ""}`;
  }
  return text;
}

/** All 8 groups with 4 digits each. */
export const expandIPv6 = (value: bigint) => ipv6Groups(value).map((group) => group.toString(16).padStart(4, "0")).join(":");

export const formatAddress = (value: bigint, version: IpVersion) => (version === 4 ? formatIPv4(value) : formatIPv6(value));

export const formatCidr = (value: bigint, prefix: number, version: IpVersion) => `${formatAddress(value, version)}/${prefix}`;

/** The PTR name for an address, such as 1.2.0.192.in-addr.arpa. */
export function reverseDnsName(value: bigint, version: IpVersion): string {
  if (version === 4) return `${formatIPv4(value).split(".").reverse().join(".")}.in-addr.arpa`;
  return `${value.toString(16).padStart(32, "0").split("").reverse().join(".")}.ip6.arpa`;
}

/**
 * The reverse DNS zone that holds the block. Zones break on 8-bit (IPv4) or 4-bit (IPv6)
 * boundaries, so a block such as a /26 sits in the zone of its /24.
 */
export function reverseDnsZone(network: bigint, prefix: number, version: IpVersion): string {
  if (version === 4) {
    const octets = Math.floor(prefix / 8);
    const labels = formatIPv4(network).split(".").slice(0, octets).reverse();
    return [...labels, "in-addr.arpa"].join(".");
  }
  const nibbles = Math.floor(prefix / 4);
  const labels = network.toString(16).padStart(32, "0").slice(0, nibbles).split("").reverse();
  return [...labels, "ip6.arpa"].join(".");
}

export const toHex = (value: bigint, version: IpVersion) => `0x${value.toString(16).toUpperCase().padStart(version === 4 ? 8 : 32, "0")}`;

/** Groups of bits, split at the prefix, for a display that marks network and host bits. */
export function binaryGroups(value: bigint, version: IpVersion, prefix: number): { network: string; host: string }[] {
  const bits = bitsOf(version);
  const size = version === 4 ? 8 : 16;
  const binary = value.toString(2).padStart(bits, "0");
  const groups: { network: string; host: string }[] = [];
  for (let start = 0; start < bits; start += size) {
    const split = Math.min(Math.max(prefix - start, 0), size);
    groups.push({ network: binary.slice(start, start + split), host: binary.slice(start + split, start + size) });
  }
  return groups;
}

/** The plain binary text with a separator between groups. */
export const binaryText = (value: bigint, version: IpVersion) =>
  binaryGroups(value, version, 0)
    .map((group) => group.host)
    .join(version === 4 ? "." : ":");

/** Adds thousands separators to a BigInt, in the app language (Latin digits). */
export const groupThousands = (value: bigint) => formatNumber(value);

/** A count for display: exact digits, and a power of two for large IPv6 counts. */
export function formatCount(value: bigint): string {
  if (value < 1_000_000_000_000n) return groupThousands(value);
  const power = value.toString(2).length - 1;
  if (value === 1n << BigInt(power)) return `${groupThousands(value)} (2^${power})`;
  if (value + 1n === 1n << BigInt(power + 1)) return `${groupThousands(value)} (2^${power + 1} - 1)`;
  return groupThousands(value);
}

interface SpecialBlock {
  cidr: string;
  label: TKey;
  detail: TKey;
}

const IPV4_BLOCKS: SpecialBlock[] = [
  { cidr: "0.0.0.0/32", label: "type.unspecified", detail: "typeDetail.unspecified" },
  { cidr: "0.0.0.0/8", label: "type.thisNetwork", detail: "typeDetail.thisNetwork" },
  { cidr: "10.0.0.0/8", label: "type.private", detail: "typeDetail.private" },
  { cidr: "100.64.0.0/10", label: "type.cgnat", detail: "typeDetail.cgnat" },
  { cidr: "127.0.0.0/8", label: "type.loopback", detail: "typeDetail.loopback4" },
  { cidr: "169.254.0.0/16", label: "type.linkLocal", detail: "typeDetail.linkLocal4" },
  { cidr: "172.16.0.0/12", label: "type.private", detail: "typeDetail.private" },
  { cidr: "192.0.0.0/24", label: "type.ietf", detail: "typeDetail.ietf" },
  { cidr: "192.0.2.0/24", label: "type.documentation", detail: "typeDetail.testNet1" },
  { cidr: "192.88.99.0/24", label: "type.sixToFourRelay", detail: "typeDetail.sixToFourRelay" },
  { cidr: "192.168.0.0/16", label: "type.private", detail: "typeDetail.private" },
  { cidr: "198.18.0.0/15", label: "type.benchmarking", detail: "typeDetail.benchmarking" },
  { cidr: "198.51.100.0/24", label: "type.documentation", detail: "typeDetail.testNet2" },
  { cidr: "203.0.113.0/24", label: "type.documentation", detail: "typeDetail.testNet3" },
  { cidr: "224.0.0.0/4", label: "type.multicast", detail: "typeDetail.multicast4" },
  { cidr: "255.255.255.255/32", label: "type.limitedBroadcast", detail: "typeDetail.limitedBroadcast" },
  { cidr: "240.0.0.0/4", label: "type.reserved", detail: "typeDetail.reserved4" },
];

const IPV6_BLOCKS: SpecialBlock[] = [
  { cidr: "::/128", label: "type.unspecified", detail: "typeDetail.unspecified" },
  { cidr: "::1/128", label: "type.loopback", detail: "typeDetail.loopback6" },
  { cidr: "::ffff:0:0/96", label: "type.ipv4Mapped", detail: "typeDetail.ipv4Mapped" },
  { cidr: "64:ff9b::/96", label: "type.translation", detail: "typeDetail.nat64" },
  { cidr: "64:ff9b:1::/48", label: "type.translation", detail: "typeDetail.nat64Local" },
  { cidr: "100::/64", label: "type.discard", detail: "typeDetail.discard" },
  { cidr: "2001::/32", label: "type.teredo", detail: "typeDetail.teredo" },
  { cidr: "2001:db8::/32", label: "type.documentation", detail: "typeDetail.doc6" },
  { cidr: "2002::/16", label: "type.sixToFour", detail: "typeDetail.sixToFour" },
  { cidr: "3fff::/20", label: "type.documentation", detail: "typeDetail.doc6New" },
  { cidr: "fc00::/7", label: "type.uniqueLocal", detail: "typeDetail.uniqueLocal" },
  { cidr: "fe80::/10", label: "type.linkLocal", detail: "typeDetail.linkLocal6" },
  { cidr: "ff00::/8", label: "type.multicast", detail: "typeDetail.multicast6" },
  { cidr: "2000::/3", label: "type.globalUnicast", detail: "typeDetail.globalUnicast" },
];

const toRange = (block: SpecialBlock) => {
  const parsed = parseCidr(block.cidr);
  if (!parsed.ok) throw new Error(parsed.error);
  const bits = bitsOf(parsed.value.version);
  const start = parsed.value.value & prefixMask(parsed.value.prefix, bits);
  return { ...block, start, end: start | allOnes(bits - parsed.value.prefix) };
};

let blockCache: { 4: ReturnType<typeof toRange>[]; 6: ReturnType<typeof toRange>[] } | null = null;
const specialBlocks = (version: IpVersion) => {
  blockCache ??= { 4: IPV4_BLOCKS.map(toRange), 6: IPV6_BLOCKS.map(toRange) };
  return blockCache[version];
};

/** Names the kind of address space that holds the whole range from `start` to `end`. */
export function classifyRange(start: bigint, end: bigint, version: IpVersion): AddressType {
  const blocks = specialBlocks(version);
  // The table lists specific blocks before the broad ones, so the first match is the most specific.
  const inside = blocks.find((block) => block.start <= start && end <= block.end);
  const overlaps = blocks.filter((block) => block.start <= end && start <= block.end);
  // A block such as 2001::/16 is global unicast, but it also holds Teredo and documentation space.
  const mixed = overlaps.some((block) => block !== inside && !(block.start <= start && end <= block.end));
  if (inside && !mixed) return { label: t(inside.label), detail: t(inside.detail) };
  if (overlaps.length) {
    return { label: t("type.mixed"), detail: t("typeDetail.mixed") };
  }
  if (version === 4) return { label: t("type.public"), detail: t("typeDetail.public") };
  return { label: t("type.reserved"), detail: t("typeDetail.reservedIetf") };
}

/** The class before CIDR (RFC 791). Only of historical interest. */
export function ipv4Class(value: bigint): string {
  const first = Number(value >> 24n);
  if (first < 128) return "A";
  if (first < 192) return "B";
  if (first < 224) return "C";
  if (first < 240) return t("class.multicast");
  return t("class.reserved");
}

export function describeCidr(cidr: Cidr): CidrInfo {
  const { version, value, prefix } = cidr;
  const bits = bitsOf(version);
  const netmask = prefixMask(prefix, bits);
  const wildcard = allOnes(bits - prefix);
  const network = value & netmask;
  const last = network | wildcard;
  const total = 1n << BigInt(bits - prefix);
  const hostBits = bits - prefix;

  let firstHost = network;
  let lastHost = last;
  let usable = total;
  let broadcast: bigint | null = null;
  let hostNote: string;
  if (hostBits === 0) {
    hostNote = t("hostNote.single");
  } else if (hostBits === 1) {
    hostNote = t(version === 4 ? "hostNote.pointToPoint4" : "hostNote.pointToPoint6");
  } else if (version === 4) {
    broadcast = last;
    firstHost = network + 1n;
    lastHost = last - 1n;
    usable = total - 2n;
    hostNote = t("hostNote.ipv4");
  } else {
    firstHost = network + 1n;
    usable = total - 1n;
    hostNote = t("hostNote.ipv6");
  }

  return {
    version,
    bits,
    address: value,
    prefix,
    hostBitsSet: value !== network,
    network,
    last,
    broadcast,
    firstHost,
    lastHost,
    netmask,
    wildcard,
    total,
    usable,
    hostNote,
    type: classifyRange(network, last, version),
    ipv4Class: version === 4 ? ipv4Class(value) : null,
  };
}

/** Parses and describes the input in one step. */
export function calculateCidr(text: string): Parsed<CidrInfo> {
  const cidr = parseCidr(text);
  return failed(cidr) ? cidr : ok(describeCidr(cidr.value));
}

/** The IPv4-mapped IPv6 forms of an IPv4 address. */
export const ipv4MappedForms = (value: bigint) => {
  const mapped = MAPPED_PREFIX | value;
  return { dotted: formatIPv6(mapped), hex: formatIPv6(mapped, false) };
};

export interface IpRange {
  version: IpVersion;
  start: bigint;
  end: bigint;
}

/** Reads a CIDR block, a single address, or a range such as "10.0.0.5 - 10.0.0.20". */
export function parseRange(raw: string): Parsed<IpRange> {
  const text = raw.trim();
  if (!text) return fail(t("error.enterRange"));
  const dash = text.match(/^(\S+)\s*-\s*(\S+)$/);
  if (dash && !text.includes("/")) {
    const start = parseAddress(dash[1]);
    if (!start.ok) return fail(t("error.rangeStart", { error: start.error }));
    const end = parseAddress(dash[2]);
    if (!end.ok) return fail(t("error.rangeEnd", { error: end.error }));
    if (start.value.version !== end.value.version) return fail(t("error.rangeVersion"));
    if (start.value.value > end.value.value) return fail(t("error.rangeOrder"));
    return ok({ version: start.value.version, start: start.value.value, end: end.value.value });
  }
  const cidr = parseCidr(text);
  if (failed(cidr)) return cidr;
  const bits = bitsOf(cidr.value.version);
  const start = cidr.value.value & prefixMask(cidr.value.prefix, bits);
  return ok({ version: cidr.value.version, start, end: start | allOnes(bits - cidr.value.prefix) });
}

export type ContainsResult = "inside" | "partial" | "outside";

/** Checks if an address, CIDR block, or range falls inside the block. */
export function checkContains(info: CidrInfo, text: string): Parsed<ContainsResult> {
  const range = parseRange(text);
  if (failed(range)) return range;
  if (range.value.version !== info.version) return fail(t("error.versionMismatch", { block: info.version, other: range.value.version }));
  const { start, end } = range.value;
  if (info.network <= start && end <= info.last) return ok("inside");
  if (start <= info.last && info.network <= end) return ok("partial");
  return ok("outside");
}

export interface Subnet {
  network: bigint;
  last: bigint;
  cidr: string;
}

export interface SubnetSplit {
  prefix: number;
  /** The number of subnets in total. It can be more than the list holds. */
  count: bigint;
  subnets: Subnet[];
}

export const MAX_SUBNETS = 256;

/** Splits the block into subnets with the new prefix. Lists at most `limit` of them. */
export function splitByPrefix(info: CidrInfo, newPrefix: number, limit = MAX_SUBNETS): Parsed<SubnetSplit> {
  if (!Number.isInteger(newPrefix)) return fail(t("error.splitPrefixWhole"));
  if (newPrefix < info.prefix) return fail(t("error.splitPrefixShorter", { prefix: info.prefix }));
  if (newPrefix > info.bits) return fail(t("error.splitPrefixRange", { version: info.version, bits: info.bits }));
  const count = 1n << BigInt(newPrefix - info.prefix);
  const size = 1n << BigInt(info.bits - newPrefix);
  const shown = count < BigInt(limit) ? Number(count) : limit;
  const subnets: Subnet[] = [];
  for (let i = 0; i < shown; i++) {
    const network = info.network + BigInt(i) * size;
    subnets.push({ network, last: network + size - 1n, cidr: formatCidr(network, newPrefix, info.version) });
  }
  return ok({ prefix: newPrefix, count, subnets });
}

/** Splits the block into at least `parts` equal subnets. The count rounds up to a power of two. */
export function splitByCount(info: CidrInfo, parts: number, limit = MAX_SUBNETS): Parsed<SubnetSplit> {
  if (!Number.isInteger(parts) || parts < 1) return fail(t("error.splitCountWhole"));
  const extra = Math.ceil(Math.log2(parts));
  // Math.log2 can be off by a hair for large numbers, so check the power of two directly.
  const bitsNeeded = 2 ** extra >= parts ? extra : extra + 1;
  const available = info.bits - info.prefix;
  if (bitsNeeded > available) {
    return fail(t("error.splitCountMax", { prefix: info.prefix, max: formatCount(1n << BigInt(available)) }));
  }
  return splitByPrefix(info, info.prefix + bitsNeeded, limit);
}

/** The fewest CIDR blocks that cover the range exactly. */
export function rangeToCidrs(range: IpRange): string[] {
  const bits = bitsOf(range.version);
  const blocks: string[] = [];
  let start = range.start;
  while (start <= range.end) {
    // The largest block that starts here is set by the lowest 1 bit of the start address.
    let size = start === 0n ? bits : (start & -start).toString(2).length - 1;
    while (size > 0 && start + (1n << BigInt(size)) - 1n > range.end) size--;
    blocks.push(formatCidr(start, bits - size, range.version));
    start += 1n << BigInt(size);
  }
  return blocks;
}

export interface MergeResult {
  cidrs: string[];
  errors: { line: number; text: string; error: string }[];
}

/** Merges a list of CIDR blocks, addresses, or ranges into the fewest blocks. IPv4 comes first. */
export function mergeCidrs(text: string): MergeResult {
  const ranges: IpRange[] = [];
  const errors: MergeResult["errors"] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    // A line can hold several items with commas between them. Errors name the line, not the item.
    for (const part of line.replace(/#.*/, "").split(",")) {
      const item = part.trim();
      if (!item) continue;
      const range = parseRange(item);
      if (range.ok) ranges.push(range.value);
      else errors.push({ line: index + 1, text: item, error: range.error });
    }
  });
  const cidrs: string[] = [];
  for (const version of [4, 6] as const) {
    const sorted = ranges.filter((range) => range.version === version).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const merged: IpRange[] = [];
    for (const range of sorted) {
      const previous = merged[merged.length - 1];
      // Join ranges that overlap or touch.
      if (previous && range.start <= previous.end + 1n) {
        if (range.end > previous.end) previous.end = range.end;
      } else {
        merged.push({ ...range });
      }
    }
    for (const range of merged) cidrs.push(...rangeToCidrs(range));
  }
  return { cidrs, errors };
}
