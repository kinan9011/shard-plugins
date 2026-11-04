import { decodeHex } from "./checksum";
import { formatNumber, t } from "@/lib/i18n";
export interface AsnNode {
  offset: number;
  header: number;
  length: number;
  tag: number;
  tagClass: string;
  constructed: boolean;
  name: string;
  value: string;
  hex: string;
  children: AsnNode[];
}
const names: Record<number, string> = {
  1: "BOOLEAN",
  2: "INTEGER",
  3: "BIT STRING",
  4: "OCTET STRING",
  5: "NULL",
  6: "OBJECT IDENTIFIER",
  10: "ENUMERATED",
  12: "UTF8String",
  16: "SEQUENCE",
  17: "SET",
  18: "NumericString",
  19: "PrintableString",
  20: "TeletexString",
  22: "IA5String",
  23: "UTCTime",
  24: "GeneralizedTime",
  30: "BMPString",
};
export function decodeAsnInput(
  input: string,
  format: "pem" | "hex" | "base64",
): Uint8Array {
  if (input.length > 3000000)
    throw new Error(t("error.inputLimit", { max: formatNumber(3000000) }));
  if (format === "hex") return decodeHex(input);
  let body = input.trim();
  if (format === "pem") {
    const match =
      /^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----$/.exec(body);
    if (!match)
      throw new Error(t("error.pem"));
    body = match[2];
  }
  body = body.replace(/\s/g, "");
  if (!body || !/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1)
    throw new Error(t("error.base64"));
  try {
    return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(t("error.base64"));
  }
}
function primitive(tag: number, bytes: Uint8Array): string {
  if (tag === 1) {
    if (bytes.length !== 1)
      throw new Error(t("error.boolean"));
    return bytes[0] ? "true" : "false";
  }
  if (tag === 2 || tag === 10) {
    if (!bytes.length) throw new Error(t("error.integerEmpty"));
    if (bytes.length > 512) return t("value.integerTooLarge");
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    if (bytes[0] & 128) n -= 1n << BigInt(bytes.length * 8);
    return n.toString();
  }
  if (tag === 5) {
    if (bytes.length) throw new Error(t("error.nullLength"));
    return "null";
  }
  if (tag === 6) {
    if (bytes.length > 4096) throw new Error(t("error.oidTooLong", { max: formatNumber(4096) }));
    const arcs: bigint[] = [];
    let value = 0n;
    if (!bytes.length) throw new Error(t("error.oidEmpty"));
    for (const b of bytes) {
      value = (value << 7n) | BigInt(b & 127);
      if (!(b & 128)) {
        arcs.push(value);
        value = 0n;
      }
    }
    if (bytes[bytes.length - 1] & 128) throw new Error(t("error.oidTruncated"));
    const first = arcs.shift()!;
    const root = first < 40n ? 0n : first < 80n ? 1n : 2n;
    return [root, first - root * 40n, ...arcs].join(".");
  }
  if ([12, 18, 19, 22, 23, 24].includes(tag))
    return new TextDecoder().decode(bytes.slice(0, 4096));
  // T.61 has no TextDecoder. Latin-1 shows its ASCII range correctly and never fails.
  if (tag === 20) return new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  if (tag === 30) {
    if (bytes.length % 2) throw new Error(t("error.bmpPairs"));
    return new TextDecoder("utf-16be").decode(bytes.slice(0, 4096));
  }
  return "";
}
export function parseAsn1(bytes: Uint8Array): AsnNode[] {
  if (bytes.length > 1000000) throw new Error(t("error.asnLimit"));
  if (!bytes.length) throw new Error(t("error.enterAsn"));
  let count = 0;
  function parse(start: number, end: number, depth: number): AsnNode[] {
    if (depth > 40) throw new Error(t("error.nesting", { max: 40 }));
    const nodes: AsnNode[] = [];
    let pos = start;
    const read = () => {
      if (pos >= end) throw new Error(t("error.truncated", { position: pos }));
      return bytes[pos++];
    };
    while (pos < end) {
      if (++count > 10000) throw new Error(t("error.tooManyNodes", { max: formatNumber(10000) }));
      const offset = pos,
        first = read(),
        cls = first >>> 6,
        constructed = Boolean(first & 32);
      let tag = first & 31;
      if (tag === 31) {
        tag = 0;
        let b: number;
        do {
          b = read();
          tag = tag * 128 + (b & 127);
          if (tag > 0x7fffffff) throw new Error(t("error.tagTooLarge"));
        } while (b & 128);
      }
      let length = read();
      if (length === 128)
        throw new Error(t("error.indefinite"));
      if (length & 128) {
        const size = length & 127;
        if (size > 4) throw new Error(t("error.lengthTooLarge"));
        length = 0;
        for (let i = 0; i < size; i++) length = length * 256 + read();
      }
      const header = pos - offset,
        stop = pos + length;
      if (stop > end)
        throw new Error(t("error.beyond", { offset }));
      if (cls === 0 && tag === 0)
        throw new Error(t("error.endOfContent"));
      const valueBytes = bytes.subarray(pos, stop);
      const hex =
        Array.from(valueBytes.subarray(0, 256), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(" ") + (length > 256 ? " …" : "");
      nodes.push({
        offset,
        header,
        length,
        tag,
        tagClass: ["Universal", "Application", "Context-specific", "Private"][
          cls
        ],
        constructed,
        name: cls === 0 ? (names[tag] ?? `Tag ${tag}`) : `Tag ${tag}`,
        value: !constructed && cls === 0 ? primitive(tag, valueBytes) : "",
        hex,
        children: constructed ? parse(pos, stop, depth + 1) : [],
      });
      pos = stop;
    }
    return nodes;
  }
  return parse(0, bytes.length, 0);
}
