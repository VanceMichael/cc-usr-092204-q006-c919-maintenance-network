// 轻量 JSON Schema 校验器，覆盖本仓库契约使用的子集：
// type（含类型数组与 "null"）、properties、required、additionalProperties
// （false 或子模式）、items、enum、const、oneOf、pattern、minimum、minItems。
const TYPE_CHECKS = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null
};

export function validateSchema(schema, value, path = "$") {
  const errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);

  if (schema.const !== undefined && value !== schema.const) {
    fail(`应为常量 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`取值 ${JSON.stringify(value)} 不在枚举 ${schema.enum.join("/")} 内`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => TYPE_CHECKS[t](value))) {
      fail(`类型应为 ${types.join("|")}`);
      return errors;
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => validateSchema(sub, value, path).length === 0);
    if (matches.length !== 1) {
      fail(`应且只应匹配一种结构，实际匹配 ${matches.length} 种`);
    }
    return errors;
  }
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    fail(`不匹配模式 ${schema.pattern}`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    fail(`不应小于 ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`数组长度不应小于 ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(schema.items, item, `${path}[${index}]`));
      });
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) fail(`缺少字段 ${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...validateSchema(properties[key], item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        fail(`存在未定义的字段 ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateSchema(schema.additionalProperties, item, `${path}.${key}`));
      }
    }
  }
  return errors;
}
