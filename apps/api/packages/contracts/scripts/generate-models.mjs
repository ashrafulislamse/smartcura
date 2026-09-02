import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'openapi', 'openapi.json'), 'utf8'));
const schemas = contract.components.schemas;
const contractVersion = contract.info.version;

const refName = (ref) => ref.split('/').at(-1);
const lowerFirst = (value) => value.charAt(0).toLowerCase() + value.slice(1);
const camel = (value) => value.toLowerCase().replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());

function tsType(schema) {
  if (!schema) return 'unknown';
  if (schema.$ref) return refName(schema.$ref);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.oneOf) return schema.oneOf.map(tsType).join(' | ');
  if (Array.isArray(schema.type)) return schema.type.map((type) => tsType({ ...schema, type })).join(' | ');
  if (schema.enum) return `${schema.enum.map((value) => JSON.stringify(value)).join(' | ')} | UnknownEnumValue`;
  if (schema.type === 'array') return `ReadonlyArray<${tsType(schema.items)}>`;
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  if (schema.type === 'object') return 'Readonly<Record<string, unknown>>';
  return 'string';
}

function generateTypeScript() {
  const lines = [
    '// GENERATED FILE - DO NOT EDIT.',
    `// Source: OpenAPI ${contract.openapi}, contract ${contractVersion}`,
    '',
    "export type UnknownEnumValue = string & { readonly __smartCuraUnknownEnum: 'unknown' };",
    '',
  ];

  for (const [name, schema] of Object.entries(schemas)) {
    if (schema.type === 'object' && schema.properties) {
      const required = new Set(schema.required ?? []);
      lines.push(`export interface ${name} {`);
      for (const [wireName, property] of Object.entries(schema.properties)) {
        const optional = required.has(wireName) ? '' : '?';
        lines.push(`  readonly ${wireName}${optional}: ${tsType(property)};`);
      }
      lines.push('}', '');
    } else {
      lines.push(`export type ${name} = ${tsType(schema)};`, '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function dartNullable(schema) {
  return Array.isArray(schema?.type)
    ? schema.type.includes('null')
    : Boolean(schema?.oneOf?.some((part) => part.type === 'null'));
}

function dartBaseType(schema) {
  if (!schema) return 'Object?';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.oneOf) {
    const choices = schema.oneOf.filter((part) => part.type !== 'null');
    if (choices.length !== 1) throw new Error(`Unsupported Dart oneOf: ${JSON.stringify(schema)}`);
    return dartBaseType(choices[0]);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  if (type === 'array') return `List<${dartType(schema.items)}>`;
  if (type === 'integer') return 'int';
  if (type === 'number') return 'double';
  if (type === 'boolean') return 'bool';
  if (type === 'object') return 'Map<String, Object?>';
  return 'String';
}

function dartType(schema, forceNullable = false) {
  const base = dartBaseType(schema);
  const nullable = forceNullable || dartNullable(schema);
  return nullable && !base.endsWith('?') ? `${base}?` : base;
}

function enumBlock(name, values) {
  const functionName = `${lowerFirst(name)}FromWire`;
  const hasWireUnknown = values.includes('unknown');
  const enumValues = hasWireUnknown ? values : [...values, 'unknown'];
  const lines = [`enum ${name} {`];
  enumValues.forEach((value) => lines.push(`  ${camel(value)},`));
  lines.push('}', '', `extension ${name}Wire on ${name} {`, '  String get wireValue => switch (this) {');
  values.forEach((value) => lines.push(`    ${name}.${camel(value)} => '${value}',`));
  if (!hasWireUnknown) lines.push(`    ${name}.unknown => throw StateError('Cannot serialize unknown ${name}'),`);
  lines.push('  };', '}', '', `${name} ${functionName}(String value) => switch (value) {`);
  values.forEach((value) => lines.push(`  '${value}' => ${name}.${camel(value)},`));
  lines.push(`  _ => ${name}.unknown,`, '};', '');
  return lines;
}

function generateDart() {
  const lines = [
    '// GENERATED FILE - DO NOT EDIT.',
    `// Source: OpenAPI ${contract.openapi}, contract ${contractVersion}`,
    '',
  ];

  for (const [name, schema] of Object.entries(schemas)) {
    if (schema.enum && schema.enum.every((value) => typeof value === 'string')) {
      lines.push(...enumBlock(name, schema.enum));
      continue;
    }
    if (schema.type === 'object' && schema.properties) {
      const required = new Set(schema.required ?? []);
      lines.push(`class ${name} {`, `  const ${name}({`);
      for (const [wireName] of Object.entries(schema.properties)) {
        const keyword = required.has(wireName) ? 'required ' : '';
        lines.push(`    ${keyword}this.${camel(wireName)},`);
      }
      lines.push('  });', '');
      for (const [wireName, property] of Object.entries(schema.properties)) {
        lines.push(`  final ${dartType(property, !required.has(wireName))} ${camel(wireName)};`);
      }
      lines.push('', `  factory ${name}.fromJson(Map<String, Object?> json) => ${name}(`);
      for (const [wireName, property] of Object.entries(schema.properties)) {
        const fieldName = camel(wireName);
        lines.push(`    ${fieldName}: ${dartFromJson(property, wireName, !required.has(wireName))},`);
      }
      lines.push('  );', '');
      lines.push('  Map<String, Object?> toJson() => {');
      for (const [wireName, property] of Object.entries(schema.properties)) {
        const fieldName = camel(wireName);
        lines.push(`    '${wireName}': ${dartToJson(property, fieldName, !required.has(wireName))},`);
      }
      lines.push('  };', '}', '');
      continue;
    }
    lines.push(`typedef ${name} = ${dartBaseType(schema)};`, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Whether a `$ref` target is a string-enum schema. Used to decide whether a
 * referenced type round-trips through an `xxxFromWire` / `.wireValue` pair
 * rather than a `SubClass.fromJson` / `.toJson()` call.
 */
function refIsEnum(ref) {
  const target = schemas[refName(ref)];
  return Boolean(target?.enum?.every((value) => typeof value === 'string'));
}

/**
 * Whether a `$ref` target is a generated Dart class (object with properties),
 * as opposed to a typedef, enum, or primitive. Only class targets carry
 * `fromJson` / `toJson` members.
 */
function refIsClass(ref) {
  const target = schemas[refName(ref)];
  return Boolean(target?.type === 'object' && target?.properties);
}

/**
 * The base Dart type name for a `$ref` target when it is NOT a class — i.e. a
 * typedef or an enum. Returns the same `dartBaseType` that `generateDart`
 * emits as a `typedef` for simple-type schemas.
 */
function refSimpleType(ref) {
  const target = schemas[refName(ref)];
  if (target?.enum?.every((value) => typeof value === 'string')) return refName(ref);
  return dartBaseType(target);
}

/**
 * Emits the Dart expression that converts a JSON value (read from
 * `json['wireName']`) into the property's Dart type.
 */
function dartFromJson(schema, wireName, forceNullable = false) {
  // Collapse oneOf [{...}, {type:null}] to the non-null choice, remembering that
  // the schema was nullable. Without this the oneOf branch recurses forever.
  let effective = schema;
  const nullable = forceNullable || dartNullable(schema);
  if (schema.oneOf) {
    const choices = schema.oneOf.filter((part) => part.type !== 'null');
    if (choices.length === 1) effective = choices[0];
  }
  const accessKey = `'${wireName}'`;
  if (effective.$ref) {
    const target = refName(effective.$ref);
    if (refIsEnum(effective.$ref)) {
      const fn = `${lowerFirst(target)}FromWire`;
      return nullable
        ? `json[${accessKey}] == null ? null : ${fn}(json[${accessKey}] as String)`
        : `${fn}(json[${accessKey}] as String)`;
    }
    if (refIsClass(effective.$ref)) {
      return nullable
        ? `json[${accessKey}] == null ? null : ${target}.fromJson(json[${accessKey}] as Map<String, Object?>)`
        : `${target}.fromJson(json[${accessKey}] as Map<String, Object?>)`;
    }
    // A typedef (e.g. UuidV7, Timestamp) — the wire value is already the right
    // type, no conversion needed beyond the cast.
    return nullable
      ? `json[${accessKey}] == null ? null : json[${accessKey}] as ${refSimpleType(effective.$ref)}`
      : `json[${accessKey}] as ${refSimpleType(effective.$ref)}`;
  }
  const type = Array.isArray(effective.type) ? effective.type.find((item) => item !== 'null') : effective.type;
  if (type === 'array') {
    const item = effective.items;
    if (item?.$ref) {
      const target = refName(item.$ref);
      if (refIsEnum(item.$ref)) {
        const fn = `${lowerFirst(target)}FromWire`;
        return nullable
          ? `json[${accessKey}] == null ? null : (json[${accessKey}] as List).map((e) => ${fn}(e as String)).toList()`
          : `(json[${accessKey}] as List).map((e) => ${fn}(e as String)).toList()`;
      }
      if (refIsClass(item.$ref)) {
        return nullable
          ? `json[${accessKey}] == null ? null : (json[${accessKey}] as List).map((e) => ${target}.fromJson(e as Map<String, Object?>)).toList()`
          : `(json[${accessKey}] as List).map((e) => ${target}.fromJson(e as Map<String, Object?>)).toList()`;
      }
      // Array of typedefs (e.g. List<UuidV7>) — copy the list as-is.
      return nullable
        ? `json[${accessKey}] == null ? null : List<${refSimpleType(item.$ref)}>.from(json[${accessKey}] as List)`
        : `List<${refSimpleType(item.$ref)}>.from(json[${accessKey}] as List)`;
    }
    // Array of primitives (string, int, etc.) — use the item's base type.
    const itemType = dartBaseType(item);
    return nullable
      ? `json[${accessKey}] == null ? null : List<${itemType}>.from(json[${accessKey}] as List)`
      : `List<${itemType}>.from(json[${accessKey}] as List)`;
  }
  if (type === 'integer') return nullable ? `json[${accessKey}] == null ? null : (json[${accessKey}] as num).toInt()` : `(json[${accessKey}] as num).toInt()`;
  if (type === 'number') return nullable ? `json[${accessKey}] == null ? null : (json[${accessKey}] as num).toDouble()` : `(json[${accessKey}] as num).toDouble()`;
  if (type === 'boolean') return nullable ? `json[${accessKey}] == null ? null : json[${accessKey}] as bool` : `json[${accessKey}] as bool`;
  if (type === 'object') return nullable ? `json[${accessKey}] == null ? null : Map<String, Object?>.from(json[${accessKey}] as Map)` : `Map<String, Object?>.from(json[${accessKey}] as Map)`;
  // String (including string enums without $ref)
  return nullable ? `json[${accessKey}] == null ? null : json[${accessKey}] as String` : `json[${accessKey}] as String`;
}

/**
 * Emits the Dart expression that converts the property's Dart value (`fieldName`)
 * back into a JSON-serialisable value.
 */
function dartToJson(schema, fieldName, forceNullable = false) {
  // Collapse oneOf [{...}, {type:null}] to the non-null choice.
  let effective = schema;
  const nullable = forceNullable || dartNullable(schema);
  if (schema.oneOf) {
    const choices = schema.oneOf.filter((part) => part.type !== 'null');
    if (choices.length === 1) effective = choices[0];
  }
  if (effective.$ref) {
    const target = refName(effective.$ref);
    if (refIsEnum(effective.$ref)) {
      return nullable ? `${fieldName}?.wireValue` : `${fieldName}.wireValue`;
    }
    if (refIsClass(effective.$ref)) {
      return nullable ? `${fieldName}?.toJson()` : `${fieldName}.toJson()`;
    }
    // A typedef — the Dart value is already the JSON value.
    return fieldName;
  }
  const type = Array.isArray(effective.type) ? effective.type.find((item) => item !== 'null') : effective.type;
  if (type === 'array') {
    const item = effective.items;
    if (item?.$ref) {
      const target = refName(item.$ref);
      if (refIsEnum(item.$ref)) {
        return nullable ? `${fieldName}?.map((e) => e.wireValue).toList()` : `${fieldName}.map((e) => e.wireValue).toList()`;
      }
      if (refIsClass(item.$ref)) {
        return nullable ? `${fieldName}?.map((e) => e.toJson()).toList()` : `${fieldName}.map((e) => e.toJson()).toList()`;
      }
    }
    return fieldName;
  }
  return fieldName;
}

function writeGenerated(relativePath, content) {
  const outputPath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  return path.relative(root, outputPath).replaceAll('\\', '/');
}

const outputs = [
  writeGenerated('generated/typescript/models.ts', generateTypeScript()),
  writeGenerated('generated/dart/lib/smartcura_contracts.dart', generateDart()),
];

console.log(`Generated ${Object.keys(schemas).length} OpenAPI schemas:`);
outputs.forEach((output) => console.log(`- ${output}`));
