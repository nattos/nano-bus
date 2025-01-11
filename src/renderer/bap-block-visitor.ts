import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext, BapSubtreeValue, BapTypeLiteral, BapFunctionLiteral, BapThisSymbol, BapReturnValueSymbol as BapReturnValueSymbol } from "./bap-value";
import { BapVisitor, BapVisitorRootContext } from "./bap-visitor";
import { CodeBinaryOperator } from "./code-writer";
import { getNodeLabel } from "./ts-helpers";

export class BapGlobalBlockVisitor extends BapVisitor {
  constructor(context: BapVisitorRootContext) {
    super(context);
  }

  visitSourceFile(node: ts.SourceFile): BapSubtreeGenerator|undefined {
    const oldParent = BapVisitor.currentParent;
    BapVisitor.currentParent = this;
    try {
      return this.implInner(node);
    } finally {
      BapVisitor.currentParent = oldParent;
    }
  }

  private implInner(node: ts.SourceFile): BapSubtreeGenerator|undefined {
    const stmts: Array<BapSubtreeGenerator|undefined> = [];
    for (const statement of node.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
      } else if (ts.isClassDeclaration(statement)) {
        // TODO:
        // if (!this.verifyNotNulllike(statement.name, `Anonymous classes not supported.`)) {
        //   return;
        // }
        // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
      } else if (ts.isFunctionDeclaration(statement)) {
        stmts.push(new BapFunctionDeclarationVisitor().impl(statement));
      } else {
        this.logAssert(`Unsupported ${getNodeLabel(statement)} at global scope.`);
      }
    }

    return {
      generateRead: (context: BapGenerateContext) => {
        let lastFuncLiteral: BapFunctionLiteral|undefined;
        for (const stmt of stmts) {
          if (!stmt) {
            continue;
          }
          const result = stmt.generateRead(context);
          if (result.type === 'function') {
            lastFuncLiteral = result;
          }
        }
        return {
          type: 'literal',
          writeIntoExpression: (prepare) => {
            if (lastFuncLiteral) {
              return lastFuncLiteral.resolve([], [])?.writeIntoExpression?.(prepare);
            }
          },
        };
        // const stmtValues = stmts.map(stmt => stmt?.generateRead(context));
        // return {
        //   type: 'statement',
        //   writeIntoExpression: (prepare) => {
        //     for (const stmtValue of stmtValues) {
        //       stmtValue?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
        //     }
        //     return undefined;
        //   },
        // };
      },
    };
    // node.statements.forEach(this.visitChild.bind(this));
    // return {};
  }
}

export class BapFunctionDeclarationVisitor extends BapVisitor {
  impl(node: ts.FunctionDeclaration): BapSubtreeGenerator|undefined {
    if (!this.verifyNotNulllike(node.name, `Unsupported anonymous function at global scope.`)) {
      return;
    }
    if (!this.verifyNotNulllike(node.body, `Function at global scope must have a body.`)) {
      return;
    }
    const funcBody = node.body;
    const functionName = node.name.text;
    return {
      generateRead: (context) => {
        const body = this.child(funcBody);
        const funcLiteral: BapFunctionLiteral = {
          type: 'function',
          resolve: (args: BapSubtreeValue[], typeArgs: BapTypeLiteral[]) => {
            // TODO: Perform overload resolution and generic template expansion.
            // TODO: Insert args into context.
            const childContext = context.withChildScope();
            childContext.scope.declare(BapReturnValueSymbol, { type: 'error' });
            const callWriter = body?.generateRead(childContext);
            return {
              type: 'literal',
              writeIntoExpression: (prepare) => {
                callWriter?.writeIntoExpression?.(prepare);
                return childContext.scope.resolve(BapReturnValueSymbol)?.writeIntoExpression?.(prepare);
              },
            };
          },
        };
        context.scope.declare(functionName, funcLiteral);
        return funcLiteral;
      },
    };
  }
}

export class BapBlockVisitor extends BapVisitor {
  impl(node: ts.Block): BapSubtreeGenerator|undefined {
    const stmts = node.statements.map(stmt => this.child(stmt));
    return {
      generateRead: (context: BapGenerateContext) => {
        const stmtValues = stmts.map(stmt => stmt?.generateRead(context));
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            for (const stmtValue of stmtValues) {
              stmtValue?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
            }
            return undefined;
          },
        };
      },
    };
    // node.statements.forEach(this.visitChild.bind(this));
    // return {};
  }
}

export class BapVariableDeclarationVisitor extends BapVisitor {
  impl(node: ts.VariableStatement|ts.VariableDeclarationList): BapSubtreeGenerator|undefined {
    const declarations = ts.isVariableDeclarationList(node) ? node.declarations : node.declarationList.declarations;
    const newVars = declarations.map(decl => {
      const identifier = decl.name.getText();
      const initializer = decl.initializer ? this.child(decl.initializer) : undefined;
      return {
        identifier,
        initializer,
      };
    });
    return {
      generateRead: (context) => {
        for (const newVar of newVars) {
          const newValue = newVar.initializer?.generateRead(context) ?? { type: 'uninitialized' };
          context.scope.declare(newVar.identifier, newValue);
        }
        return {
          type: 'statement'
        };
      },
    };
    // const newVars = declarations.map(decl => {
    //   const initializer = this.visitChildOrNull(decl.initializer);
    //   const valueAuxType = initializer?.getAuxTypeInference?.();
    //   const varType = valueAuxType?.bopType ?? this.resolveType(this.tc.getTypeAtLocation(decl));
    //   const newVar = this.block.mapTempIdentifier(decl.name.getText(), varType);
    //   this.addDebugIn(node.getStart(), newVar);
    //   return {
    //     variable: newVar,
    //     initializer: initializer,
    //     type: varType,
    //     getAuxTypeInference() { return valueAuxType; },
    //   };
    // });

    // return {
    //   produceResult: () => {
    //     let debugOutResult: BopVariable|undefined;
    //     for (const newVar of newVars) {
    //       if (newVar.initializer) {
    //         const newVarResult = this.readResult(newVar.initializer);
    //         debugOutResult ??= newVarResult;
    //         if (newVarResult.requiresDirectAccess) {
    //           newVar.variable.result = newVarResult.result;
    //           newVar.variable.requiresDirectAccess = true;
    //         } else {
    //           let [initializerVar, initializerBopVar] = this.writeCoersion(newVarResult, newVar.type, this.blockWriter);
    //           const outVar = this.blockWriter.scope.createVariableInScope(newVar.variable.type, newVar.variable.nameHint);
    //           const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //           if (initializerVar) {
    //             ret.initializer.writeExpression().writeVariableReference(initializerVar);
    //           }
    //           newVar.variable.result = outVar;
    //         }
    //       }
    //     }
    //     return {
    //       exportDebugOut: {
    //         lineNumber: this.getNodeLineNumber(node),
    //         overrideResult: debugOutResult,
    //       },
    //     };
    //   },
    // };
  }
}

export class BapReturnStatementVisitor extends BapVisitor {
  impl(node: ts.ReturnStatement): BapSubtreeGenerator|undefined {
    if (!node.expression) {
      // TODO: Control flow!!!
      return;
    }
    const valueBop = this.child(node.expression);
    return {
      generateRead: (context) => {
        const value = valueBop?.generateRead(context) ?? { type: 'error' };
        context.scope.assign(BapReturnValueSymbol, value);
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            value?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
            return undefined;
          },
        };
      },
    };
    // const valueBop = this.visitChildOrNull(node.expression);
    // return {
    //   produceResult: () => {
    //     if (valueBop) {
    //       // Coerce to return type.
    //       const returnType = this.scopeReturnType;
    //       const valueVar = this.writeCoersionFromExpr(valueBop, returnType, this.blockWriter);

    //       const ret = this.blockWriter.writeReturnStatement();
    //       ret.expr.writeVariableReference(valueVar);
    //     }
    //     return {};
    //   },
    // };
  }
}

export class BapIdentifierExpressionVisitor extends BapVisitor {
  impl(node: ts.Identifier|ts.ThisExpression): BapSubtreeGenerator|undefined {
    const identifierName = ts.isIdentifier(node) ? node.text : BapThisSymbol;
    return {
      generateRead: (context) => {
        return context.scope.resolve(identifierName) ?? { type: 'error' };
      },
    };
    // const identifierName = ts.isIdentifier(node) ? node.text : 'this';
    // const varRef = createBopReference(identifierName);
    // return {
    //   resolveIdentifiers: () => {
    //     this.resolve(varRef);
    //   },
    //   produceResult: () => {
    //     const inVar = varRef.resolvedRef?.result;
    //     const isInstance = !!inVar;
    //     const isStatic = varRef.resolvedRef?.type === CodeTypeSpec.typeType;
    //     const isValidContext = isInstance || isStatic || varRef.resolvedRef?.requiresDirectAccess;
    //     if (!varRef.resolvedRef || !isValidContext) {
    //       this.logAssert(`Identifier ${varRef.identifier} is undefined.`);
    //       return;
    //     }
    //     const outBopType = varRef.resolvedRef.bopType;
    //     let outType = isInstance ? inVar.typeSpec : CodeTypeSpec.compileErrorType;
    //     let isDirectAccess = false;
    //     if (isStatic) {
    //       isDirectAccess = true;
    //     } else if (asAssignableRef) {
    //       outType = outType.toReference();
    //       if (outType.asPrimitive === CodePrimitiveType.Function) {
    //         isDirectAccess = true;
    //       }
    //     }
    //     if (varRef.resolvedRef.requiresDirectAccess) {
    //       isDirectAccess = true;
    //     }
    //     let outBopVar;
    //     if (isDirectAccess) {
    //       outBopVar = varRef.resolvedRef;
    //     } else {
    //       const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType, identifierName);
    //       outBopVar = outTmpBopVar;
    //       const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //       if (asAssignableRef) {
    //         ret.initializer.writeExpression().writeVariableReferenceReference(inVar!);
    //       } else {
    //         ret.initializer.writeExpression().writeVariableReference(inVar!);
    //       }
    //     }
    //     return { expressionResult: outBopVar };
    //   },
    //   isAssignableRef: asAssignableRef,
    // };
  }
}

export class BapNewExpressionVisitor extends BapVisitor {
  impl(node: ts.NewExpression): BapSubtreeGenerator|undefined {
    // TODO: Resolve function expressions.
    if (!ts.isIdentifier(node.expression)) {
      this.logAssert(`Function expressions are not supported.`);
      return;
    }
    const identifier = node.expression.text;

    const candidatesOutArray: ts.Signature[] = [];
    const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments?.length);
    if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
      return;
    }
    // console.log(this.tc.signatureToString(functionSignature));

    // const type = this.resolveType(this.tc.getTypeAtLocation(node));
    // return {
    //   generateRead: (context: BapGenerateContext) => {
    //     let innerScope = context.scope;
    //     if (hasGenericTypeArgs) {
    //       innerScope = innerScope.makeChild(...);
    //     }
    //     const type: BapSubtreeValue|undefined = innerScope.resolve(identifier);
    //     if (!this.check(type?.type === 'type', `Expected a type for new.`)) {
    //       return { type: 'error' };
    //     }
    //     const func: BapSubtreeValue = type.scope.resolve('constructor');
    //     if (!this.check(func?.type === 'literal' && func.value.type === 'function', `No constructor found.`)) {
    //       return { type: 'error' };
    //     }
    //     const overload: BapSubtreeValue = func.value.function.resolveOverload(...);
    //     if (!this.verifyNotNulllike(overload, `Constructor overload not found.`)) {
    //       return { type: 'error' };
    //     }
    //     // Make cached getter in scope. ???
    //     return {
    //       type  : 'cached',
    //       aaa,
    //     }
    //   },
    // };
    // return this.makeCallBop(node, () => {
    //   // TODO: Support constructor overloads.
    //   const constructorRef = createBopReference('constructor', type.innerBlock);
    //   this.resolve(constructorRef);
    //   const functionOf = this.resolveFunctionOverload(constructorRef.resolvedRef?.bopType, functionSignature);
    //   if (!this.verifyNotNulllike(constructorRef.resolvedRef, `Constructor for ${type.debugName} is undefined.`) ||
    //       !this.verifyNotNulllike(functionOf, `Constructor for ${type.debugName} is undefined.`)) {
    //     return;
    //   }
    //   return { functionVar: constructorRef.resolvedRef, thisVar: undefined, functionOf };
    // }, node.arguments ?? []);
  }
}

export class BapCallExpressionVisitor extends BapVisitor {
  impl(node: ts.CallExpression): BapSubtreeGenerator|undefined {
    const func = this.child(node.expression);
    return {
      generateRead: (context: BapGenerateContext) => {
        let funcValue = func?.generateRead(context);
        if (funcValue?.type === 'function') {
          funcValue = funcValue.resolve([], []);
        }
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          writeIntoExpression: (prepare) => {
            return funcValue?.writeIntoExpression?.(prepare);
          },
        };
      },
    };

    // const callingFuncConcreteImpl = this.currentFunctionConcreteImpl;
    // if (!this.verifyNotNulllike(callingFuncConcreteImpl, `Function calls from the global scope are not supported.`)) {
    //   return;
    // }

    // // Hacky special cases!!! These are necessary for now since specialized
    // // generics handling, like vararg expansions are not supported.
    // let specialHandling: BopStage|undefined;
    // for (const specialHandler of this.specialHandlers) {
    //   specialHandling = specialHandler(node);
    //   if (specialHandling) {
    //     break;
    //   }
    // }
    // if (specialHandling) {
    //   return specialHandling;
    // }

    // // TODO: Resolve function expressions.
    // const oldAsAssignableRef = this.asAssignableRef;
    // this.asAssignableRef = true;
    // const functionBop = this.visitChild(node.expression);
    // this.asAssignableRef = oldAsAssignableRef;

    // const candidatesOutArray: ts.Signature[] = [];
    // const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
    // if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
    //   return;
    // }
    // // console.log(this.tc.signatureToString(functionSignature));

    // let typeParameters: BopFields = [];
    // const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
    // if (instantatedFromSignature?.typeParameters) {
    //   // Reverse map to extrapolate type parameters.
    //   const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
    //   if (typeMapper) {
    //     typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
    //   }
    // }

    // let functionVar: BopVariable|undefined;
    // return this.makeCallBop(node, () => {
    //   const functionExprResult = this.readFullResult(functionBop);
    //   const functionRef = functionExprResult?.expressionResult;
    //   const thisRef = functionExprResult?.thisResult;
    //   if (!functionRef) {
    //     return;
    //   }
    //   const genericFunction = functionRef?.genericFunctionResult;
    //   if (genericFunction) {
    //     functionVar = this.instantiateGenericFunction(genericFunction, typeParameters);
    //   }
    //   functionVar ??= functionRef;
    //   // const functionOf = functionVar.bopType.functionOf;
    //   const functionOf = this.resolveFunctionOverload(functionVar.bopType, functionSignature);
    //   if (!this.verifyNotNulllike(functionOf, `Expression is not callable.`)) {
    //     return;
    //   }
    //   if (functionOf.isMethod && !this.verifyNotNulllike(thisRef?.result, `Cannot call instance method in a static context.`)) {
    //     return;
    //   }
    //   if (functionOf.concreteImpl) {
    //     functionOf.concreteImpl.referencedFrom.add(callingFuncConcreteImpl);
    //     callingFuncConcreteImpl.references.add(functionOf.concreteImpl);
    //   }
    //   return { functionVar: functionVar, thisVar: thisRef, functionOf };
    // }, node.arguments);
  }
}
















export class BapBinaryExpressionVisitor extends BapVisitor {
  impl(node: ts.BinaryExpression): BapSubtreeGenerator|undefined {
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

    const isLogicalOp =
        opType === CodeBinaryOperator.Equals ||
        opType === CodeBinaryOperator.NotEquals ||
        opType === CodeBinaryOperator.GreaterThan ||
        opType === CodeBinaryOperator.GreaterThanEquals ||
        opType === CodeBinaryOperator.LessThan ||
        opType === CodeBinaryOperator.LessThanEquals ||
        opType === CodeBinaryOperator.LogicalOr ||
        opType === CodeBinaryOperator.LogicalAnd ||
        false;

    const opName = utils.findEnumName(CodeBinaryOperator, opType);
    const customOperatorName = `operator${opName}`;

    const lhs = this.child(node.left);
    const rhs = this.child(node.right);
    if (!lhs || !rhs) {
      return;
    }
    return {
      generateRead: (context: BapGenerateContext) => {
        const lhsValue = lhs.generateRead(context);
        const rhsValue = rhs.generateRead(context);
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          writeIntoExpression: (prepare) => {
            const lhsWriter = lhsValue.writeIntoExpression?.(prepare);
            const rhsWriter = rhsValue.writeIntoExpression?.(prepare);
            return expr => {
              const opExpr = expr.writeBinaryOperation(opType);
              lhsWriter?.(opExpr.lhs);
              rhsWriter?.(opExpr.rhs);
            };
          },
        };
      },
    };
    // const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.left), { allowWouldBeAny: true }));
    // const rhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.right), { allowWouldBeAny: true }));

    // let exprType: BopType;
    // let lhsType: BopType;
    // let rhsType: BopType;
    // let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
    // const thisStage: BopStage = {
    //   getAuxTypeInference: () => {
    //     // TODO: Support operators with different type patterns.
    //     const lhsAuxType = lhs.getAuxTypeInference?.();
    //     const rhsAuxType = rhs.getAuxTypeInference?.();

    //     const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
    //     const rhsCustomOperatorType = this.makeCustomOperatorType(rhsRawType, rhsAuxType);

    //     if (lhsCustomOperatorType && rhsCustomOperatorType) {
    //       const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
    //       const rhsCustomOperator = rhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
    //       const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
    //       const rhsOverloads = rhsCustomOperator?.bopType.functionOf?.overloads;
    //       if (lhsOverloads || rhsOverloads) {
    //         let overloads;
    //         if (lhsOverloads && rhsOverloads) {
    //           overloads = lhsOverloads.concat(rhsOverloads);
    //         } else {
    //           overloads = lhsOverloads ?? rhsOverloads!;
    //         }
    //         const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType, rhsCustomOperatorType ]);

    //         if (resolvedCustomOperator) {
    //           if (lhsOverloads?.includes(resolvedCustomOperator)) {
    //             customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
    //           } else {
    //             customOperator = { bopVar: rhsCustomOperator!, functionOf: resolvedCustomOperator };
    //           }
    //           lhsType = resolvedCustomOperator.args[0].type;
    //           rhsType = resolvedCustomOperator.args[1].type;
    //           exprType = resolvedCustomOperator.returnType;
    //           return { bopType: resolvedCustomOperator.returnType };
    //         }
    //       }
    //     }

    //     if (isLogicalOp) {
    //       exprType = this.booleanType;
    //       lhsType = lhsCustomOperatorType ?? exprType;
    //       rhsType = rhsCustomOperatorType ?? exprType;
    //       return {};
    //     }

    //     if (lhsAuxType || rhsAuxType) {
    //       const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int && rhsAuxType?.numberType === BopInferredNumberType.Int;
    //       exprType = asInt ? this.intType : this.floatType;
    //     } else {
    //       exprType = this.resolveType(this.tc.getTypeAtLocation(node));
    //     }
    //     lhsType = exprType;
    //     rhsType = exprType;
    //     return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
    //   },
    //   produceResult: () => {
    //     thisStage.getAuxTypeInference!();
    //     const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
    //     const rhsVar = this.writeCoersionFromExpr(rhs, rhsType, this.blockWriter);
    //     if (customOperator) {
    //       const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
    //       const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar, rhsVar ]);
    //       if (!callBop) {
    //         return;
    //       }
    //       this.doProduceResult(callBop);
    //       return { expressionResult: this.readResult(callBop) };
    //     } else {
    //       const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
    //       const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //       const op = ret.initializer.writeExpression().writeBinaryOperation(opType);
    //       op.lhs.writeVariableReference(lhsVar);
    //       op.rhs.writeVariableReference(rhsVar);
    //       return { expressionResult: outBopVar };
    //     }
    //   },
    // };
    // return thisStage;
  }
}




export class BapNumericLiteralVisitor extends BapVisitor {
  impl(node: ts.NumericLiteral): BapSubtreeGenerator|undefined {
    const parsedInt = utils.parseIntOr(node.text);
    const parsedFloat = utils.parseFloatOr(node.text);
    // TODO: Bad!!!
    const asInt = !node.getText(this.sourceRoot).includes('.') && parsedInt === parsedFloat;
    return {
      generateRead: () => {
        return {
          type: 'literal',
          writeIntoExpression: () => {
            return expr => {
              if (asInt) {
                expr.writeLiteralInt(parsedInt ?? Number.NaN);
              } else {
                expr.writeLiteralFloat(parsedFloat ?? Number.NaN);
              }
            };
          },
        };
      },
    };
    // return {
    //   produceResult: () => {
    //     const numberType = asInt ? this.intType : this.floatType;
    //     const [outVar, outBopVar] = allocTmpOut(numberType.storageType, numberType, node.text);
    //     const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //     if (asInt) {
    //       ret.initializer.writeExpression().writeLiteralInt(parsedInt ?? Number.NaN);
    //     } else {
    //       ret.initializer.writeExpression().writeLiteralFloat(parsedFloat ?? Number.NaN);
    //     }
    //     return { expressionResult: outBopVar };
    //   },
    //   getAuxTypeInference: () => {
    //     return { numberType: asInt ? BopInferredNumberType.Int : BopInferredNumberType.Float };
    //   },
    // };
  }
}

export class BapBooleanLiteralVisitor extends BapVisitor {
  impl(node: ts.TrueLiteral|ts.FalseLiteral): BapSubtreeGenerator|undefined {
    const isTrue = node.kind === ts.SyntaxKind.TrueKeyword;
    return {
      generateRead: () => {
        return {
          type: 'literal',
          writeIntoExpression: () => {
            return expr => {
              expr.writeLiteralBool(isTrue);
            };
          },
        };
      },
    };
    // return {
    //   produceResult: () => {
    //     const [outVar, outBopVar] = allocTmpOut(this.booleanType.storageType, this.booleanType);
    //     const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //     ret.initializer.writeExpression().writeLiteralBool(isTrue);
    //     return { expressionResult: outBopVar };
    //   },
    // };
  }
}







