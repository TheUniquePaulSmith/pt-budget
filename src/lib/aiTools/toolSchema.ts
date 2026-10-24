import type { AiToolInputSchema, AiToolPropertySchema } from '@/types/aiTools';

/**
 * Small JSON-schema subset validator for tool arguments. Supports the
 * `type` / `enum` / `required` / `additionalProperties` / `items` /
 * `properties` keywords the packs and built-in tools use. Returns a list of
 * human-readable problems; an empty list means the args are acceptable.
 */
export function validateToolArguments(schema: AiToolInputSchema, args: unknown): string[] {
  const errors: string[] = [];
  validateObject(schema, args, '$', errors);
  return errors;
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

function validateValue(schema: AiToolPropertySchema, value: unknown, path: string, errors: string[]): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((type) => typeMatches(type, value))) {
    errors.push(`${path} must be of type ${types.join(' | ')}`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as string | number)) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(', ')}`);
    return;
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, index) => validateValue(schema.items as AiToolPropertySchema, item, `${path}[${index}]`, errors));
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value) && schema.properties) {
    validateObject(
      {
        type: 'object',
        properties: schema.properties,
        required: schema.required,
        additionalProperties: schema.additionalProperties,
      },
      value,
      path,
      errors
    );
  }
}

function validateObject(schema: AiToolInputSchema, value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const record = value as Record<string, unknown>;
  const properties = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    if (!(key in record) || record[key] === undefined) {
      errors.push(`${path}.${key} is required`);
    }
  }

  for (const [key, propertyValue] of Object.entries(record)) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not an allowed argument`);
      }
      continue;
    }
    if (propertyValue === undefined) {
      continue;
    }
    validateValue(propertySchema, propertyValue, `${path}.${key}`, errors);
  }
}

export function isInputSchema(value: unknown): value is AiToolInputSchema {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== 'object') {
    return false;
  }
  if (typeof record.properties !== 'object' || record.properties === null || Array.isArray(record.properties)) {
    return false;
  }
  for (const property of Object.values(record.properties as Record<string, unknown>)) {
    if (typeof property !== 'object' || property === null) {
      return false;
    }
    const type = (property as { type?: unknown }).type;
    if (typeof type !== 'string' && !(Array.isArray(type) && type.every((item) => typeof item === 'string'))) {
      return false;
    }
  }
  if (record.required !== undefined && !(Array.isArray(record.required) && record.required.every((item) => typeof item === 'string'))) {
    return false;
  }
  return true;
}
