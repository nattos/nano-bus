import * as utils from '../utils';
import * as ts from "typescript";
import { CodeScopeType, CodeTypeSpec, CodeVariable, CodeWriter } from './code-writer';
import { BopType, BopInternalTypeBuilder, BopFields, BopFunctionType, BopFunctionConcreteImplDetail, BopFunctionOf } from './bop-type';
import { BopBlock, BopIdentifierPrefix, BopGenericFunction, BopPropertyAccessor, BopVariable } from './bop-data';

export type ResolvedType = { name?: string, bopType?: BopType, typeArgs: ResolvedType[] };

export function toStringResolvedType(type: ResolvedType) {
  let result = type.name ?? type.bopType?.debugName ?? 'unknown';
  if (type.typeArgs.length > 0) {
    result += `<${type.typeArgs.map(t => toStringResolvedType(t)).join(', ')}>`;
  }
  return result;
};

export function loadBopLib(host: {
  readonly program: ts.Program;
  readonly sourceRoot: ts.SourceFile;
  readonly tc: ts.TypeChecker;
  readonly writer: CodeWriter;
  readonly globalBlock: BopBlock;
  readonly errorType: BopType;
  readonly typeType: BopType;
  readonly functionType: BopType;
  readonly voidType: BopType;
  readonly undefinedType: BopType;
  readonly undefinedConstant: BopVariable;
  readonly bopFunctionConcreteImpls: BopFunctionConcreteImplDetail[];

  readonly typeMap: Map<ts.Type, BopType>;

  resolveType(type: ts.Type, options?: { inBlock?: BopBlock }): BopType;
  createInternalType(options: {
    identifier: string,
    internalIdentifier?: string,
    anonymous?: boolean,
    isArrayOf?: BopType,
  }): BopInternalTypeBuilder;
  createInternalGenericType(options: {
    identifier: string,
    writer: (typeParameters: BopFields) => BopType,
  }): void;
}) {
  const bopLibRoot = host.program.getSourceFile('default.d.ts');

  // type ResolvedType = { name: string, typeArgs: ResolvedType[] };
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
            const typeArgBlock = host.globalBlock.createTempBlock(CodeScopeType.Class);
            for (const [typeParameterName, index] of typeParameterMap) {
              const typeArg = typeArgs[index];
              const typeArgType = resolveNewBopType(typeArg);
              typeArgBlock.mapIdentifier(typeParameterName, CodeTypeSpec.typeType, host.typeType).typeResult = typeArgType;
            }
            return utils.upcast({ bopType: host.resolveType(host.tc.getTypeAtLocation(typeNode), { inBlock: typeArgBlock }), typeArgs: [] })
          };
        }
        const existingType = host.typeMap.get(host.tc.getTypeFromTypeNode(typeNode));
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
          const isStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
          type.methods.push({
            name: propName,
            typeParameters: methodTypeParameters,
            parameters: parameters,
            returnType: returnType,
            isConstructor: isConstructor,
            isStatic: isStatic,
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
        // console.log(method);
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
    const instantiateIntoType = (instantiatedTypeName: string, newType: BopInternalTypeBuilder, typeArgs: ResolvedType[], staticOnly: boolean): BopType => {
      const instantiatedType = newType.type;
      for (const method of type.methods) {
        const isStaticLike = !method.isConstructor && method.isStatic;
        if (staticOnly !== isStaticLike) {
          continue;
        }
        const methodName = method.name;
        const debugMethodName = `${instantiatedTypeName}::${methodName}`;

        // console.log(debugMethodName);
        if (method.typeParameters.length === 0 || method.isConstructor) {
          const methodTypeArgs: ResolvedType[] = [];
          const params: BopFields = method.parameters.map(p => {
            const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
            return { identifier: p.name, type: paramType ?? host.errorType };
          });
          let returnType: BopType|undefined;
          if (method.isConstructor) {
            returnType = newType.type;
          } else {
            returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;
          }
          if (method.isConstructor) {
            newType.declareInternalConstructor(params, debugMethodName);
          } else {
            newType.declareInternalMethod(method.name, debugMethodName, params, returnType, { isMethod: !method.isStatic });
          }
        } else {
          const genericFunc = new BopGenericFunction((typeParameters: BopFields) => {
            const isMethod = !method.isStatic;

            // Resolve generic params into concrete ones now that we have all type args.
            const methodTypeArgs: ResolvedType[] = typeParameters.map(t => utils.upcast({ bopType: t.type, typeArgs: [] }));
            const paramDecls: BopFields = method.parameters.map(p => {
              const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
              return { identifier: p.name, type: paramType ?? host.errorType };
            });
            if (isMethod) {
              paramDecls.splice(0, 0, { identifier: 'this', type: instantiatedType });
            }
            const returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;

            // Create the BopType to represent the concrete function, and map it in the global scope.
            const debugInstantiatedMethodName = `${debugMethodName}<${methodTypeArgs.map(t => toStringResolvedType(t)).join(',')}>`;
            const newFunctionType = BopType.createFunctionType({
              debugName: debugInstantiatedMethodName,
              innerScope: host.writer.global.scope.createChildScope(CodeScopeType.Local),
              innerBlock: host.globalBlock.createChildBlock(CodeScopeType.Local),
              functionOf: new BopFunctionOf([new BopFunctionType(
                paramDecls,
                returnType,
                isMethod,
                0,
              )]),
            });

            const concreteFunctionVar = host.globalBlock.mapTempIdentifier(debugInstantiatedMethodName, newFunctionType, /* anonymous */ true);
            const concreteFunctionIdentifier = host.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, debugInstantiatedMethodName);
            const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar);
            newFunctionType.functionOf!.overloads[0].concreteImpl = concreteImpl;
            host.bopFunctionConcreteImpls.push(concreteImpl);
            concreteFunctionVar.result = concreteFunctionIdentifier;

            // Write the trampoline function body.
            const funcScope = host.writer.global.scope.createChildScope(CodeScopeType.Function);
            const func = host.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
            func.touchedByProxy = {
              get touchedByCpu() { return concreteImpl.touchedByCpu; },
              get touchedByGpu() { return concreteImpl.touchedByGpu; },
            };

            func.returnTypeSpec = returnType.storageType;
            const paramVars: CodeVariable[] = [];
            for (const param of paramDecls) {
              const paramVar = funcScope.allocateVariableIdentifier(param.type.assignableRefType, BopIdentifierPrefix.Local, param.identifier);
              func.addParam(paramVar.typeSpec, paramVar.identifierToken);
              paramVars.push(paramVar);
            }
            const externIdentifier = funcScope.allocateIdentifier(BopIdentifierPrefix.Extern, debugInstantiatedMethodName);
            const externFuncCall = func.body.writeReturnStatement().expr.writeStaticFunctionCall(externIdentifier);
            externFuncCall.externCallSemantics = true;
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
            host.writer.mapInternalToken(externIdentifier, debugMethodName);

            return concreteFunctionVar;
          });
          newType.declareGenericMethod(methodName, genericFunc);
        }
      }

      for (const propDecl of type.properties) {
        if (staticOnly) {
          continue;
        }
        const propName = propDecl.name;
        const propType = resolveNewBopType(propDecl.type(typeArgs)) ?? host.errorType;
        const propVar = newType.declareInternalProperty(propName, propType);
        const propertyIdentifierToken = newType.type.innerScope.allocateIdentifier(BopIdentifierPrefix.Field, propName);
        host.writer.mapInternalToken(propertyIdentifierToken, propName);

        const getterName = `${instantiatedTypeName}::get_${propName}`;
        const setterName = `${instantiatedTypeName}::set_${propName}`;

        const getterType = BopType.createFunctionType({
          debugName: getterName,
          innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
          innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
          functionOf: new BopFunctionOf([new BopFunctionType(
            [],
            propType,
            /* isMethod */ true,
            0,
          )]),
        });
        const getterBopVar = newType.type.innerBlock.mapIdentifier(getterType.debugName, getterType.tempType, getterType, /* anonymous */ true);
        const getterVar = newType.type.innerScope.createVariableInScope(getterBopVar.type, getterBopVar.nameHint);
        getterBopVar.result = getterVar;
        getterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(getterBopVar);
        host.bopFunctionConcreteImpls.push(getterType.functionOf!.overloads[0].concreteImpl);
        host.writer.mapInternalToken(getterVar.identifierToken, getterName);

        const setterType = BopType.createFunctionType({
          debugName: setterName,
          innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
          innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
          functionOf: new BopFunctionOf([new BopFunctionType(
            [{ identifier: 'value', type: propType }],
            host.voidType,
            /* isMethod */ true,
            0,
          )]),
        });
        const setterBopVar = newType.type.innerBlock.mapIdentifier(setterType.debugName, setterType.tempType, setterType, /* anonymous */ true);
        const setterVar = newType.type.innerScope.createVariableInScope(setterBopVar.type, setterBopVar.nameHint);
        setterBopVar.result = setterVar;
        setterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(setterBopVar);
        host.bopFunctionConcreteImpls.push(setterType.functionOf!.overloads[0].concreteImpl);
        host.writer.mapInternalToken(setterVar.identifierToken, setterName);

        propVar.propertyResult = new BopPropertyAccessor(getterBopVar, setterBopVar, { directAccessIdentifier: propertyIdentifierToken });
      }

      return instantiatedType;
    }

    if (type.typeParameters.length > 0) {
      const baseTypeToken = host.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, type.name);
      host.writer.mapInternalToken(baseTypeToken, type.name);

      let instanceIndex = 0;
      host.createInternalGenericType({
        identifier: type.name,
        writer: (typeArgs: BopFields) => {
          // Create typedef.
          const instantiatedTypeName = `BopLib_${type.name}_${instanceIndex}`;
          instanceIndex++;

          const typedefType = CodeTypeSpec.fromStruct(baseTypeToken).withTypeArgs(typeArgs.map(t => t.type.storageType));
          const typedefIdentifier = host.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, instantiatedTypeName);
          host.writer.global.writeTypedef(typedefIdentifier, typedefType);
          host.writer.mapInternalToken(typedefIdentifier, instantiatedTypeName);

          // Instantiate the type.
          const translatedTypeArgs = typeArgs.map(typeArg => utils.upcast({ bopType: typeArg.type, typeArgs: [] }));
          let isArrayOf: BopType|undefined;
          // HACK!!!
          if (type.name === 'Array' && translatedTypeArgs.length === 1) {
            isArrayOf = translatedTypeArgs[0].bopType;
          }
          const newType = host.createInternalType({
            identifier: type.name,
            internalIdentifier: instantiatedTypeName,
            anonymous: true,
            isArrayOf: isArrayOf,
          });
          newBopTypeMap.set(type.name, { bopType: newType.type });
          instantiateIntoType(instantiatedTypeName, newType, translatedTypeArgs, false);
          return newType.type;
        },
      });

      const typeName = `BopLib::${type.name}`;
      const newType = host.createInternalType({
        identifier: type.name,
        internalIdentifier: typeName,
      });
      newConcreteTypes.push(() => {
        const staticBopVar = instantiateIntoType(typeName, newType, [], true);
        host.globalBlock.mapIdentifier(type.name, CodeTypeSpec.typeType, staticBopVar);
      });
    } else {
      const typeName = `BopLib::${type.name}`;
      const newType = host.createInternalType({
        identifier: type.name,
        internalIdentifier: typeName,
      });
      newBopTypeMap.set(type.name, { bopType: newType.type });
      newConcreteTypes.push(() => instantiateIntoType(typeName, newType, [], false));
      newConcreteTypes.push(() => {
        const staticBopVar = instantiateIntoType(typeName, newType, [], true);
        host.globalBlock.mapIdentifier(type.name, CodeTypeSpec.typeType, staticBopVar);
      });
    }
  }
  newConcreteTypes.forEach(f => f());

  return { libTypes, newBopTypeMap };
}
