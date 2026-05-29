import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types (self-contained — duplicated from kernel/types.ts intentionally)
// ---------------------------------------------------------------------------

export interface MerkleTraceEntry {
  sequenceNumber: number;
  traceId: string;
  contentHash: string;
  previousHash: string;
  merkleRoot: string;
  timestamp: number;
}

export interface ChainVerification {
  valid: boolean;
  length: number;
  brokenAt?: number;
  brokenReason?: string;
}

// ---------------------------------------------------------------------------
// Merkle Trace Chain
// ---------------------------------------------------------------------------

const ZERO_HASH = '0'.repeat(64);

export class MerkleChain {
  private entries: MerkleTraceEntry[] = [];
  private leafHashes: string[] = [];

  // ---- Public API --------------------------------------------------------

  /**
   * Append a new trace to the chain.
   * Returns the newly created entry with its computed hashes and merkle root.
   */
  append(traceId: string, content: string): MerkleTraceEntry {
    const contentHash = this.computeHash(content);
    const previousHash =
      this.entries.length > 0
        ? this.entries[this.entries.length - 1].contentHash
        : ZERO_HASH;

    this.leafHashes.push(contentHash);
    const merkleRoot = this.computeMerkleRoot(this.leafHashes);

    const entry: MerkleTraceEntry = {
      sequenceNumber: this.entries.length,
      traceId,
      contentHash,
      previousHash,
      merkleRoot,
      timestamp: Date.now(),
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Walk the entire chain and verify its integrity.
   *
   * Checks:
   *  1. Genesis entry must have previousHash === ZERO_HASH.
   *  2. Every subsequent entry's previousHash must equal the prior entry's
   *     contentHash.
   *  3. The stored merkleRoot at each position must match a fresh computation
   *     over the leaf hashes accumulated up to (and including) that position.
   */
  verify(): ChainVerification {
    const len = this.entries.length;

    for (let i = 0; i < len; i++) {
      const entry = this.entries[i];

      // --- previous-hash linkage ---
      if (i === 0) {
        if (entry.previousHash !== ZERO_HASH) {
          return {
            valid: false,
            length: len,
            brokenAt: i,
            brokenReason:
              'Genesis entry has invalid previousHash (expected zero hash)',
          };
        }
      } else {
        const prev = this.entries[i - 1];
        if (entry.previousHash !== prev.contentHash) {
          return {
            valid: false,
            length: len,
            brokenAt: i,
            brokenReason: `Entry ${i} previousHash does not match entry ${i - 1} contentHash`,
          };
        }
      }

      // --- merkle root verification ---
      const leavesUpToHere = this.leafHashes.slice(0, i + 1);
      const expectedRoot = this.computeMerkleRoot(leavesUpToHere);
      if (entry.merkleRoot !== expectedRoot) {
        return {
          valid: false,
          length: len,
          brokenAt: i,
          brokenReason: `Entry ${i} merkleRoot does not match recomputed root`,
        };
      }
    }

    return { valid: true, length: len };
  }

  /**
   * Return the Merkle proof (sibling-hash path) for a given entry, allowing
   * independent verification that the entry belongs to the tree without
   * revealing any other entries.
   *
   * The proof is an ordered list of sibling hashes from leaf level up to the
   * root.
   */
  getProof(sequenceNumber: number): string[] {
    if (sequenceNumber < 0 || sequenceNumber >= this.leafHashes.length) {
      return [];
    }
    if (this.leafHashes.length <= 1) return [];

    const proof: string[] = [];
    let currentLayer = [...this.leafHashes];
    if (currentLayer.length > 1 && currentLayer.length % 2 !== 0) {
      currentLayer.push(currentLayer[currentLayer.length - 1]);
    }
    let idx = sequenceNumber;

    while (currentLayer.length > 1) {
      // Find sibling at current level
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx >= 0 && siblingIdx < currentLayer.length) {
        proof.push(currentLayer[siblingIdx]);
      }

      // Compute next layer (always even since we pair adjacent elements)
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        nextLayer.push(this.computeHash(currentLayer[i] + currentLayer[i + 1]));
      }
      currentLayer = nextLayer;
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  /** Retrieve a single entry by its sequence number. */
  getEntry(sequenceNumber: number): MerkleTraceEntry | undefined {
    return this.entries[sequenceNumber];
  }

  /** Retrieve the most recently appended entry. */
  getLatest(): MerkleTraceEntry | undefined {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1]
      : undefined;
  }

  /** Number of entries in the chain. */
  get length(): number {
    return this.entries.length;
  }

  /** Return a shallow copy of all entries. */
  export(): MerkleTraceEntry[] {
    return [...this.entries];
  }

  /**
   * Rebuild the chain from previously {@link export}ed entries — used when
   * rehydrating a persisted audit trail. Leaf hashes are reconstructed from
   * each entry's `contentHash`, so a subsequent {@link verify} validates the
   * restored chain end-to-end. Replaces any existing entries.
   */
  restore(entries: MerkleTraceEntry[]): void {
    this.entries = entries.map((e) => ({ ...e }));
    this.leafHashes = this.entries.map((e) => e.contentHash);
  }

  /** Current merkle root, or the zero hash if the chain is empty. */
  getRoot(): string {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1].merkleRoot
      : ZERO_HASH;
  }

  // ---- Private helpers ---------------------------------------------------

  /** SHA-256 hex digest. */
  private computeHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Duplicate the last element if the layer has an odd count so that every
   * node has a pairing partner.
   */
  private buildLayer(hashes: string[]): string[] {
    const layer = [...hashes];
    if (layer.length > 1 && layer.length % 2 !== 0) {
      layer.push(layer[layer.length - 1]);
    }
    return layer;
  }

  /**
   * Standard bottom-up Merkle tree root computation.
   *
   * 1. If the list is empty, return the zero hash.
   * 2. If odd, duplicate the last hash.
   * 3. Pair adjacent hashes, hash each pair, repeat until one root remains.
   */
  private computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) {
      return ZERO_HASH;
    }

    let layer = [...hashes];
    if (layer.length > 1 && layer.length % 2 !== 0) {
      layer.push(layer[layer.length - 1]);
    }

    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = i + 1 < layer.length ? layer[i + 1] : layer[i];
        next.push(this.computeHash(left + right));
      }
      layer = next;
      // Re-pad if odd (only needed if input was odd-depth tree — rare edge case)
      if (layer.length > 1 && layer.length % 2 !== 0) {
        layer.push(layer[layer.length - 1]);
      }
    }

    return layer[0];
  }
}
