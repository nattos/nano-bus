import * as utils from '../utils';
import * as ts from "typescript";
import { CodeBinaryOperator, CodeFunctionWriter, CodeNamedToken, CodePrimitiveType, CodeScope, CodeScopeType, CodeStatementWriter, CodeTypeSpec, CodeVariable, CodeWriter } from './code-writer';





interface BopResult {
  expressionResult?: BopVariable;
  thisResult?: BopVariable;
}

interface BopStage {
  createScopes?(): void;
  mapIdentifiers?(): void;
  resolveIdentifiers?(): void;
  resolveStorage?(): void;
  produceResult?(): BopResult|undefined;

  isAssignableRef?: boolean;

  resolvedIdentifiers?: boolean;
}

class BopGenericFunctionInstance {
  constructor(
    public readonly typeParameters: BopFields,
    public readonly functionVar: BopVariable,
  ) {}
}

type BopGenericFunctionWriter = (typeParameters: BopFields) => BopVariable;

class BopGenericFunction {
  readonly instantiations = new Map<string, BopGenericFunctionInstance>();

  constructor(
    public readonly instanceWriter: BopGenericFunctionWriter,
  ) {}
}

class BopPropertyAccessor {
  constructor(
    public readonly getter: BopVariable,
    public readonly setter: BopVariable,
  ) {}
}

class BopVariable {
  result?: CodeVariable;
  typeResult?: BopType;
  genericFunctionResult?: BopGenericFunction;
  propertyResult?: BopPropertyAccessor;

  constructor(
    public readonly nameHint: string,
    public readonly type: CodeTypeSpec,
    public readonly bopType: BopType,
    public group: BopVariableGroup,
  ) {}
}

class BopVariableGroup {
  public readonly vars: BopVariable[] = [];

  constructor(
    public block: BopBlock,
  ) {}
}

class BopBlock {
  readonly children: Array<BopStage|BopBlock> = [];
  readonly identifierMap = new Map<string, BopVariable>();
  thisRef?: BopVariable;

  private constructor(
    public readonly scopeType: CodeScopeType,
    public readonly parent: BopBlock|undefined,
  ) {}

  createChildBlock(scopeType: CodeScopeType) {
    const newBlock = new BopBlock(scopeType, this);
    this.children.push(newBlock);
    return newBlock;
  }

  createTempBlock(scopeType: CodeScopeType) {
    const newBlock = new BopBlock(scopeType, this);
    return newBlock;
  }

  static createGlobalBlock() {
    return new BopBlock(CodeScopeType.Global, undefined);
  }

  mapStorageIdentifier(identifier: string, bopType: BopType, anonymous = false): BopVariable {
    return this.mapIdentifier(identifier, bopType.storageType, bopType, anonymous);
  }

  mapTempIdentifier(identifier: string, bopType: BopType, anonymous = false): BopVariable {
    return this.mapIdentifier(identifier, bopType.tempType, bopType, anonymous);
  }

  mapIdentifier(identifier: string, type: CodeTypeSpec, bopType: BopType, anonymous = false): BopVariable {
    const newGroup = new BopVariableGroup(this);
    const newVar = new BopVariable(identifier, type, bopType, newGroup);
    newGroup.vars.push(newVar);
    if (!anonymous) {
      this.identifierMap.set(identifier, newVar);
    }
    return newVar;
  }
}

enum BopIdentifierPrefix {
  Function = 'F',
  Method = 'M',
  Constructor = 'ctor',
  Field = 'f',
  Local = 'v',
  Struct = 's',
  Extern = 'extern',
}

class BopReference {
  public resolvedRef?: BopVariable;

  constructor(
    public readonly identifier: string,
    public readonly block: BopBlock,
  ) {}
}

class BopTypeUnion {
  public constructor(
    caseVarsMap: Map<BopType, { caseVar: CodeVariable, caseIndex: number }>,
    caseVariable: CodeVariable,
  ) {}
}

class BopFunctionType {
  public constructor(
    public readonly args: BopFields,
    public readonly returnType: BopType,
    public readonly isMethod: boolean,
  ) {}
}

class BopType {
  private constructor(
    public readonly debugName: string,
    public readonly storageType: CodeTypeSpec,
    public readonly tempType: CodeTypeSpec,
    public readonly assignableRefType: CodeTypeSpec,
    public readonly passByRef: boolean,
    public readonly innerScope: CodeScope,
    public readonly innerBlock: BopBlock,
    public readonly functionOf: BopFunctionType|undefined,
    public readonly unionOf: BopTypeUnion|undefined,
  ) {}

  static createPassByRef(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType.toReference(),
      options.valueType.toReference(),
      true,
      options.innerScope,
      options.innerBlock,
      undefined,
      undefined,
    );
  }

  static createPassByValue(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType,
      options.valueType.toReference(),
      false,
      options.innerScope,
      options.innerBlock,
      undefined,
      undefined,
    );
  }

  static createTypeUnion(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    unionOf: BopTypeUnion,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType,
      options.valueType.toReference(),
      false,
      options.innerScope,
      options.innerBlock,
      undefined,
      options.unionOf,
    );
  }

  static createFunctionType(options: {
    debugName: string,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    functionOf: BopFunctionType,
  }): BopType {
    return new BopType(
      options.debugName,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      false,
      options.innerScope,
      options.innerBlock,
      options.functionOf,
      undefined,
    );
  }
}

type BopFields = Array<{ type: BopType, identifier: string }>;

type BopInternalTypeBuilder = {
  type: BopType,
  declareField(identifier: string, type: BopType): BopVariable,
  declareConstructor(params: BopFields): CodeFunctionWriter,
  declareMethod(identifier: string, params: BopFields, returnType: BopType): CodeFunctionWriter,
  declareInternalField(identifier: string, type: BopType): void,
  declareInternalConstructor(params: BopFields, internalIdentifier: string): void,
  declareInternalMethod(identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType): void,
  declareGenericMethod(identifier: string, genericFunc: BopGenericFunction): void,
  declareInternalProperty(identifier: string, type: BopType): BopVariable,
};







class BopProcessor {
  private readonly tc: ts.TypeChecker;
  private readonly writer = new CodeWriter();
  private blockWriter: CodeStatementWriter;
  private block: BopBlock;
  private scopeReturnType: BopType;
  private asAssignableRef = false;
  private globalBlock: BopBlock;
  private unrolledBlocks?: BopStage[];

  private readonly errorType;
  private readonly typeType;
  private readonly functionType;
  private readonly voidType;
  private readonly booleanType;
  private readonly intType;
  private readonly undefinedType;
  private readonly undefinedConstant;
  private readonly resultMap = new Map<BopStage, BopResult>();

  constructor(
    public readonly program: ts.Program,
    public readonly sourceRoot: ts.SourceFile,
  ) {
    this.tc = program.getTypeChecker();
    sourceRoot.statements.forEach(this.printRec.bind(this));

    const initFunc = this.writer.global.writeFunction(this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Function, 'init'));
    this.blockWriter = initFunc.body;
    this.globalBlock = BopBlock.createGlobalBlock();
    this.block = this.globalBlock;

    // Map intrinsic types.
    this.errorType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
    this.functionType = this.createPrimitiveType(CodeTypeSpec.functionType);
    this.typeType = this.createPrimitiveType(CodeTypeSpec.typeType);
    this.typeMap.set(this.tc.getVoidType(), this.voidType = this.createPrimitiveType(CodeTypeSpec.voidType));
    this.typeMap.set(this.tc.getBooleanType(), this.booleanType = this.createPrimitiveType(CodeTypeSpec.boolType));
    this.undefinedType = this.createInternalType({ identifier: 'UndefinedType', anonymous: true }).type;
    this.undefinedConstant = this.createInternalConstant({ identifier: 'undefined', internalIdentifier: 'kUndefinedValue', type: this.undefinedType });

    const bopLibRoot = program.getSourceFile('default.d.ts');

    {
      // type ResolvedType = { name: string, typeArgs: ResolvedType[] };
      type ResolvedType = { name?: string, bopType?: BopType, typeArgs: ResolvedType[] };
      type TypeResolver = (typeArgs: ResolvedType[]) => ResolvedType;
      type MethodParameterTypeResolver = (typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]) => ResolvedType;
      type PropertyResolver = () => BopType;
      type TypeInfo = {
        name: string,
        typeParameters: string[],
        expandFrom: Array<{ typeName: string, typeArgs: TypeResolver[], asStatic: boolean }>,
        methods: Array<{
          name: string,
          typeParameters: string[],
          parameters: Array<{ name: string, type: MethodParameterTypeResolver }>,
          returnType: MethodParameterTypeResolver,
          isConstructor: boolean,
          isStatic: boolean,
        }>,
        properties: { name: string, type: TypeResolver}[],
      };

      const errorType = { name: 'error', typeArgs: [] };
      const remappedTypes = new Map<string, string>([
        [ 'Swizzlable2<boolean>', 'boolean2' ],
        [ 'Swizzlable2<int>', 'int2' ],
        [ 'Swizzlable2<float>', 'float2' ],
        [ 'Swizzlable3<boolean>', 'boolean3' ],
        [ 'Swizzlable3<int>', 'int3' ],
        [ 'Swizzlable3<float>', 'float3' ],
        [ 'Swizzlable4<boolean>', 'boolean4' ],
        [ 'Swizzlable4<int>', 'int4' ],
        [ 'Swizzlable4<float>', 'float4' ],
      ]);

      const toStringResolvedType = (type: ResolvedType) => {
        let result = type.name ?? type.bopType?.debugName ?? 'unknown';
        if (type.typeArgs.length > 0) {
          result += `<${type.typeArgs.map(t => toStringResolvedType(t)).join(', ')}>`;
        }
        return result;
      };
      const resolveStaticType = (typeNode: ts.TypeNode): ResolvedType => {
        if (!ts.isTypeReferenceNode(typeNode)) {
          return errorType;
        }
        const typeName = typeNode.typeName.getText();
        const typeArgs = (typeNode.typeArguments ?? []).map(t => resolveStaticType(t));

        const foundBaseType = libTypes.get(typeName);
        if (!foundBaseType) {
          return errorType;
        }
        const result = { name: foundBaseType.name, typeArgs: typeArgs };

        const foundRemapped = remappedTypes.get(toStringResolvedType(result));
        if (foundRemapped) {
          const remapToType = libTypes.get(foundRemapped);
          if (!remapToType) {
            return errorType;
          }
          return { name: remapToType.name, typeArgs: [] };
        }
        return result;
      }

      const libTypes = new Map<string, TypeInfo>();
      const libConstructorDecls: Array<{ typeName: string, constructorTypeResolver: () => ResolvedType }> = [];
      for (const statement of bopLibRoot?.statements ?? []) {
        if (ts.isInterfaceDeclaration(statement)) {
          const typeName = statement.name.text;
          let foundType = libTypes.get(typeName);
          if (!foundType) {
            foundType = {
              name: typeName,
              typeParameters: (statement.typeParameters ?? []).map(t => t.name.text),
              expandFrom: [],
              methods: [],
              properties: [],
            };
            libTypes.set(typeName, foundType);
          }
          const type = foundType;

          const typeParameterMap = new Map<string, number>();
          for (let i = 0; i < type.typeParameters.length; ++i) {
            typeParameterMap.set(type.typeParameters[i], i);
          }

          const makeTypeResolver = (typeNode: ts.TypeNode, otherResolver?: (identifier: string) => ResolvedType|undefined): TypeResolver => {
            if (ts.isUnionTypeNode(typeNode)) {
              return (typeArgs) => {
                const typeArgBlock = this.globalBlock.createTempBlock(CodeScopeType.Class);
                for (const [typeParameterName, index] of typeParameterMap) {
                  const typeArg = typeArgs[index];
                  const typeArgType = resolveNewBopType(typeArg);
                  typeArgBlock.mapIdentifier(typeParameterName, CodeTypeSpec.typeType, this.typeType).typeResult = typeArgType;
                }
                return utils.upcast({ bopType: this.resolveType(this.tc.getTypeAtLocation(typeNode), typeArgBlock), typeArgs: [] })
              };
            }
            const existingType = this.typeMap.get(this.tc.getTypeFromTypeNode(typeNode));
            if (existingType) {
              return () => utils.upcast({ bopType: existingType, typeArgs: [] });
            }
            if (!ts.isTypeReferenceNode(typeNode)) {
              return () => errorType;
            }
            const typeName = typeNode.typeName.getText();
            const typeParamIndex = typeParameterMap.get(typeName);
            const typeArgResolvers = (typeNode.typeArguments ?? []).map(t => makeTypeResolver(t, otherResolver));
            return (typeArgs: ResolvedType[]) => {
              const otherResolved = otherResolver?.(typeName);
              if (otherResolved) {
                return otherResolved;
              }
              if (typeParamIndex !== undefined) {
                const resolvedAsTypeArg = typeArgs.at(typeParamIndex);
                if (typeArgResolvers.length > 0) {
                  return errorType;
                }
                return resolvedAsTypeArg ?? errorType;
              }

              const foundBaseType = libTypes.get(typeName);
              if (!foundBaseType) {
                return errorType;
              }
              const refTypeArgs = typeArgResolvers.map(e => e(typeArgs));
              const result = { name: foundBaseType.name, typeArgs: refTypeArgs };

              const foundRemapped = remappedTypes.get(toStringResolvedType(result));
              if (foundRemapped) {
                const remapToType = libTypes.get(foundRemapped);
                if (!remapToType) {
                  return errorType;
                }
                return { name: remapToType.name, typeArgs: [] };
              }
              return result;
            };
          };

          for (const inherits of statement.heritageClauses ?? []) {
            for (const inheritExpr of inherits.types) {
              type.expandFrom.push({
                typeName: inheritExpr.expression.getText(),
                typeArgs: (inheritExpr.typeArguments ?? []).map(t => makeTypeResolver(t)),
                asStatic: false,
              });
            }
          }

          for (const member of statement.members) {
            if (ts.isMethodSignature(member) ||
                ts.isConstructSignatureDeclaration(member)) {
              const isConstructor = ts.isConstructSignatureDeclaration(member);
              const methodTypeParameters = (member.typeParameters ?? []).map(t => t.name.text);
              const methodTypeParameterMap = new Map<string, number>();
              for (let i = 0; i < methodTypeParameters.length; ++i) {
                methodTypeParameterMap.set(methodTypeParameters[i], i);
              }

              const makeMethodTypeResolver = (typeNode: ts.TypeNode|undefined): MethodParameterTypeResolver => {
                if (!typeNode) {
                  return () => errorType;
                }
                let innerMethodTypeArgs: ResolvedType[];
                const innerResolver = makeTypeResolver(typeNode, identifier => {
                  const methodTypeParameterIndex = methodTypeParameterMap.get(identifier);
                  if (methodTypeParameterIndex !== undefined) {
                    return innerMethodTypeArgs!.at(methodTypeParameterIndex);
                  }
                  return undefined;
                });
                return (typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]) => {
                  innerMethodTypeArgs = methodTypeArgs;
                  return innerResolver(typeTypeArgs);
                };
              };

              const parameters = member.parameters.map(p => utils.upcast({
                name: p.name.getText(),
                type: makeMethodTypeResolver(p.type!),
              }));
              const returnType = makeMethodTypeResolver(member.type);

              const propName = isConstructor ? 'constructor' : member.name.getText();
              type.methods.push({
                name: propName,
                typeParameters: methodTypeParameters,
                parameters: parameters,
                returnType: returnType,
                isConstructor: isConstructor,
                isStatic: false,
              });
            } else if (ts.isPropertySignature(member)) {
              // TODO: Handle static properties.
              if (!member.type || !ts.isTypeReferenceNode(member.type)) {
                continue;
              }
              const propName = member.name.getText();
              type.properties.push({
                name: propName,
                type: makeTypeResolver(member.type),
              });
            }
          }
        } else if (ts.isVariableStatement(statement)) {
          if (!statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) {
            continue;
          }
          for (const decl of statement.declarationList.declarations) {
            if (!decl.type) {
              continue;
            }
            if (!ts.isTypeReferenceNode(decl.type)) {
              continue;
            }
            const intoTypeName = decl.name.getText();
            const typeArgs = (decl.type.typeArguments ?? []);
            libConstructorDecls.push({
              typeName: intoTypeName,
              constructorTypeResolver: () => {
                return resolveStaticType(decl.type!);
              },
            });
          }
        }
      }

      for (const constructorDecls of libConstructorDecls) {
        const type = libTypes.get(constructorDecls.typeName);
        if (!type) {
          continue;
        }
        const fromType = constructorDecls.constructorTypeResolver();
        type.expandFrom.push({
          typeName: fromType.name!,
          typeArgs: fromType.typeArgs.map(t => () => t),
          asStatic: true,
        });
      }

      const expandFromRec = (intoType: TypeInfo, fromTypes: Array<{ typeName: string, typeArgs: TypeResolver[], asStatic: boolean }>) => {
        for (const entry of fromTypes) {
          const fromTypeName = entry.typeName;
          const fromType = libTypes.get(fromTypeName);
          if (!fromType) {
            continue;
          }

          const translateTypeResolver = (inner: TypeResolver): TypeResolver => {
            return (typeArgs: ResolvedType[]): ResolvedType => {
              return inner(entry.typeArgs.map(a => a(typeArgs)));
            };
          };
          const translateMethodTypeResolver = (inner: MethodParameterTypeResolver): MethodParameterTypeResolver => {
            return (typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]): ResolvedType => {
              return inner(entry.typeArgs.map(a => a(typeTypeArgs)), methodTypeArgs);
            };
          };

          for (const method of fromType.methods) {
            intoType.methods.push({
              name: method.name,
              typeParameters: method.typeParameters,
              parameters: method.parameters.map(p => utils.upcast({
                name: p.name,
                type: translateMethodTypeResolver(p.type),
              })),
              returnType: translateMethodTypeResolver(method.returnType),
              isConstructor: method.isConstructor,
              isStatic: method.isStatic || entry.asStatic,
            });
          }

          for (const prop of fromType.properties) {
            intoType.properties.push({
              name: prop.name,
              type: translateTypeResolver(prop.type),
            });
          }

          expandFromRec(intoType, fromType.expandFrom);
        }
      };
      for (const type of libTypes.values()) {
        expandFromRec(type, type.expandFrom);
      }



      const newBopTypeMap = new Map<string, { bopType?: BopType, genericInstantiator?: (typeArgs: ResolvedType[]) => BopType }>();
      const newConcreteTypes: Array<() => void> = [];
      const resolveNewBopType = (resolved: ResolvedType): BopType|undefined =>  {
        if (resolved.bopType) {
          return resolved.bopType;
        }
        if (!resolved.name) {
          return undefined;
        }
        const newType = newBopTypeMap.get(resolved.name);
        if (!newType) {
          return undefined;
        }
        if (newType.bopType) {
          return newType.bopType;
        }
        if (newType.genericInstantiator) {
          return newType.genericInstantiator(resolved.typeArgs);
        }
        return undefined;
      };
      const resolveMethodParamType = (p: MethodParameterTypeResolver, typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]): BopType|undefined => {
        const resolved = p(typeTypeArgs, methodTypeArgs);
        return resolveNewBopType(resolved);
      };


      for (const type of libTypes.values()) {
        const instantiateIntoType = (instantiatedTypeName: string, newType: BopInternalTypeBuilder, typeArgs: ResolvedType[]): BopType => {
          const instantiatedType = newType.type;
          for (const method of type.methods) {
            const methodName = method.name;
            const debugMethodName = `${instantiatedTypeName}::${methodName}`;

            if (method.typeParameters.length === 0 || method.isConstructor) {
              const methodTypeArgs: ResolvedType[] = [];
              const params: BopFields = method.parameters.map(p => {
                const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
                return { identifier: p.name, type: paramType ?? this.errorType };
              });
              let returnType: BopType|undefined;
              if (method.isConstructor) {
                returnType = newType.type;
              } else {
                returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? this.errorType;
              }
              if (method.isConstructor) {
                newType.declareInternalConstructor(params, debugMethodName);
              } else {
                newType.declareInternalMethod(method.name, debugMethodName, params, returnType);
              }
            } else {
              const genericFunc = new BopGenericFunction((typeParameters: BopFields) => {
                const isMethod = true;

                // Resolve generic params into concrete ones now that we have all type args.
                const methodTypeArgs: ResolvedType[] = typeParameters.map(t => utils.upcast({ bopType: t.type, typeArgs: [] }));
                const paramDecls: BopFields = method.parameters.map(p => {
                  const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
                  return { identifier: p.name, type: paramType ?? this.errorType };
                });
                if (isMethod) {
                  paramDecls.splice(0, 0, { identifier: 'this', type: instantiatedType });
                }
                const returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? this.errorType;

                // Create the BopType to represent the concrete function, and map it in the global scope.
                const debugInstantiatedMethodName = `${debugMethodName}<${methodTypeArgs.map(t => toStringResolvedType(t)).join(',')}>`;
                const newFunctionType = BopType.createFunctionType({
                  debugName: debugInstantiatedMethodName,
                  innerScope: this.writer.global.scope.createChildScope(CodeScopeType.Local),
                  innerBlock: this.globalBlock.createChildBlock(CodeScopeType.Local),
                  functionOf: new BopFunctionType(
                    paramDecls,
                    returnType,
                    isMethod,
                  ),
                });

                const concreteFunctionVar = this.globalBlock.mapTempIdentifier(debugInstantiatedMethodName, newFunctionType, /* anonymous */ true);
                const concreteFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, debugInstantiatedMethodName);
                concreteFunctionVar.result = concreteFunctionIdentifier;

                // Write the trampoline function body.
                const funcScope = this.writer.global.scope.createChildScope(CodeScopeType.Function);
                const func = this.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
                func.returnTypeSpec = returnType.storageType;
                const paramVars: CodeVariable[] = [];
                for (const param of paramDecls) {
                  const paramVar = funcScope.allocateVariableIdentifier(param.type.assignableRefType, BopIdentifierPrefix.Local, param.identifier);
                  func.addParam(paramVar.typeSpec, paramVar.identifierToken);
                  paramVars.push(paramVar);
                }
                const externIdentifier = funcScope.allocateIdentifier(BopIdentifierPrefix.Extern, debugInstantiatedMethodName);
                const externFuncCall = func.body.writeExpressionStatement().expr.writeStaticFunctionCall(externIdentifier);
                for (const typeArg of methodTypeArgs) {
                  let typeArgType: CodeTypeSpec|undefined;
                  // TODO: Fix this crude resolution.
                  if (typeArg.name) {
                    typeArgType = resolveNewBopType({ name: typeArg.name, typeArgs: [] })?.storageType;
                  } else {
                    typeArgType = typeArg.bopType?.storageType;
                  }
                  typeArgType ??= CodeTypeSpec.compileErrorType;
                  externFuncCall.addTemplateArg(typeArgType);
                }
                for (const param of paramVars) {
                  externFuncCall.addArg().writeVariableReference(param);
                }
                this.writer.mapInternalToken(externIdentifier, debugMethodName);

                return concreteFunctionVar;
              });
              newType.declareGenericMethod(methodName, genericFunc);
            }
          }

          for (const propDecl of type.properties) {
            const propName = propDecl.name;
            const propType = resolveNewBopType(propDecl.type(typeArgs)) ?? this.errorType;
            const propVar = newType.declareInternalProperty(propName, propType);

            const getterName = `${instantiatedTypeName}::get_${propName}`;
            const setterName = `${instantiatedTypeName}::set_${propName}`;

            const getterType = BopType.createFunctionType({
              debugName: getterName,
              innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
              innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
              functionOf: new BopFunctionType(
                [],
                propType,
                /* isMethod */ true,
              ),
            });
            const getterBopVar = newType.type.innerBlock.mapIdentifier(getterType.debugName, getterType.tempType, getterType, /* anonymous */ true);
            const getterVar = newType.type.innerScope.createVariableInScope(getterBopVar.type, getterBopVar.nameHint);
            getterBopVar.result = getterVar;
            this.writer.mapInternalToken(getterVar.identifierToken, getterName);

            const setterType = BopType.createFunctionType({
              debugName: setterName,
              innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
              innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
              functionOf: new BopFunctionType(
                [{ identifier: 'value', type: propType }],
                this.voidType,
                /* isMethod */ true,
              ),
            });
            const setterBopVar = newType.type.innerBlock.mapIdentifier(setterType.debugName, setterType.tempType, setterType, /* anonymous */ true);
            const setterVar = newType.type.innerScope.createVariableInScope(setterBopVar.type, setterBopVar.nameHint);
            setterBopVar.result = setterVar;
            this.writer.mapInternalToken(setterVar.identifierToken, setterName);

            propVar.propertyResult = new BopPropertyAccessor(getterBopVar, setterBopVar);
          }

          return instantiatedType;
        }

        if (type.typeParameters.length > 0) {
          const baseTypeToken = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, type.name);
          this.writer.mapInternalToken(baseTypeToken, type.name);

          let instanceIndex = 0;
          this.createInternalGenericType({
            identifier: type.name,
            writer: (typeArgs: BopFields) => {
              // Create typedef.
              const instantiatedTypeName = `BopLib_${type.name}_${instanceIndex}`;
              instanceIndex++;

              const typedefType = CodeTypeSpec.fromStruct(baseTypeToken).withTypeArgs(typeArgs.map(t => t.type.storageType));
              const typedefIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, instantiatedTypeName);
              this.writer.global.writeTypedef(typedefIdentifier, typedefType);
              this.writer.mapInternalToken(typedefIdentifier, instantiatedTypeName);

              // Instantiate the type.
              const translatedTypeArgs = typeArgs.map(typeArg => utils.upcast({ bopType: typeArg.type, typeArgs: [] }));
              const newType = this.createInternalType({
                identifier: type.name,
                internalIdentifier: instantiatedTypeName,
                anonymous: true,
              });
              newBopTypeMap.set(type.name, { bopType: newType.type });
              instantiateIntoType(instantiatedTypeName, newType, translatedTypeArgs);
              return newType.type;
            },
          });
        } else {
          const typeName = `BopLib::${type.name}`;
          const newType = this.createInternalType({
            identifier: type.name,
            internalIdentifier: typeName,
          });
          newBopTypeMap.set(type.name, { bopType: newType.type });
          newConcreteTypes.push(() => instantiateIntoType(typeName, newType, []));
        }
      }
      newConcreteTypes.forEach(f => f());

      this.intType = newBopTypeMap.get('int')!.bopType!;
      this.typeMap.set(this.tc.getNumberType(), this.intType);



      for (const type of libTypes.values()) {
        const typeArgs = type.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
        const typeName = toStringResolvedType({ name: type.name, typeArgs });
        for (const prop of type.properties) {
          const propType = prop.type(typeArgs);
          console.log(`${typeName}.${prop.name}: ${toStringResolvedType(propType)}`);
        }
        for (const method of type.methods) {
          const methodTypeArgs = method.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
          let methodName = method.name;
          if (methodTypeArgs.length > 0) {
            methodName += `<${methodTypeArgs.map(toStringResolvedType).join(', ')}>`;
          }
          console.log(`${typeName}.${methodName}(${method.parameters.map(p => `${p.name}: ${toStringResolvedType(p.type(typeArgs, methodTypeArgs))}`).join(', ')}): ???`);
        }
      }

      console.log(Array.from(libTypes.values()));
    }

    this.scopeReturnType = this.errorType;

    this.visitTopLevelNode(this.sourceRoot);
    console.log(this.globalBlock);

    this.mapAndResolveRec(this.globalBlock);

    for (const c of this.globalBlock.children) {
      if (c instanceof BopBlock) {
      } else {
        this.doProduceResult(c);
      }
    }
    console.log(this.writer.getOuterCode());
  }

  private mapAndResolveRec(block: BopBlock, children?: Array<BopStage|BopBlock>) {
    children ??= block.children;
    const visitRec = (block: BopBlock, children: Array<BopStage|BopBlock>, func: (stage: BopStage, block: BopBlock) => void) => {
      for (const c of children) {
        if (c instanceof BopBlock) {
          visitRec(c, c.children, func);
        } else {
          func(c, block);
        }
      }
    };
    const inBlock = (func: (stage: BopStage, block: BopBlock) => void) => {
      return (stage: BopStage, block: BopBlock) => {
        const oldBlock = this.block;
        func(stage, block);
        this.block = oldBlock;
      };
    };

    visitRec(block, children, inBlock(stage => stage.mapIdentifiers?.()));
    visitRec(block, children, inBlock(stage => {
      if (!stage.resolvedIdentifiers) {
        stage.resolvedIdentifiers = true;
        stage.resolveIdentifiers?.();
      }
    }));
  }

  private createPrimitiveType(type: CodeTypeSpec): BopType {
    return BopType.createPassByValue({
        debugName: type.asPrimitive ?? '???',
        valueType: type,
        innerScope: this.writer.global.scope.createChildScope(CodeScopeType.Class),
        innerBlock: this.globalBlock.createChildBlock(CodeScopeType.Class),
    });
  }

  private createInternalGenericType(options: {
    identifier: string,
    writer: (typeParameters: BopFields) => BopType,
  }) {
    this.internalGenericTypeMap.set(options.identifier, options.writer);
  }

  private createInternalType(options: {
    identifier: string,
    internalIdentifier?: string,
    anonymous?: boolean,
  }): BopInternalTypeBuilder {
    const typeBopVar = this.globalBlock.mapStorageIdentifier(options.identifier, this.typeType, /* anonymous */ true);
    const typeVar = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, options.identifier);
    const innerScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const innerBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    this.writer.mapInternalToken(typeVar.identifierToken, options.internalIdentifier ?? options.identifier);

    const declareField = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      fieldBopVar.result = fieldVar;
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const declareInternalProperty = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const newType = BopType.createPassByValue({
        debugName: options.identifier,
        valueType: CodeTypeSpec.fromStruct(typeVar.identifierToken),
        innerScope: innerScope,
        innerBlock: innerBlock,
    });
    typeBopVar.typeResult = newType;

    if (!options.anonymous) {
      this.internalTypes.set(options.identifier, newType);
    }

    const declareFunction = (identifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, debugName);
      const funcType = BopType.createFunctionType({
        debugName: debugName,
        innerScope: innerScope.createChildScope(CodeScopeType.Local),
        innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionType(
          params,
          newType,
          /* isMethod */ options.includeThis,
        ),
      });

      innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
      const funcWriter = this.writer.global.writeFunction(funcIdentifier.identifierToken);
      funcWriter.returnTypeSpec = returnType.storageType;
      return funcWriter;
    };

    const declareMethod = (identifier: string, params: BopFields, returnType: BopType) => {
      return declareFunction(identifier, params, returnType, { includeThis: true });
    };

    const declareConstructor = (params: BopFields) => {
      return declareFunction('constructor', params, newType, { includeThis: false });
    };

    const declareInternalField = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      fieldBopVar.result = fieldVar;
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const declareInternalFunction = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
      const funcType = BopType.createFunctionType({
        debugName: debugName,
        innerScope: innerScope.createChildScope(CodeScopeType.Local),
        innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionType(
          params,
          returnType,
          /* isMethod */ options.includeThis,
        ),
      });

      innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
      this.writer.mapInternalToken(funcIdentifier.identifierToken, internalIdentifier);
      return;
    };

    const declareInternalMethod = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType) => {
      return declareInternalFunction(identifier, internalIdentifier, params, returnType, { includeThis: true });
    };

    const declareInternalConstructor = (params: BopFields, internalIdentifier: string) => {
      return declareInternalFunction('constructor', internalIdentifier, params, newType, { includeThis: false });
    };

    const declareGenericMethod = (identifier: string, genericFunc: BopGenericFunction) => {
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
      innerBlock.mapTempIdentifier(identifier, this.functionType).genericFunctionResult = genericFunc;
      return;
    };

    return {
      type: newType,
      declareField,
      declareMethod,
      declareConstructor,
      declareInternalField,
      declareInternalMethod,
      declareInternalConstructor,
      declareGenericMethod,
      declareInternalProperty,
    };
  }



  private createInternalConstant(options: {
    identifier: string,
    internalIdentifier?: string,
    type: BopType,
  }): BopVariable {
    const constBopVar = this.globalBlock.mapStorageIdentifier(options.identifier, options.type);
    const constVar = this.writer.global.scope.allocateVariableIdentifier(options.type.storageType, BopIdentifierPrefix.Local, options.identifier);
    constBopVar.result = constVar;
    this.writer.mapInternalToken(constVar.identifierToken, options.internalIdentifier ?? options.identifier);
    return constBopVar;
  }

  private verify<T>(value: T, errorFormatter: (() => string)|string, predicate?: (v: T) => boolean): T {
    const cond = predicate === undefined ? (!!value) : predicate(value);
    if (!cond) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
    }
    return value;
  }

  private logAssert(error: string) {
    console.error(error);
  }

  private check(cond: boolean, errorFormatter: (() => string)|string): boolean {
    if (!cond) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
    }
    return cond;
  }

  private verifyNotNulllike<T>(cond: T|null|undefined, errorFormatter: (() => string)|string): cond is T {
    if (cond === null || cond === undefined) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
      return false;
    }
    return true;
  }

  private visitTopLevelNode(node: ts.Node): BopStage|undefined {
    const getNodeLabel = (node: ts.Node) => { return tsGetSyntaxTypeLabel(node.kind) ?? 'Unknown'; };

    // console.log(node);
    const sourceMapRange = ts.getSourceMapRange(node);
    console.log(`${tsGetSyntaxTypeLabel(node.kind)}   inner code: ${(sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).trim()}`);

    const block = this.block;
    const asAssignableRef = this.asAssignableRef;

    const recurse = (child: ts.Node): BopStage => {
      const rawExpr = this.visitTopLevelNode(child);
      if (rawExpr) {
        this.block.children.push(rawExpr);
      }
      return rawExpr ?? {};
    }

    if (ts.isSourceFile(node)) {
      for (const statement of node.statements) {
        if (ts.isInterfaceDeclaration(statement)) {
          // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
        } else if (ts.isClassDeclaration(statement)) {
          if (!this.verifyNotNulllike(statement.name, `Anonymous classes not supported.`)) {
            return;
          }
          const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
        } else if (ts.isFunctionDeclaration(statement)) {
          this.declareFunction(statement, undefined, this.globalBlock, this.globalBlock);
        } else {
          this.logAssert(`Unsupported ${getNodeLabel(statement)} at global scope.`);
        }
      }
      return {};
    } else if (ts.isBlock(node)) {
      node.statements.forEach(recurse);
      return {};
    }
    this.logAssert(`Unsupported syntax ${getNodeLabel(node)}.`);

    return;
  };


  private visitBlockGenerator(node: ts.Node): BopStage|undefined {
    const getNodeLabel = (node: ts.Node) => { return tsGetSyntaxTypeLabel(node.kind) ?? 'Unknown'; };

    const sourceMapRange = ts.getSourceMapRange(node);
    console.log(`${tsGetSyntaxTypeLabel(node.kind)}   inner code: ${(sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).trim()}`);

    const block = this.block;
    const asAssignableRef = this.asAssignableRef;

    const createBopReference = (identifier: string, inBlock?: BopBlock): BopReference => {
      return new BopReference(identifier, inBlock ?? this.block);
    };
    const allocTmpOut = (type: CodeTypeSpec, bopType: BopType): [CodeVariable, BopVariable] => {
      const outBopVar = this.block.mapIdentifier('tmp', type, bopType, /* anonymous */ true);
      const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, getNodeLabel(node));
      outBopVar.result = outVar;
      return [outVar, outBopVar];
    };

    if (ts.isBlock(node)) {
      node.statements.forEach(this.visitChild.bind(this));
      return {};
    } else if (ts.isExpressionStatement(node)) {
      return this.delegateToChild(node.expression);
    } else if (ts.isVariableStatement(node)) {
      const newVars = node.declarationList.declarations.map(decl => {
        const varType = this.resolveType(this.tc.getTypeAtLocation(decl));
        const newVar = this.block.mapTempIdentifier(decl.name.getText(), varType);
        const initializer = this.visitChildOrNull(decl.initializer);
        return {
          variable: newVar,
          initializer: initializer,
          type: varType,
        };
      });

      return {
        produceResult: () => {
          for (const newVar of newVars) {
            let initializerVar = this.writeCoersionFromExpr(newVar.initializer, newVar.type, this.blockWriter);
            const outVar = this.blockWriter.scope.createVariableInScope(newVar.variable.type, newVar.variable.nameHint);
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            if (initializerVar) {
              ret.initializer.writeExpression().writeVariableReference(initializerVar);
            }
            newVar.variable.result = outVar;
          }
          return {};
        },
      };
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const oldAsAssignableRef = this.asAssignableRef;
      this.asAssignableRef = true;
      const refExpr = this.visitChild(node.left);
      this.asAssignableRef = oldAsAssignableRef;

      if (!this.check(refExpr.isAssignableRef === true, `LHS expression is not assignable.`)) {
        return;
      }

      const valueExpr = this.visitChild(node.right);

      return {
        produceResult: () => {
          const [value, valueRef] = this.writeCoersionFromExprPair(valueExpr, this.errorType, this.blockWriter);

          const refResult = this.readFullResult(refExpr);
          const propAccessor = refResult?.expressionResult?.propertyResult;
          if (propAccessor) {
            // This is calling a setter property.
            const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.setter, thisVar: refResult.thisResult }), [value]);
            if (!callBop) {
              return;
            }
            this.doProduceResult(callBop);
            return { expressionResult: valueRef };
          }

          const oldAsAssignableRef = this.asAssignableRef;
          this.asAssignableRef = true;
          const [ref, refVar] = this.writeCoersionFromExprPair(refExpr, this.errorType, this.blockWriter);
          this.asAssignableRef = oldAsAssignableRef;

          const ret = this.blockWriter.writeAssignmentStatement();
          ret.ref.writeVariableReference(ref);
          ret.value.writeVariableReference(value);
          return { expressionResult: valueRef };
        },
      };
    } else if (ts.isReturnStatement(node)) {
      const valueBop = this.visitChildOrNull(node.expression);
      return {
        produceResult: () => {
          const ret = this.blockWriter.writeReturnStatement();
          if (valueBop) {
            // Coerce to return type.
            const returnType = this.scopeReturnType;
            const valueVar = this.writeCoersionFromExpr(valueBop, returnType, this.blockWriter);
            ret.expr.writeVariableReference(valueVar);
          }
          return {};
        },
      };
    } else if (ts.isIfStatement(node)) {
      const condBop = this.visitChild(node.expression);
      const branches: BopBlock[] = [ this.visitInBlock(node.thenStatement, CodeScopeType.Local) ];
      if (node.elseStatement) {
        branches.push(this.visitInBlock(node.elseStatement, CodeScopeType.Local));
      }
      return {
        produceResult: () => {
          const condVar = this.writeCoersionFromExpr(condBop, this.booleanType, this.blockWriter);
          const ret = this.blockWriter.writeConditional(branches.length);
          ret.branches[0].condWriter.writeVariableReference(condVar);
          this.writeBlock(branches[0], ret.branches[0].blockWriter);
          return {};
        },
      };
    } else if (ts.isPropertyAccessExpression(node)) {
      const fromBop = this.visitChild(node.expression);
      return {
        resolveIdentifiers: () => {
        },
        produceResult: () => {
          const fromBopVar = this.readResult(fromBop);
          const fromVar = fromBopVar.result!;
          const propertyRef = createBopReference(node.name.text, fromBopVar.bopType.innerBlock);
          this.resolve(propertyRef);

          if (!this.verifyNotNulllike(propertyRef.resolvedRef, `Property ${propertyRef.identifier} is undefined.`)) {
            return;
          }
          const outBopType = propertyRef.resolvedRef.bopType;
          const isProperty = !!propertyRef.resolvedRef.propertyResult;
          let outType = propertyRef.resolvedRef.type;
          let isDirectAccess = false;
          if (asAssignableRef) {
            outType = outType.toReference();
            if (isProperty || outType.asPrimitive === CodePrimitiveType.Function) {
              isDirectAccess = true;
            }
          }

          let outBopVar;
          if (isDirectAccess) {
            outBopVar = propertyRef.resolvedRef;
          } else {
            const propAccessor = propertyRef.resolvedRef.propertyResult;
            const propVar = propertyRef.resolvedRef.result;
            if (propAccessor) {
              // This is calling a getter property.
              const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.getter, thisVar: fromBopVar }), []);
              if (!callBop) {
                return;
              }
              this.doProduceResult(callBop);
              const result = this.readResult(callBop);
              return {
                expressionResult: result,
                thisResult: fromBopVar,
              };
            } else if (propVar) {
              const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType);
              outBopVar = outTmpBopVar;
              const ret = this.blockWriter.writeVariableDeclaration(outVar);
              ret.initializer.writeExpression().writePropertyAccess(propVar.identifierToken).source.writeVariableReference(fromVar);
            } else {
              this.logAssert(`Property ${propertyRef.identifier} is undefined.`);
              return;
            }
          }
          return {
            expressionResult: outBopVar,
            thisResult: fromBopVar,
          };
        },
        isAssignableRef: asAssignableRef && fromBop.isAssignableRef,
      };
    } else if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) {
      const identifierName = ts.isIdentifier(node) ? node.text : 'this';
      const varRef = createBopReference(identifierName);
      return {
        resolveIdentifiers: () => {
          this.resolve(varRef);
        },
        produceResult: () => {
          const inVar = varRef.resolvedRef?.result;
          if (!this.verifyNotNulllike(varRef.resolvedRef, `Identifier ${varRef.identifier} is undefined.`) ||
              !this.verifyNotNulllike(inVar, `Identifier ${varRef.identifier} is undefined.`)) {
            return;
          }
          const outBopType = varRef.resolvedRef.bopType;
          let outType = inVar.typeSpec;
          let isDirectAccess = false;
          if (asAssignableRef) {
            outType = outType.toReference();
            if (outType.asPrimitive === CodePrimitiveType.Function) {
              isDirectAccess = true;
            }
          }
          let outBopVar;
          if (isDirectAccess) {
            outBopVar = varRef.resolvedRef;
          } else {
            const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType);
            outBopVar = outTmpBopVar;
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            ret.initializer.writeExpression().writeVariableReference(inVar);
          }
          return { expressionResult: outBopVar };
        },
        isAssignableRef: asAssignableRef,
      };
    } else if (ts.isCallExpression(node)) {
      // TODO: Resolve function expressions.
      const oldAsAssignableRef = this.asAssignableRef;
      this.asAssignableRef = true;
      const functionBop = this.visitChild(node.expression);
      this.asAssignableRef = oldAsAssignableRef;

      const candidatesOutArray: ts.Signature[] = [];
      const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
      if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
        return;
      }
      console.log(this.tc.signatureToString(functionSignature));

      let typeParameters: BopFields = [];
      const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
      if (instantatedFromSignature?.typeParameters) {
        // Reverse map to extrapolate type parameters.
        const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
        if (typeMapper) {
          typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
        }
      }

      let functionVar: BopVariable|undefined;
      return this.makeCallBop(node, () => {
        const functionExprResult = this.readFullResult(functionBop);
        const functionRef = functionExprResult?.expressionResult;
        const thisRef = functionExprResult?.thisResult;
        if (!functionRef) {
          return;
        }
        const genericFunction = functionRef?.genericFunctionResult;
        if (genericFunction) {
          functionVar = this.instantiateGenericFunction(genericFunction, typeParameters);
        }
        functionVar ??= functionRef;
        const functionOf = functionVar.bopType.functionOf;
        if (!this.verifyNotNulllike(functionOf, `Expression is not callable.`)) {
          return;
        }
        if (functionOf.isMethod && !this.verifyNotNulllike(thisRef, `Cannot call instance method in a static context.`)) {
          return;
        }
        return { functionVar: functionVar, thisVar: thisRef };
      }, node.arguments);
    } else if (ts.isObjectLiteralExpression(node)) {
      const asType = this.resolveType(this.tc.getTypeAtLocation(node));
      // const storage = createStorage(asType);

      const initializers: Array<{ field: string, valueBop: BopStage, propertyRef: BopReference }> = [];
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const field = p.name.getText();
          const valueBop = this.visitChild(p.initializer);
          const propertyRef = createBopReference(field, asType.innerBlock);
          initializers.push({ field, valueBop, propertyRef });
        } else {
          this.logAssert(`Unknown object literal syntax.`);
          continue;
        }
      }

      return {
        resolveIdentifiers: () => {
          initializers.forEach(e => this.resolve(e.propertyRef));
        },
        // resolveStorage: () => {
        //   this.resolveStorage(storage);
        // },
        produceResult: () => {
          const initializerVars: Array<{ identifierToken: CodeNamedToken, valueVar: CodeVariable }> = [];
          for (const initializer of initializers) {
            const prop = initializer.propertyRef.resolvedRef;
            const propRef = prop?.result;
            if (!this.verifyNotNulllike(prop, `Property ${initializer.field} is undefined.`) ||
                !this.verifyNotNulllike(propRef, `Property ${initializer.field} is undefined.`)) {
              return;
            }
            initializerVars.push({ identifierToken: propRef.identifierToken, valueVar: this.writeCoersionFromExpr(initializer.valueBop, prop.bopType, this.blockWriter) });
          }

          const [outVar, outBopVar] = allocTmpOut(asType.tempType, asType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          for (const initializer of initializerVars) {
            ret.initializer.writeAssignStructField(initializer.identifierToken).value.writeVariableReference(initializer.valueVar);
          }
          return { expressionResult: outBopVar };
        },
      };
    } else if (ts.isNewExpression(node)) {
      // TODO: Resolve function expressions.
      if (!ts.isIdentifier(node.expression)) {
        this.logAssert(`Function expressions are not supported.`);
        return;
      }

      const type = this.resolveType(this.tc.getTypeAtLocation(node));
      return this.makeCallBop(node, () => {
        const constructorRef = createBopReference('constructor', type.innerBlock);
        this.resolve(constructorRef);
        if (!this.verifyNotNulllike(constructorRef.resolvedRef, `Constructor for ${type.debugName} is undefined.`) ||
            !this.verifyNotNulllike(constructorRef.resolvedRef.bopType.functionOf, `Constructor for ${type.debugName} is undefined.`)) {
          return;
        }
        return { functionVar: constructorRef.resolvedRef, thisVar: undefined };
      }, node.arguments ?? []);
    } else if (ts.isBinaryExpression(node)) {
      const opType =
          ts.isPlusToken(node.operatorToken) ? CodeBinaryOperator.Add :
          ts.isMinusToken(node.operatorToken) ? CodeBinaryOperator.Subtract :
          ts.isAsteriskToken(node.operatorToken) ? CodeBinaryOperator.Multiply :
          node.operatorToken.kind === ts.SyntaxKind.SlashToken ? CodeBinaryOperator.Divide :
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ? CodeBinaryOperator.Equals :
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? CodeBinaryOperator.Equals :
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? CodeBinaryOperator.NotEquals :
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ? CodeBinaryOperator.NotEquals :
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken ? CodeBinaryOperator.GreaterThan :
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken ? CodeBinaryOperator.GreaterThanEquals :
          node.operatorToken.kind === ts.SyntaxKind.LessThanToken ? CodeBinaryOperator.LessThan :
          node.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken ? CodeBinaryOperator.LessThanEquals :
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? CodeBinaryOperator.LogicalOr :
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? CodeBinaryOperator.LogicalAnd :
          undefined;
      if (!this.verifyNotNulllike(opType, `Unknown operator ${getNodeLabel(node.operatorToken)}.`)) {
        return;
      }

      const exprType = this.resolveType(this.tc.getTypeAtLocation(node));

      const lhs = this.visitChild(node.left);
      const rhs = this.visitChild(node.right);
      const lhsType = this.errorType;
      const rhsType = this.errorType;

      return {
        produceResult: () => {
          const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
          const rhsVar = this.writeCoersionFromExpr(rhs, rhsType, this.blockWriter);
          const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          const op = ret.initializer.writeExpression().writeBinaryOperation(opType);
          op.lhs.writeVariableReference(lhsVar);
          op.rhs.writeVariableReference(rhsVar);
          return { expressionResult: outBopVar };
        },
      };
    } else if (ts.isParenthesizedExpression(node)) {
      return this.delegateToChild(node.expression);
    } else if (ts.isNumericLiteral(node)) {
      return {
        produceResult: () => {
          const [outVar, outBopVar] = allocTmpOut(this.intType.storageType, this.intType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          ret.initializer.writeExpression().writeLiteralInt(parseInt(node.text));
          return { expressionResult: outBopVar };
        },
      };
    } else if (
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword) {
      const isTrue = node.kind === ts.SyntaxKind.TrueKeyword;
      return {
        produceResult: () => {
          const [outVar, outBopVar] = allocTmpOut(this.booleanType.storageType, this.booleanType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          ret.initializer.writeExpression().writeLiteralBool(isTrue);
          return { expressionResult: outBopVar };
        },
      };
    }
    this.logAssert(`Unsupported syntax ${getNodeLabel(node)}.`);

    return;
  };









  private writeCoersionFromExpr(stage: BopStage, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable;
  private writeCoersionFromExpr(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable|undefined;
  private writeCoersionFromExpr(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable|undefined {
    const ret = this.writeCoersionFromExprPair(stage, type, blockWriter);
    if (!ret) {
      return undefined;
    }
    return ret[0];
  }
  private writeCoersionFromExprPair(stage: BopStage, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable];
  private writeCoersionFromExprPair(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable]|undefined;
  private writeCoersionFromExprPair(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable]|undefined {
    if (!stage) {
      return undefined;
    }
    return this.writeCoersion(this.readResult(stage), type, blockWriter);
  }

  private writeCoersion(source: BopVariable, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable] {
    blockWriter ??= this.blockWriter;
    if (!source.result) {
      const errorResult = this.readCompileError();
      return [errorResult.result!, errorResult];
    }
    return [source.result, source];
  }



  private declareFunction(node: ts.FunctionLikeDeclarationBase, methodThisType: BopType|undefined, declareInBlock: BopBlock, lookupInBlock: BopBlock, instantiateWithTypeParameters?: BopFields): BopVariable|undefined {
    const isConstructor = ts.isConstructorDeclaration(node);
    let candidateFuncName = node.name?.getText();
    if (!candidateFuncName && isConstructor) {
      candidateFuncName = 'constructor';
    }
    if (!this.verifyNotNulllike(candidateFuncName, `Anonymous functions not supported.`)) {
      return;
    }
    if (!this.verifyNotNulllike(node.body, `Function has no body.`)) {
      return;
    }
    const funcName = candidateFuncName;
    const isMethod = !!methodThisType && !isConstructor;

    let returnTypeProvider: (block: BopBlock) => BopType;
    let parameterSignatures: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }> = [];
    if (isConstructor) {
      returnTypeProvider = () => methodThisType!;

      for (const param of node.parameters) {
        const isField = param.modifiers?.some(m =>
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword ||
            m.kind === ts.SyntaxKind.PublicKeyword ||
            m.kind === ts.SyntaxKind.ReadonlyKeyword ||
            false
        ) ?? false;

        const paramName = param.name.getText();
        const paramType = this.tc.getTypeAtLocation(param);

        parameterSignatures.push({ identifier: paramName, type: paramType, isAutoField: isField });
      }
    } else {
      const funcType = this.tc.getTypeAtLocation(node);
      const signature = this.tc.getSignaturesOfType(funcType, ts.SignatureKind.Call).at(0);
      if (!this.verifyNotNulllike(signature, `Function has unknown signature.`)) {
        return;
      }
      for (const param of signature.parameters) {
        parameterSignatures.push({ identifier: param.name, type: this.tc.getTypeOfSymbol(param), isAutoField: false });
      }
      const returnType = signature.getReturnType();
      returnTypeProvider = block => this.resolveType(returnType, block);
    }

    const instantiateFunc = (typeParameters: BopFields, anonymous: boolean): BopVariable => {
      const paramDecls: BopFields = [];
      const params: BopVariable[] = [];
      const autoFields: Array<{ argRef: BopVariable, identifier: string }> = [];
      let constructorBopVar: BopVariable|undefined;
      let body: BopBlock;

      const functionBlock = lookupInBlock.createChildBlock(CodeScopeType.Function);
      if (isMethod) {
        params.push(functionBlock.mapIdentifier('this', methodThisType.assignableRefType, methodThisType));
      } else if (isConstructor) {
        constructorBopVar = functionBlock.mapIdentifier('this', methodThisType!.assignableRefType, methodThisType!);
      }
      for (const param of typeParameters) {
        functionBlock.mapTempIdentifier(param.identifier, this.typeType).typeResult = param.type;
      }
      for (const param of parameterSignatures) {
        const paramType = this.resolveType(param.type, functionBlock);
        paramDecls.push({ type: paramType, identifier: param.identifier });

        const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
        params.push(argVar);

        if (param.isAutoField) {
          autoFields.push({ argRef: argVar, identifier: param.identifier });
        }
      }
      const returnType = returnTypeProvider(functionBlock);

      const newFunctionType = BopType.createFunctionType({
        debugName: funcName,
        innerScope: this.writer.global.scope.createChildScope(CodeScopeType.Local),
        innerBlock: lookupInBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionType(
          paramDecls,
          returnType,
          !!methodThisType,
        ),
      });

      const concreteFunctionVar = declareInBlock.mapTempIdentifier(funcName, newFunctionType, anonymous ?? true);
      const concreteFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, funcName);
      concreteFunctionVar.result = concreteFunctionIdentifier;

      this.pushBlockGenerator(lookupInBlock, {
        unrollBlocks: () => {
          // Map type parameters.
          const oldBlock = this.block;
          this.block = functionBlock;
          body = this.visitInBlock(node.body!, CodeScopeType.Function);
          this.block = oldBlock;
        },
        produceResult: () => {
          const ret = this.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);

          let constructorOutVar;
          if (constructorBopVar) {
            constructorOutVar = ret.body.scope.allocateVariableIdentifier(methodThisType!.storageType, BopIdentifierPrefix.Local, 'New');
            ret.body.writeVariableDeclaration(constructorOutVar);
            constructorBopVar.result = constructorOutVar;
          }

          ret.returnTypeSpec = returnType.tempType;
          for (const param of params) {
            param.result = ret.body.scope.createVariableInScope(param.type, param.nameHint);
            ret.addParam(param.type, param.result.identifierToken);
          }
          if (constructorOutVar) {
            for (const autoField of autoFields) {
              const fieldRef = new BopReference(autoField.identifier, methodThisType!.innerBlock);
              this.resolve(fieldRef);
              if (!this.verifyNotNulllike(fieldRef.resolvedRef?.result, `Field ${autoField.identifier} not found.`)) {
                return;
              }

              const assign = ret.body.writeAssignmentStatement();
              assign.ref.writePropertyAccess(fieldRef.resolvedRef.result.identifierToken).source.writeVariableReference(constructorOutVar);
              assign.value.writeVariableReference(autoField.argRef.result!);
            }
          }

          const oldReturnType = this.scopeReturnType;
          this.scopeReturnType = returnType;
          this.writeBlock(body, ret.body);
          this.scopeReturnType = oldReturnType;

          if (constructorOutVar) {
            ret.body.writeReturnStatement().expr.writeVariableReference(constructorOutVar);
          }

          return {};
        },
      });
      return concreteFunctionVar;
    };

    if (node.typeParameters && !instantiateWithTypeParameters) {
      const genericFunctionVar = declareInBlock.mapTempIdentifier(funcName, this.functionType);
      const genericFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, funcName);
      genericFunctionVar.result = genericFunctionIdentifier;

      genericFunctionVar.genericFunctionResult = new BopGenericFunction((typeParameters: BopFields) => {
        return instantiateFunc(typeParameters, /* anonymous */ true);
      });
      return genericFunctionVar;
    } else {
      return instantiateFunc(instantiateWithTypeParameters ?? [], /* anonymous */ false);
    }
  }

  private makeCallBop(node: ts.Node, funcGetter: () => { functionVar: BopVariable, thisVar: BopVariable|undefined }|undefined, args: ArrayLike<ts.Expression|CodeVariable>): BopStage|undefined {
    const argBops: Array<BopStage|CodeVariable> = Array.from(args).map(e => {
      if (e instanceof CodeVariable) {
        return e;
      }
      return this.visitChild(e);
    });

    return {
      produceResult: () => {
        const inFunc = funcGetter();
        if (!inFunc?.functionVar || !inFunc?.functionVar.bopType.functionOf) {
          return;
        }

        const functionRef = inFunc.functionVar;
        const functionOf: BopFunctionType = inFunc?.functionVar.bopType.functionOf;
        const thisRef = inFunc.thisVar;
        if (functionOf.isMethod && !thisRef?.result) {
          return;
        }

        const argCount = Math.min(functionOf.args.length, argBops.length);
        const argVars: CodeVariable[] = [];
        for (let i = 0; i < argCount; ++i) {
          const argBop = argBops[i];
          const arg = functionOf.args[i];
          if (argBop instanceof CodeVariable) {
            argVars.push(argBop);
          } else {
            argVars.push(this.writeCoersionFromExpr(argBop, arg.type, this.blockWriter));
          }
        }
        const outBopVar = this.block.mapStorageIdentifier('tmp', functionOf.returnType, /* anonymous */ true);
        const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, this.getNodeLabel(node));
        outBopVar.result = outVar;
        const ret = this.blockWriter.writeVariableDeclaration(outVar);
        const funcCall = ret.initializer.writeExpression().writeStaticFunctionCall(functionRef.result!.identifierToken);
        if (functionOf.isMethod) {
          funcCall.addArg().writeVariableReference(thisRef!.result!);
        }
        for (const argVar of argVars) {
          funcCall.addArg().writeVariableReference(argVar);
        }
        return { expressionResult: outBopVar };
      },
    };
  }

  private visitChild(child: ts.Node): BopStage {
    const rawExpr = this.visitBlockGenerator(child);
    if (rawExpr) {
      this.block.children.push(rawExpr);
    }
    const newExpr = rawExpr ?? {};
    return newExpr;
  }

  private visitChildOrNull(child: ts.Node|undefined): BopStage|undefined {
    if (!child) {
      return undefined;
    }
    return this.visitChild(child);
  }

  private delegateToChild(child: ts.Node): BopStage {
    return this.visitBlockGenerator(child) ?? {};
  };

  private visitInBlock(child: ts.Node, scopeType: CodeScopeType, childBlock?: BopBlock): BopBlock {
    const oldBlock = this.block;
    const newBlock = childBlock ?? oldBlock.createChildBlock(scopeType);
    this.block = newBlock;
    this.visitChild(child);
    this.block = oldBlock;
    return newBlock;
  };

  private pushBlockGenerator(parentBlock: BopBlock, generator: {
    unrollBlocks(): void,
    produceResult(): BopResult|undefined,
  }) {
    const oldBlock = this.block;
    const newBlock = parentBlock;
    this.block = newBlock;

    const oldUnrolledBlocks = this.unrolledBlocks;
    this.unrolledBlocks = [];
    generator.unrollBlocks();
    while (this.unrolledBlocks.length > 0) {
      console.log(this.unrolledBlocks);
      const toUnroll = this.unrolledBlocks;
      this.mapAndResolveRec(newBlock, toUnroll);
      this.unrolledBlocks = [];
    }
    this.unrolledBlocks = oldUnrolledBlocks;

    const generatorBlock = { produceResult: generator.produceResult };
    parentBlock.children.push(generatorBlock);
    this.unrolledBlocks?.push(generatorBlock);
    this.block = oldBlock;
  }

  private getNodeLabel(node: ts.Node) {
    return tsGetSyntaxTypeLabel(node.kind) ?? 'Unknown';
  }

  private resolve(ref: BopReference) {
    let block: BopBlock|undefined = ref.block;
    while (block) {
      const resolved = block.identifierMap.get(ref.identifier);
      if (resolved) {
        ref.resolvedRef = resolved;
        return;
      }
      block = block.parent;
    }
  }

  private instantiateGenericFunction(func: BopGenericFunction, typeParameters: BopFields): BopVariable {
    const structureKey = this.toStructureKey(typeParameters);
    let instance = func.instantiations.get(structureKey);
    if (!instance) {
      instance = new BopGenericFunctionInstance(typeParameters, func.instanceWriter(typeParameters));
      func.instantiations.set(structureKey, instance);
    }
    return instance.functionVar;
  }

  private writeBlock(block: BopBlock, blockWriter: CodeStatementWriter) {
    const oldBlock = this.blockWriter;
    this.blockWriter = blockWriter;
    for (const c of block.children) {
      if (c instanceof BopBlock) {
      } else {
        if (!c.resolvedIdentifiers) {
          c.resolvedIdentifiers = true;
          c.resolveIdentifiers?.();
        }
        this.doProduceResult(c);
      }
    }
    this.blockWriter = oldBlock;
  }

  private doProduceResult(stage: BopStage) {
    const result = stage.produceResult?.();
    if (result?.expressionResult) {
      this.resultMap.set(stage, result);
    }
  }

  private readResult(stage: BopStage): BopVariable {
    const resultIdentifier = this.resultMap.get(stage);
    return resultIdentifier?.expressionResult ?? this.readCompileError();
  }

  private readFullResult(stage: BopStage): BopResult|undefined {
    return this.resultMap.get(stage);
  }

  private readCompileError(): BopVariable {
    const outVar = this.block.mapTempIdentifier('error', this.errorType, /* anonymous */ true);
    const identifier = this.blockWriter.scope.createVariableInScope(CodeTypeSpec.compileErrorType, 'error');
    outVar.result = identifier;
    this.blockWriter.writeVariableDeclaration(identifier);
    return outVar;
  }



  private typeMap = new Map<ts.Type, BopType>();
  private typeGenericMap = new Map<ts.Type, Map<string, BopType>>();
  private typeIdMap = new Map<CodeNamedToken|CodePrimitiveType, number>();
  private typeCoalesceMap = new Map<string, {
    identifier: CodeVariable,
    innerScope: CodeScope,
    fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BopType }>,
    defaultConstructor?: { fieldVar: CodeVariable, fieldType: BopType },
  }>();
  private internalTypes = new Map<string, BopType>();
  private internalGenericTypeMap = new Map<string, (typeParameters: BopFields) => BopType>();
  private resolvingSet = new Map<ts.Type, void>();

  private resolveType(type: ts.Type, inBlock?: BopBlock): BopType {
    const thisBlock = inBlock ?? this.block;

    const isObject = (type.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object;
    const objectFlags = isObject ? (type as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
    const isReference = (objectFlags & ts.ObjectFlags.Reference) === ts.ObjectFlags.Reference;
    const isClassOrInterface = !!(objectFlags & ts.ObjectFlags.ClassOrInterface);
    const isGeneric = isReference && ((type as ts.TypeReference)?.typeArguments?.length ?? 0) > 0;
    const genericBase: ts.BaseType|undefined = isReference ? ((type as any).target as ts.TypeReference) : undefined;
    const isGenericBase = isGeneric && genericBase === type;
    if (isGenericBase) {
      return this.errorType;
    }
    const requiresGenericLookup = isReference;
    const isTypeParameter = type.isTypeParameter();
    const requiresFullLookup = requiresGenericLookup || isTypeParameter;

    let found = !requiresFullLookup && this.typeMap.get(type);
    // let found = this.typeMap.get(type) ?? this.typeSymbolMap.get(type.symbol);
    if (found) {
      return found;
    }

    if ((type.flags & ts.TypeFlags.NumberLiteral) === ts.TypeFlags.NumberLiteral) {
      found = this.intType;
    } else if ((type.flags & ts.TypeFlags.BooleanLiteral) === ts.TypeFlags.BooleanLiteral) {
      found = this.booleanType;
    } else if ((type.flags & ts.TypeFlags.Undefined) === ts.TypeFlags.Undefined) {
      found = this.undefinedType;
    }
    if (found) {
      return found;
    }

    const parentScope = this.writer.global.scope;
    const parentBlock = this.globalBlock;
    const shortName = this.stringifyType(type);

    // Create a new type.
    if (!this.check((type.flags & ts.TypeFlags.Any) !== ts.TypeFlags.Any, `Type ${utils.stringEmptyToNull(shortName) ?? 'any'} is disallowed.`)) {
      return this.errorType;
    }
    if (!this.check(!this.resolvingSet.has(type), `Type ${shortName} is recursive.`)) {
      return this.errorType;
    }

    // Resolve types, that might contain type parameters.
    const resolveInnerTypeRef = (t: ts.Type): BopType|undefined => {
      if (!t.symbol) {
        return this.resolveType(t, thisBlock);
      }
      const typeRef = new BopReference(t.symbol.name, thisBlock);
      this.resolve(typeRef);
      return typeRef.resolvedRef?.typeResult;
    };

    if (isTypeParameter) {
      return resolveInnerTypeRef(type) ?? this.errorType;
    } else {
      // type.isTypeParameter() and the return confuses the type checker.
      type = type as ts.Type;
    }

    this.resolvingSet.set(type);
    const typeArgs: BopFields = [];
    try {
      // Lookup cached generic instantiations.
      let typeParamsKey = '';
      if (requiresGenericLookup) {
        const baseTypeArgs = (genericBase as ts.InterfaceType).typeParameters ?? [];
        const thisTypeArgs = (type as ts.TypeReference).typeArguments ?? [];
        if (!this.check(baseTypeArgs.length === thisTypeArgs.length, `Mismatching type arguments.`)) {
          return this.errorType;
        }
        for (let i = 0; i < baseTypeArgs.length; ++i) {
          const baseType = baseTypeArgs[i];
          const thisType = thisTypeArgs[i];
          const resolved = resolveInnerTypeRef(thisType) ?? this.errorType;
          typeArgs.push({
            identifier: baseType.symbol.name,
            type: resolved,
          });
        }
        typeParamsKey = this.toStructureKey(typeArgs);

        const genericInstances = this.typeGenericMap.get(genericBase!);
        if (genericInstances) {
          found = genericInstances.get(typeParamsKey);
        } else {
          found = undefined;
        }
        if (found) {
          return found;
        }
      }

      // Lookup internal types.
      const sourceFile = tsGetSourceFileOfNode(type.symbol?.declarations?.at(0));
      const isInternalDeclaration = sourceFile?.fileName?.toLowerCase()?.endsWith('.d.ts') ?? false;
      if (isInternalDeclaration) {
        // console.log(`     internal type mapping ========> ${type.symbol.name}`);
        const internalGenericType = this.internalGenericTypeMap.get(type.symbol.name);
        if (internalGenericType) {
          const instantiatedType = internalGenericType(typeArgs);
          let genericInstances = this.typeGenericMap.get(genericBase!);
          if (!genericInstances) {
            genericInstances = new Map();
            this.typeGenericMap.set(genericBase!, genericInstances);
          }
          genericInstances.set(typeParamsKey, instantiatedType);
          return instantiatedType;
        }
        return this.internalTypes.get(type.symbol.name) ?? this.errorType;
      }

      // Coalesce backing storage structs.
      const fields: BopFields = [];
      let constructorDecl: ts.ConstructorDeclaration|undefined;
      let methodDecls: ts.MethodDeclaration[] = [];
      for (const property of ((type as any).members as ts.SymbolTable) ?? []) {
        const propertyName = property[0].toString();
        const propertySymbol = property[1];
        const propertyDecl = propertySymbol.declarations?.at(0);
        if (!this.verifyNotNulllike(propertyDecl, `Cannot determine type for property ${propertyName}.`)) {
          return this.errorType;
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
        let propertyType;
        if (propertySymbolType.isTypeParameter()) {
          propertyType = resolveInnerTypeRef(propertySymbolType);
        }
        propertyType ??= this.resolveType(propertySymbolType);
        // const propertyType = this.resolveType(this.tc.getTypeAtLocation(propertyDecl));
        fields.push({ type: propertyType, identifier: propertyName });
      }
      // Sometimes the constructor disappears from everything but the symbol.
      for (const property of type.symbol?.members ?? []) {
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

      let casesIdentifierMap: Map<BopType, { identifier: string, index: number }>|undefined;
      let caseVariableIdentifier: string|undefined;
      if (type.isUnion()) {
        casesIdentifierMap = new Map();

        const innerTypes = type.types.map(t => this.resolveType(t));
        let innerIndex = 0;
        for (const innerType of innerTypes) {
          if (casesIdentifierMap.has(innerType)) {
            continue;
          }
          const identifier = `${innerType.debugName}`;
          fields.push({ type: innerType, identifier });
          casesIdentifierMap.set(innerType, { identifier, index: innerIndex });
          innerIndex++;
        }

        caseVariableIdentifier = 'case';
        fields.push({ type: this.intType, identifier: caseVariableIdentifier });
      }

      const structureKey = this.toStructureKey(fields);
      console.log(structureKey);

      let existingTypeInfo = this.typeCoalesceMap.get(structureKey);
      let fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BopType }>;
      let identifier: CodeVariable;
      let innerScope: CodeScope;
      const methodFuncs: Array<() => void> = [];
      if (existingTypeInfo) {
        identifier = existingTypeInfo.identifier;
        innerScope = existingTypeInfo.innerScope;
        fieldIdentifierMap = existingTypeInfo.fieldIdentifierMap;
      } else {
        identifier = parentScope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, shortName);
        innerScope = parentScope.createChildScope(CodeScopeType.Class);
        fieldIdentifierMap = new Map();
        existingTypeInfo = { identifier, innerScope, fieldIdentifierMap };
        this.typeCoalesceMap.set(structureKey, existingTypeInfo);

        const structWriter = this.writer.global.writeStruct(identifier.identifierToken).struct;
        for (const property of fields) {
          const fieldIdentifier = innerScope.allocateVariableIdentifier(property.type.tempType, BopIdentifierPrefix.Field, property.identifier);
          structWriter.writeField(fieldIdentifier.identifierToken, property.type.tempType);
          fieldIdentifierMap.set(property.identifier, { fieldVar: fieldIdentifier, fieldType: property.type });
        }

        for (const methodDecl of methodDecls) {
          methodFuncs.push(() => {
            const methodVar = this.declareFunction(methodDecl, newType, this.globalBlock, thisBlock, typeArgs);
            if (!methodVar) {
              return;
            }
          });
        }
      }

      let unionOf: BopTypeUnion|undefined;
      if (casesIdentifierMap && caseVariableIdentifier) {
        unionOf = new BopTypeUnion(
          new Map(Array.from(casesIdentifierMap.entries()).map(([type, entry]) => [ type, { caseVar: fieldIdentifierMap.get(entry.identifier)!.fieldVar, caseIndex: entry.index } ])),
          fieldIdentifierMap.get(caseVariableIdentifier)!.fieldVar,
        );
      }

      const innerBlock = parentBlock.createChildBlock(CodeScopeType.Class);
      const typeVar = parentBlock.mapStorageIdentifier(shortName, this.typeType);

      const fieldMap = new Map<string, BopVariable>();
      for (const property of fields) {
        const fieldIdentifier = fieldIdentifierMap.get(property.identifier)!;
        const fieldVar = innerBlock.mapIdentifier(property.identifier, fieldIdentifier.fieldVar.typeSpec, fieldIdentifier.fieldType);
        fieldVar.result = fieldIdentifier.fieldVar;
        fieldMap.set(property.identifier, fieldVar);
      }

      const newType = BopType.createPassByValue({
          debugName: shortName,
          valueType: CodeTypeSpec.fromStruct(identifier.identifierToken),
          innerScope,
          innerBlock,
      });
      if (requiresGenericLookup) {
        let genericInstances = this.typeGenericMap.get(genericBase!);
        if (!genericInstances) {
          genericInstances = new Map();
          this.typeGenericMap.set(genericBase!, genericInstances);
        }
        genericInstances.set(typeParamsKey, newType);
      } else {
        this.typeMap.set(type, newType);
      }
      typeVar.typeResult = newType;



      if (!constructorDecl && existingTypeInfo.defaultConstructor) {
        // Use the existing default constructor.
        const constructorIdentifier = existingTypeInfo.defaultConstructor;
        innerBlock.mapIdentifier('constructor', constructorIdentifier.fieldVar.typeSpec, constructorIdentifier.fieldType).result = constructorIdentifier.fieldVar;
      } else {
        if (!constructorDecl) {
          // Generate a default constructor.
          const constructorIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, shortName);
          const constructorFuncType = BopType.createFunctionType({
            debugName: `${shortName}.constructor`,
            innerScope: innerScope.createChildScope(CodeScopeType.Local),
            innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
            functionOf: new BopFunctionType(
              [],
              newType,
              /* isMethod */ false,
            ),
          });
          existingTypeInfo.defaultConstructor = { fieldVar: constructorIdentifier, fieldType: constructorFuncType };

          innerBlock.mapIdentifier('constructor', constructorIdentifier.typeSpec, constructorFuncType).result = constructorIdentifier;
          const constructorWriter = this.writer.global.writeFunction(constructorIdentifier.identifierToken);
          constructorWriter.returnTypeSpec = newType.storageType;

          const constructorBlock = this.globalBlock.createChildBlock(CodeScopeType.Function);
          const constructorScope = this.writer.global.scope.createChildScope(CodeScopeType.Function);
          const constructorOutVar = constructorScope.allocateVariableIdentifier(newType.storageType, BopIdentifierPrefix.Local, 'New');
          constructorWriter.body.writeVariableDeclaration(constructorOutVar);
          constructorWriter.body.writeReturnStatement().expr.writeVariableReference(constructorOutVar);
        } else {
          // Roll out the constructor implementation.
          this.declareFunction(constructorDecl, newType, this.globalBlock, thisBlock, typeArgs);
        }
      }
      methodFuncs.forEach(f => f());

      return newType;
    } finally {
      this.resolvingSet.delete(type);
    }
  }

  private toStructureKey(fields: BopFields) {
    let structureKey = '';
    for (const entry of fields) {
      const lookupType = entry.type.tempType;
      let typeKey = lookupType.asPrimitive ?? lookupType.asStruct!;
      let typeId = this.typeIdMap.get(typeKey);
      if (typeId === undefined) {
        typeId = this.typeIdMap.size;
        this.typeIdMap.set(typeKey, typeId);
      }
      let structureKeyPart = `${entry.identifier}:${typeId},`;
      if (lookupType.isConst) {
        structureKeyPart = `const ${structureKeyPart}`;
      }
      if (lookupType.isReference) {
        structureKeyPart += '&';
      }
      if (lookupType.isPointer) {
        structureKeyPart += '*';
      }
      if (lookupType.isArray) {
        structureKeyPart += '[]';
      }
      structureKey += structureKeyPart;
    }
    return structureKey;
  }

  private getSymbolType(s: ts.Symbol|undefined) {
    if (s?.valueDeclaration) {
      return this.stringifyType(this.tc.getTypeAtLocation(s.valueDeclaration));
    }
    return '???';
  }

  private stringifyType(type: ts.Type): string {
      // console.log(this.tc.typeToString(type));
      // console.log(this.tc.typeToString(this.tc.getWidenedType(type)));
      // console.log((this.tc as any).getElementTypeOfArrayType(type));
    const isObject = (type.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object && type.symbol;
    const objectFlags = isObject ? (type as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
    const isReference = objectFlags & ts.ObjectFlags.Reference;
    const intrinsicType = (type as any)?.intrinsicName;
    const isError = intrinsicType === 'error';
    if (isError) {
      return '';
    } else if (intrinsicType) {
      return intrinsicType;
    } else if ((type.flags & ts.TypeFlags.Any) === ts.TypeFlags.Any) {
      return 'any';
    } else if (type.isUnion()) {
      return type.types.map(t => this.stringifyType(t)).join('|');
    } else if (type.isIntersection()) {
      return type.types.map(t => this.stringifyType(t)).join('&');
    } else if (type.isLiteral()) {
      return type.value.toString();
    } else if (type.isClassOrInterface()) {
      return type.symbol.name;
    } else if (isReference) {
      return `${type.symbol.name}<${(type as ts.TypeReference).typeArguments?.map(a => this.stringifyType(a)).join(',')}>`;
    } else if (isObject && this.tc.isArrayType(type)) {
      let elementType = isReference ? (type as ts.TypeReference).typeArguments?.at(0) : undefined;
      elementType ??= this.tc.getAnyType();
      return `${this.stringifyType(elementType)}[]`;
    } else if (isObject) {
      if ((type.symbol.flags & ts.SymbolFlags.Function) === ts.SymbolFlags.Function) {
        const signature = this.tc.getSignaturesOfType(type, ts.SignatureKind.Call).at(0);
        if (signature) {
          const returnType = signature.getReturnType();
          return `(${signature.getParameters().map(p => `${p.name}:${this.getSymbolType(p)}`).join(',')}) => ${this.stringifyType(returnType)}`;
        }
      }
      return `{${type.getProperties().map(p => `${p.name}:${this.getSymbolType(p)}`).join(',')}}`;
    }
    return type.symbol?.name ?? ((type as any)?.intrinsicName) ?? '';
  }

  private printRec(node: ts.Node) {
    const sourceMapRange = ts.getSourceMapRange(node);
    const resolvedType = this.tc.getTypeAtLocation(node);

    const nodeKindStr =
        tsGetSyntaxTypeLabel(node.kind)
        ?.replaceAll('Expression', 'Expr')
        ?.replaceAll('Literal', 'Lit')
        ?.replaceAll('Reference', 'Ref')
        ?.replaceAll('Variable', 'Var')
        ?.replaceAll('Declaration', 'Decl')
        ?.replaceAll('Statement', 'Stmt')
        ?.replaceAll('Token', 'Tok')
        ?.replaceAll('Assignment', 'Asgn')
        ?.replaceAll('Keyword', 'Kywd')
        ?.replaceAll('Property', 'Prop')
    let sourceSnippetStr = (sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).replaceAll('\n', '');
    const sourceSnippetLength = 32;
    if (sourceSnippetStr.length > (sourceSnippetLength + 2)) {
      sourceSnippetStr = sourceSnippetStr.substring(0, sourceSnippetLength) + ' …';
    }
    sourceSnippetStr = sourceSnippetStr.trim();
    console.log(`${nodeKindStr?.padEnd(16)}   ${this.stringifyType(resolvedType).padEnd(16)}  <=  ${sourceSnippetStr}`);
    // console.log(resolvedType);

    node.getChildren().forEach(this.printRec.bind(this));
  };
}








// function test(a: int): void;
// function test(a: float): void;
// function test(a: float, b: int): void;
// function test(a: int, b: float): void;
// function test(a: int|float, b?: int|float): void {
// }


// function doSomething() {
//   test(1 as float, 2 as int);
// }









export function compile(code: string) {
  // readonly identifier: string,
  // readonly parameters: LocalDecl[],
  // readonly returnType: TypeSpec,
  // readonly genericTypeParameters: TypeParameter[],
  // readonly statements: Expression[]) {}
  // let exprIndex = 0;
  // const returnNode: BuildNode;
  // const localMap = new Map<LocalDecl, BuildAlias>(func.parameters.map());

  // const expressionMap = new Map<Expression, BuildNode>();
  // const nodeList = Array.from(expressionMap.values()).concat(returnNode).concat(localMap);
  // // TODO: Recurse.
  // for (const s of func.statements) {
  //   if (s definesLocal) {
  //     localMap.;
  //   }
  //   if (s returns) {
  //     //
  //     returnNode.sets.push(expressionMap.get(s.returnExpr));
  //   } else if (s continues) {
  //     //
  //   } else if (s breaks) {
  //     //
  //   }
  //   // if (s terminatesAbnormally) {
  //   //   // Not supported?
  //   // }
  // }

  // const writer = new CodeWriter();
  // const structASymbol = writer.global.scope.allocateIdentifier('struct', 'A');
  // const structARet = writer.global.writeStruct(structASymbol);
  // const structAFieldX = structARet.struct.scope.allocateIdentifier('field', 'x');
  // const structAFieldY = structARet.struct.scope.allocateIdentifier('field', 'y');
  // structARet.struct.writeField(structAFieldX, CodeTypeSpec.intType);
  // structARet.struct.writeField(structAFieldY, CodeTypeSpec.intType);

  // const funcSomethingRet = writer.global.writeFunction(writer.global.scope.allocateIdentifier('f', 'funcSomething'), []);
  // {
  //   const aVar = funcSomethingRet.body.scope.createVariableInScope(CodeTypeSpec.fromStruct(structASymbol), 'aStruct');
  //   const stmt = funcSomethingRet.body.writeVariableDeclaration(aVar);
  //   stmt.initializer.writeAssignStructField(structAFieldX).value.writeLiteralInt(123);
  //   stmt.initializer.writeAssignStructField(structAFieldY).value.writeLiteralInt(234);
  // }
  // {
  //   const aVar = funcSomethingRet.body.scope.createVariableInScope(CodeTypeSpec.intType, 'a');
  //   const stmt = funcSomethingRet.body.writeVariableDeclaration(aVar);
  //   stmt.initializer.writeExpression().writeLiteralInt(123);
  // }
  // {
  //   const stmt = funcSomethingRet.body.writeReturnStatement();
  //   const op1 = stmt.expr.writeBinaryOperation(CodeBinaryOperator.Add);
  //   const op2 = op1.lhs.writeBinaryOperation(CodeBinaryOperator.Add);
  //   op2.lhs.writeLiteralInt(1);
  //   op2.rhs.writeLiteralInt(2);
  //   op1.rhs.writeLiteralInt(3);
  // }

  // console.log(writer.getOuterCode());



  // ts.sys = new CodeSystem();
  const compilerHost = new MemoryCompilerHost(new Map<string, string>([
    [ 'test.ts', code ],
    [ 'default.d.ts', libCode ],
  ]));
  // const root = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest);
  // console.log(root);
  const program = ts.createProgram(['test.ts'], {}, compilerHost);
  // const tc = program.getTypeChecker();
  // console.log(program);
  const root = program.getSourceFile('test.ts')!;

  new BopProcessor(program, root);
  // const rootExpr = visitNodeRec(root)!;
  // console.log(rootExpr);
}





const libCode = `

interface boolean2 {}
interface boolean3 {}
interface boolean4 {}
interface int { isInt: true }
interface int2 {}
interface int3 {}
interface int4 {}
interface float { isFloat: true }
interface float2 {}
interface float3 {}
interface float4 {}

interface Vector2Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, y: TElement): TVector;
  new (xy: Swizzlable2<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean2: Vector2Constructor<boolean2, boolean>;
declare var int2: Vector2Constructor<int2, int>;
declare var float2: Vector2Constructor<float2, float>;

interface Vector3Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, yz: Swizzlable2<TElement>): TVector;
  new (xy: Swizzlable2<TElement>, z: TElement): TVector;
  new (xyz: Swizzlable3<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean3: Vector3Constructor<boolean3, boolean>;
declare var int3: Vector3Constructor<int3, int>;
declare var float3: Vector3Constructor<float3, float>;

interface Vector4Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, y: TElement, zw: Swizzlable2<TElement>): TVector;
  new (x: TElement, yz: Swizzlable2<TElement>, w: TElement): TVector;
  new (xy: Swizzlable2<TElement>, z: TElement, w: TElement): TVector;
  new (xy: Swizzlable2<TElement>, zw: Swizzlable2<TElement>): TVector;
  new (x: TElement, yzw: Swizzlable3<TElement>): TVector;
  new (xyz: Swizzlable3<TElement>, w: TElement): TVector;
  new (xyzw: Swizzlable4<TElement>): TVector;

  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean4: Vector4Constructor<boolean4, boolean>;
declare var int4: Vector4Constructor<int4, int>;
declare var float4: Vector4Constructor<float4, float>;





interface Swizzlable2<T> {
  x: T;
  y: T;
  xy: Swizzlable2<T>;
  yx: Swizzlable2<T>;
}
interface boolean2 extends Swizzlable2<boolean> {}
interface int2 extends Swizzlable2<int> {}
interface float2 extends Swizzlable2<float> {}

interface Swizzlable3<T> {
  x: T;
  y: T;
  z: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
}
interface boolean3 extends Swizzlable3<boolean> {}
interface int3 extends Swizzlable3<int> {}
interface float3 extends Swizzlable3<float> {}

interface Swizzlable4<T> {
  x: T;
  y: T;
  z: T;
  w: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  xw: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  yw: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  zw: Swizzlable2<T>;
  wx: Swizzlable2<T>;
  wy: Swizzlable2<T>;
  wz: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xyw: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  xzw: Swizzlable3<T>;
  xwy: Swizzlable3<T>;
  xwz: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yxw: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  yzw: Swizzlable3<T>;
  ywx: Swizzlable3<T>;
  ywz: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zxw: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
  zyw: Swizzlable3<T>;
  zwx: Swizzlable3<T>;
  zwy: Swizzlable3<T>;
  wxy: Swizzlable3<T>;
  wxz: Swizzlable3<T>;
  wyx: Swizzlable3<T>;
  wyz: Swizzlable3<T>;
  wzx: Swizzlable3<T>;
  wzy: Swizzlable3<T>;
  xyzw: Swizzlable4<T>;
  xywz: Swizzlable4<T>;
  xzyw: Swizzlable4<T>;
  xzwy: Swizzlable4<T>;
  xwyz: Swizzlable4<T>;
  xwzy: Swizzlable4<T>;
  yxzw: Swizzlable4<T>;
  yxwz: Swizzlable4<T>;
  yzxw: Swizzlable4<T>;
  yzwx: Swizzlable4<T>;
  ywxz: Swizzlable4<T>;
  ywzx: Swizzlable4<T>;
  zxyw: Swizzlable4<T>;
  zxwy: Swizzlable4<T>;
  zyxw: Swizzlable4<T>;
  zywx: Swizzlable4<T>;
  zwxy: Swizzlable4<T>;
  zwyx: Swizzlable4<T>;
  wxyz: Swizzlable4<T>;
  wxzy: Swizzlable4<T>;
  wyxz: Swizzlable4<T>;
  wyzx: Swizzlable4<T>;
  wzxy: Swizzlable4<T>;
  wzyx: Swizzlable4<T>;
}
interface boolean4 extends Swizzlable4<boolean> {}
interface int4 extends Swizzlable4<int> {}
interface float4 extends Swizzlable4<float> {}



interface AtomicCounter {
  relaxedGet(): int;
  relaxedGetAndIncrement(): int;
  relaxedGetAndIncrement(delta: int): int;
}
interface AtomicCounterConstructor {
  new (): AtomicCounter;
  new (initialValue: int): AtomicCounter;
}
declare var AtomicCounter: AtomicCounterConstructor;


interface Texture {
  width: int;
  height: int;
  size: int2;
  channels: int;

  fill(color: float4);
  syncToGpu();

  sample<TCoordMode extends CoordMode, TFilterMode extends FilterMode, TAddressMode extends AddressMode>(
      uv: float2): float4;
}
interface TextureConstructor {
  new (width: int, height: int, channels: int = 4): Texture;
  new (size: int2, channels: int = 4): Texture;
}
declare var Texture: TextureConstructor;


interface CoordMode { coordMode: 0|1; }
interface NormalizedCoordMode extends CoordMode { coordMode: 0; }
interface PixelCoordMode extends CoordMode { coordMode: 1; }

interface FilterMode { filterMode: 0|1|2; }
interface NearestFilterMode { filterMode: 0; }
interface LinearFilterMode { filterMode: 1; }
interface BicubicFilterMode { filterMode: 2; }

interface AddressMode { addressMode: 0|1|2|3|4; }
interface ClampToZeroAddressMode { addressMode: 0; }
interface ClampToEdgeAddressMode { addressMode: 1; }
interface RepeatAddressMode { addressMode: 2; }
interface MirroredRepeatAddressMode { addressMode: 3; }
interface ClampToBorderAddressMode { addressMode: 4; }



interface Array<T> {
  [n: int]: T;
  length: int;

  readonly isGpuBufferDirty: boolean;
  readonly isCpuBufferDirty: boolean;

  syncToGpu();
  syncToCpu();
}
interface ArrayConstructor {
  new <T>(): Array<T>;
  new <T>(length: int): Array<T>;
  new <T>(length: int, fill: T): Array<T>;
}
declare var Array: ArrayConstructor;


interface RelativeIndexable<T> {
  at(index: int): T | undefined;
}
interface Array<T> extends RelativeIndexable<T> {}
`;




















class CodeSystem implements ts.System {
  args = [];
  newLine = '\n';
  useCaseSensitiveFileNames = true;
  write(s: string): void {}
  // writeOutputIsTTY?(): boolean;
  // getWidthOfTerminal?(): number;
  readFile(path: string, encoding?: string): string | undefined { return ''; }
  // getFileSize?(path: string): number;
  writeFile(path: string, data: string, writeByteOrderMark?: boolean): void {}
  // /**
  //   * @pollingInterval - this parameter is used in polling-based watchers and ignored in watchers that
  //   * use native OS file watching
  //   */
  // watchFile?(path: string, callback: FileWatcherCallback, pollingInterval?: number, options?: WatchOptions): FileWatcher;
  // watchDirectory?(path: string, callback: DirectoryWatcherCallback, recursive?: boolean, options?: WatchOptions): FileWatcher;
  resolvePath(path: string): string { return path; };
  fileExists(path: string): boolean { return true; }
  directoryExists(path: string): boolean { return true; }
  createDirectory(path: string): void {}
  getExecutingFilePath(): string { return '/'; }
  getCurrentDirectory(): string { return '/'; }
  getDirectories(path: string): string[] { return []; }
  readDirectory(path: string, extensions?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number): string[] { return []; }
  // getModifiedTime?(path: string): Date | undefined;
  // setModifiedTime?(path: string, time: Date): void;
  // deleteFile?(path: string): void;
  // /**
  //   * A good implementation is node.js' `crypto.createHash`. (https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm)
  //   */
  // createHash?(data: string): string;
  // /** This must be cryptographically secure. Only implement this method using `crypto.createHash("sha256")`. */
  // createSHA256Hash?(data: string): string;
  // getMemoryUsage?(): number;
  exit(exitCode?: number): void {}
  // realpath?(path: string): string;
  // setTimeout?(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
  // clearTimeout?(timeoutId: any): void;
  // clearScreen?(): void;
  // base64decode?(input: string): string;
  // base64encode?(input: string): string;
}

class MemoryCompilerHost implements ts.CompilerHost {
  constructor(public codeFiles: Map<string, string>) {}

  fileExists(fileName: string): boolean {
    console.log(`readFile ${fileName}`);
    return true;
  }
  readFile(fileName: string): string | undefined {
    console.log(`readFile ${fileName}`);
    return '';
  }
  // trace?(s: string): void;
  // directoryExists?(directoryName: string): boolean;
  // realpath?(path: string): string;
  // getCurrentDirectory?(): string;
  // getDirectories?(path: string): string[];
  // useCaseSensitiveFileNames?: boolean | (() => boolean) | undefined;

  getSourceFile(fileName: string, languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
    console.log(`getSourceFile ${fileName}: shouldCreateNewSourceFile: ${shouldCreateNewSourceFile}`);
    const code = this.codeFiles.get(fileName);
    if (code === undefined) {
      return undefined;
    }
    const root = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest);
    return root;
  }
  // getSourceFileByPath?(fileName: string, path: Path, languageVersionOrOptions: ScriptTarget | CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): SourceFile | undefined;
  // getCancellationToken?(): CancellationToken;
  getDefaultLibFileName(options: ts.CompilerOptions): string { return 'default'; }
  getDefaultLibLocation?(): string { return '/'; }
  writeFile: ts.WriteFileCallback = (fileName: string, text: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: readonly ts.SourceFile[], data?: ts.WriteFileCallbackData) => {};
  getCurrentDirectory(): string { return '/'; }
  getCanonicalFileName(fileName: string): string { return fileName; }
  useCaseSensitiveFileNames(): boolean { return true; }
  getNewLine(): string { return '\n'; }
  // readDirectory?(rootDir: string, extensions: readonly string[], excludes: readonly string[] | undefined, includes: readonly string[], depth?: number): string[];
  // resolveModuleNames?(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile?: SourceFile): (ResolvedModule | undefined)[];
  // getModuleResolutionCache?(): ts.ModuleResolutionCache | undefined;
  // resolveTypeReferenceDirectives?(typeReferenceDirectiveNames: string[] | readonly FileReference[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingFileMode?: ResolutionMode): (ResolvedTypeReferenceDirective | undefined)[];
  // resolveModuleNameLiterals?(moduleLiterals: readonly StringLiteralLike[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile, reusedNames: readonly StringLiteralLike[] | undefined): readonly ResolvedModuleWithFailedLookupLocations[];
  // resolveTypeReferenceDirectiveReferences?<T extends FileReference | string>(typeDirectiveReferences: readonly T[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile | undefined, reusedNames: readonly T[] | undefined): readonly ResolvedTypeReferenceDirectiveWithFailedLookupLocations[];
  // getEnvironmentVariable?(name: string): string | undefined;
  // hasInvalidatedResolutions?(filePath: Path): boolean;
  // createHash?(data: string): string;
  // getParsedCommandLine?(fileName: string): ParsedCommandLine | undefined;
}






const enum tsTypeMapKind {
    Simple,
    Array,
    Deferred,
    Function,
    Composite,
    Merged,
}

type tsTypeMapper =
    | { kind: tsTypeMapKind.Simple; source: ts.Type; target: ts.Type; }
    | { kind: tsTypeMapKind.Array; sources: readonly ts.Type[]; targets: readonly ts.Type[] | undefined; }
    | { kind: tsTypeMapKind.Deferred; sources: readonly ts.Type[]; targets: (() => ts.Type)[]; }
    | { kind: tsTypeMapKind.Function; func: (t: ts.Type) => ts.Type; debugInfo?: () => string; }
    | { kind: tsTypeMapKind.Composite | tsTypeMapKind.Merged; mapper1: tsTypeMapper; mapper2: tsTypeMapper; };

function tsGetMappedType(type: ts.Type, mapper: tsTypeMapper, tc: ts.TypeChecker): ts.Type {
  switch (mapper.kind) {
    case tsTypeMapKind.Simple:
      return type === mapper.source ? mapper.target : type;
    case tsTypeMapKind.Array: {
      const sources = mapper.sources;
      const targets = mapper.targets;
      for (let i = 0; i < sources.length; i++) {
        if (type === sources[i]) {
          return targets ? targets[i] : tc.getAnyType();
        }
      }
      return type;
    }
    case tsTypeMapKind.Deferred: {
      const sources = mapper.sources;
      const targets = mapper.targets;
      for (let i = 0; i < sources.length; i++) {
        if (type === sources[i]) {
          return targets[i]();
        }
      }
      return type;
    }
    case tsTypeMapKind.Function:
      return mapper.func(type);
    case tsTypeMapKind.Composite:
    case tsTypeMapKind.Merged:
      throw new Error('Unsupported.');
      // const t1 = tsGetMappedType(type, mapper.mapper1, tc);
      // return t1 !== type && mapper.kind === tsTypeMapKind.Composite ? instantiateType(t1, mapper.mapper2) : tsGetMappedType(t1, mapper.mapper2, tc);
  }
}

function tsGetSourceFileOfNode(node: ts.Node | undefined): ts.SourceFile | undefined {
  while (node && node.kind !== ts.SyntaxKind.SourceFile) {
    node = node.parent;
  }
  return node as ts.SourceFile;
}




function tsGetSyntaxTypeLabel(kind: ts.SyntaxKind) {
  return SYNTAX_TYPE_NAME_MAP.get(kind);
}

const SYNTAX_TYPE_NAME_MAP = new Map<ts.SyntaxKind, string>(utils.filterUnique([
  [ ts.SyntaxKind.Unknown, 'Unknown' ],
  [ ts.SyntaxKind.EndOfFileToken, 'EndOfFileToken' ],
  [ ts.SyntaxKind.SingleLineCommentTrivia, 'SingleLineCommentTrivia' ],
  [ ts.SyntaxKind.MultiLineCommentTrivia, 'MultiLineCommentTrivia' ],
  [ ts.SyntaxKind.NewLineTrivia, 'NewLineTrivia' ],
  [ ts.SyntaxKind.WhitespaceTrivia, 'WhitespaceTrivia' ],
  [ ts.SyntaxKind.ShebangTrivia, 'ShebangTrivia' ],
  [ ts.SyntaxKind.ConflictMarkerTrivia, 'ConflictMarkerTrivia' ],
  [ ts.SyntaxKind.NonTextFileMarkerTrivia, 'NonTextFileMarkerTrivia' ],
  [ ts.SyntaxKind.NumericLiteral, 'NumericLiteral' ],
  [ ts.SyntaxKind.BigIntLiteral, 'BigIntLiteral' ],
  [ ts.SyntaxKind.StringLiteral, 'StringLiteral' ],
  [ ts.SyntaxKind.JsxText, 'JsxText' ],
  [ ts.SyntaxKind.JsxTextAllWhiteSpaces, 'JsxTextAllWhiteSpaces' ],
  [ ts.SyntaxKind.RegularExpressionLiteral, 'RegularExpressionLiteral' ],
  [ ts.SyntaxKind.NoSubstitutionTemplateLiteral, 'NoSubstitutionTemplateLiteral' ],
  [ ts.SyntaxKind.TemplateHead, 'TemplateHead' ],
  [ ts.SyntaxKind.TemplateMiddle, 'TemplateMiddle' ],
  [ ts.SyntaxKind.TemplateTail, 'TemplateTail' ],
  [ ts.SyntaxKind.OpenBraceToken, 'OpenBraceToken' ],
  [ ts.SyntaxKind.CloseBraceToken, 'CloseBraceToken' ],
  [ ts.SyntaxKind.OpenParenToken, 'OpenParenToken' ],
  [ ts.SyntaxKind.CloseParenToken, 'CloseParenToken' ],
  [ ts.SyntaxKind.OpenBracketToken, 'OpenBracketToken' ],
  [ ts.SyntaxKind.CloseBracketToken, 'CloseBracketToken' ],
  [ ts.SyntaxKind.DotToken, 'DotToken' ],
  [ ts.SyntaxKind.DotDotDotToken, 'DotDotDotToken' ],
  [ ts.SyntaxKind.SemicolonToken, 'SemicolonToken' ],
  [ ts.SyntaxKind.CommaToken, 'CommaToken' ],
  [ ts.SyntaxKind.QuestionDotToken, 'QuestionDotToken' ],
  [ ts.SyntaxKind.LessThanToken, 'LessThanToken' ],
  [ ts.SyntaxKind.LessThanSlashToken, 'LessThanSlashToken' ],
  [ ts.SyntaxKind.GreaterThanToken, 'GreaterThanToken' ],
  [ ts.SyntaxKind.LessThanEqualsToken, 'LessThanEqualsToken' ],
  [ ts.SyntaxKind.GreaterThanEqualsToken, 'GreaterThanEqualsToken' ],
  [ ts.SyntaxKind.EqualsEqualsToken, 'EqualsEqualsToken' ],
  [ ts.SyntaxKind.ExclamationEqualsToken, 'ExclamationEqualsToken' ],
  [ ts.SyntaxKind.EqualsEqualsEqualsToken, 'EqualsEqualsEqualsToken' ],
  [ ts.SyntaxKind.ExclamationEqualsEqualsToken, 'ExclamationEqualsEqualsToken' ],
  [ ts.SyntaxKind.EqualsGreaterThanToken, 'EqualsGreaterThanToken' ],
  [ ts.SyntaxKind.PlusToken, 'PlusToken' ],
  [ ts.SyntaxKind.MinusToken, 'MinusToken' ],
  [ ts.SyntaxKind.AsteriskToken, 'AsteriskToken' ],
  [ ts.SyntaxKind.AsteriskAsteriskToken, 'AsteriskAsteriskToken' ],
  [ ts.SyntaxKind.SlashToken, 'SlashToken' ],
  [ ts.SyntaxKind.PercentToken, 'PercentToken' ],
  [ ts.SyntaxKind.PlusPlusToken, 'PlusPlusToken' ],
  [ ts.SyntaxKind.MinusMinusToken, 'MinusMinusToken' ],
  [ ts.SyntaxKind.LessThanLessThanToken, 'LessThanLessThanToken' ],
  [ ts.SyntaxKind.GreaterThanGreaterThanToken, 'GreaterThanGreaterThanToken' ],
  [ ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, 'GreaterThanGreaterThanGreaterThanToken' ],
  [ ts.SyntaxKind.AmpersandToken, 'AmpersandToken' ],
  [ ts.SyntaxKind.BarToken, 'BarToken' ],
  [ ts.SyntaxKind.CaretToken, 'CaretToken' ],
  [ ts.SyntaxKind.ExclamationToken, 'ExclamationToken' ],
  [ ts.SyntaxKind.TildeToken, 'TildeToken' ],
  [ ts.SyntaxKind.AmpersandAmpersandToken, 'AmpersandAmpersandToken' ],
  [ ts.SyntaxKind.BarBarToken, 'BarBarToken' ],
  [ ts.SyntaxKind.QuestionToken, 'QuestionToken' ],
  [ ts.SyntaxKind.ColonToken, 'ColonToken' ],
  [ ts.SyntaxKind.AtToken, 'AtToken' ],
  [ ts.SyntaxKind.QuestionQuestionToken, 'QuestionQuestionToken' ],
  [ ts.SyntaxKind.BacktickToken, 'BacktickToken' ],
  [ ts.SyntaxKind.HashToken, 'HashToken' ],
  [ ts.SyntaxKind.EqualsToken, 'EqualsToken' ],
  [ ts.SyntaxKind.PlusEqualsToken, 'PlusEqualsToken' ],
  [ ts.SyntaxKind.MinusEqualsToken, 'MinusEqualsToken' ],
  [ ts.SyntaxKind.AsteriskEqualsToken, 'AsteriskEqualsToken' ],
  [ ts.SyntaxKind.AsteriskAsteriskEqualsToken, 'AsteriskAsteriskEqualsToken' ],
  [ ts.SyntaxKind.SlashEqualsToken, 'SlashEqualsToken' ],
  [ ts.SyntaxKind.PercentEqualsToken, 'PercentEqualsToken' ],
  [ ts.SyntaxKind.LessThanLessThanEqualsToken, 'LessThanLessThanEqualsToken' ],
  [ ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, 'GreaterThanGreaterThanEqualsToken' ],
  [ ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, 'GreaterThanGreaterThanGreaterThanEqualsToken' ],
  [ ts.SyntaxKind.AmpersandEqualsToken, 'AmpersandEqualsToken' ],
  [ ts.SyntaxKind.BarEqualsToken, 'BarEqualsToken' ],
  [ ts.SyntaxKind.BarBarEqualsToken, 'BarBarEqualsToken' ],
  [ ts.SyntaxKind.AmpersandAmpersandEqualsToken, 'AmpersandAmpersandEqualsToken' ],
  [ ts.SyntaxKind.QuestionQuestionEqualsToken, 'QuestionQuestionEqualsToken' ],
  [ ts.SyntaxKind.CaretEqualsToken, 'CaretEqualsToken' ],
  [ ts.SyntaxKind.Identifier, 'Identifier' ],
  [ ts.SyntaxKind.PrivateIdentifier, 'PrivateIdentifier' ],
  [ ts.SyntaxKind.BreakKeyword, 'BreakKeyword' ],
  [ ts.SyntaxKind.CaseKeyword, 'CaseKeyword' ],
  [ ts.SyntaxKind.CatchKeyword, 'CatchKeyword' ],
  [ ts.SyntaxKind.ClassKeyword, 'ClassKeyword' ],
  [ ts.SyntaxKind.ConstKeyword, 'ConstKeyword' ],
  [ ts.SyntaxKind.ContinueKeyword, 'ContinueKeyword' ],
  [ ts.SyntaxKind.DebuggerKeyword, 'DebuggerKeyword' ],
  [ ts.SyntaxKind.DefaultKeyword, 'DefaultKeyword' ],
  [ ts.SyntaxKind.DeleteKeyword, 'DeleteKeyword' ],
  [ ts.SyntaxKind.DoKeyword, 'DoKeyword' ],
  [ ts.SyntaxKind.ElseKeyword, 'ElseKeyword' ],
  [ ts.SyntaxKind.EnumKeyword, 'EnumKeyword' ],
  [ ts.SyntaxKind.ExportKeyword, 'ExportKeyword' ],
  [ ts.SyntaxKind.ExtendsKeyword, 'ExtendsKeyword' ],
  [ ts.SyntaxKind.FalseKeyword, 'FalseKeyword' ],
  [ ts.SyntaxKind.FinallyKeyword, 'FinallyKeyword' ],
  [ ts.SyntaxKind.ForKeyword, 'ForKeyword' ],
  [ ts.SyntaxKind.FunctionKeyword, 'FunctionKeyword' ],
  [ ts.SyntaxKind.IfKeyword, 'IfKeyword' ],
  [ ts.SyntaxKind.ImportKeyword, 'ImportKeyword' ],
  [ ts.SyntaxKind.InKeyword, 'InKeyword' ],
  [ ts.SyntaxKind.InstanceOfKeyword, 'InstanceOfKeyword' ],
  [ ts.SyntaxKind.NewKeyword, 'NewKeyword' ],
  [ ts.SyntaxKind.NullKeyword, 'NullKeyword' ],
  [ ts.SyntaxKind.ReturnKeyword, 'ReturnKeyword' ],
  [ ts.SyntaxKind.SuperKeyword, 'SuperKeyword' ],
  [ ts.SyntaxKind.SwitchKeyword, 'SwitchKeyword' ],
  [ ts.SyntaxKind.ThisKeyword, 'ThisKeyword' ],
  [ ts.SyntaxKind.ThrowKeyword, 'ThrowKeyword' ],
  [ ts.SyntaxKind.TrueKeyword, 'TrueKeyword' ],
  [ ts.SyntaxKind.TryKeyword, 'TryKeyword' ],
  [ ts.SyntaxKind.TypeOfKeyword, 'TypeOfKeyword' ],
  [ ts.SyntaxKind.VarKeyword, 'VarKeyword' ],
  [ ts.SyntaxKind.VoidKeyword, 'VoidKeyword' ],
  [ ts.SyntaxKind.WhileKeyword, 'WhileKeyword' ],
  [ ts.SyntaxKind.WithKeyword, 'WithKeyword' ],
  [ ts.SyntaxKind.ImplementsKeyword, 'ImplementsKeyword' ],
  [ ts.SyntaxKind.InterfaceKeyword, 'InterfaceKeyword' ],
  [ ts.SyntaxKind.LetKeyword, 'LetKeyword' ],
  [ ts.SyntaxKind.PackageKeyword, 'PackageKeyword' ],
  [ ts.SyntaxKind.PrivateKeyword, 'PrivateKeyword' ],
  [ ts.SyntaxKind.ProtectedKeyword, 'ProtectedKeyword' ],
  [ ts.SyntaxKind.PublicKeyword, 'PublicKeyword' ],
  [ ts.SyntaxKind.StaticKeyword, 'StaticKeyword' ],
  [ ts.SyntaxKind.YieldKeyword, 'YieldKeyword' ],
  [ ts.SyntaxKind.AbstractKeyword, 'AbstractKeyword' ],
  [ ts.SyntaxKind.AccessorKeyword, 'AccessorKeyword' ],
  [ ts.SyntaxKind.AsKeyword, 'AsKeyword' ],
  [ ts.SyntaxKind.AssertsKeyword, 'AssertsKeyword' ],
  [ ts.SyntaxKind.AssertKeyword, 'AssertKeyword' ],
  [ ts.SyntaxKind.AnyKeyword, 'AnyKeyword' ],
  [ ts.SyntaxKind.AsyncKeyword, 'AsyncKeyword' ],
  [ ts.SyntaxKind.AwaitKeyword, 'AwaitKeyword' ],
  [ ts.SyntaxKind.BooleanKeyword, 'BooleanKeyword' ],
  [ ts.SyntaxKind.ConstructorKeyword, 'ConstructorKeyword' ],
  [ ts.SyntaxKind.DeclareKeyword, 'DeclareKeyword' ],
  [ ts.SyntaxKind.GetKeyword, 'GetKeyword' ],
  [ ts.SyntaxKind.InferKeyword, 'InferKeyword' ],
  [ ts.SyntaxKind.IntrinsicKeyword, 'IntrinsicKeyword' ],
  [ ts.SyntaxKind.IsKeyword, 'IsKeyword' ],
  [ ts.SyntaxKind.KeyOfKeyword, 'KeyOfKeyword' ],
  [ ts.SyntaxKind.ModuleKeyword, 'ModuleKeyword' ],
  [ ts.SyntaxKind.NamespaceKeyword, 'NamespaceKeyword' ],
  [ ts.SyntaxKind.NeverKeyword, 'NeverKeyword' ],
  [ ts.SyntaxKind.OutKeyword, 'OutKeyword' ],
  [ ts.SyntaxKind.ReadonlyKeyword, 'ReadonlyKeyword' ],
  [ ts.SyntaxKind.RequireKeyword, 'RequireKeyword' ],
  [ ts.SyntaxKind.NumberKeyword, 'NumberKeyword' ],
  [ ts.SyntaxKind.ObjectKeyword, 'ObjectKeyword' ],
  [ ts.SyntaxKind.SatisfiesKeyword, 'SatisfiesKeyword' ],
  [ ts.SyntaxKind.SetKeyword, 'SetKeyword' ],
  [ ts.SyntaxKind.StringKeyword, 'StringKeyword' ],
  [ ts.SyntaxKind.SymbolKeyword, 'SymbolKeyword' ],
  [ ts.SyntaxKind.TypeKeyword, 'TypeKeyword' ],
  [ ts.SyntaxKind.UndefinedKeyword, 'UndefinedKeyword' ],
  [ ts.SyntaxKind.UniqueKeyword, 'UniqueKeyword' ],
  [ ts.SyntaxKind.UnknownKeyword, 'UnknownKeyword' ],
  [ ts.SyntaxKind.UsingKeyword, 'UsingKeyword' ],
  [ ts.SyntaxKind.FromKeyword, 'FromKeyword' ],
  [ ts.SyntaxKind.GlobalKeyword, 'GlobalKeyword' ],
  [ ts.SyntaxKind.BigIntKeyword, 'BigIntKeyword' ],
  [ ts.SyntaxKind.OverrideKeyword, 'OverrideKeyword' ],
  [ ts.SyntaxKind.OfKeyword, 'OfKeyword' ],
  [ ts.SyntaxKind.QualifiedName, 'QualifiedName' ],
  [ ts.SyntaxKind.ComputedPropertyName, 'ComputedPropertyName' ],
  [ ts.SyntaxKind.TypeParameter, 'TypeParameter' ],
  [ ts.SyntaxKind.Parameter, 'Parameter' ],
  [ ts.SyntaxKind.Decorator, 'Decorator' ],
  [ ts.SyntaxKind.PropertySignature, 'PropertySignature' ],
  [ ts.SyntaxKind.PropertyDeclaration, 'PropertyDeclaration' ],
  [ ts.SyntaxKind.MethodSignature, 'MethodSignature' ],
  [ ts.SyntaxKind.MethodDeclaration, 'MethodDeclaration' ],
  [ ts.SyntaxKind.ClassStaticBlockDeclaration, 'ClassStaticBlockDeclaration' ],
  [ ts.SyntaxKind.Constructor, 'Constructor' ],
  [ ts.SyntaxKind.GetAccessor, 'GetAccessor' ],
  [ ts.SyntaxKind.SetAccessor, 'SetAccessor' ],
  [ ts.SyntaxKind.CallSignature, 'CallSignature' ],
  [ ts.SyntaxKind.ConstructSignature, 'ConstructSignature' ],
  [ ts.SyntaxKind.IndexSignature, 'IndexSignature' ],
  [ ts.SyntaxKind.TypePredicate, 'TypePredicate' ],
  [ ts.SyntaxKind.TypeReference, 'TypeReference' ],
  [ ts.SyntaxKind.FunctionType, 'FunctionType' ],
  [ ts.SyntaxKind.ConstructorType, 'ConstructorType' ],
  [ ts.SyntaxKind.TypeQuery, 'TypeQuery' ],
  [ ts.SyntaxKind.TypeLiteral, 'TypeLiteral' ],
  [ ts.SyntaxKind.ArrayType, 'ArrayType' ],
  [ ts.SyntaxKind.TupleType, 'TupleType' ],
  [ ts.SyntaxKind.OptionalType, 'OptionalType' ],
  [ ts.SyntaxKind.RestType, 'RestType' ],
  [ ts.SyntaxKind.UnionType, 'UnionType' ],
  [ ts.SyntaxKind.IntersectionType, 'IntersectionType' ],
  [ ts.SyntaxKind.ConditionalType, 'ConditionalType' ],
  [ ts.SyntaxKind.InferType, 'InferType' ],
  [ ts.SyntaxKind.ParenthesizedType, 'ParenthesizedType' ],
  [ ts.SyntaxKind.ThisType, 'ThisType' ],
  [ ts.SyntaxKind.TypeOperator, 'TypeOperator' ],
  [ ts.SyntaxKind.IndexedAccessType, 'IndexedAccessType' ],
  [ ts.SyntaxKind.MappedType, 'MappedType' ],
  [ ts.SyntaxKind.LiteralType, 'LiteralType' ],
  [ ts.SyntaxKind.NamedTupleMember, 'NamedTupleMember' ],
  [ ts.SyntaxKind.TemplateLiteralType, 'TemplateLiteralType' ],
  [ ts.SyntaxKind.TemplateLiteralTypeSpan, 'TemplateLiteralTypeSpan' ],
  [ ts.SyntaxKind.ImportType, 'ImportType' ],
  [ ts.SyntaxKind.ObjectBindingPattern, 'ObjectBindingPattern' ],
  [ ts.SyntaxKind.ArrayBindingPattern, 'ArrayBindingPattern' ],
  [ ts.SyntaxKind.BindingElement, 'BindingElement' ],
  [ ts.SyntaxKind.ArrayLiteralExpression, 'ArrayLiteralExpression' ],
  [ ts.SyntaxKind.ObjectLiteralExpression, 'ObjectLiteralExpression' ],
  [ ts.SyntaxKind.PropertyAccessExpression, 'PropertyAccessExpression' ],
  [ ts.SyntaxKind.ElementAccessExpression, 'ElementAccessExpression' ],
  [ ts.SyntaxKind.CallExpression, 'CallExpression' ],
  [ ts.SyntaxKind.NewExpression, 'NewExpression' ],
  [ ts.SyntaxKind.TaggedTemplateExpression, 'TaggedTemplateExpression' ],
  [ ts.SyntaxKind.TypeAssertionExpression, 'TypeAssertionExpression' ],
  [ ts.SyntaxKind.ParenthesizedExpression, 'ParenthesizedExpression' ],
  [ ts.SyntaxKind.FunctionExpression, 'FunctionExpression' ],
  [ ts.SyntaxKind.ArrowFunction, 'ArrowFunction' ],
  [ ts.SyntaxKind.DeleteExpression, 'DeleteExpression' ],
  [ ts.SyntaxKind.TypeOfExpression, 'TypeOfExpression' ],
  [ ts.SyntaxKind.VoidExpression, 'VoidExpression' ],
  [ ts.SyntaxKind.AwaitExpression, 'AwaitExpression' ],
  [ ts.SyntaxKind.PrefixUnaryExpression, 'PrefixUnaryExpression' ],
  [ ts.SyntaxKind.PostfixUnaryExpression, 'PostfixUnaryExpression' ],
  [ ts.SyntaxKind.BinaryExpression, 'BinaryExpression' ],
  [ ts.SyntaxKind.ConditionalExpression, 'ConditionalExpression' ],
  [ ts.SyntaxKind.TemplateExpression, 'TemplateExpression' ],
  [ ts.SyntaxKind.YieldExpression, 'YieldExpression' ],
  [ ts.SyntaxKind.SpreadElement, 'SpreadElement' ],
  [ ts.SyntaxKind.ClassExpression, 'ClassExpression' ],
  [ ts.SyntaxKind.OmittedExpression, 'OmittedExpression' ],
  [ ts.SyntaxKind.ExpressionWithTypeArguments, 'ExpressionWithTypeArguments' ],
  [ ts.SyntaxKind.AsExpression, 'AsExpression' ],
  [ ts.SyntaxKind.NonNullExpression, 'NonNullExpression' ],
  [ ts.SyntaxKind.MetaProperty, 'MetaProperty' ],
  [ ts.SyntaxKind.SyntheticExpression, 'SyntheticExpression' ],
  [ ts.SyntaxKind.SatisfiesExpression, 'SatisfiesExpression' ],
  [ ts.SyntaxKind.TemplateSpan, 'TemplateSpan' ],
  [ ts.SyntaxKind.SemicolonClassElement, 'SemicolonClassElement' ],
  [ ts.SyntaxKind.Block, 'Block' ],
  [ ts.SyntaxKind.EmptyStatement, 'EmptyStatement' ],
  [ ts.SyntaxKind.VariableStatement, 'VariableStatement' ],
  [ ts.SyntaxKind.ExpressionStatement, 'ExpressionStatement' ],
  [ ts.SyntaxKind.IfStatement, 'IfStatement' ],
  [ ts.SyntaxKind.DoStatement, 'DoStatement' ],
  [ ts.SyntaxKind.WhileStatement, 'WhileStatement' ],
  [ ts.SyntaxKind.ForStatement, 'ForStatement' ],
  [ ts.SyntaxKind.ForInStatement, 'ForInStatement' ],
  [ ts.SyntaxKind.ForOfStatement, 'ForOfStatement' ],
  [ ts.SyntaxKind.ContinueStatement, 'ContinueStatement' ],
  [ ts.SyntaxKind.BreakStatement, 'BreakStatement' ],
  [ ts.SyntaxKind.ReturnStatement, 'ReturnStatement' ],
  [ ts.SyntaxKind.WithStatement, 'WithStatement' ],
  [ ts.SyntaxKind.SwitchStatement, 'SwitchStatement' ],
  [ ts.SyntaxKind.LabeledStatement, 'LabeledStatement' ],
  [ ts.SyntaxKind.ThrowStatement, 'ThrowStatement' ],
  [ ts.SyntaxKind.TryStatement, 'TryStatement' ],
  [ ts.SyntaxKind.DebuggerStatement, 'DebuggerStatement' ],
  [ ts.SyntaxKind.VariableDeclaration, 'VariableDeclaration' ],
  [ ts.SyntaxKind.VariableDeclarationList, 'VariableDeclarationList' ],
  [ ts.SyntaxKind.FunctionDeclaration, 'FunctionDeclaration' ],
  [ ts.SyntaxKind.ClassDeclaration, 'ClassDeclaration' ],
  [ ts.SyntaxKind.InterfaceDeclaration, 'InterfaceDeclaration' ],
  [ ts.SyntaxKind.TypeAliasDeclaration, 'TypeAliasDeclaration' ],
  [ ts.SyntaxKind.EnumDeclaration, 'EnumDeclaration' ],
  [ ts.SyntaxKind.ModuleDeclaration, 'ModuleDeclaration' ],
  [ ts.SyntaxKind.ModuleBlock, 'ModuleBlock' ],
  [ ts.SyntaxKind.CaseBlock, 'CaseBlock' ],
  [ ts.SyntaxKind.NamespaceExportDeclaration, 'NamespaceExportDeclaration' ],
  [ ts.SyntaxKind.ImportEqualsDeclaration, 'ImportEqualsDeclaration' ],
  [ ts.SyntaxKind.ImportDeclaration, 'ImportDeclaration' ],
  [ ts.SyntaxKind.ImportClause, 'ImportClause' ],
  [ ts.SyntaxKind.NamespaceImport, 'NamespaceImport' ],
  [ ts.SyntaxKind.NamedImports, 'NamedImports' ],
  [ ts.SyntaxKind.ImportSpecifier, 'ImportSpecifier' ],
  [ ts.SyntaxKind.ExportAssignment, 'ExportAssignment' ],
  [ ts.SyntaxKind.ExportDeclaration, 'ExportDeclaration' ],
  [ ts.SyntaxKind.NamedExports, 'NamedExports' ],
  [ ts.SyntaxKind.NamespaceExport, 'NamespaceExport' ],
  [ ts.SyntaxKind.ExportSpecifier, 'ExportSpecifier' ],
  [ ts.SyntaxKind.MissingDeclaration, 'MissingDeclaration' ],
  [ ts.SyntaxKind.ExternalModuleReference, 'ExternalModuleReference' ],
  [ ts.SyntaxKind.JsxElement, 'JsxElement' ],
  [ ts.SyntaxKind.JsxSelfClosingElement, 'JsxSelfClosingElement' ],
  [ ts.SyntaxKind.JsxOpeningElement, 'JsxOpeningElement' ],
  [ ts.SyntaxKind.JsxClosingElement, 'JsxClosingElement' ],
  [ ts.SyntaxKind.JsxFragment, 'JsxFragment' ],
  [ ts.SyntaxKind.JsxOpeningFragment, 'JsxOpeningFragment' ],
  [ ts.SyntaxKind.JsxClosingFragment, 'JsxClosingFragment' ],
  [ ts.SyntaxKind.JsxAttribute, 'JsxAttribute' ],
  [ ts.SyntaxKind.JsxAttributes, 'JsxAttributes' ],
  [ ts.SyntaxKind.JsxSpreadAttribute, 'JsxSpreadAttribute' ],
  [ ts.SyntaxKind.JsxExpression, 'JsxExpression' ],
  [ ts.SyntaxKind.JsxNamespacedName, 'JsxNamespacedName' ],
  [ ts.SyntaxKind.CaseClause, 'CaseClause' ],
  [ ts.SyntaxKind.DefaultClause, 'DefaultClause' ],
  [ ts.SyntaxKind.HeritageClause, 'HeritageClause' ],
  [ ts.SyntaxKind.CatchClause, 'CatchClause' ],
  [ ts.SyntaxKind.AssertClause, 'AssertClause' ],
  [ ts.SyntaxKind.AssertEntry, 'AssertEntry' ],
  [ ts.SyntaxKind.ImportTypeAssertionContainer, 'ImportTypeAssertionContainer' ],
  [ ts.SyntaxKind.PropertyAssignment, 'PropertyAssignment' ],
  [ ts.SyntaxKind.ShorthandPropertyAssignment, 'ShorthandPropertyAssignment' ],
  [ ts.SyntaxKind.SpreadAssignment, 'SpreadAssignment' ],
  [ ts.SyntaxKind.EnumMember, 'EnumMember' ],
  [ ts.SyntaxKind.SourceFile, 'SourceFile' ],
  [ ts.SyntaxKind.Bundle, 'Bundle' ],
  [ ts.SyntaxKind.JSDocTypeExpression, 'JSDocTypeExpression' ],
  [ ts.SyntaxKind.JSDocNameReference, 'JSDocNameReference' ],
  [ ts.SyntaxKind.JSDocMemberName, 'JSDocMemberName' ],
  [ ts.SyntaxKind.JSDocAllType, 'JSDocAllType' ],
  [ ts.SyntaxKind.JSDocUnknownType, 'JSDocUnknownType' ],
  [ ts.SyntaxKind.JSDocNullableType, 'JSDocNullableType' ],
  [ ts.SyntaxKind.JSDocNonNullableType, 'JSDocNonNullableType' ],
  [ ts.SyntaxKind.JSDocOptionalType, 'JSDocOptionalType' ],
  [ ts.SyntaxKind.JSDocFunctionType, 'JSDocFunctionType' ],
  [ ts.SyntaxKind.JSDocVariadicType, 'JSDocVariadicType' ],
  [ ts.SyntaxKind.JSDocNamepathType, 'JSDocNamepathType' ],
  [ ts.SyntaxKind.JSDoc, 'JSDoc' ],
  [ ts.SyntaxKind.JSDocComment, 'JSDocComment' ],
  [ ts.SyntaxKind.JSDocText, 'JSDocText' ],
  [ ts.SyntaxKind.JSDocTypeLiteral, 'JSDocTypeLiteral' ],
  [ ts.SyntaxKind.JSDocSignature, 'JSDocSignature' ],
  [ ts.SyntaxKind.JSDocLink, 'JSDocLink' ],
  [ ts.SyntaxKind.JSDocLinkCode, 'JSDocLinkCode' ],
  [ ts.SyntaxKind.JSDocLinkPlain, 'JSDocLinkPlain' ],
  [ ts.SyntaxKind.JSDocTag, 'JSDocTag' ],
  [ ts.SyntaxKind.JSDocAugmentsTag, 'JSDocAugmentsTag' ],
  [ ts.SyntaxKind.JSDocImplementsTag, 'JSDocImplementsTag' ],
  [ ts.SyntaxKind.JSDocAuthorTag, 'JSDocAuthorTag' ],
  [ ts.SyntaxKind.JSDocDeprecatedTag, 'JSDocDeprecatedTag' ],
  [ ts.SyntaxKind.JSDocClassTag, 'JSDocClassTag' ],
  [ ts.SyntaxKind.JSDocPublicTag, 'JSDocPublicTag' ],
  [ ts.SyntaxKind.JSDocPrivateTag, 'JSDocPrivateTag' ],
  [ ts.SyntaxKind.JSDocProtectedTag, 'JSDocProtectedTag' ],
  [ ts.SyntaxKind.JSDocReadonlyTag, 'JSDocReadonlyTag' ],
  [ ts.SyntaxKind.JSDocOverrideTag, 'JSDocOverrideTag' ],
  [ ts.SyntaxKind.JSDocCallbackTag, 'JSDocCallbackTag' ],
  [ ts.SyntaxKind.JSDocOverloadTag, 'JSDocOverloadTag' ],
  [ ts.SyntaxKind.JSDocEnumTag, 'JSDocEnumTag' ],
  [ ts.SyntaxKind.JSDocParameterTag, 'JSDocParameterTag' ],
  [ ts.SyntaxKind.JSDocReturnTag, 'JSDocReturnTag' ],
  [ ts.SyntaxKind.JSDocThisTag, 'JSDocThisTag' ],
  [ ts.SyntaxKind.JSDocTypeTag, 'JSDocTypeTag' ],
  [ ts.SyntaxKind.JSDocTemplateTag, 'JSDocTemplateTag' ],
  [ ts.SyntaxKind.JSDocTypedefTag, 'JSDocTypedefTag' ],
  [ ts.SyntaxKind.JSDocSeeTag, 'JSDocSeeTag' ],
  [ ts.SyntaxKind.JSDocPropertyTag, 'JSDocPropertyTag' ],
  [ ts.SyntaxKind.JSDocThrowsTag, 'JSDocThrowsTag' ],
  [ ts.SyntaxKind.JSDocSatisfiesTag, 'JSDocSatisfiesTag' ],
  [ ts.SyntaxKind.SyntaxList, 'SyntaxList' ],
  [ ts.SyntaxKind.NotEmittedStatement, 'NotEmittedStatement' ],
  [ ts.SyntaxKind.PartiallyEmittedExpression, 'PartiallyEmittedExpression' ],
  [ ts.SyntaxKind.CommaListExpression, 'CommaListExpression' ],
  [ ts.SyntaxKind.SyntheticReferenceExpression, 'SyntheticReferenceExpression' ],
  [ ts.SyntaxKind.Count, 'Count' ],
  [ ts.SyntaxKind.FirstAssignment, 'FirstAssignment' ],
  [ ts.SyntaxKind.LastAssignment, 'LastAssignment' ],
  [ ts.SyntaxKind.FirstCompoundAssignment, 'FirstCompoundAssignment' ],
  [ ts.SyntaxKind.LastCompoundAssignment, 'LastCompoundAssignment' ],
  [ ts.SyntaxKind.FirstReservedWord, 'FirstReservedWord' ],
  [ ts.SyntaxKind.LastReservedWord, 'LastReservedWord' ],
  [ ts.SyntaxKind.FirstKeyword, 'FirstKeyword' ],
  [ ts.SyntaxKind.LastKeyword, 'LastKeyword' ],
  [ ts.SyntaxKind.FirstFutureReservedWord, 'FirstFutureReservedWord' ],
  [ ts.SyntaxKind.LastFutureReservedWord, 'LastFutureReservedWord' ],
  [ ts.SyntaxKind.FirstTypeNode, 'FirstTypeNode' ],
  [ ts.SyntaxKind.LastTypeNode, 'LastTypeNode' ],
  [ ts.SyntaxKind.FirstPunctuation, 'FirstPunctuation' ],
  [ ts.SyntaxKind.LastPunctuation, 'LastPunctuation' ],
  [ ts.SyntaxKind.FirstToken, 'FirstToken' ],
  [ ts.SyntaxKind.LastToken, 'LastToken' ],
  [ ts.SyntaxKind.FirstTriviaToken, 'FirstTriviaToken' ],
  [ ts.SyntaxKind.LastTriviaToken, 'LastTriviaToken' ],
  [ ts.SyntaxKind.FirstLiteralToken, 'FirstLiteralToken' ],
  [ ts.SyntaxKind.LastLiteralToken, 'LastLiteralToken' ],
  [ ts.SyntaxKind.FirstTemplateToken, 'FirstTemplateToken' ],
  [ ts.SyntaxKind.LastTemplateToken, 'LastTemplateToken' ],
  [ ts.SyntaxKind.FirstBinaryOperator, 'FirstBinaryOperator' ],
  [ ts.SyntaxKind.LastBinaryOperator, 'LastBinaryOperator' ],
  [ ts.SyntaxKind.FirstStatement, 'FirstStatement' ],
  [ ts.SyntaxKind.LastStatement, 'LastStatement' ],
  [ ts.SyntaxKind.FirstNode, 'FirstNode' ],
  [ ts.SyntaxKind.FirstJSDocNode, 'FirstJSDocNode' ],
  [ ts.SyntaxKind.LastJSDocNode, 'LastJSDocNode' ],
  [ ts.SyntaxKind.FirstJSDocTagNode, 'FirstJSDocTagNode' ],
  [ ts.SyntaxKind.LastJSDocTagNode, 'LastJSDocTagNode' ],
],
([key, value]) => key));


