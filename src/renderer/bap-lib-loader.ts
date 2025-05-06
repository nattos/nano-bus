import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { BapFields, BapFunctionLiteral, BapGenerateContext, BapSubtreeGenerator, BapSubtreeValue, BapTypeGenerator, BapTypeLiteral, BapTypeSpec, BapWriteAsStatementFunc, BapWriteIntoExpressionFunc } from "./bap-value";
import { getNodeLabel } from "./ts-helpers";
import { CodeNamedToken, CodePrimitiveType, CodeScope, CodeScopeType, CodeTypeSpec, CodeVariable, CodeWriter } from './code-writer/code-writer';
import { BapIdentifierPrefix } from './bap-constants';
import { BapConstructorSymbol, BapPrototypeScope, BapScope, BapThisSymbol } from './bap-scope';
import { BapRootContextMixin } from './bap-root-context-mixin';
import { BapVisitorRootContext } from './bap-visitor';

export type ResolvedType = { name?: string, type?: BapTypeSpec, typeArgs: ResolvedType[] };


type TypeResolver = (typeArgs: ResolvedType[]) => ResolvedType;
type MethodParameterTypeResolver = (typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]) => ResolvedType;

interface TypeInfo {
  name: string;
  tsType: ts.Type;
  typeParameters: string[];
  expandFrom: Array<{ typeName: string, typeArgs: TypeResolver[], asStatic: boolean }>;
  methods: Array<{
    name: string;
    typeParameters: string[];
    parameters: Array<{ name: string, type: MethodParameterTypeResolver }>;
    returnType: MethodParameterTypeResolver;
    isConstructor: boolean;
    isStatic: boolean;
  }>;
  properties: { name: string; type: TypeResolver; isStatic: boolean; }[];
};

export function toStringResolvedType(type: ResolvedType) {
  let result = type.name ?? type.type?.debugName ?? 'unknown';
  if (type.typeArgs.length > 0) {
    result += `<${type.typeArgs.map(t => toStringResolvedType(t)).join(', ')}>`;
  }
  return result;
};

export class BapLibLoader extends BapRootContextMixin {
  constructor(context: BapVisitorRootContext) { super(context); }

  loadBopLib() {
    const bopLibRoot = this.program.getSourceFile('default.d.ts');

    // type ResolvedType = { name: string, typeArgs: ResolvedType[] };
    // type PropertyResolver = () => BopType;

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
            tsType: this.tc.getTypeAtLocation(statement),
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
          // if (ts.isUnionTypeNode(typeNode)) {
          //   return (typeArgs) => {
          //     const typeArgBlock = host.globalBlock.createTempBlock(CodeScopeType.Class);
          //     for (const [typeParameterName, index] of typeParameterMap) {
          //       const typeArg = typeArgs[index];
          //       const typeArgType = resolveNewBopType(typeArg);
          //       typeArgBlock.mapIdentifier(typeParameterName, CodeTypeSpec.typeType, host.typeType).typeResult = typeArgType;
          //     }
          //     return utils.upcast({ bopType: host.resolveType(host.tc.getTypeAtLocation(typeNode), { inBlock: typeArgBlock }), typeArgs: [] })
          //   };
          // }
          // const existingType = host.typeMap.get(host.tc.getTypeFromTypeNode(typeNode));
          const existingType = undefined;
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
          const isStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
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
              isStatic: isStatic,
            });
          } else if (ts.isPropertySignature(member)) {
            if (!member.type || !ts.isTypeReferenceNode(member.type)) {
              continue;
            }
            const propName = member.name.getText();
            type.properties.push({
              name: propName,
              type: makeTypeResolver(member.type),
              isStatic: isStatic,
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
            isStatic: entry.asStatic,
          });
        }

        expandFromRec(intoType, fromType.expandFrom);
      }
    };
    for (const type of libTypes.values()) {
      expandFromRec(type, type.expandFrom);
    }


    console.log(Array.from(libTypes.values()));


    const libTypeGens: Array<{ identifier: string; tsType: ts.Type; typeGen: BapTypeGenerator; }> = [];
    for (const type of libTypes.values()) {
      let instanceIndex = 0;
      const instanceMap = new Map<string, BapTypeSpec>();
      const typeGen: BapTypeGenerator = {
        generate: (context, options) => {
          const thisInstanceIndex = instanceIndex++;
          return this.generateType(type, thisInstanceIndex, context, instanceMap, { allowTypeParameters: options?.allowTypeParameters });
        },
        debug: {
          debugName: type.name,
        },
      };
      libTypeGens.push({ identifier: type.name, tsType: type.tsType, typeGen: typeGen });

      this.newBopTypeMap.set(type.name, {
        genericInstantiator: (context, typeArgs) => {
          const thisInstanceIndex = instanceIndex++;
          const innerContext = context.withChildScope();
          for (const [ name, arg ] of utils.zip(type.typeParameters, typeArgs)) {
            const typeArgValue = arg.type;
            innerContext.scope.declare(name, { type: 'type', isGenericTypeParameter: false, typeGen: { generate: () => typeArgValue, debug: { debugName: name, fixed: typeArgValue } } });
          }
          return this.generateType(type, thisInstanceIndex, innerContext, instanceMap);
        },
      });

    }
    return libTypeGens;




    // for (const type of libTypes.values()) {
    //   const instantiateIntoType = (instantiatedTypeName: string, newType: BopInternalTypeBuilder, typeArgs: ResolvedType[], staticOnly: boolean): BopType => {
    //     const instantiatedType = newType.type;
    //     for (const method of type.methods) {
    //       const isStaticLike = !method.isConstructor && method.isStatic;
    //       if (staticOnly !== isStaticLike) {
    //         continue;
    //       }
    //       const methodName = method.name;
    //       const debugMethodName = `${instantiatedTypeName}::${methodName}`;

    //       // console.log(debugMethodName);
    //       if (method.typeParameters.length === 0 || method.isConstructor) {
    //         const methodTypeArgs: ResolvedType[] = [];
    //         const params: BopFields = method.parameters.map(p => {
    //           const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
    //           return { identifier: p.name, type: paramType ?? host.errorType };
    //         });
    //         let returnType: BopType|undefined;
    //         if (method.isConstructor) {
    //           returnType = newType.type;
    //         } else {
    //           returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;
    //         }
    //         if (method.isConstructor) {
    //           newType.declareInternalConstructor(params, debugMethodName);
    //         } else {
    //           newType.declareInternalMethod(method.name, debugMethodName, params, returnType, { isMethod: !method.isStatic });
    //         }
    //       } else {
    //         const genericFunc = new BopGenericFunction((typeParameters: BopFields) => {
    //           const isMethod = !method.isStatic;

    //           // Resolve generic params into concrete ones now that we have all type args.
    //           const methodTypeArgs: ResolvedType[] = typeParameters.map(t => utils.upcast({ bopType: t.type, typeArgs: [] }));
    //           const paramDecls: BopFields = method.parameters.map(p => {
    //             const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
    //             return { identifier: p.name, type: paramType ?? host.errorType };
    //           });
    //           if (isMethod) {
    //             paramDecls.splice(0, 0, { identifier: 'this', type: instantiatedType });
    //           }
    //           const returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;

    //           // Create the BopType to represent the concrete function, and map it in the global scope.
    //           const debugInstantiatedMethodName = `${debugMethodName}<${methodTypeArgs.map(t => toStringResolvedType(t)).join(',')}>`;
    //           const newFunctionType = BopType.createFunctionType({
    //             debugName: debugInstantiatedMethodName,
    //             innerScope: host.writer.global.scope.createChildScope(CodeScopeType.Local),
    //             innerBlock: host.globalBlock.createChildBlock(CodeScopeType.Local),
    //             functionOf: new BopFunctionOf([new BopFunctionType(
    //               paramDecls,
    //               returnType,
    //               isMethod,
    //               0,
    //             )]),
    //           });

    //           const concreteFunctionVar = host.globalBlock.mapTempIdentifier(debugInstantiatedMethodName, newFunctionType, /* anonymous */ true);
    //           const concreteFunctionIdentifier = host.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, debugInstantiatedMethodName);
    //           const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar);
    //           newFunctionType.functionOf!.overloads[0].concreteImpl = concreteImpl;
    //           host.bopFunctionConcreteImpls.push(concreteImpl);
    //           concreteFunctionVar.result = concreteFunctionIdentifier;

    //           // Write the trampoline function body.
    //           const funcScope = host.writer.global.scope.createChildScope(CodeScopeType.Function);
    //           const func = host.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
    //           func.touchedByProxy = {
    //             get touchedByCpu() { return concreteImpl.touchedByCpu; },
    //             get touchedByGpu() { return concreteImpl.touchedByGpu; },
    //           };

    //           func.returnTypeSpec = returnType.storageType;
    //           const paramVars: CodeVariable[] = [];
    //           for (const param of paramDecls) {
    //             const paramVar = funcScope.allocateVariableIdentifier(param.type.assignableRefType, BopIdentifierPrefix.Local, param.identifier);
    //             func.addParam(paramVar.typeSpec, paramVar.identifierToken);
    //             paramVars.push(paramVar);
    //           }
    //           const externIdentifier = funcScope.allocateIdentifier(BopIdentifierPrefix.Extern, debugInstantiatedMethodName);
    //           const externFuncCall = func.body.writeReturnStatement().expr.writeStaticFunctionCall(externIdentifier);
    //           externFuncCall.externCallSemantics = true;
    //           for (const typeArg of methodTypeArgs) {
    //             let typeArgType: CodeTypeSpec|undefined;
    //             // TODO: Fix this crude resolution.
    //             if (typeArg.name) {
    //               typeArgType = resolveNewBopType({ name: typeArg.name, typeArgs: [] })?.storageType;
    //             } else {
    //               typeArgType = typeArg.bopType?.storageType;
    //             }
    //             typeArgType ??= CodeTypeSpec.compileErrorType;
    //             externFuncCall.addTemplateArg(typeArgType);
    //           }
    //           for (const param of paramVars) {
    //             externFuncCall.addArg().writeVariableReference(param);
    //           }
    //           host.writer.mapInternalToken(externIdentifier, debugMethodName);

    //           return concreteFunctionVar;
    //         });
    //         newType.declareGenericMethod(methodName, genericFunc);
    //       }
    //     }

    //     for (const propDecl of type.properties) {
    //       if (staticOnly) {
    //         continue;
    //       }
    //       const propName = propDecl.name;
    //       const propType = resolveNewBopType(propDecl.type(typeArgs)) ?? host.errorType;
    //       const propVar = newType.declareInternalProperty(propName, propType);
    //       const propertyIdentifierToken = newType.type.innerScope.allocateIdentifier(BopIdentifierPrefix.Field, propName);
    //       host.writer.mapInternalToken(propertyIdentifierToken, propName);

    //       const getterName = `${instantiatedTypeName}::get_${propName}`;
    //       const setterName = `${instantiatedTypeName}::set_${propName}`;

    //       const getterType = BopType.createFunctionType({
    //         debugName: getterName,
    //         innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
    //         innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
    //         functionOf: new BopFunctionOf([new BopFunctionType(
    //           [],
    //           propType,
    //           /* isMethod */ true,
    //           0,
    //         )]),
    //       });
    //       const getterBopVar = newType.type.innerBlock.mapIdentifier(getterType.debugName, getterType.tempType, getterType, /* anonymous */ true);
    //       const getterVar = newType.type.innerScope.createVariableInScope(getterBopVar.type, getterBopVar.nameHint);
    //       getterBopVar.result = getterVar;
    //       getterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(getterBopVar);
    //       host.bopFunctionConcreteImpls.push(getterType.functionOf!.overloads[0].concreteImpl);
    //       host.writer.mapInternalToken(getterVar.identifierToken, getterName);

    //       const setterType = BopType.createFunctionType({
    //         debugName: setterName,
    //         innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
    //         innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
    //         functionOf: new BopFunctionOf([new BopFunctionType(
    //           [{ identifier: 'value', type: propType }],
    //           host.voidType,
    //           /* isMethod */ true,
    //           0,
    //         )]),
    //       });
    //       const setterBopVar = newType.type.innerBlock.mapIdentifier(setterType.debugName, setterType.tempType, setterType, /* anonymous */ true);
    //       const setterVar = newType.type.innerScope.createVariableInScope(setterBopVar.type, setterBopVar.nameHint);
    //       setterBopVar.result = setterVar;
    //       setterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(setterBopVar);
    //       host.bopFunctionConcreteImpls.push(setterType.functionOf!.overloads[0].concreteImpl);
    //       host.writer.mapInternalToken(setterVar.identifierToken, setterName);

    //       propVar.propertyResult = new BopPropertyAccessor(getterBopVar, setterBopVar, { directAccessIdentifier: propertyIdentifierToken });
    //     }

    //     return instantiatedType;
    //   }

    //   if (type.typeParameters.length > 0) {
    //     const baseTypeToken = host.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, type.name);
    //     host.writer.mapInternalToken(baseTypeToken, type.name);

    //     let instanceIndex = 0;
    //     host.createInternalGenericType({
    //       identifier: type.name,
    //       writer: (typeArgs: BopFields) => {
    //         // Create typedef.
    //         const instantiatedTypeName = `BopLib_${type.name}_${instanceIndex}`;
    //         instanceIndex++;

    //         const typedefType = CodeTypeSpec.fromStruct(baseTypeToken).withTypeArgs(typeArgs.map(t => t.type.storageType));
    //         const typedefIdentifier = host.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, instantiatedTypeName);
    //         host.writer.global.writeTypedef(typedefIdentifier, typedefType);
    //         host.writer.mapInternalToken(typedefIdentifier, instantiatedTypeName);

    //         // Instantiate the type.
    //         const translatedTypeArgs = typeArgs.map(typeArg => utils.upcast({ bopType: typeArg.type, typeArgs: [] }));
    //         let isArrayOf: BopType|undefined;
    //         // HACK!!!
    //         if (type.name === 'Array' && translatedTypeArgs.length === 1) {
    //           isArrayOf = translatedTypeArgs[0].bopType;
    //         }
    //         const newType = host.createInternalType({
    //           identifier: type.name,
    //           internalIdentifier: instantiatedTypeName,
    //           anonymous: true,
    //           isArrayOf: isArrayOf,
    //         });
    //         newBopTypeMap.set(type.name, { bopType: newType.type });
    //         instantiateIntoType(instantiatedTypeName, newType, translatedTypeArgs, false);
    //         return newType.type;
    //       },
    //     });

    //     const typeName = `BopLib::${type.name}`;
    //     const newType = host.createInternalType({
    //       identifier: type.name,
    //       internalIdentifier: typeName,
    //     });
    //     newConcreteTypes.push(() => {
    //       const staticBopVar = instantiateIntoType(typeName, newType, [], true);
    //       host.globalBlock.mapIdentifier(type.name, CodeTypeSpec.typeType, staticBopVar);
    //     });
    //   } else {
    //     const typeName = `BopLib::${type.name}`;
    //     const newType = host.createInternalType({
    //       identifier: type.name,
    //       internalIdentifier: typeName,
    //     });
    //     newBopTypeMap.set(type.name, { bopType: newType.type });
    //     newConcreteTypes.push(() => instantiateIntoType(typeName, newType, [], false));
    //     newConcreteTypes.push(() => {
    //       const staticBopVar = instantiateIntoType(typeName, newType, [], true);
    //       host.globalBlock.mapIdentifier(type.name, CodeTypeSpec.typeType, staticBopVar);
    //     });
    //   }
    // }
    // newConcreteTypes.forEach(f => f());

    // return { libTypes, newBopTypeMap };
  }





  private readonly newBopTypeMap = new Map<string, { bopType?: BapTypeSpec, genericInstantiator?: (context: BapGenerateContext, typeArgs: ResolvedType[]) => BapTypeSpec }>();
  private readonly newConcreteTypes: Array<() => void> = [];
  private resolveNewBopType(context: BapGenerateContext, resolved: ResolvedType): BapTypeSpec|undefined {
    if (resolved.type) {
      return resolved.type;
    }
    if (!resolved.name) {
      return undefined;
    }
    const newType = this.newBopTypeMap.get(resolved.name);
    if (!newType) {
      return undefined;
    }
    if (newType.bopType) {
      return newType.bopType;
    }
    if (newType.genericInstantiator) {
      return newType.genericInstantiator(context, resolved.typeArgs);
    }
    return undefined;
  };
  private resolveMethodParamType(context: BapGenerateContext, p: MethodParameterTypeResolver, typeTypeArgs: ResolvedType[], methodTypeArgs: ResolvedType[]): BapTypeSpec|undefined {
    const resolved = p(typeTypeArgs, methodTypeArgs);
    return this.resolveNewBopType(context, resolved);
  }


  private generateType(type: TypeInfo, instanceIndex: number, context: BapGenerateContext, instanceMap: Map<string, BapTypeSpec>, options?: { allowTypeParameters?: boolean }): BapTypeSpec {
    const codeWriter = context.globalWriter;
    const codeGlobalScope = codeWriter.global.scope;

    const typeParameters = type.typeParameters;
    const isGeneric = typeParameters.length > 0;
    const typeArgPairs: BapFields = type.typeParameters.map(t => {
      const typeGen = context.scope.resolve(t, { isTypeLookup: true });
      let typeSpec;
      if (options?.allowTypeParameters && !typeGen) {
        typeSpec = {
          prototypeScope: this.types.errorType.prototypeScope,
          staticScope: this.types.errorType.staticScope,
          typeParameters: [],
          codeTypeSpec: this.types.errorType.codeTypeSpec,
          isShadow: false,
          debugName: t
        } satisfies BapTypeSpec;
      } else if (typeGen?.type !== 'type') {
        typeSpec = this.types.errorType;
      } else {
        typeSpec = typeGen.typeGen.generate(context) ?? this.types.errorType;
      }
      return { identifier: t, type: typeSpec };
    });

    let marshalSize: number|undefined = undefined;
    let isArrayOf: BapTypeSpec|undefined;
    // HACK!!!
    if (type.name === 'Array' && typeArgPairs.length === 1) {
      isArrayOf = typeArgPairs[0].type;
    } else if (type.name === 'float') {
      marshalSize = 4;
    } else if (type.name === 'float2') {
      marshalSize = 4 * 2;
    } else if (type.name === 'float3') {
      marshalSize = 4 * 3;
    } else if (type.name === 'float4') {
      marshalSize = 4 * 4;
    }

    const prototypeScope = new BapPrototypeScope({ arrayOfType: isArrayOf });// context.rootContext.withChildScope();
    const staticScope = new BapPrototypeScope();// context.rootContext.withChildScope();
    const shortName = type.name;

    const structureKey = this.types.toStructureKey(typeArgPairs);
    const oldInstance = instanceMap.get(structureKey);
    if (oldInstance) {
      return oldInstance;
    }

    const baseTypeToken = codeGlobalScope.allocateIdentifier(BapIdentifierPrefix.Struct, type.name);
    const externBaseTypeName = `BopLib::${type.name}`;
    codeWriter.mapInternalToken(baseTypeToken, externBaseTypeName);

    const typeArgSpecs = typeArgPairs.map(t => t.type);
    const typeArgCodeSpecs = typeArgSpecs.map(t => t.codeTypeSpec);

    // TODO: Coalease copies!!!
    let instantiatedTypeName: string;
    // Create typedef.
    let typedefIdentifier: CodeNamedToken;
    if (isGeneric) {
      instantiatedTypeName = `BopLib_${type.name}_${instanceIndex}`;
      typedefIdentifier = codeGlobalScope.allocateIdentifier(BapIdentifierPrefix.Struct, instantiatedTypeName);
      const isStaticAccess = options?.allowTypeParameters && typeArgSpecs.some(typeArg => typeArg?.codeTypeSpec.asPrimitive === CodePrimitiveType.CompileError);

      let typedefType: CodeTypeSpec;
      if (isStaticAccess) {
        typedefType = CodeTypeSpec.fromStruct(baseTypeToken);
      } else {
        typedefType = CodeTypeSpec.fromStruct(baseTypeToken).withTypeArgs(typeArgCodeSpecs);
      }
      const typedefWriter = codeWriter.global.writeTypedef(typedefIdentifier, typedefType);
      if (isStaticAccess) {
        typedefWriter.touchedByGpu = false;
      }
      codeWriter.mapInternalToken(typedefIdentifier, instantiatedTypeName);
    } else {
      instantiatedTypeName = externBaseTypeName;
      typedefIdentifier = baseTypeToken;
    }

    const newType: BapTypeSpec = {
      prototypeScope: prototypeScope,
      staticScope: staticScope,
      typeParameters: typeParameters,
      codeTypeSpec: CodeTypeSpec.fromStruct(typedefIdentifier),
      isShadow: false,
      debugName: shortName,
      libType: {
        identifier: type.name,
        marshalSize: marshalSize,
      },
    };
    instanceMap.set(structureKey, newType);

    for (let i = 0; i < typeArgCodeSpecs.length; ++i) {
      const typeParameter = typeParameters[i];
      const typeArg = typeArgSpecs[i];
      const typeParameterCodeIdentifier = codeGlobalScope.allocateIdentifier(BapIdentifierPrefix.Local, typeParameter);
      codeWriter.mapInternalToken(typeParameterCodeIdentifier, typeParameter);

      staticScope.declare(
        typeParameter,
        {
          isField: false,
          token: typeParameterCodeIdentifier,
          genType: { generate: (context: BapGenerateContext) => typeArg, debug: { debugName: typeParameter, fixed: typeArg } },
          gen: (bindScope) => ({
            generateRead: (context: BapGenerateContext): BapSubtreeValue => {
              return {
                type: 'type',
                isGenericTypeParameter: false,
                typeGen: { generate: (context) => typeArg, debug: { debugName: typeParameter, fixed: typeArg } },
              };
            },
          })
      });
    }

    for (const propDecl of type.properties) {
      const isStaticLike = propDecl.isStatic;
      const declareInScope = isStaticLike ? staticScope : prototypeScope;
      const fieldName = propDecl.name;
      const fieldType = this.resolveNewBopType(context, propDecl.type(typeArgCodeSpecs)) ?? this.types.errorType;
      const fieldVar = codeGlobalScope.allocateVariableIdentifier(fieldType.codeTypeSpec, BapIdentifierPrefix.Field, fieldName);
      codeWriter.mapInternalToken(fieldVar.identifierToken, fieldName);
      const fieldIdentifier = fieldVar.identifierToken;

      const getterName = `${instantiatedTypeName}::get_${fieldName}`;
      const setterName = `${instantiatedTypeName}::set_${fieldName}`;
      const getterVar = codeGlobalScope.createVariableInScope(CodeTypeSpec.functionType, getterName);
      codeWriter.mapInternalToken(getterVar.identifierToken, getterName);
      const setterVar = codeGlobalScope.createVariableInScope(CodeTypeSpec.functionType, getterName);
      codeWriter.mapInternalToken(setterVar.identifierToken, setterName);

      const generateWrite = (context: BapGenerateContext, value: BapSubtreeValue): BapWriteAsStatementFunc => {
        const thisValue = context.scope.resolve(BapThisSymbol);
        return (prepare) => {
          const thisWriter = thisValue?.writeIntoExpression?.(prepare);
          const valueWriter = value.writeIntoExpression?.(prepare);
          return (block) => {
            const funcCallExpr = block.writeExpressionStatement().expr.writeStaticFunctionCall(setterVar.identifierToken);
            funcCallExpr.externCallSemantics = true;
            if (!isStaticLike) {
              for (const typeArgSpec of typeArgCodeSpecs) {
                funcCallExpr.addTemplateArg(typeArgSpec);
              }
            }
            thisWriter?.(funcCallExpr.addArg());
            valueWriter?.(funcCallExpr.addArg());
          };
        };
      };

      declareInScope.declare(
        fieldName,
        {
          isField: true,
          token: fieldIdentifier,
          genType: { generate: (context: BapGenerateContext) => fieldType, debug: { debugName: fieldIdentifier.nameHint, fixed: fieldType } },
          gen: (bindScope) => ({
            generateRead: (context: BapGenerateContext): BapSubtreeValue => {
              const thisValue = bindScope.resolve(BapThisSymbol);
              return {
                type: 'cached',
                typeSpec: fieldType,
                writeIntoExpression: (prepare) => {
                  const thisWriter = thisValue?.writeIntoExpression?.(prepare);
                  return (expr) => {
                    const funcCallExpr = expr.writeStaticFunctionCall(getterVar.identifierToken);
                    funcCallExpr.externCallSemantics = true;
                    if (!isStaticLike) {
                      for (const typeArgSpec of typeArgCodeSpecs) {
                        funcCallExpr.addTemplateArg(typeArgSpec);
                      }
                    }
                    thisWriter?.(funcCallExpr.addArg());
                  };
                },
                generateWrite: (value): BapWriteAsStatementFunc => generateWrite(context, value),
              };
            },
            generateWrite: generateWrite,
          }),
        });
    }

    for (const method of type.methods) {
      const isStaticLike = !method.isConstructor && method.isStatic;
      const declareInScope = isStaticLike ? staticScope : prototypeScope;
      // if (staticOnly !== isStaticLike) {
      //   continue;
      // }
      const methodName = method.name;
      const internalFunctionName = `${instantiatedTypeName}::${methodName}`;

      // let overloads: BopFunctionType[];
      // overloads = [];
      if (method.isConstructor) {
        const funcName = 'constructor';
        const funcSymbol = BapConstructorSymbol;
        const returnType: BapTypeSpec = newType;
        const debugName = `${newType.debugName}.${funcName}`;
        const funcIdentifier = codeGlobalScope.allocateVariableIdentifier(CodeTypeSpec.functionType, BapIdentifierPrefix.Method, debugName);
        codeWriter.mapInternalToken(funcIdentifier.identifierToken, internalFunctionName);

        declareInScope.declare(
          funcSymbol,
          {
            isField: false,
            token: funcIdentifier.identifierToken,
            genType: { generate: (context: BapGenerateContext) => { return this.types.primitiveTypeSpec(CodePrimitiveType.Function); }, debug: { debugName: funcIdentifier.identifierToken.nameHint } },
            gen: (bindScope) => ({
              generateRead: (prepare) => {
                const funcLiteral: BapFunctionLiteral = {
                  type: 'function',
                  typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Function),
                  resolve: (args: BapSubtreeValue[], typeArgs: BapTypeSpec[]) => {
                    return {
                      type: 'literal',
                      typeSpec: returnType,
                      writeIntoExpression: (prepare) => {
                        const argWriters = args.map(v => v.writeIntoExpression?.(prepare));
                        return (expr) => {
                          const funcCallExpr = expr.writeStaticFunctionCall(funcIdentifier.identifierToken);
                          funcCallExpr.externCallSemantics = true;
                          if (!isStaticLike) {
                            for (const typeArgSpec of typeArgCodeSpecs) {
                              funcCallExpr.addTemplateArg(typeArgSpec);
                            }
                          }
                          for (const typeArgSpec of typeArgs) {
                            funcCallExpr.addTemplateArg(typeArgSpec.codeTypeSpec);
                          }
                          for (const writer of argWriters) {
                            writer?.(funcCallExpr.addArg());
                          }
                        };
                      },
                    };
                  },
                };
                return funcLiteral;
              },
            }),
          });
      } else {
        const funcName = method.name;
        const funcSymbol = funcName;
        const debugName = `${newType.debugName}.${funcName}`;
        const funcIdentifier = codeGlobalScope.allocateVariableIdentifier(CodeTypeSpec.functionType, BapIdentifierPrefix.Method, debugName);
        codeWriter.mapInternalToken(funcIdentifier.identifierToken, internalFunctionName);

        function toResolvedType(type: BapTypeSpec): ResolvedType {
          return {
            type: type,
            typeArgs: [],
          };
        }

        declareInScope.declare(
          funcSymbol,
          {
            isField: false,
            token: funcIdentifier.identifierToken,
            genType: { generate: (context: BapGenerateContext) => { return this.types.primitiveTypeSpec(CodePrimitiveType.Function); }, debug: { debugName: funcIdentifier.identifierToken.nameHint } },
            gen: (bindScope) => ({
              generateRead: (prepare) => {
                const funcLiteral: BapFunctionLiteral = {
                  type: 'function',
                  typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Function),
                  resolve: (args: BapSubtreeValue[], methodTypeArgs: BapTypeSpec[]) => {
                    const thisValue = bindScope.resolve(BapThisSymbol);
                    const returnType: BapTypeSpec = this.resolveMethodParamType(
                      context,
                      method.returnType,
                      typeArgSpecs.map(toResolvedType),
                      methodTypeArgs.map(toResolvedType),
                    ) ?? this.types.errorType;
                    console.log(`returnType`, returnType);
                    return {
                      type: 'literal',
                      typeSpec: returnType,
                      writeIntoExpression: (prepare) => {
                        const thisWriter = thisValue?.writeIntoExpression?.(prepare);
                        const argWriters = args.map(v => v.writeIntoExpression?.(prepare));
                        return (expr) => {
                          const funcCallExpr = expr.writeStaticFunctionCall(funcIdentifier.identifierToken);
                          funcCallExpr.externCallSemantics = true;
                          if (!isStaticLike) {
                            for (const typeArgSpec of typeArgCodeSpecs) {
                              funcCallExpr.addTemplateArg(typeArgSpec);
                            }
                          }
                          for (const typeArgSpec of methodTypeArgs) {
                            funcCallExpr.addTemplateArg(typeArgSpec.codeTypeSpec);
                          }
                          thisWriter?.(funcCallExpr.addArg());
                          for (const writer of argWriters) {
                            writer?.(funcCallExpr.addArg());
                          }
                        };
                      },
                    };
                  },
                };
                return funcLiteral;
              },
            }),
          });
      }

      // // console.log(debugMethodName);
      // if (method.typeParameters.length === 0 || method.isConstructor) {
      //   const methodTypeArgs: ResolvedType[] = [];
      //   const params: BopFields = method.parameters.map(p => {
      //     const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
      //     return { identifier: p.name, type: paramType ?? host.errorType };
      //   });
      //   let returnType: BopType|undefined;
      //   if (method.isConstructor) {
      //     returnType = newType.type;
      //   } else {
      //     returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;
      //   }
      //   if (method.isConstructor) {
      //     newType.declareInternalConstructor(params, debugMethodName);
      //   } else {
      //     newType.declareInternalMethod(method.name, debugMethodName, params, returnType, { isMethod: !method.isStatic });
      //   }
      // } else {
      //   const genericFunc = new BopGenericFunction((typeParameters: BopFields) => {
      //     const isMethod = !method.isStatic;

      //     // Resolve generic params into concrete ones now that we have all type args.
      //     const methodTypeArgs: ResolvedType[] = typeParameters.map(t => utils.upcast({ bopType: t.type, typeArgs: [] }));
      //     const paramDecls: BopFields = method.parameters.map(p => {
      //       const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
      //       return { identifier: p.name, type: paramType ?? host.errorType };
      //     });
      //     if (isMethod) {
      //       paramDecls.splice(0, 0, { identifier: 'this', type: instantiatedType });
      //     }
      //     const returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;

      //     // Create the BopType to represent the concrete function, and map it in the global scope.
      //     const debugInstantiatedMethodName = `${debugMethodName}<${methodTypeArgs.map(t => toStringResolvedType(t)).join(',')}>`;
      //     const newFunctionType = BopType.createFunctionType({
      //       debugName: debugInstantiatedMethodName,
      //       innerScope: host.writer.global.scope.createChildScope(CodeScopeType.Local),
      //       innerBlock: host.globalBlock.createChildBlock(CodeScopeType.Local),
      //       functionOf: new BopFunctionOf([new BopFunctionType(
      //         paramDecls,
      //         returnType,
      //         isMethod,
      //         0,
      //       )]),
      //     });

      //     const concreteFunctionVar = host.globalBlock.mapTempIdentifier(debugInstantiatedMethodName, newFunctionType, /* anonymous */ true);
      //     const concreteFunctionIdentifier = host.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, debugInstantiatedMethodName);
      //     const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar);
      //     newFunctionType.functionOf!.overloads[0].concreteImpl = concreteImpl;
      //     host.bopFunctionConcreteImpls.push(concreteImpl);
      //     concreteFunctionVar.result = concreteFunctionIdentifier;

      //     // Write the trampoline function body.
      //     const funcScope = host.writer.global.scope.createChildScope(CodeScopeType.Function);
      //     const func = host.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
      //     func.touchedByProxy = {
      //       get touchedByCpu() { return concreteImpl.touchedByCpu; },
      //       get touchedByGpu() { return concreteImpl.touchedByGpu; },
      //     };

      //     func.returnTypeSpec = returnType.storageType;
      //     const paramVars: CodeVariable[] = [];
      //     for (const param of paramDecls) {
      //       const paramVar = funcScope.allocateVariableIdentifier(param.type.assignableRefType, BopIdentifierPrefix.Local, param.identifier);
      //       func.addParam(paramVar.typeSpec, paramVar.identifierToken);
      //       paramVars.push(paramVar);
      //     }
      //     const externIdentifier = funcScope.allocateIdentifier(BopIdentifierPrefix.Extern, debugInstantiatedMethodName);
      //     const externFuncCall = func.body.writeReturnStatement().expr.writeStaticFunctionCall(externIdentifier);
      //     externFuncCall.externCallSemantics = true;
      //     for (const typeArg of methodTypeArgs) {
      //       let typeArgType: CodeTypeSpec|undefined;
      //       // TODO: Fix this crude resolution.
      //       if (typeArg.name) {
      //         typeArgType = resolveNewBopType({ name: typeArg.name, typeArgs: [] })?.storageType;
      //       } else {
      //         typeArgType = typeArg.bopType?.storageType;
      //       }
      //       typeArgType ??= CodeTypeSpec.compileErrorType;
      //       externFuncCall.addTemplateArg(typeArgType);
      //     }
      //     for (const param of paramVars) {
      //       externFuncCall.addArg().writeVariableReference(param);
      //     }
      //     host.writer.mapInternalToken(externIdentifier, debugMethodName);

      //     return concreteFunctionVar;
      //   });
      //   newType.declareGenericMethod(methodName, genericFunc);
      // }
    }

    // const instantiateIntoType = (instantiatedTypeName: string, newType: BopInternalTypeBuilder, typeArgs: ResolvedType[], staticOnly: boolean): BopType => {
    // const instantiatedType = newType.type;
    // for (const method of type.methods) {
    //   const isStaticLike = !method.isConstructor && method.isStatic;
    //   if (staticOnly !== isStaticLike) {
    //     continue;
    //   }
    //   const methodName = method.name;
    //   const debugMethodName = `${instantiatedTypeName}::${methodName}`;

    //   // console.log(debugMethodName);
    //   if (method.typeParameters.length === 0 || method.isConstructor) {
    //     const methodTypeArgs: ResolvedType[] = [];
    //     const params: BopFields = method.parameters.map(p => {
    //       const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
    //       return { identifier: p.name, type: paramType ?? host.errorType };
    //     });
    //     let returnType: BopType|undefined;
    //     if (method.isConstructor) {
    //       returnType = newType.type;
    //     } else {
    //       returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;
    //     }
    //     if (method.isConstructor) {
    //       newType.declareInternalConstructor(params, debugMethodName);
    //     } else {
    //       newType.declareInternalMethod(method.name, debugMethodName, params, returnType, { isMethod: !method.isStatic });
    //     }
    //   } else {
    //     const genericFunc = new BopGenericFunction((typeParameters: BopFields) => {
    //       const isMethod = !method.isStatic;

    //       // Resolve generic params into concrete ones now that we have all type args.
    //       const methodTypeArgs: ResolvedType[] = typeParameters.map(t => utils.upcast({ bopType: t.type, typeArgs: [] }));
    //       const paramDecls: BopFields = method.parameters.map(p => {
    //         const paramType = resolveMethodParamType(p.type, typeArgs, methodTypeArgs);
    //         return { identifier: p.name, type: paramType ?? host.errorType };
    //       });
    //       if (isMethod) {
    //         paramDecls.splice(0, 0, { identifier: 'this', type: instantiatedType });
    //       }
    //       const returnType = resolveMethodParamType(method.returnType, typeArgs, methodTypeArgs) ?? host.errorType;

    //       // Create the BopType to represent the concrete function, and map it in the global scope.
    //       const debugInstantiatedMethodName = `${debugMethodName}<${methodTypeArgs.map(t => toStringResolvedType(t)).join(',')}>`;
    //       const newFunctionType = BopType.createFunctionType({
    //         debugName: debugInstantiatedMethodName,
    //         innerScope: host.writer.global.scope.createChildScope(CodeScopeType.Local),
    //         innerBlock: host.globalBlock.createChildBlock(CodeScopeType.Local),
    //         functionOf: new BopFunctionOf([new BopFunctionType(
    //           paramDecls,
    //           returnType,
    //           isMethod,
    //           0,
    //         )]),
    //       });

    //       const concreteFunctionVar = host.globalBlock.mapTempIdentifier(debugInstantiatedMethodName, newFunctionType, /* anonymous */ true);
    //       const concreteFunctionIdentifier = host.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, debugInstantiatedMethodName);
    //       const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar);
    //       newFunctionType.functionOf!.overloads[0].concreteImpl = concreteImpl;
    //       host.bopFunctionConcreteImpls.push(concreteImpl);
    //       concreteFunctionVar.result = concreteFunctionIdentifier;

    //       // Write the trampoline function body.
    //       const funcScope = host.writer.global.scope.createChildScope(CodeScopeType.Function);
    //       const func = host.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
    //       func.touchedByProxy = {
    //         get touchedByCpu() { return concreteImpl.touchedByCpu; },
    //         get touchedByGpu() { return concreteImpl.touchedByGpu; },
    //       };

    //       func.returnTypeSpec = returnType.storageType;
    //       const paramVars: CodeVariable[] = [];
    //       for (const param of paramDecls) {
    //         const paramVar = funcScope.allocateVariableIdentifier(param.type.assignableRefType, BopIdentifierPrefix.Local, param.identifier);
    //         func.addParam(paramVar.typeSpec, paramVar.identifierToken);
    //         paramVars.push(paramVar);
    //       }
    //       const externIdentifier = funcScope.allocateIdentifier(BopIdentifierPrefix.Extern, debugInstantiatedMethodName);
    //       const externFuncCall = func.body.writeReturnStatement().expr.writeStaticFunctionCall(externIdentifier);
    //       externFuncCall.externCallSemantics = true;
    //       for (const typeArg of methodTypeArgs) {
    //         let typeArgType: CodeTypeSpec|undefined;
    //         // TODO: Fix this crude resolution.
    //         if (typeArg.name) {
    //           typeArgType = resolveNewBopType({ name: typeArg.name, typeArgs: [] })?.storageType;
    //         } else {
    //           typeArgType = typeArg.bopType?.storageType;
    //         }
    //         typeArgType ??= CodeTypeSpec.compileErrorType;
    //         externFuncCall.addTemplateArg(typeArgType);
    //       }
    //       for (const param of paramVars) {
    //         externFuncCall.addArg().writeVariableReference(param);
    //       }
    //       host.writer.mapInternalToken(externIdentifier, debugMethodName);

    //       return concreteFunctionVar;
    //     });
    //     newType.declareGenericMethod(methodName, genericFunc);
    //   }
    // }

    // for (const propDecl of type.properties) {
    //   // if (staticOnly) {
    //   //   continue;
    //   // }
    //   const propName = propDecl.name;
    //   const propType = resolveNewBopType(propDecl.type(typeArgs)) ?? host.errorType;
    //   const propVar = newType.declareInternalProperty(propName, propType);
    //   // const propertyIdentifierToken = newType.type.innerScope.allocateIdentifier(BopIdentifierPrefix.Field, propName);
    //   // host.writer.mapInternalToken(propertyIdentifierToken, propName);

    //   const getterName = `${instantiatedTypeName}::get_${propName}`;
    //   const setterName = `${instantiatedTypeName}::set_${propName}`;

    //   const getterType = BopType.createFunctionType({
    //     debugName: getterName,
    //     innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
    //     innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
    //     functionOf: new BopFunctionOf([new BopFunctionType(
    //       [],
    //       propType,
    //       /* isMethod */ true,
    //       0,
    //     )]),
    //   });
    //   const getterBopVar = newType.type.innerBlock.mapIdentifier(getterType.debugName, getterType.tempType, getterType, /* anonymous */ true);
    //   const getterVar = newType.type.innerScope.createVariableInScope(getterBopVar.type, getterBopVar.nameHint);
    //   getterBopVar.result = getterVar;
    //   getterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(getterBopVar);
    //   host.bopFunctionConcreteImpls.push(getterType.functionOf!.overloads[0].concreteImpl);
    //   host.writer.mapInternalToken(getterVar.identifierToken, getterName);

    //   const setterType = BopType.createFunctionType({
    //     debugName: setterName,
    //     innerScope: newType.type.innerScope.createChildScope(CodeScopeType.Local),
    //     innerBlock: newType.type.innerBlock.createChildBlock(CodeScopeType.Local),
    //     functionOf: new BopFunctionOf([new BopFunctionType(
    //       [{ identifier: 'value', type: propType }],
    //       host.voidType,
    //       /* isMethod */ true,
    //       0,
    //     )]),
    //   });
    //   const setterBopVar = newType.type.innerBlock.mapIdentifier(setterType.debugName, setterType.tempType, setterType, /* anonymous */ true);
    //   const setterVar = newType.type.innerScope.createVariableInScope(setterBopVar.type, setterBopVar.nameHint);
    //   setterBopVar.result = setterVar;
    //   setterType.functionOf!.overloads[0].concreteImpl = new BopFunctionConcreteImplDetail(setterBopVar);
    //   host.bopFunctionConcreteImpls.push(setterType.functionOf!.overloads[0].concreteImpl);
    //   host.writer.mapInternalToken(setterVar.identifierToken, setterName);

    //   propVar.propertyResult = new BopPropertyAccessor(getterBopVar, setterBopVar, { directAccessIdentifier: propertyIdentifierToken });
    // }

    //   return instantiatedType;
    // }
    return newType;
  }







  private readonly internalIsFieldSet = new Set<string>([
    'x',
    'y',
    'z',
    'w',
  ]);

  // createInternalType(context: BapGenerateContext, options: {
  //   identifier: string,
  //   internalIdentifier?: string,
  //   anonymous?: boolean,
  //   isArrayOf?: BapTypeSpec,
  // }): BopInternalTypeBuilder {
  //   // const typeBopVar = context..globalBlock.mapStorageIdentifier(options.identifier, this.types.primitiveTypeSpec(CodePrimitiveType.Type).codeTypeSpec, /* anonymous */ true);
  //   const typeVar = codeGlobalScope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, options.identifier);
  //   const innerScope = codeGlobalScope.createChildScope(CodeScopeType.Class);
  //   // const innerBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
  //   context.scope.child({  });
  //   this.writer.mapInternalToken(typeVar.identifierToken, options.internalIdentifier ?? options.identifier);

  //   // HACK!!! Use the mutability of arrays to allow us to mutate BopStructType after the fact.
  //   const fields: BopVariable[] = [];
  //   const declareField = (identifier: string, type: BopType) => {
  //     const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
  //     const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
  //     fieldBopVar.result = fieldVar;
  //     this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
  //     if (this.internalIsFieldSet.has(identifier)) {
  //       fields.push(fieldBopVar);
  //     }
  //     return fieldBopVar;
  //   };

  //   const declareInternalProperty = (identifier: string, type: BopType) => {
  //     const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
  //     const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
  //     this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
  //     if (this.internalIsFieldSet.has(identifier)) {
  //       fields.push(fieldBopVar);
  //     }
  //     return fieldBopVar;
  //   };

  //   const newType = BopType.createPassByValue({
  //       debugName: options.identifier,
  //       valueType: CodeTypeSpec.fromStruct(typeVar.identifierToken),
  //       innerScope: innerScope,
  //       innerBlock: innerBlock,
  //       structOf: new BopStructType(fields),
  //       internalTypeOf: new BopInternalType(options.isArrayOf),
  //   });
  //   typeBopVar.typeResult = newType;

  //   if (!options.anonymous) {
  //     this.internalTypes.set(options.identifier, newType);
  //   }

  //   const declareFunction = (identifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
  //     const bopFunctionType = new BopFunctionType(
  //       params,
  //       newType,
  //       /* isMethod */ options.includeThis,
  //       0,
  //     );

  //     let funcIdentifier;
  //     const oldFunc = innerBlock.identifierMap.get(identifier);
  //     if (oldFunc && oldFunc.bopType.functionOf && oldFunc.result) {
  //       funcIdentifier = oldFunc.result;
  //       oldFunc.bopType.functionOf.overloads.push(bopFunctionType);
  //     } else {
  //       const debugName = `${newType.debugName}.${identifier}`;
  //       funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, debugName);
  //       const funcType = BopType.createFunctionType({
  //         debugName: debugName,
  //         innerScope: innerScope.createChildScope(CodeScopeType.Local),
  //         innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
  //         functionOf: new BopFunctionOf([bopFunctionType]),
  //       });
  //       innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
  //     }

  //     // TODO: Allocate different identifier tokens for each overload.
  //     const funcWriter = this.writer.global.writeFunction(funcIdentifier.identifierToken);
  //     funcWriter.returnTypeSpec = returnType.storageType;
  //     return funcWriter;
  //   };

  //   const declareMethod = (identifier: string, params: BopFields, returnType: BopType) => {
  //     return declareFunction(identifier, params, returnType, { includeThis: true });
  //   };

  //   const declareConstructor = (params: BopFields) => {
  //     return declareFunction('constructor', params, newType, { includeThis: false });
  //   };

  //   const declareInternalField = (identifier: string, type: BopType) => {
  //     const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
  //     const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
  //     fieldBopVar.result = fieldVar;
  //     this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
  //     return fieldBopVar;
  //   };

  //   const declareInternalFunction = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
  //     let funcIdentifier;
  //     let overloads: BopFunctionType[];
  //     const oldFunc = innerBlock.identifierMap.get(identifier);
  //     if (oldFunc && oldFunc.bopType.functionOf && oldFunc.result) {
  //       funcIdentifier = oldFunc.result;
  //       overloads = oldFunc.bopType.functionOf.overloads;
  //     } else {
  //       const debugName = `${newType.debugName}.${identifier}`;
  //       const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
  //       overloads = [];
  //       const funcType = BopType.createFunctionType({
  //         debugName: debugName,
  //         innerScope: innerScope.createChildScope(CodeScopeType.Local),
  //         innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
  //         functionOf: new BopFunctionOf(overloads),
  //       });
  //       innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
  //       this.writer.mapInternalToken(funcIdentifier.identifierToken, internalIdentifier);
  //     }

  //     const bopFunctionType = new BopFunctionType(
  //       params,
  //       returnType,
  //       /* isMethod */ options.includeThis,
  //       overloads.length,
  //     );
  //     overloads.push(bopFunctionType);
  //     return;
  //   };

  //   const declareInternalMethod = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { isMethod: boolean }) => {
  //     return declareInternalFunction(identifier, internalIdentifier, params, returnType, { includeThis: options.isMethod });
  //   };

  //   const declareInternalConstructor = (params: BopFields, internalIdentifier: string) => {
  //     return declareInternalFunction('constructor', internalIdentifier, params, newType, { includeThis: false });
  //   };

  //   const declareGenericMethod = (identifier: string, genericFunc: BopGenericFunction) => {
  //     const debugName = `${newType.debugName}.${identifier}`;
  //     const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
  //     innerBlock.mapTempIdentifier(identifier, this.functionType).genericFunctionResult = genericFunc;
  //     return;
  //   };

  //   return {
  //     type: newType,
  //     declareField,
  //     declareMethod,
  //     declareConstructor,
  //     declareInternalField,
  //     declareInternalMethod,
  //     declareInternalConstructor,
  //     declareGenericMethod,
  //     declareInternalProperty,
  //   };
  // }
}











