// @vitest-environment node
// Moved from the devtools repo (tests/tools/hash-generator.test.ts), now against the WebAssembly module.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHasher, formatBytes, HASH_TYPES, HMAC_TYPES } from "../src/hasher";

const wasmFile = resolve(__dirname, "../public/hash.wasm");
const { instance } = await WebAssembly.instantiate(readFileSync(wasmFile), {});
const hasher = createHasher(instance);
const text = (value: string) => new TextEncoder().encode(value);

describe("hash.wasm", () => {
  it("needs no imports", async () => {
    expect(WebAssembly.Module.imports(await WebAssembly.compile(readFileSync(wasmFile)))).toEqual([]);
  });

  it("lists the hashes and HMACs in the order the UI shows them", () => {
    expect(Object.keys(hasher.hashAll(text("x")))).toEqual(HASH_TYPES.map((h) => h.type));
    expect(Object.keys(hasher.hmacAll(text("x"), text("k")))).toEqual(HMAC_TYPES.map((h) => h.type));
  });

  it("matches known digests of the empty string", () => {
    const all = hasher.hashAll(new Uint8Array());
    expect(all.md5).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(all.sha1).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(all.sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(all["sha3-256"]).toBe("a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a");
    expect(all.keccak256).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  it('matches known digests of "abc"', () => {
    const all = hasher.hashAll(text("abc"));
    expect(all.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(all.sha384).toBe("cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
    expect(all["sha3-256"]).toBe("3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532");
    expect(all["sha3-512"]).toBe("b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0");
    expect(all.keccak256).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });

  it("hashes the UTF-8 bytes of text", () => {
    expect(hasher.hashAll(text("héllo 🌟")).sha256).toBe(createHash("sha256").update("héllo 🌟", "utf8").digest("hex"));
  });

  it("computes HMAC (RFC 4231 test case 2)", () => {
    const macs = hasher.hmacAll(text("what do ya want for nothing?"), text("Jefe"));
    expect(macs.sha256).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    expect(macs.sha384).toBe("af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649");
    expect(macs.sha512).toBe("164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
  });

  it("matches node's crypto at block edges and for large inputs (all but Keccak-256)", () => {
    const sizes = [0, 1, 55, 56, 63, 64, 65, 111, 112, 119, 120, 127, 128, 129, 135, 136, 137, 1_000_000];
    for (const size of sizes) {
      const bytes = randomBytes(size);
      const all = hasher.hashAll(bytes);
      for (const [type, name] of [["md5", "md5"], ["sha1", "sha1"], ["sha256", "sha256"], ["sha384", "sha384"], ["sha512", "sha512"], ["sha3-256", "sha3-256"], ["sha3-512", "sha3-512"]] as const) {
        expect(all[type], `${name}, ${size} bytes`).toBe(createHash(name).update(bytes).digest("hex"));
      }
    }
  });

  it("matches node's HMAC for empty, short, block-size and longer keys", () => {
    const bytes = randomBytes(300);
    for (const keySize of [0, 1, 64, 65, 128, 129, 1000]) {
      const key = randomBytes(keySize);
      const macs = hasher.hmacAll(bytes, key);
      for (const type of ["sha256", "sha384", "sha512"] as const) {
        expect(macs[type], `${type}, key ${keySize} bytes`).toBe(createHmac(type, key).update(bytes).digest("hex"));
      }
    }
  });

  it("keeps working after the memory grew", () => {
    const big = randomBytes(40_000_000);
    expect(hasher.hashAll(big).sha256).toBe(createHash("sha256").update(big).digest("hex"));
    expect(hasher.hashAll(text("abc")).sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("formatBytes", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });
});
