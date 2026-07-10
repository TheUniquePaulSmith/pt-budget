import { describe, expect, it } from 'vitest';

import { inspectGgufModelFiles } from './aiModelFileInspection';

enum TestGgufValueType {
  Uint32 = 4,
  String = 8,
  Array = 9,
}

function writeUint32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function writeUint64(bytes: number[], value: number) {
  const bigintValue = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number((bigintValue >> BigInt(index * 8)) & BigInt(0xff)));
  }
}

function writeString(bytes: number[], value: string) {
  const encoded = new TextEncoder().encode(value);
  writeUint64(bytes, encoded.byteLength);
  bytes.push(...encoded);
}

function writeMetadataEntry(bytes: number[], key: string, value: string | number | string[]) {
  writeString(bytes, key);

  if (typeof value === 'string') {
    writeUint32(bytes, TestGgufValueType.String);
    writeString(bytes, value);
    return;
  }

  if (typeof value === 'number') {
    writeUint32(bytes, TestGgufValueType.Uint32);
    writeUint32(bytes, value);
    return;
  }

  writeUint32(bytes, TestGgufValueType.Array);
  writeUint32(bytes, TestGgufValueType.String);
  writeUint64(bytes, value.length);
  value.forEach((entry) => writeString(bytes, entry));
}

function createGgufFile(name: string, metadata: Record<string, string | number | string[]> = {}) {
  const bytes: number[] = [];
  bytes.push('G'.charCodeAt(0), 'G'.charCodeAt(0), 'U'.charCodeAt(0), 'F'.charCodeAt(0));
  writeUint32(bytes, 3);
  writeUint64(bytes, 42);
  writeUint64(bytes, Object.keys(metadata).length);
  Object.entries(metadata).forEach(([key, value]) => writeMetadataEntry(bytes, key, value));
  return new File([new Uint8Array(bytes)], name);
}

describe('inspectGgufModelFiles', () => {
  it('extracts validation status and model statistics from GGUF metadata', async () => {
    const result = await inspectGgufModelFiles([
      createGgufFile('demo.gguf', {
        'general.name': 'Demo Model',
        'general.architecture': 'llama',
        'general.file_type': 15,
        'llama.context_length': 4096,
        'llama.embedding_length': 2048,
        'llama.block_count': 22,
        'tokenizer.ggml.tokens': ['a', 'b', 'c'],
      }),
    ]);

    expect(result.status).toBe('valid');
    expect(result.stats).toMatchObject({
      modelName: 'Demo Model',
      architecture: 'llama',
      quantization: 'GGUF file type 15',
      contextLength: 4096,
      embeddingLength: 2048,
      layerCount: 22,
      vocabularySize: 3,
      tensorCount: 42,
      metadataCount: 7,
      formatVersion: 3,
    });
  });

  it('rejects files without a GGUF header', async () => {
    const result = await inspectGgufModelFiles([
      new File([new Uint8Array([0, 1, 2, 3])], 'bad.gguf'),
    ]);

    expect(result.status).toBe('invalid');
    expect(result.issues[0].message).toContain('too small');
  });

  it('requires complete split-model shard selections', async () => {
    const result = await inspectGgufModelFiles([
      createGgufFile('demo-00001-of-00002.gguf'),
    ]);

    expect(result.status).toBe('invalid');
    expect(result.issues[0].message).toContain('Expected 2 shards');
  });
});