import { BapTypeSpec, BapGenerateContext, BapFields } from './bap-value';


export function resolveBapFields(type: BapTypeSpec, context: BapGenerateContext): BapFields {
  const fields: BapFields = [];
  for (const [fieldName, member] of type.prototypeScope.allFields) {
    if (!member.isField || typeof fieldName !== 'string') {
      continue;
    }
    const fieldType = member.genType.generate(context);
    if (!fieldType) {
      continue;
    }
    fields.push({
      identifier: fieldName,
      type: fieldType,
    });
  }
  return fields;
}
