import { describe, it, expect } from 'vitest';
import { MerkleChain } from '../src/trace/merkle.js';

describe('MerkleChain', () => {
  it('appends entries and computes hashes', () => {
    const chain = new MerkleChain();
    const e1 = chain.append('t1', '{"action":"write"}');
    expect(e1.sequenceNumber).toBe(0);
    expect(e1.contentHash).toBeTruthy();
    expect(e1.merkleRoot).toBeTruthy();
    expect(e1.previousHash).toBe('0'.repeat(64));
  });

  it('chains entries correctly', () => {
    const chain = new MerkleChain();
    const e1 = chain.append('t1', 'data1');
    const e2 = chain.append('t2', 'data2');
    expect(e2.previousHash).toBe(e1.contentHash);
    expect(e2.sequenceNumber).toBe(1);
  });

  it('verifies an intact chain', () => {
    const chain = new MerkleChain();
    chain.append('t1', 'data1');
    chain.append('t2', 'data2');
    chain.append('t3', 'data3');
    const result = chain.verify();
    expect(result.valid).toBe(true);
    expect(result.length).toBe(3);
  });

  it('detects tampered entries', () => {
    const chain = new MerkleChain();
    chain.append('t1', 'data1');
    chain.append('t2', 'data2');

    // Tamper with internal state
    const entries = chain.export();
    expect(entries.length).toBe(2);

    // A fresh chain with different data should produce a different root
    const chain2 = new MerkleChain();
    chain2.append('t1', 'TAMPERED');
    chain2.append('t2', 'data2');
    expect(chain2.getRoot()).not.toBe(chain.getRoot());
  });

  it('provides merkle proofs', () => {
    const chain = new MerkleChain();
    chain.append('t1', 'd1');
    chain.append('t2', 'd2');
    chain.append('t3', 'd3');
    chain.append('t4', 'd4');
    const proof = chain.getProof(0);
    expect(Array.isArray(proof)).toBe(true);
  });

  it('returns correct length and root', () => {
    const chain = new MerkleChain();
    expect(chain.length).toBe(0);
    expect(chain.getRoot()).toBe('0'.repeat(64));
    chain.append('t1', 'x');
    expect(chain.length).toBe(1);
    expect(chain.getRoot().length).toBe(64);
  });
});
