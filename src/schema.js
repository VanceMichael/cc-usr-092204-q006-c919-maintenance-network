// 极简 JSON Schema 校验器：只覆盖本仓库契约用到的子集
// （type/required/properties/additionalProperties/items/enum/minimum/minLength），
// 用于在测试中核对样例数据与交换契约一致，避免引入外部依赖。

const TYPE_CHECKS = {
  object: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number",
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null,
};

export function validate(schema, value, path = "$", errors = []) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const type of types) {
      if (!TYPE_CHECKS[type]) throw new Error(`校验器未支持的类型: ${type}`);
    }
    if (!types.some((type) => TYPE_CHECKS[type](value))) {
      errors.push({ path, message: `期望类型 ${types.join("|")}` });
      return { ok: false, errors };
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `取值须为 ${schema.enum.join("/")} 之一` });
  }
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errors.push({ path, message: `不得小于 ${schema.minimum}` });
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push({ path, message: `长度不得小于 ${schema.minLength}` });
  }

  if (TYPE_CHECKS.object(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push({ path: `${path}.${key}`, message: "缺少必填字段" });
    }
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in value) validate(subSchema, value[key], `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push({ path: `${path}.${key}`, message: "契约未定义的字段" });
      }
    } else if (typeof schema.additionalProperties === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (!(key in properties)) validate(schema.additionalProperties, item, `${path}.${key}`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`, errors));
  }

  return { ok: errors.length === 0, errors };
}

export function assertValid(schema, value, label = "数据") {
  const result = validate(schema, value);
  if (!result.ok) {
    const detail = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`${label}不符合契约: ${detail}`);
  }
  return value;
}
