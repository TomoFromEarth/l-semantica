export interface JsonSchemaSubset {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  required?: string[];
  properties?: Record<string, JsonSchemaSubset>;
  items?: JsonSchemaSubset;
  additionalProperties?: boolean;
  const?: unknown;
  minLength?: number;
  minItems?: number;
  enum?: unknown[];
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function validateObject(
  schema: JsonSchemaSubset,
  value: unknown,
  path: string,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${path} expected object, got ${typeName(value)}`);
    return;
  }

  for (const key of schema.required ?? []) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  if (schema.properties) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateNode(propertySchema, value[key], `${path}.${key}`, errors);
      }
    }
  }

  if (schema.additionalProperties === false && schema.properties) {
    for (const key of Object.keys(value)) {
      if (!(key in schema.properties)) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
}

function validateArray(schema: JsonSchemaSubset, value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} expected array, got ${typeName(value)}`);
    return;
  }

  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${path} expected at least ${schema.minItems} items`);
  }

  if (schema.items) {
    value.forEach((entry, index) => {
      validateNode(schema.items as JsonSchemaSubset, entry, `${path}[${index}]`, errors);
    });
  }
}

function validateNode(
  schema: JsonSchemaSubset,
  value: unknown,
  path: string,
  errors: string[]
): void {
  if ("const" in schema && value !== schema.const) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }

  switch (schema.type) {
    case "object":
      validateObject(schema, value, path, errors);
      break;
    case "array":
      validateArray(schema, value, path, errors);
      break;
    case "string":
      if (typeof value !== "string") {
        errors.push(`${path} expected string, got ${typeName(value)}`);
      } else if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        errors.push(`${path} expected minimum length ${schema.minLength}`);
      }
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} expected number, got ${typeName(value)}`);
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path} expected integer, got ${typeName(value)}`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${path} expected boolean, got ${typeName(value)}`);
      }
      break;
    case "null":
      if (value !== null) {
        errors.push(`${path} expected null, got ${typeName(value)}`);
      }
      break;
    default:
      break;
  }
}

export function validateJsonSchemaSubset(
  schema: JsonSchemaSubset,
  value: unknown
): JsonSchemaValidationResult {
  const errors: string[] = [];
  validateNode(schema, value, "$", errors);

  return {
    valid: errors.length === 0,
    errors
  };
}
