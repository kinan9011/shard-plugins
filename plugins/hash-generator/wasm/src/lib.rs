//! Hashes for the Hash Generator plugin, compiled to WebAssembly without wasm-bindgen or dependencies.
//!
//! The page talks to it through linear memory:
//! 1. `alloc(len)` returns a pointer to `len` bytes the caller may write to.
//! 2. `digest_into(algo, input, len, output)` or `hmac_into(algo, key, key_len, input, len, output)` writes the
//!    result to `output` (64 bytes are always enough) and returns its length. A bad `algo` returns 0.
//! 3. `dealloc(ptr, len)` frees each block.
//!
//! Algorithm numbers: 0 MD5, 1 SHA-1, 2 SHA-256, 3 SHA-384, 4 SHA-512, 5 SHA3-256, 6 SHA3-512, 7 Keccak-256.
//! HMAC is defined for 2, 3 and 4.

mod constants;
#[cfg(test)]
mod vectors;

use constants::{H256, H384, H512, K256, K512, MD5_K};

const MD5: u32 = 0;
const SHA1: u32 = 1;
const SHA256: u32 = 2;
const SHA384: u32 = 3;
const SHA512: u32 = 4;
const SHA3_256: u32 = 5;
const SHA3_512: u32 = 6;
const KECCAK256: u32 = 7;

/// The message padded for a Merkle–Damgård hash: 0x80, zeros, then the bit length in `len_bytes` bytes.
fn md_pad(data: &[u8], block: usize, len_bytes: usize, big_endian: bool) -> Vec<u8> {
    let mut out = data.to_vec();
    out.push(0x80);
    while out.len() % block != block - len_bytes {
        out.push(0);
    }
    let bits = (data.len() as u128) * 8;
    let bytes = if big_endian { bits.to_be_bytes() } else { bits.to_le_bytes() };
    if big_endian {
        out.extend_from_slice(&bytes[16 - len_bytes..]);
    } else {
        out.extend_from_slice(&bytes[..len_bytes]);
    }
    out
}

fn md5(data: &[u8]) -> Vec<u8> {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for block in md_pad(data, 64, 8, false).chunks_exact(64) {
        let m: Vec<u32> = block.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a.wrapping_add(f).wrapping_add(MD5_K[i]).wrapping_add(m[g]).rotate_left(S[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d]) {
            *slot = slot.wrapping_add(value);
        }
    }
    state.iter().flat_map(|word| word.to_le_bytes()).collect()
}

fn sha1(data: &[u8]) -> Vec<u8> {
    let mut state: [u32; 5] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    for block in md_pad(data, 64, 8, true).chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, chunk) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (i, word) in w.iter().enumerate() {
            let (f, k) = match i / 20 {
                0 => ((b & c) | (!b & d), 0x5a827999),
                1 => (b ^ c ^ d, 0x6ed9eba1),
                2 => ((b & c) | (b & d) | (c & d), 0x8f1bbcdc),
                _ => (b ^ c ^ d, 0xca62c1d6u32),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }
    state.iter().flat_map(|word| word.to_be_bytes()).collect()
}

fn sha256(data: &[u8]) -> Vec<u8> {
    let mut state = H256;
    for block in md_pad(data, 64, 8, true).chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, chunk) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K256[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }
    state.iter().flat_map(|word| word.to_be_bytes()).collect()
}

/// SHA-512, or SHA-384 (other start values, output cut to 48 bytes).
fn sha512_family(data: &[u8], short: bool) -> Vec<u8> {
    let mut state = if short { H384 } else { H512 };
    for block in md_pad(data, 128, 16, true).chunks_exact(128) {
        let mut w = [0u64; 80];
        for (i, chunk) in block.chunks_exact(8).enumerate() {
            w[i] = u64::from_be_bytes(chunk.try_into().unwrap());
        }
        for i in 16..80 {
            let s0 = w[i - 15].rotate_right(1) ^ w[i - 15].rotate_right(8) ^ (w[i - 15] >> 7);
            let s1 = w[i - 2].rotate_right(19) ^ w[i - 2].rotate_right(61) ^ (w[i - 2] >> 6);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..80 {
            let s1 = e.rotate_right(14) ^ e.rotate_right(18) ^ e.rotate_right(41);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K512[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(28) ^ a.rotate_right(34) ^ a.rotate_right(39);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut out: Vec<u8> = state.iter().flat_map(|word| word.to_be_bytes()).collect();
    out.truncate(if short { 48 } else { 64 });
    out
}

const KECCAK_RC: [u64; 24] = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000, 0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009, 0x000000000000008a,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000a, 0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800a, 0x800000008000000a, 0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
];
const KECCAK_ROT: [u32; 24] = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const KECCAK_PI: [usize; 24] = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

fn keccak_f(state: &mut [u64; 25]) {
    for rc in KECCAK_RC {
        let mut columns = [0u64; 5];
        for (x, column) in columns.iter_mut().enumerate() {
            *column = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        for x in 0..5 {
            let t = columns[(x + 4) % 5] ^ columns[(x + 1) % 5].rotate_left(1);
            for y in (0..25).step_by(5) {
                state[y + x] ^= t;
            }
        }
        let mut carried = state[1];
        for i in 0..24 {
            let target = KECCAK_PI[i];
            let next = state[target];
            state[target] = carried.rotate_left(KECCAK_ROT[i]);
            carried = next;
        }
        for y in (0..25).step_by(5) {
            let row = [state[y], state[y + 1], state[y + 2], state[y + 3], state[y + 4]];
            for x in 0..5 {
                state[y + x] = row[x] ^ (!row[(x + 1) % 5] & row[(x + 2) % 5]);
            }
        }
        state[0] ^= rc;
    }
}

/// A Keccak sponge with `out_len` bytes of output. `suffix` is 0x06 for SHA-3 and 0x01 for the original Keccak.
fn keccak(data: &[u8], out_len: usize, suffix: u8) -> Vec<u8> {
    let rate = 200 - 2 * out_len;
    let mut padded = data.to_vec();
    padded.push(suffix);
    while !padded.len().is_multiple_of(rate) {
        padded.push(0);
    }
    let last = padded.len() - 1;
    padded[last] |= 0x80;
    let mut state = [0u64; 25];
    for block in padded.chunks_exact(rate) {
        for (lane, chunk) in state.iter_mut().zip(block.chunks_exact(8)) {
            *lane ^= u64::from_le_bytes(chunk.try_into().unwrap());
        }
        keccak_f(&mut state);
    }
    let mut out: Vec<u8> = state.iter().flat_map(|lane| lane.to_le_bytes()).collect();
    out.truncate(out_len);
    out
}

/// The digest of `data`, or `None` for an unknown algorithm number.
pub fn digest(algo: u32, data: &[u8]) -> Option<Vec<u8>> {
    Some(match algo {
        MD5 => md5(data),
        SHA1 => sha1(data),
        SHA256 => sha256(data),
        SHA384 => sha512_family(data, true),
        SHA512 => sha512_family(data, false),
        SHA3_256 => keccak(data, 32, 0x06),
        SHA3_512 => keccak(data, 64, 0x06),
        KECCAK256 => keccak(data, 32, 0x01),
        _ => return None,
    })
}

/// HMAC (RFC 2104) over SHA-256, SHA-384 or SHA-512. `None` for any other algorithm.
pub fn hmac(algo: u32, key: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    let block = match algo {
        SHA256 => 64,
        SHA384 | SHA512 => 128,
        _ => return None,
    };
    let mut key = if key.len() > block { digest(algo, key)? } else { key.to_vec() };
    key.resize(block, 0);
    let mut inner: Vec<u8> = key.iter().map(|byte| byte ^ 0x36).collect();
    inner.extend_from_slice(data);
    let mut outer: Vec<u8> = key.iter().map(|byte| byte ^ 0x5c).collect();
    outer.extend_from_slice(&digest(algo, &inner)?);
    digest(algo, &outer)
}

/// Reserves `len` bytes of linear memory and returns a pointer to them.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Frees a block from `alloc` (pass the same `len`).
///
/// # Safety
/// `ptr` must come from `alloc(len)` and must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

unsafe fn write_out(result: Option<Vec<u8>>, output: *mut u8) -> usize {
    match result {
        Some(bytes) => {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len());
            bytes.len()
        }
        None => 0,
    }
}

/// Writes the digest of the `len` bytes at `input` to `output` and returns its length (0: unknown `algo`).
///
/// # Safety
/// `input` must point to `len` readable bytes and `output` to 64 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn digest_into(algo: u32, input: *const u8, len: usize, output: *mut u8) -> usize {
    write_out(digest(algo, std::slice::from_raw_parts(input, len)), output)
}

/// Writes the HMAC of the `len` bytes at `input` under the key to `output` and returns its length (0: unknown `algo`).
///
/// # Safety
/// `key` and `input` must point to `key_len` and `len` readable bytes, `output` to 64 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn hmac_into(algo: u32, key: *const u8, key_len: usize, input: *const u8, len: usize, output: *mut u8) -> usize {
    write_out(hmac(algo, std::slice::from_raw_parts(key, key_len), std::slice::from_raw_parts(input, len)), output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn input(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 7 + 3) as u8).collect()
    }

    fn check(algo: u32, expected: &[&str]) {
        for (n, want) in vectors::LENGTHS.iter().zip(expected) {
            assert_eq!(hex(&digest(algo, &input(*n)).unwrap()), *want, "algo {algo}, {n} bytes");
        }
    }

    #[test]
    fn matches_hashlib_at_every_block_edge() {
        check(MD5, &vectors::MD5);
        check(SHA1, &vectors::SHA1);
        check(SHA256, &vectors::SHA256);
        check(SHA384, &vectors::SHA384);
        check(SHA512, &vectors::SHA512);
        check(SHA3_256, &vectors::SHA3_256);
        check(SHA3_512, &vectors::SHA3_512);
    }

    #[test]
    fn keccak256_is_the_original_padding_not_sha3() {
        assert_eq!(hex(&digest(KECCAK256, b"").unwrap()), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
        assert_eq!(hex(&digest(KECCAK256, b"abc").unwrap()), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
        assert_ne!(digest(KECCAK256, b"abc"), digest(SHA3_256, b"abc"));
    }

    #[test]
    fn hmac_matches_python_for_short_block_and_long_keys() {
        for (algo, expected) in [(SHA256, &vectors::HMAC_SHA256), (SHA384, &vectors::HMAC_SHA384), (SHA512, &vectors::HMAC_SHA512)] {
            for (key_len, want) in vectors::HMAC_KEY_LENGTHS.iter().zip(expected) {
                let key: Vec<u8> = input(*key_len).into_iter().rev().collect();
                assert_eq!(hex(&hmac(algo, &key, &input(100)).unwrap()), *want, "algo {algo}, key {key_len} bytes");
            }
        }
    }

    #[test]
    fn hmac_rfc4231_case_2() {
        assert_eq!(hex(&hmac(SHA256, b"Jefe", b"what do ya want for nothing?").unwrap()), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn unknown_algorithms_give_nothing() {
        assert_eq!(digest(99, b"x"), None);
        assert_eq!(hmac(MD5, b"k", b"x"), None);
    }

    #[test]
    fn exported_functions_round_trip() {
        let (input, key, output) = (alloc(3), alloc(1), alloc(64));
        unsafe {
            std::ptr::copy_nonoverlapping(b"abc".as_ptr(), input, 3);
            *key = b'k';
            let len = digest_into(SHA256, input, 3, output);
            assert_eq!(hex(std::slice::from_raw_parts(output, len)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
            let len = hmac_into(SHA512, key, 1, input, 3, output);
            assert_eq!(len, 64);
            assert_eq!(digest_into(42, input, 3, output), 0);
            dealloc(input, 3);
            dealloc(key, 1);
            dealloc(output, 64);
        }
    }
}
