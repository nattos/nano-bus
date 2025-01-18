import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { BapFields, BapGenerateContext, BapSubtreeGenerator, BapSubtreeValue, BapTypeGenerator, BapTypeSpec, BapWriteAsStatementFunc, BapWriteIntoExpressionFunc } from "./bap-value";
import { getNodeLabel } from "./ts-helpers";
import { CodePrimitiveType, CodeScope, CodeScopeType, CodeTypeSpec, CodeVariable, CodeWriter } from './code-writer';
import { BopIdentifierPrefix } from './bop-data';
import { BapPrototypeScope, BapScope, BapThisSymbol } from './bap-scope';

type AnyPossibleNode<TType extends ts.SyntaxKind> = ts.Node&{ readonly kind: TType };
export type BapVisitorImpl<TNode> = BapVisitor&{ impl(node: TNode|Node): BapSubtreeGenerator|undefined; };
type BapVisitorImplConstructor<TNode> = { new (): BapVisitorImpl<TNode>; };

export interface BapVisitorRootContext {
  readonly program: ts.Program;
  readonly sourceRoot: ts.SourceFile;
  readonly tc: ts.TypeChecker;
}

interface VistorDecl {
  predicate?: (node: ts.Node) => boolean;
  visit: (node: ts.Node) => BapSubtreeGenerator|undefined;
}

export class BapVisitor {
  protected static currentParent?: BapVisitor;
  private static readonly nodeTypeMap = new Map<ts.SyntaxKind, Array<VistorDecl>>();

  readonly program: ts.Program;
  readonly sourceRoot: ts.SourceFile;
  readonly tc: ts.TypeChecker;

  constructor(rootContext?: BapVisitorRootContext) {
    let parentContext = rootContext ?? BapVisitor.currentParent;
    if (!parentContext) {
      throw new Error('Visitor not constructed within a context.');
    }
    this.program = parentContext.program;
    this.sourceRoot = parentContext.sourceRoot;
    this.tc = parentContext.tc;
  }

  protected child(node: ts.Node|undefined): BapSubtreeGenerator|undefined {
    if (!node) {
      return;
    }
    const oldParent = BapVisitor.currentParent;
    BapVisitor.currentParent = this;
    try {
      return this.visitChildImpl(node);
    } finally {
      BapVisitor.currentParent = oldParent;
    }
  }
  protected visitChildImpl(node: ts.Node): BapSubtreeGenerator|undefined {
    let child: BapSubtreeGenerator|undefined = undefined;
    const visitors = BapVisitor.nodeTypeMap.get(node.kind);
    if (visitors) {
      for (const visitorDecl of visitors) {
        if (visitorDecl.predicate) {
          if (!visitorDecl.predicate(node)) {
            continue;
          }
        }
        child = visitorDecl.visit(node);
        break;
      }
    }
    if (!this.verifyNotNulllike(child, `Unsupported syntax ${getNodeLabel(node)}`)) {
      return;
    }
    return child;
  }
  static visit(node: ts.Node): BapSubtreeGenerator|undefined {
    let child: BapSubtreeGenerator|undefined = undefined;
    const visitors = BapVisitor.nodeTypeMap.get(node.kind);
    if (visitors) {
      for (const visitorDecl of visitors) {
        if (visitorDecl.predicate) {
          if (!visitorDecl.predicate(node)) {
            continue;
          }
        }
        child = visitorDecl.visit(node);
        break;
      }
    }
    return child;
  }

  // TODO: Move to type resolver with cache!!!
  protected primitiveType(primitiveType: CodePrimitiveType): BapTypeGenerator {
    return {
      generate: (context) => {
        return {
          prototypeScope: new BapPrototypeScope(), // TODO: Fix!!!
          codeTypeSpec: CodeTypeSpec.fromPrimitive(primitiveType),
        };
      },
    };
  }

  // TODO: Move to type resolver with cache!!!
  static primitiveTypeSpec(primitiveType: CodePrimitiveType): BapTypeSpec {
    return {
      prototypeScope: new BapPrototypeScope(), // TODO: Fix!!!
      codeTypeSpec: CodeTypeSpec.fromPrimitive(primitiveType),
    };
  }

  // TODO: Move to type resolver with cache!!!
  protected type(nodeOrType: ts.Node|ts.Type): BapTypeGenerator {
    let tsType: ts.Type;
    let maybeNode = nodeOrType as ts.Node;
    let maybeType = nodeOrType as ts.Type;
    if (maybeNode.kind) {
      tsType = this.tc.getTypeAtLocation(maybeNode);
    } else {
      tsType = maybeType;
    }
    return {
      generate: (context) => {
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

        let found: BapTypeGenerator|undefined = undefined;
        // let found = !requiresFullLookup && this.typeMap.get(tsType);
        // // let found = this.typeMap.get(type) ?? this.typeSymbolMap.get(type.symbol);
        // if (found) {
        //   return found;
        // }

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
          found = this.primitiveType(CodePrimitiveType.Int);
        }

        if ((tsType.flags & ts.TypeFlags.NumberLiteral) === ts.TypeFlags.NumberLiteral) {
          found = this.primitiveType(CodePrimitiveType.Int);
        } else if ((tsType.flags & ts.TypeFlags.BooleanLiteral) === ts.TypeFlags.BooleanLiteral) {
          found = this.primitiveType(CodePrimitiveType.Bool);
        } else if ((tsType.flags & ts.TypeFlags.Undefined) === ts.TypeFlags.Undefined) {
          // found = this.primitiveType(CodePrimitiveType.Undefined);
        }
        if (found) {
          return found.generate(context);
        }

        const parentCodeScope = context.globalWriter.global.scope;
        // const parentBlock = this.globalBlock;
        const shortName = this.stringifyType(tsType);

        // Create a new type.
        if (!this.check((tsType.flags & ts.TypeFlags.Any) !== ts.TypeFlags.Any, `Type ${utils.stringEmptyToNull(shortName) ?? 'any'} is disallowed.`)) {
          return;
          // return options?.allowWouldBeAny ? this.wouldBeAnyType : this.errorType;
        }
        // if (!this.check(!this.resolvingSet.has(tsType), `Type ${shortName} is recursive.`)) {
        //   return this.errorType;
        // }

        // Resolve types, that might contain type parameters.
        // const resolveInnerTypeRef = (t: ts.Type): BopType|undefined => {
        //   if (!t.symbol) {
        //     return this.resolveType(t, { inBlock: thisBlock });
        //   }
        //   const typeRef = new BopReference(t.symbol.name, thisBlock);
        //   this.resolve(typeRef);
        //   if (typeRef.resolvedRef) {
        //     return typeRef.resolvedRef?.typeResult;
        //   }
        //   return this.resolveType(t, { inBlock: thisBlock });
        // };

        // if (isTypeParameter) {
        //   return resolveInnerTypeRef(tsType) ?? this.errorType;
        // } else {
        //   // type.isTypeParameter() and the return confuses the type checker.
        //   tsType = tsType as ts.Type;
        // }

        // this.resolvingSet.set(tsType);
        // const typeArgs: BopFields = [];
        try {
          // Lookup cached generic instantiations.
          // let typeParamsKey = '';
          // if (requiresGenericLookup) {
          //   const baseTypeArgs = (genericBase as ts.InterfaceType).typeParameters ?? [];
          //   const thisTypeArgs = (tsType as ts.TypeReference).typeArguments ?? [];
          //   if (!this.check(baseTypeArgs.length === thisTypeArgs.length, `Mismatching type arguments.`)) {
          //     return this.errorType;
          //   }
          //   for (let i = 0; i < baseTypeArgs.length; ++i) {
          //     const baseType = baseTypeArgs[i];
          //     const thisType = thisTypeArgs[i];
          //     const resolved = resolveInnerTypeRef(thisType) ?? this.errorType;
          //     typeArgs.push({
          //       identifier: baseType.symbol.name,
          //       type: resolved,
          //     });
          //   }
          //   typeParamsKey = this.toStructureKey(typeArgs);

          //   const genericInstances = this.typeGenericMap.get(genericBase!);
          //   if (genericInstances) {
          //     found = genericInstances.get(typeParamsKey);
          //   } else {
          //     found = undefined;
          //   }
          //   if (found) {
          //     return found;
          //   }
          // }

          // Lookup internal types.
          // const sourceFile = tsGetSourceFileOfNode(tsType.symbol?.declarations?.at(0));
          // const isInternalDeclaration = sourceFile?.fileName?.toLowerCase()?.endsWith('.d.ts') ?? false;
          // if (isInternalDeclaration) {
          //   // console.log(`     internal type mapping ========> ${type.symbol.name}`);
          //   const internalGenericType = this.internalGenericTypeMap.get(tsType.symbol.name);
          //   if (internalGenericType) {
          //     const instantiatedType = internalGenericType(typeArgs);
          //     let genericInstances = this.typeGenericMap.get(genericBase!);
          //     if (!genericInstances) {
          //       genericInstances = new Map();
          //       this.typeGenericMap.set(genericBase!, genericInstances);
          //     }
          //     genericInstances.set(typeParamsKey, instantiatedType);
          //     return instantiatedType;
          //   }
          //   return this.internalTypes.get(tsType.symbol.name) ?? this.errorType;
          // }

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
            let propertyType;
            // if (propertySymbolType.isTypeParameter()) {
            //   propertyType = resolveInnerTypeRef(propertySymbolType);
            // }
            // propertyType ??= this.type(propertySymbolType, { willCoerceTo: options?.willCoerceFieldsTo?.get(propertyName) });
            propertyType ??= this.type(propertySymbolType);
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

          // let casesIdentifierMap: Map<BopType, { identifier: string, index: number }>|undefined;
          // let caseVariableIdentifier: string|undefined;
          // if (tsType.isUnion()) {
          //   casesIdentifierMap = new Map();

          //   const innerTypes = tsType.types.map(t => this.resolveType(t));
          //   let innerIndex = 0;
          //   for (const innerType of innerTypes) {
          //     if (casesIdentifierMap.has(innerType)) {
          //       continue;
          //     }
          //     const identifier = `${innerType.debugName}`;
          //     fields.push({ type: innerType, identifier });
          //     casesIdentifierMap.set(innerType, { identifier, index: innerIndex });
          //     innerIndex++;
          //   }

          //   caseVariableIdentifier = 'case';
          //   fields.push({ type: this.intType, identifier: caseVariableIdentifier });
          // }

          // const structureKey = this.toStructureKey(fields);

          // let existingTypeInfo = this.typeCoalesceMap.get(structureKey);
          // let fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BopType }>;
          let fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BapTypeSpec }>;
          let identifier: CodeVariable;
          let innerCodeScope: CodeScope;
          const methodFuncs: Array<() => void> = [];
          // if (existingTypeInfo) {
          //   identifier = existingTypeInfo.identifier;
          //   innerScope = existingTypeInfo.innerScope;
          //   fieldIdentifierMap = existingTypeInfo.fieldIdentifierMap;
          // } else {
          {
            identifier = parentCodeScope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, shortName);
            innerCodeScope = parentCodeScope.createChildScope(CodeScopeType.Class);
            fieldIdentifierMap = new Map();
            // existingTypeInfo = { identifier, innerScope, fieldIdentifierMap };
            // this.typeCoalesceMap.set(structureKey, existingTypeInfo);
            for (const property of fields) {
              const typeSpec = property.type.generate(context);
              if (!this.verifyNotNulllike(typeSpec, `Field ${property.identifier} does not have a valid type.`)) {
                continue;
              }
              const fieldIdentifier = innerCodeScope.allocateVariableIdentifier(typeSpec.codeTypeSpec, BopIdentifierPrefix.Field, property.identifier);
              fieldIdentifierMap.set(property.identifier, { fieldVar: fieldIdentifier, fieldType: typeSpec });
            }
          }
          {
            const structWriterOuter = context.globalWriter.global.writeStruct(identifier.identifierToken);
            // structWriterOuter.touchedByProxy = {
            //   get touchedByCpu() { return structOf.touchedByCpu; },
            //   get touchedByGpu() { return structOf.touchedByGpu; },
            // };
            const structWriter = structWriterOuter.body;

            for (const [identifier, property] of fieldIdentifierMap) {
              structWriter.writeField(property.fieldVar.identifierToken, property.fieldVar.typeSpec);
            }
            // structWriter.writeStaticConstant(this.writer.makeInternalToken('marshalBytesInto'), CodeTypeSpec.functionType, () => {
            //   return structOf.marshalFunc;
            // });
            // structWriter.writeStaticConstant(this.writer.makeInternalToken('marshalByteStride'), CodeTypeSpec.functionType, () => {
            //   if (structOf.marshalLength === undefined) {
            //     return;
            //   }
            //   const value = structOf.marshalLength;
            //   return (expr: CodeExpressionWriter) => {
            //     expr.writeLiteralInt(value);
            //   };
            // });

            // for (const methodDecl of methodDecls) {
            //   methodFuncs.push(() => {
            //     const methodVar = this.declareFunction(methodDecl, newType, this.globalBlock, thisBlock, typeArgs);
            //     if (!methodVar) {
            //       return;
            //     }
            //   });
            // }
          }

          // let unionOf: BopTypeUnion|undefined;
          // if (casesIdentifierMap && caseVariableIdentifier) {
          //   unionOf = new BopTypeUnion(
          //     new Map(Array.from(casesIdentifierMap.entries()).map(([type, entry]) => [ type, { caseVar: fieldIdentifierMap.get(entry.identifier)!.fieldVar, caseIndex: entry.index } ])),
          //     fieldIdentifierMap.get(caseVariableIdentifier)!.fieldVar,
          //   );
          // }

          // const innerBlock = parentBlock.createChildBlock(CodeScopeType.Class);
          // const typeVar = parentBlock.mapStorageIdentifier(shortName, this.typeType);

          const prototypeScope = new BapPrototypeScope();// context.rootContext.withChildScope();
          // const fieldMap = new Map<string, BopVariable>();
          for (const property of fields) {
            const fieldIdentifier = fieldIdentifierMap.get(property.identifier)!;

            const generateWrite = (context: BapGenerateContext, value: BapSubtreeValue): BapWriteAsStatementFunc => {
              const thisValue = context.scope.resolve(BapThisSymbol);
              return (prepare) => {
                const thisWriter = thisValue?.writeIntoExpression?.(prepare);
                const valueWriter = value.writeIntoExpression?.(prepare);
                const assignStmt = prepare.writeAssignmentStatement();
                thisWriter?.(assignStmt.ref.writePropertyAccess(fieldIdentifier.fieldVar.identifierToken).source);
                valueWriter?.(assignStmt.value);
              };
            };

            prototypeScope.declare(property.identifier, fieldIdentifier.fieldVar.identifierToken, {
              generateRead: (context: BapGenerateContext): BapSubtreeValue => {
                const thisValue = context.scope.resolve(BapThisSymbol);
                return {
                  type: 'cached',
                  typeSpec: property.type.generate(context),
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
            });
            // const fieldVar = innerBlock.mapIdentifier(property.identifier, fieldIdentifier.fieldVar.typeSpec, fieldIdentifier.fieldType);
            // fieldVar.result = fieldIdentifier.fieldVar;
            // fieldMap.set(property.identifier, fieldVar);
          }

          // const structOf = new BopStructType(
          //   fields.map(f => fieldMap.get(f.identifier)!),
          // );
          // structOf.touchedByCpu = true;
          // structOf.touchedByGpu = true;

          // const newType = BopType.createPassByValue({
          //     debugName: shortName,
          //     valueType: CodeTypeSpec.fromStruct(identifier.identifierToken),
          //     innerScope,
          //     innerBlock,
          //     structOf,
          // });
          // if (requiresGenericLookup) {
          //   let genericInstances = this.typeGenericMap.get(genericBase!);
          //   if (!genericInstances) {
          //     genericInstances = new Map();
          //     this.typeGenericMap.set(genericBase!, genericInstances);
          //   }
          //   genericInstances.set(typeParamsKey, newType);
          // } else {
          //   this.typeMap.set(tsType, newType);
          // }
          // typeVar.typeResult = newType;


          // if (!constructorDecl && existingTypeInfo.defaultConstructor) {
          //   // Use the existing default constructor.
          //   const constructorIdentifier = existingTypeInfo.defaultConstructor;
          //   innerBlock.mapIdentifier('constructor', constructorIdentifier.fieldVar.typeSpec, constructorIdentifier.fieldType).result = constructorIdentifier.fieldVar;
          // } else {
          //   if (!constructorDecl) {
          //     // Generate a default constructor.
          //     const constructorIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, shortName);
          //     const constructorFuncType = BopType.createFunctionType({
          //       debugName: `${shortName}.constructor`,
          //       innerScope: innerScope.createChildScope(CodeScopeType.Local),
          //       innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
          //       functionOf: new BopFunctionOf([new BopFunctionType(
          //         [],
          //         newType,
          //         /* isMethod */ false,
          //         0,
          //       )]),
          //     });
          //     existingTypeInfo.defaultConstructor = { fieldVar: constructorIdentifier, fieldType: constructorFuncType };

          //     innerBlock.mapIdentifier('constructor', constructorIdentifier.typeSpec, constructorFuncType).result = constructorIdentifier;
          //     const constructorWriter = this.writer.global.writeFunction(constructorIdentifier.identifierToken);
          //     constructorWriter.returnTypeSpec = newType.storageType;

          //     const constructorBlock = this.globalBlock.createChildBlock(CodeScopeType.Function);
          //     const constructorScope = this.writer.global.scope.createChildScope(CodeScopeType.Function);
          //     const constructorOutVar = constructorScope.allocateVariableIdentifier(newType.storageType, BopIdentifierPrefix.Local, 'New');
          //     constructorWriter.body.writeVariableDeclaration(constructorOutVar);
          //     constructorWriter.body.writeReturnStatement().expr.writeVariableReference(constructorOutVar);
          //   } else {
          //     // Roll out the constructor implementation.
          //     this.declareFunction(constructorDecl, newType, this.globalBlock, thisBlock, typeArgs);
          //   }
          // }
          // methodFuncs.forEach(f => f());

          const newType: BapTypeSpec = {
            prototypeScope: prototypeScope,
            codeTypeSpec: CodeTypeSpec.fromStruct(identifier.identifierToken),
          };
          return newType;
        } finally {
          // this.resolvingSet.delete(tsType);
        }
        return this.errorType;
      },
    };
  }

  private get errorType(): BapTypeSpec {
    throw new Error('???');
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








  // private toStructureKey(fields: BopFields) {
  //   let structureKey = '';
  //   for (const entry of fields) {
  //     const lookupType = entry.type.tempType;
  //     let typeKey = lookupType.asPrimitive ?? lookupType.asStruct!;
  //     let typeId = this.typeIdMap.get(typeKey);
  //     if (typeId === undefined) {
  //       typeId = this.typeIdMap.size;
  //       this.typeIdMap.set(typeKey, typeId);
  //     }
  //     let structureKeyPart = `${entry.identifier}:${typeId},`;
  //     if (lookupType.isConst) {
  //       structureKeyPart = `const ${structureKeyPart}`;
  //     }
  //     if (lookupType.isReference) {
  //       structureKeyPart += '&';
  //     }
  //     if (lookupType.isPointer) {
  //       structureKeyPart += '*';
  //     }
  //     if (lookupType.isArray) {
  //       structureKeyPart += '[]';
  //     }
  //     structureKey += structureKeyPart;
  //   }
  //   return structureKey;
  // }

  protected verify<T>(value: T, errorFormatter: (() => string)|string, predicate?: (v: T) => boolean): T {
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

  protected logAssert(error: string) {
    console.error(error);
  }

  protected check(cond: boolean, errorFormatter: (() => string)|string): boolean {
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

  protected verifyNotNulllike<T>(cond: T|null|undefined, errorFormatter: (() => string)|string): cond is T {
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

  protected writeFuncToExpr(func: BapWriteAsStatementFunc|undefined): BapWriteIntoExpressionFunc|undefined {
    if (!func) {
      return;
    }
    return (prepare) => {
      func(prepare);
      return undefined;
    };
  }

  protected bindGenContext(gen: BapSubtreeGenerator|undefined, context: BapGenerateContext) {
    if (!gen) {
      return;
    }
    return {
      generateRead: (_: BapGenerateContext): BapSubtreeValue => {
        return gen.generateRead(context);
      },
    };
  }

  public static mapNodeType<
      TKind extends ts.SyntaxKind,
      TNode extends AnyPossibleNode<TKind>,
  >(
      nodeKind: TKind,
      activator: BapVisitorImplConstructor<TNode>,
      predicate?: (node: TNode) => boolean,
  ) {
    const visitImpl = (node: ts.Node) => new activator().impl(node as TNode);
    this.mapNodeTypeVisitor(nodeKind, visitImpl, predicate as any);
  }

  public static mapNodeTypeFunc<
      TKind extends ts.SyntaxKind,
      TNode extends AnyPossibleNode<TKind>,
  >(
      nodeKind: TKind,
      activator: () => BapVisitorImpl<TNode>,
      predicate?: (node: TNode) => boolean,
  ) {
    const visitImpl = (node: ts.Node) => activator().impl(node as TNode);
    this.mapNodeTypeVisitor(nodeKind, visitImpl, predicate as any);
  }

  private static mapNodeTypeVisitor(
      nodeKind: ts.SyntaxKind,
      visitImpl: (node: ts.Node) => BapSubtreeGenerator|undefined,
      predicate?: (node: ts.Node) => boolean,
  ) {
    let visitors = this.nodeTypeMap.get(nodeKind);
    if (!visitors) {
      visitors = [];
      this.nodeTypeMap.set(nodeKind, visitors);
    }
    visitors.push({
      predicate: predicate,
      visit: visitImpl,
    });
  }
}
