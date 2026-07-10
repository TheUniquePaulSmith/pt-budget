import type {
  AiModelFileStats,
  AiModelInspectionResult,
  AiModelInspectionStats,
  AiModelValidationIssue,
} from '@/types/ai';

const GGUF_MAGIC = 'GGUF';
const GGUF_HEADER_BYTES = 24;
const INSPECTION_BYTES = 16 * 1024 * 1024;
const SUPPORTED_GGUF_VERSIONS = new Set([1, 2, 3]);

enum GgufValueType {
  Uint8 = 0,
  Int8 = 1,
  Uint16 = 2,
  Int16 = 3,
  Uint32 = 4,
  Int32 = 5,
  Float32 = 6,
  Bool = 7,
  String = 8,
  Array = 9,
  Uint64 = 10,
  Int64 = 11,
  Float64 = 12,
}

type GgufArraySummary = {
  type: 'array';
  itemType: GgufValueType;
  length: number;
};

type GgufMetadataValue = string | number | boolean | GgufArraySummary;

interface ParsedGgufFile {
  fileStats: AiModelFileStats;
  metadata: Record<string, GgufMetadataValue>;
}

class GgufMetadataReader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  get position() {
    return this.offset;
  }

  readMagic() {
    this.ensure(4);
    const magic = String.fromCharCode(
      this.view.getUint8(this.offset),
      this.view.getUint8(this.offset + 1),
      this.view.getUint8(this.offset + 2),
      this.view.getUint8(this.offset + 3)
    );
    this.offset += 4;
    return magic;
  }

  readUint32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readInt32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER));
  }

  readInt64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    if (value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number.MIN_SAFE_INTEGER;
    }
    return Number(value);
  }

  readString() {
    const length = this.readUint64();
    this.ensure(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readValue(): GgufMetadataValue {
    const valueType = this.readUint32();
    return this.readValueByType(valueType);
  }

  private readValueByType(valueType: number): GgufMetadataValue {
    switch (valueType) {
      case GgufValueType.Uint8: {
        this.ensure(1);
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
      }
      case GgufValueType.Int8: {
        this.ensure(1);
        const value = this.view.getInt8(this.offset);
        this.offset += 1;
        return value;
      }
      case GgufValueType.Uint16: {
        this.ensure(2);
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
      }
      case GgufValueType.Int16: {
        this.ensure(2);
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
      }
      case GgufValueType.Uint32:
        return this.readUint32();
      case GgufValueType.Int32:
        return this.readInt32();
      case GgufValueType.Float32: {
        this.ensure(4);
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
      }
      case GgufValueType.Bool: {
        this.ensure(1);
        const value = this.view.getUint8(this.offset) !== 0;
        this.offset += 1;
        return value;
      }
      case GgufValueType.String:
        return this.readString();
      case GgufValueType.Array:
        return this.readArray();
      case GgufValueType.Uint64:
        return this.readUint64();
      case GgufValueType.Int64:
        return this.readInt64();
      case GgufValueType.Float64: {
        this.ensure(8);
        const value = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return value;
      }
      default:
        throw new Error(`Unsupported GGUF metadata value type ${valueType}.`);
    }
  }

  private readArray(): GgufArraySummary {
    const itemType = this.readUint32();
    const length = this.readUint64();
    const fixedSize = getFixedValueByteLength(itemType);

    if (fixedSize !== null) {
      const bytesToSkip = fixedSize * length;
      this.ensure(bytesToSkip);
      this.offset += bytesToSkip;
    } else if (itemType === GgufValueType.String) {
      for (let index = 0; index < length; index += 1) {
        this.readString();
      }
    } else {
      throw new Error(`Unsupported GGUF array item type ${itemType}.`);
    }

    return { type: 'array', itemType, length };
  }

  private ensure(byteLength: number) {
    if (this.offset + byteLength > this.view.byteLength) {
      throw new Error('The GGUF metadata header is larger than the inspection window.');
    }
  }
}

function getFixedValueByteLength(valueType: number): number | null {
  switch (valueType) {
    case GgufValueType.Uint8:
    case GgufValueType.Int8:
    case GgufValueType.Bool:
      return 1;
    case GgufValueType.Uint16:
    case GgufValueType.Int16:
      return 2;
    case GgufValueType.Uint32:
    case GgufValueType.Int32:
    case GgufValueType.Float32:
      return 4;
    case GgufValueType.Uint64:
    case GgufValueType.Int64:
    case GgufValueType.Float64:
      return 8;
    default:
      return null;
  }
}

async function parseGgufHeader(file: File): Promise<ParsedGgufFile> {
  if (file.size < GGUF_HEADER_BYTES) {
    throw new Error(`${file.name} is too small to be a GGUF model file.`);
  }

  const buffer = await file.slice(0, INSPECTION_BYTES).arrayBuffer();
  const reader = new GgufMetadataReader(new DataView(buffer));
  const magic = reader.readMagic();

  if (magic !== GGUF_MAGIC) {
    throw new Error(`${file.name} does not have a valid GGUF header.`);
  }

  const formatVersion = reader.readUint32();
  const tensorCount = reader.readUint64();
  const metadataCount = reader.readUint64();

  if (!SUPPORTED_GGUF_VERSIONS.has(formatVersion)) {
    throw new Error(`${file.name} uses unsupported GGUF version ${formatVersion}.`);
  }

  const metadata: Record<string, GgufMetadataValue> = {};
  for (let index = 0; index < metadataCount; index += 1) {
    const key = reader.readString();
    metadata[key] = reader.readValue();
  }

  return {
    fileStats: {
      name: file.name,
      sizeBytes: file.size,
      formatVersion,
      tensorCount,
      metadataCount,
    },
    metadata,
  };
}

function getStringMetadata(metadata: Record<string, GgufMetadataValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberMetadata(metadata: Record<string, GgufMetadataValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getArrayLengthMetadata(metadata: Record<string, GgufMetadataValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'array'
    ? value.length
    : undefined;
}

function getModelStats(fileStats: AiModelFileStats, metadata: Record<string, GgufMetadataValue>): AiModelInspectionStats {
  const architecture = getStringMetadata(metadata, 'general.architecture');
  const architecturePrefix = architecture ? `${architecture}.` : '';
  const fileType = getNumberMetadata(metadata, 'general.file_type');

  return {
    modelName: getStringMetadata(metadata, 'general.name') ?? getStringMetadata(metadata, 'general.basename'),
    architecture,
    quantization: fileType === undefined ? undefined : `GGUF file type ${fileType}`,
    contextLength: getNumberMetadata(metadata, `${architecturePrefix}context_length`),
    embeddingLength: getNumberMetadata(metadata, `${architecturePrefix}embedding_length`),
    layerCount: getNumberMetadata(metadata, `${architecturePrefix}block_count`),
    vocabularySize: getArrayLengthMetadata(metadata, 'tokenizer.ggml.tokens'),
    tensorCount: fileStats.tensorCount,
    metadataCount: fileStats.metadataCount,
    formatVersion: fileStats.formatVersion,
  };
}

function parseSplitShardName(name: string) {
  const match = name.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    index: Number(match[2]),
    total: Number(match[3]),
  };
}

function validateSplitShards(files: File[]): AiModelValidationIssue[] {
  const splitParts = files.map((file) => ({ file, split: parseSplitShardName(file.name) }));
  const splitFiles = splitParts.filter((entry) => entry.split);

  if (splitFiles.length === 0) {
    return files.length > 1
      ? [{ severity: 'warning', message: 'Multiple GGUF files were selected, but their names do not look like numbered split-model shards.' }]
      : [];
  }

  if (splitFiles.length !== files.length) {
    return [{ severity: 'error', message: 'Split GGUF shards must be selected together without unrelated GGUF files.' }];
  }

  const first = splitFiles[0].split;
  if (!first) {
    return [];
  }

  const inconsistent = splitFiles.some((entry) => (
    !entry.split || entry.split.prefix !== first.prefix || entry.split.total !== first.total
  ));

  if (inconsistent) {
    return [{ severity: 'error', message: 'Selected split GGUF shards do not belong to the same model set.' }];
  }

  const shardIndexes = new Set(splitFiles.map((entry) => entry.split?.index));
  const missingIndexes: number[] = [];
  for (let index = 1; index <= first.total; index += 1) {
    if (!shardIndexes.has(index)) {
      missingIndexes.push(index);
    }
  }

  if (missingIndexes.length > 0 || shardIndexes.size !== splitFiles.length) {
    return [{ severity: 'error', message: `Selected split GGUF shards are incomplete. Expected ${first.total} shards.` }];
  }

  return [];
}

export async function inspectGgufModelFiles(files: File[]): Promise<AiModelInspectionResult> {
  const issues: AiModelValidationIssue[] = [];
  const totalSizeBytes = files.reduce((total, file) => total + file.size, 0);

  if (files.length === 0) {
    return {
      status: 'idle',
      files: [],
      totalSizeBytes: 0,
      stats: {},
      issues: [],
    };
  }

  const invalidExtension = files.find((file) => !file.name.toLowerCase().endsWith('.gguf'));
  if (invalidExtension) {
    return {
      status: 'invalid',
      files: [],
      totalSizeBytes,
      stats: {},
      issues: [{ severity: 'error', message: 'Only GGUF model files can be selected.' }],
    };
  }

  issues.push(...validateSplitShards(files));

  try {
    const parsedFiles = await Promise.all(files.map(parseGgufHeader));
    const firstModelFile = parsedFiles.find((file) => Object.keys(file.metadata).length > 0) ?? parsedFiles[0];
    const stats = getModelStats(firstModelFile.fileStats, firstModelFile.metadata);

    return {
      status: issues.some((issue) => issue.severity === 'error')
        ? 'invalid'
        : issues.length > 0 ? 'warning' : 'valid',
      files: parsedFiles.map((file) => file.fileStats),
      totalSizeBytes,
      stats,
      issues,
    };
  } catch (err) {
    return {
      status: 'invalid',
      files: files.map((file) => ({ name: file.name, sizeBytes: file.size })),
      totalSizeBytes,
      stats: {},
      issues: [
        ...issues,
        {
          severity: 'error',
          message: err instanceof Error ? err.message : 'Unable to inspect the selected GGUF model file.',
        },
      ],
    };
  }
}