import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { BapFields, BapGenerateContext, BapSubtreeGenerator, BapSubtreeValue, BapTypeGenerator, BapTypeSpec, BapWriteAsStatementFunc, BapWriteIntoExpressionFunc } from "./bap-value";
import { getNodeLabel } from "./ts-helpers";
import { CodeBinaryOperator, CodeExpressionWriter, CodePrimitiveType, CodeScope, CodeScopeType, CodeTypeSpec, CodeVariable, CodeVariableGroup, CodeWriter } from './code-writer/code-writer';
import { BapIdentifierPrefix } from './bap-constants';
import { BapPrototypeScope, BapScope, BapThisSymbol } from './bap-scope';
import { BapRootContextMixin } from './bap-root-context-mixin';
import { BapVisitor, BapVisitorRootContext } from './bap-visitor';
import { makeGpuBindings } from './gpu-binding/make-bindings';
import { resolveBapFields } from './bap-utils';
import { GpuFixedBinding } from './gpu-binding/gpu-bindings';
import { BufferFiller } from './gpu-binding/buffer-filler';

type StructureKey = string;

export class BapTypes extends BapRootContextMixin {
  private readonly primitives;
  readonly basic;
  private readonly typesByStructureKey = new Map<StructureKey, BapTypeSpec>();
  private readonly typesByTsTypeKey = new Map<ts.Type, BapTypeGenerator>();
  private readonly externTypesByIdentifier = new Map<string, BapTypeGenerator>();
  private readonly resolvingSet = new Map<ts.Type, void>();
  debug?: {
    debugContext: BapGenerateContext;
  }

  constructor(context: BapVisitorRootContext) {
    super(context);

    const makePrimitive = (primitiveType: CodePrimitiveType): BapTypeSpec => {
      return {
        prototypeScope: new BapPrototypeScope(), // TODO: Fix!!!
        staticScope: new BapPrototypeScope(), // TODO: Fix!!!
        typeParameters: [],
        codeTypeSpec: CodeTypeSpec.fromPrimitive(primitiveType),
        isShadow: false,
        debugName: primitiveType,
        libType: {
          identifier: primitiveType,
          marshalSize: 4,
        },
      };
    };
    this.primitives = {
      [CodePrimitiveType.Void]: makePrimitive(CodePrimitiveType.Void),
      [CodePrimitiveType.Type]: makePrimitive(CodePrimitiveType.Type),
      [CodePrimitiveType.Function]: makePrimitive(CodePrimitiveType.Function),
      [CodePrimitiveType.Int]: makePrimitive(CodePrimitiveType.Int),
      [CodePrimitiveType.Bool]: makePrimitive(CodePrimitiveType.Bool),
      [CodePrimitiveType.CompileError]: makePrimitive(CodePrimitiveType.CompileError),
    } satisfies utils.EnumKeyRecord<CodePrimitiveType, BapTypeSpec>;


    const basics = (context: BapGenerateContext) => {
      const resolveBasicType = (identifier: string) => {
        return this.externTypesByIdentifier.get(identifier)?.generate(context, { allowTypeParameters: true }) ?? this.primitiveTypeSpec(CodePrimitiveType.CompileError);
      };
      const resolveInternalType = (identifier: string): BapTypeSpec => {
        return {
          prototypeScope: new BapPrototypeScope(),
          staticScope: new BapPrototypeScope(),
          typeParameters: [],
          codeTypeSpec: CodeTypeSpec.fromStruct(context.globalWriter.makeInternalToken(identifier)),
          isShadow: false,
          debugName: identifier,
          libType: {
            identifier: identifier,
          },
        };
      };
      const foundTypes = {
        float: resolveBasicType('float'),
        float2: resolveBasicType('float2'),
        float3: resolveBasicType('float3'),
        float4: resolveBasicType('float4'),
        int: resolveBasicType('int'),
        uint: resolveBasicType('uint'),

        Array: resolveBasicType('Array'),
        Texture: resolveBasicType('Texture'),
        MTLDevice: resolveInternalType('MTLDevice'),
        MTLFunction: resolveInternalType('MTLFunction'),
        MTLRenderPipelineDescriptor: resolveInternalType('MTLRenderPipelineDescriptor'),
        MTLRenderPassDescriptor: resolveInternalType('MTLRenderPassDescriptor'),
        MTLRenderCommandEncoder: resolveInternalType('MTLRenderCommandEncoder'),
        MTLPrimitiveTypeTriangle: resolveInternalType('MTLPrimitiveTypeTriangle'),
        MTLComputePipelineDescriptor: resolveInternalType('MTLComputePipelineDescriptor'),
        MTLComputePassDescriptor: resolveInternalType('MTLComputePassDescriptor'),
        MTLComputeCommandEncoder: resolveInternalType('MTLComputeCommandEncoder'),
        BufferFiller: resolveInternalType('BufferFiller'),
      };
      return {
        ...foundTypes,
        copyMarshallableSet: new Set([
          foundTypes.float,
          foundTypes.float2,
          foundTypes.float3,
          foundTypes.float4,
          foundTypes.int,
        ]),
      };
    };
    this.basic = basics;
  }

  primitiveType(primitiveType: CodePrimitiveType): BapTypeGenerator {
    return {
      generate: (context) => this.primitives[primitiveType],
      debug: {
        debugName: primitiveType,
      },
    };
  }

  primitiveTypeSpec(primitiveType: CodePrimitiveType): BapTypeSpec {
    return this.primitives[primitiveType];
  }

  addExternType(externIdentifier: string, tsType: ts.Type, typeGen: BapTypeGenerator) {
    this.typesByTsTypeKey.set(tsType, typeGen);
    this.externTypesByIdentifier.set(externIdentifier, typeGen);
  }

  // TODO: Move to type resolver with cache!!!
  type(nodeOrType: ts.Node|ts.Type): BapTypeGenerator {
    let tsType: ts.Type;
    let maybeNode = nodeOrType as ts.Node;
    let maybeType = nodeOrType as ts.Type;
    let fieldTypeOverrides: (() => Map<string, BapTypeGenerator>)|undefined;
    let fieldInitOverrides: (() => Map<string, ts.ObjectLiteralExpression>)|undefined;
    if (maybeNode.kind) {
      tsType = this.tc.getTypeAtLocation(maybeNode);
      if (ts.isObjectLiteralExpression(maybeNode)) {
        const properties = maybeNode.properties;
        fieldTypeOverrides = utils.lazy(() => {
          const map = new Map<string, BapTypeGenerator>();
          for (const p of properties) {
            if (ts.isPropertyAssignment(p)) {
              const field = p.name.getText();
              if (ts.isLiteralExpression(p.initializer) && p.initializer.kind === ts.SyntaxKind.NumericLiteral) {
                // BAD!!!
                const asInt = !p.initializer.getText(this.sourceRoot).includes('.');
                map.set(field, {
                  generate: (context) => {
                    const basics = this.basic(context);
                    return asInt ? basics.int : basics.float;
                  },
                  debug: {
                    debugName: asInt ? 'int' : 'float',
                  },
                })
              }
            }
          }
          return map;
        });
        fieldInitOverrides = utils.lazy(() => {
          const map = new Map<string, ts.ObjectLiteralExpression>();
          for (const p of properties) {
            if (ts.isPropertyAssignment(p)) {
              const field = p.name.getText();
              if (ts.isObjectLiteralExpression(p.initializer)) {
                map.set(field, p.initializer);
              }
            }
          }
          return map;
        });
      }
    } else {
      tsType = maybeType;
    }

    const isObject = (tsType.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object;
    const objectFlags = isObject ? (tsType as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
    const isReference = (objectFlags & ts.ObjectFlags.Reference) === ts.ObjectFlags.Reference;
    const isGeneric = isReference && ((tsType as ts.TypeReference)?.typeArguments?.length ?? 0) > 0;

    const generate = (context: BapGenerateContext): BapTypeSpec|undefined => {
      const basics = this.basic(context);
      const isObject = (tsType.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object;
      const objectFlags = isObject ? (tsType as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
      const isReference = (objectFlags & ts.ObjectFlags.Reference) === ts.ObjectFlags.Reference;
      const isClassOrInterface = !!(objectFlags & ts.ObjectFlags.ClassOrInterface);
      const isGeneric = isReference && ((tsType as ts.TypeReference)?.typeArguments?.length ?? 0) > 0;
      const genericBase: ts.BaseType|undefined = isReference ? ((tsType as any).target as ts.TypeReference) : undefined;
      const isGenericBase = isGeneric && genericBase === tsType;
      if (isGenericBase) {
        return this.errorType;
      }
      const requiresGenericLookup = isReference;
      const isTypeParameter = tsType.isTypeParameter();
      const requiresFullLookup = requiresGenericLookup || isTypeParameter;

      // let found: BapTypeSpec|undefined = undefined;
      let found = this.typesByTsTypeKey.get(tsType)?.generate(context);
      if (genericBase) {
        const baseTypeParams = (genericBase as ts.InterfaceType).typeParameters ?? [];
        const thisTypeArgs = (tsType as ts.TypeReference).typeArguments ?? [];
        if (!this.check(baseTypeParams.length === thisTypeArgs.length, `Mismatching type arguments.`)) {
          return this.errorType;
        }
        const typeArgGens = thisTypeArgs.map(t => this.type(t));
        const typeParameterNames = baseTypeParams?.map(t => t.symbol.getName());
        const typeArgData = utils.zip(typeParameterNames, typeArgGens);

        const innerContext = context.withChildScope();
        for (const [ name, arg ] of typeArgData) {
          const typeArgValue = arg.generate(context);
          innerContext.scope.declare(name, { type: 'type', isGenericTypeParameter: false, typeGen: { generate: () => typeArgValue, debug: { debugName: name, fixed: typeArgValue } } });
        }

        // typeParamsKey = this.toStructureKey(typeArgs);
        found ??= this.typesByTsTypeKey.get(genericBase)?.generate(innerContext);
      }
      // let found = !requiresFullLookup && this.typesByTsTypeKey.get(tsType)?.generate(context);
      // let found = this.typesByTsTypeKey.get(tsType) ?? this.typesByTsSymbolKey.get(tsType.symbol);
      if (found) {
        return found;
      }

      if (tsType === this.tc.getNumberType()) {
        // if (options?.willCoerceTo?.assignedFromBop) {
        //   const auxTypeInference = options.willCoerceTo.assignedFromBop.getAuxTypeInference?.();
        //   if (auxTypeInference?.numberType === BopInferredNumberType.Float) {
        //     return this.floatType;
        //   } else if (auxTypeInference?.numberType === BopInferredNumberType.Int) {
        //     return this.intType;
        //   }
        // }
        // return this.intType;
        found = this.primitiveTypeSpec(CodePrimitiveType.Int);
      }

      if ((tsType.flags & ts.TypeFlags.NumberLiteral) === ts.TypeFlags.NumberLiteral) {
        found = this.primitiveTypeSpec(CodePrimitiveType.Int);
      } else if ((tsType.flags & ts.TypeFlags.BooleanLiteral) === ts.TypeFlags.BooleanLiteral) {
        found = this.primitiveTypeSpec(CodePrimitiveType.Bool);
      } else if ((tsType.flags & ts.TypeFlags.Undefined) === ts.TypeFlags.Undefined) {
        // found = this.primitiveType(CodePrimitiveType.Undefined);
      } else if ((tsType.flags & ts.TypeFlags.Void) === ts.TypeFlags.Void) {
        found = this.primitiveTypeSpec(CodePrimitiveType.Void);
      }
      if (found) {
        return found;
      }

      const parentCodeScope = context.globalWriter.global.scope;
      const shortName = this.stringifyType(tsType, { short: true }).slice(0, 24);

      // Create a new type.
      if (!this.check((tsType.flags & ts.TypeFlags.Any) !== ts.TypeFlags.Any, `Type ${utils.stringEmptyToNull(shortName) ?? 'any'} is disallowed.`)) {
        return;
        // return options?.allowWouldBeAny ? this.wouldBeAnyType : this.errorType;
      }
      if (!this.check(!this.resolvingSet.has(tsType), `Type ${shortName} is recursive.`)) {
        return this.errorType;
      }

      this.resolvingSet.set(tsType);
      try {
        // Lookup cached generic instantiations.
        // Coalesce backing storage structs.
        const fields: BapFields = [];
        let constructorDecl: ts.ConstructorDeclaration|undefined;
        let methodDecls: ts.MethodDeclaration[] = [];
        for (const property of ((tsType as any).members as ts.SymbolTable) ?? tsType.symbol?.members ?? []) {
          const propertyName = property[0].toString();
          const propertySymbol = property[1];
          const propertyDecl = propertySymbol.declarations?.at(0);
          if (!this.verifyNotNulllike(propertyDecl, `Cannot determine type for property ${propertyName}.`)) {
            // return this.errorType;
            return;
          }
          if (ts.isTypeParameterDeclaration(propertyDecl)) {
            continue;
          }
          if (ts.isMethodDeclaration(propertyDecl)) {
            methodDecls.push(propertyDecl);
            continue;
          }
          if (ts.isConstructorDeclaration(propertyDecl)) {
            continue;
          }
          let propertySymbolType = this.tc.getTypeOfSymbol(propertySymbol);
          let propertyType: BapTypeSpec|undefined;
          // if (propertySymbolType.isTypeParameter()) {
          //   propertyType = resolveInnerTypeRef(propertySymbolType);
          // }
          // propertyType ??= this.type(propertySymbolType, { willCoerceTo: options?.willCoerceFieldsTo?.get(propertyName) });
          propertyType ??= fieldTypeOverrides?.().get(propertyName)?.generate(context);
          propertyType ??= this.type(fieldInitOverrides?.()?.get(propertyName) ?? propertySymbolType)?.generate(context) ?? this.errorType;
          // const propertyType = this.resolveType(this.tc.getTypeAtLocation(propertyDecl));
          fields.push({ type: propertyType, identifier: propertyName });
        }
        // Sometimes the constructor disappears from everything but the symbol.
        for (const property of tsType.symbol?.members ?? []) {
          const propertyName = property[0].toString();
          const propertySymbol = property[1];
          const propertyDecl = propertySymbol.declarations?.at(0);
          if (!this.verifyNotNulllike(propertyDecl, `Cannot determine type for property ${propertyName}.`)) {
            return this.errorType;
          }
          if (ts.isConstructorDeclaration(propertyDecl)) {
            constructorDecl = propertyDecl;
            continue;
          }
        }

        const structureKey = this.toStructureKey(fields);
        found = this.typesByStructureKey.get(structureKey);
        if (found) {
          return found;
        }

        let fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BapTypeSpec }>;
        let identifier: CodeVariable;
        let innerCodeScope: CodeScope;
        const methodFuncs: Array<() => void> = [];
        {
          identifier = parentCodeScope.allocateVariableIdentifier(CodeTypeSpec.typeType, BapIdentifierPrefix.Struct, shortName);
          innerCodeScope = parentCodeScope.createChildScope(CodeScopeType.Class);
          fieldIdentifierMap = new Map();
          for (const property of fields) {
            const typeSpec = property.type;
            if (!this.verifyNotNulllike(typeSpec, `Field ${property.identifier} does not have a valid type.`)) {
              continue;
            }
            const fieldIdentifier = innerCodeScope.allocateVariableIdentifier(typeSpec.codeTypeSpec, BapIdentifierPrefix.Field, property.identifier);
            fieldIdentifierMap.set(property.identifier, { fieldVar: fieldIdentifier, fieldType: typeSpec });
          }
        }
        const structWriterOuter = context.globalWriter.global.writeStruct(identifier.identifierToken);
        // structWriterOuter.touchedByProxy = {
        //   get touchedByCpu() { return true; },
        //   get touchedByGpu() { return false; },
        // };
        const structWriter = structWriterOuter.body;

        for (const [identifier, property] of fieldIdentifierMap) {
          structWriter.writeField(property.fieldVar.identifierToken, property.fieldVar.typeSpec);
        }


        const marshalFuncVar = context.globalWriter.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BapIdentifierPrefix.Function, `marshal_${shortName}`);
        let marshalByteSize = 0;
        let ensuredMarshalable = false;
        const ensureMarshalable = (bapVisitor: BapVisitor) => {
          if (ensuredMarshalable) {
            return;
          }
          ensuredMarshalable = true;
          const fields = resolveBapFields(newType, context);
          for (const field of fields) {
            field.type?.marshal?.ensureMarshalable(bapVisitor);
          }
          const bindings = makeGpuBindings.bind(bapVisitor)(context, newType);
          const elementBinding = bindings.bindings.find(b => b.type === 'fixed') as GpuFixedBinding|undefined;
          if (!elementBinding) {
            return;
          }

          const marshalFunc = context.globalWriter.global.writeFunction(marshalFuncVar.identifierToken);
          marshalFunc.touchedByCpu = true;

          const codeTypeSpec = CodeTypeSpec.fromStruct(identifier.identifierToken);
          const funcScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Function);
          const valueVar = funcScope.allocateVariableIdentifier(codeTypeSpec, BapIdentifierPrefix.Local, 'value');
          marshalFunc.addParam(valueVar.typeSpec, valueVar.identifierToken);
          const bufferFillerVar = funcScope.allocateVariableIdentifier(basics.BufferFiller.codeTypeSpec, BapIdentifierPrefix.Local, 'bufferFiller');
          marshalFunc.addParam(bufferFillerVar.typeSpec, bufferFillerVar.identifierToken);
          const indexVar = funcScope.allocateVariableIdentifier(basics.int.codeTypeSpec, BapIdentifierPrefix.Local, 'index');
          marshalFunc.addParam(indexVar.typeSpec, indexVar.identifierToken);
          const funcBody = marshalFunc.body;

          const bufferFiller = new BufferFiller(context, bufferFillerVar);

          const baseOffsetVar = funcBody.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BapIdentifierPrefix.Local, 'baseOffset');
          const baseOffset = funcBody.writeVariableDeclaration(baseOffsetVar).initializer.writeExpression().writeBinaryOperation(CodeBinaryOperator.Multiply);
          baseOffset.lhs.writeVariableReference(indexVar);
          baseOffset.rhs.writeLiteralInt(elementBinding.byteLength);
          bufferFiller.baseOffsetVar = baseOffsetVar;
          elementBinding.marshal(valueVar, bufferFiller, funcBody);
          marshalByteSize = elementBinding.byteLength;
        };
        structWriter.writeStaticConstant(context.globalWriter.makeInternalToken('marshalBytesInto'), CodeTypeSpec.functionType, () => {
          return (expr: CodeExpressionWriter) => {
            if (ensuredMarshalable) {
              expr.writeVariableReference(marshalFuncVar);
            } else {
              expr.writeLiteralInt(0);
            }
          };
        });
        structWriter.writeStaticConstant(context.globalWriter.makeInternalToken('marshalByteStride'), CodeTypeSpec.functionType, () => {
          return (expr: CodeExpressionWriter) => {
            expr.writeLiteralInt(marshalByteSize);
          };
        });

        const prototypeScope = new BapPrototypeScope();
        const staticScope = new BapPrototypeScope();
        for (const property of fields) {
          const fieldIdentifier = fieldIdentifierMap.get(property.identifier)!;

          const generateWrite = (context: BapGenerateContext, value: BapSubtreeValue): BapWriteAsStatementFunc => {
            const thisValue = context.scope.resolve(BapThisSymbol);
            return (prepare) => {
              const thisWriter = thisValue?.writeIntoExpression?.(prepare);
              const valueWriter = value.writeIntoExpression?.(prepare);
              return (block) => {
                const assignStmt = block.writeAssignmentStatement();
                thisWriter?.(assignStmt.ref.writePropertyAccess(fieldIdentifier.fieldVar.identifierToken).source);
                valueWriter?.(assignStmt.value);
              };
            };
          };

          prototypeScope.declare(property.identifier, {
            isField: true,
            token: fieldIdentifier.fieldVar.identifierToken,
            genType: { generate: () => fieldIdentifier.fieldType, debug: { debugName: fieldIdentifier.fieldType.debugName, fixed: fieldIdentifier.fieldType } },
            gen: (bindScope) => ({
              generateRead: (context: BapGenerateContext): BapSubtreeValue => {
                const thisValue = bindScope.resolve(BapThisSymbol);
                return {
                  type: 'cached',
                  typeSpec: property.type,
                  writeIntoExpression: (prepare) => {
                    const thisWriter = thisValue?.writeIntoExpression?.(prepare);
                    return (expr) => {
                      const propAccessExpr = expr.writePropertyAccess(fieldIdentifier.fieldVar.identifierToken);
                      thisWriter?.(propAccessExpr.source);
                    };
                  },
                  generateWrite: (value): BapWriteAsStatementFunc => generateWrite(context, value),
                };
              },
              generateWrite: generateWrite,
            }),
          });
        }

        const newType: BapTypeSpec = {
          prototypeScope: prototypeScope,
          staticScope: staticScope,
          typeParameters: [],
          codeTypeSpec: CodeTypeSpec.fromStruct(identifier.identifierToken),
          isShadow: false,
          debugName: shortName,
          marshal: {
            ensureMarshalable
          },
        };
        this.typesByTsTypeKey.set(tsType, { generate: (context) => newType, debug: { debugName: shortName, fixed: newType } });
        this.typesByStructureKey.set(structureKey, newType);
        return newType;
      } finally {
        this.resolvingSet.delete(tsType);
      }
      return this.errorType;
    };
    return {
      generate: generate,
      debug: {
        fixed: (isGeneric || !this.debug?.debugContext) ? undefined : generate(this.debug.debugContext),
        debugName: this.stringifyType(tsType),
      },
    };
  }

  private typeParameterTypeSpecMap = new Map<string, BapTypeSpec>();

  makeTypeParameterTypeSpec(t: string): BapTypeSpec {
    const oldTypeSpec = this.typeParameterTypeSpecMap.get(t);
    if (oldTypeSpec) {
      return oldTypeSpec;
    }
    const newTypeSpec: BapTypeSpec = {
      prototypeScope: this.types.errorType.prototypeScope,
      staticScope: this.types.errorType.staticScope,
      typeParameters: [],
      codeTypeSpec: this.types.errorType.codeTypeSpec,
      isShadow: false,
      debugName: t
    };
    this.typeParameterTypeSpecMap.set(t, newTypeSpec);
    return newTypeSpec;
  }

  private structureKeyIdMap = new Map<BapTypeSpec, number>();

  toStructureKey(fields: BapFields) {
    let structureKey = '';
    for (const entry of fields) {
      const lookupType = entry.type;
      let typeKey = lookupType;
      let typeId = this.structureKeyIdMap.get(typeKey);
      if (typeId === undefined) {
        typeId = this.structureKeyIdMap.size;
        this.structureKeyIdMap.set(typeKey, typeId);
      }
      let structureKeyPart = `${entry.identifier}:${typeId},`;
      // if (lookupType.isConst) {
      //   structureKeyPart = `const ${structureKeyPart}`;
      // }
      // if (lookupType.isReference) {
      //   structureKeyPart += '&';
      // }
      // if (lookupType.isPointer) {
      //   structureKeyPart += '*';
      // }
      // if (lookupType.isArray) {
      //   structureKeyPart += '[]';
      // }
      structureKey += structureKeyPart;
    }
    return structureKey;
  }

  get errorType(): BapTypeSpec {
    return this.primitives[CodePrimitiveType.CompileError];
  }
}
