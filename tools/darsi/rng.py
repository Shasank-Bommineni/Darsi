"""Deterministic hashing shared by the Python build pipeline and the JS runtime.

Both sides must produce identical values, so this is a plain 32-bit integer
hash with no floating-point accumulation.  `game/src/core/rng.js` mirrors it
exactly and `tests/test_determinism.py` checks that they agree.
"""
from __future__ import annotations

MASK = 0xFFFFFFFF


def hash_u32(*vals: int) -> int:
    h = 2166136261
    for v in vals:
        v = int(v) & MASK
        for shift in (0, 8, 16, 24):
            h ^= (v >> shift) & 0xFF
            h = (h * 16777619) & MASK
    h ^= h >> 15
    h = (h * 2246822519) & MASK
    h ^= h >> 13
    h = (h * 3266489917) & MASK
    h ^= h >> 16
    return h


def hash_f(*vals: int) -> float:
    """Deterministic float in [0, 1)."""
    return hash_u32(*vals) / 4294967296.0


def pick(seq, *vals: int):
    return seq[hash_u32(*vals) % len(seq)]


def rand_range(lo: float, hi: float, *vals: int) -> float:
    return lo + (hi - lo) * hash_f(*vals)


class Rng:
    """Small stateful stream for build-time generation."""

    def __init__(self, seed: int):
        self.s = hash_u32(seed, 0x9E3779B9)

    def next_u32(self) -> int:
        self.s = hash_u32(self.s, 0x85EBCA6B)
        return self.s

    def f(self) -> float:
        return self.next_u32() / 4294967296.0

    def range(self, lo: float, hi: float) -> float:
        return lo + (hi - lo) * self.f()

    def int(self, lo: int, hi: int) -> int:
        return lo + self.next_u32() % max(1, hi - lo + 1)

    def pick(self, seq):
        return seq[self.next_u32() % len(seq)]

    def chance(self, p: float) -> bool:
        return self.f() < p
