import ts from "typescript/lib/typescript";
import { BapGenerateContext, BapSubtreeGenerator } from "./bap-value";
import { BapBinaryExpressionVisitor } from "./baps/binary-expression";
import { BapBlockVisitor } from "./baps/block";
import { BapBooleanLiteralVisitor } from "./baps/boolean-literal";
import { BapCallExpressionVisitor } from "./baps/call-expression";
import { BapIdentifierExpressionVisitor } from "./baps/identifier-expression";
import { BapNewExpressionVisitor } from "./baps/new-expression";
import { BapNumericLiteralVisitor } from "./baps/numeric-literal";
import { BapReturnStatementVisitor } from "./baps/return-statement";
import { BapVariableDeclarationVisitor } from "./baps/variable-declaration";
import { CodeStatementWriter, CodeWriter } from "./code-writer";
import { BapGlobalBlockVisitor } from "./baps/global-block";
import { BapVisitor, BapVisitorRootContext } from "./bap-visitor";
import { BapIfStatementVisitor } from "./baps/if-statement";
import { BapAssignmentExpressionVisitor } from "./baps/assignment-expression";
import { BapForStatementVisitor } from "./baps/for-statement";
import { BapBreakStatementVisitor } from "./baps/break-statement";
import { BapContinueStatementVisitor } from "./baps/continue-statement";
import { BapObjectLiteralExpressionVisitor } from "./baps/object-literal-expression";
import { BapPropertyAccessExpressionVisitor } from "./baps/property-access-expression";


class BapPassThroughVisitor<T extends ts.Node> extends BapVisitor {
  constructor(private readonly childNodeGetter: (node: T) => ts.Node) {
    super();
  }

  impl(node: T): BapSubtreeGenerator|undefined {
    return BapVisitor.visit(this.childNodeGetter(node));
  }
}

function makeBapPassThroughVisitor<T extends ts.Node>(childNodeGetter: (node: T) => ts.Node) {
  return () => { return new BapPassThroughVisitor(childNodeGetter); };
}

export function writeSourceNodeCode(node: ts.SourceFile, rootContext: BapVisitorRootContext, blockWriter: CodeStatementWriter, codeWriter: CodeWriter) {
  BapVisitor.mapNodeType(ts.SyntaxKind.Block, BapBlockVisitor);
  BapVisitor.mapNodeTypeFunc(ts.SyntaxKind.ExpressionStatement, makeBapPassThroughVisitor((node: ts.ExpressionStatement) => node.expression));
  BapVisitor.mapNodeTypeFunc(ts.SyntaxKind.ParenthesizedExpression, makeBapPassThroughVisitor((node: ts.ParenthesizedExpression) => node.expression));
  BapVisitor.mapNodeType(ts.SyntaxKind.VariableStatement, BapVariableDeclarationVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.VariableDeclarationList, BapVariableDeclarationVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BinaryExpression, BapAssignmentExpressionVisitor, (node) => node.operatorToken.kind === ts.SyntaxKind.EqualsToken);
  BapVisitor.mapNodeType(ts.SyntaxKind.ReturnStatement, BapReturnStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.IfStatement, BapIfStatementVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.ForOfStatement, BapForOfStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ForStatement, BapForStatementVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.WhileStatement, BapWhileStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.PropertyAccessExpression, BapPropertyAccessExpressionVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.ElementAccessExpression, BapElementAccessExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.Identifier, BapIdentifierExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ThisKeyword, BapIdentifierExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.CallExpression, BapCallExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ObjectLiteralExpression, BapObjectLiteralExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.NewExpression, BapNewExpressionVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.PrefixUnaryExpression, BapPrefixUnaryExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BinaryExpression, BapBinaryExpressionVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.ParenthesizedExpression, BapParenthesizedExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.NumericLiteral, BapNumericLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.TrueKeyword, BapBooleanLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.FalseKeyword, BapBooleanLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ReturnStatement, BapReturnStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BreakStatement, BapBreakStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ContinueStatement, BapContinueStatementVisitor);

  const context = BapGenerateContext.root(codeWriter);
  const resultWriter = new BapGlobalBlockVisitor(rootContext).visitSourceFile(node)?.generateRead(context)?.writeIntoExpression?.(blockWriter);
  const logCallExpr = blockWriter.writeExpressionStatement().expr.writeMethodCall(codeWriter.makeInternalToken('log'));
  logCallExpr.source.writeIdentifier(codeWriter.makeInternalToken('console'));
  resultWriter?.(logCallExpr.addArg());
}

// export function visitNode(node: ts.Node): BapSubtreeGenerator|undefined {
//   const delegateToChild = (child: ts.Node) => visitNode(child);

//   if (ts.isBlock(node)) {
//     return new BapBlockVisitor().impl(node);
//   } else if (ts.isExpressionStatement(node)) {
//     return delegateToChild(node.expression);
//     // const exprResult = this.delegateToChild(node.expression);
//     // const innerProduceResult = exprResult.produceResult;
//     // if (innerProduceResult) {
//     //   exprResult.produceResult = () => {
//     //     const innerResult = innerProduceResult();
//     //     if (innerResult) {
//     //       innerResult.exportDebugOut ??= {
//     //         lineNumber: this.getNodeLineNumber(node),
//     //       };
//     //     }
//     //     return innerResult;
//     //   };
//     // }
//     // this.addDebugOut(node.getStart(), exprResult);
//     // return exprResult;
//   } else if (ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) {
//     return new BapVariableDeclarationVisitor().impl(node);
//   } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
//     // const oldAsAssignableRef = this.asAssignableRef;
//     // this.asAssignableRef = true;
//     // const refExpr = this.visitChild(node.left);
//     // this.asAssignableRef = oldAsAssignableRef;

//     // if (!this.check(refExpr.isAssignableRef === true, `LHS expression is not assignable.`)) {
//     //   return;
//     // }

//     // const valueExpr = this.visitChild(node.right);
//     // const valueAuxType = valueExpr.getAuxTypeInference?.();
//     // const assignType = valueAuxType?.bopType ?? this.resolveType(this.tc.getTypeAtLocation(node.left));

//     // return {
//     //   produceResult: () => {
//     //     const [value, valueRef] = this.writeCoersionFromExprPair(valueExpr, assignType, this.blockWriter);

//     //     const refResult = this.readFullResult(refExpr);
//     //     const propAccessor = refResult?.expressionResult?.propertyResult;
//     //     if (propAccessor) {
//     //       // This is calling a setter property.
//     //       const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.setter, thisVar: refResult.thisResult, functionOf: propAccessor.setter.bopType.functionOf!.overloads[0] }), [value]);
//     //       if (!callBop) {
//     //         return;
//     //       }
//     //       this.doProduceResult(callBop);
//     //       return { expressionResult: valueRef };
//     //     }

//     //     const oldAsAssignableRef = this.asAssignableRef;
//     //     this.asAssignableRef = true;
//     //     const [ref, refVar] = this.writeCoersionFromExprPair(refExpr, assignType, this.blockWriter);
//     //     this.asAssignableRef = oldAsAssignableRef;

//     //     const ret = this.blockWriter.writeAssignmentStatement();
//     //     if (refVar.requiresDirectAccess) {
//     //       // HACK!!! ???
//     //       ret.ref.writeDereferenceExpr().value.writeVariableReferenceReference(ref);
//     //     } else {
//     //       ret.ref.writeVariableDereference(ref);
//     //     }
//     //     ret.value.writeVariableReference(value);
//     //     return { expressionResult: valueRef };
//     //   },
//     // };
//   } else if (ts.isReturnStatement(node)) {
//     return new BapReturnStatementVisitor().impl(node);
//   } else if (ts.isIfStatement(node)) {
//     // const condBop = this.visitChild(node.expression);
//     // const branches: BopBlock[] = [ this.visitInBlock(node.thenStatement, CodeScopeType.Local) ];
//     // if (node.elseStatement) {
//     //   branches.push(this.visitInBlock(node.elseStatement, CodeScopeType.Local));
//     // }
//     // return {
//     //   produceResult: () => {
//     //     const condVar = this.writeCoersionFromExpr(condBop, this.booleanType, this.blockWriter);
//     //     const ret = this.blockWriter.writeConditional(branches.length);
//     //     ret.branches[0].condWriter.writeVariableReference(condVar);
//     //     this.writeBlock(branches[0], ret.branches[0].blockWriter);
//     //     return {};
//     //   },
//     // };
//   } else if (ts.isForOfStatement(node)) {
//     // if (!node.initializer ||
//     //     !ts.isVariableDeclarationList(node.initializer) ||
//     //     node.initializer.declarations.length !== 1) {
//     //   this.logAssert(`Malformed for statement.`);
//     //   return;
//     // }
//     // const variableDeclNode = node.initializer.declarations[0];
//     // const variableName = variableDeclNode.name.getText();
//     // const enumerableType = this.resolveType(this.tc.getTypeAtLocation(node.expression));
//     // const elementType = this.resolveType(this.tc.getTypeAtLocation(variableDeclNode));
//     // const elementRawType = enumerableType.internalTypeOf?.arrayOfType;
//     // if (!this.verifyNotNulllike(elementRawType, `Unsupported enumeration over ${enumerableType.debugName}.`)) {
//     //   return;
//     // }

//     // const enumerableBop = this.visitChild(node.expression);
//     // const oldBlock = this.block;
//     // const innerBlock = oldBlock.createChildBlock(CodeScopeType.Local);
//     // const elementBopVar = innerBlock.mapTempIdentifier(variableName, elementType);

//     // this.block = innerBlock;
//     // const body = this.visitInBlock(node.statement, CodeScopeType.Local);
//     // this.block = oldBlock;

//     // return {
//     //   produceResult: () => {
//     //     const indexVar = this.blockWriter.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'index');
//     //     const lengthVar = this.blockWriter.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'length');
//     //     this.blockWriter.writeVariableDeclaration(indexVar).initializer.writeExpression().writeLiteralInt(0);
//     //     this.blockWriter.writeVariableDeclaration(lengthVar)
//     //         .initializer.writeExpression().writePropertyAccess(this.writer.makeInternalToken('length'))
//     //         .source.writeVariableReference(this.readResult(enumerableBop).result!);

//     //     const whileLoop = this.blockWriter.writeWhileLoop();
//     //     const whileCond = whileLoop.condition;
//     //     const whileBody = whileLoop.body;

//     //     const breakCond = whileBody.writeConditional(1).branches[0];
//     //     const breakCondExpr = breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeBinaryOperation(CodeBinaryOperator.LessThan);
//     //     breakCondExpr.lhs.writeVariableReference(indexVar);
//     //     breakCondExpr.rhs.writeVariableReference(lengthVar);
//     //     breakCond.blockWriter.writeBreakStatement();

//     //     const elementVar = whileBody.scope.allocateVariableIdentifier(elementBopVar.type, BopIdentifierPrefix.Local, elementBopVar.nameHint);
//     //     elementBopVar.result = elementVar;
//     //     const elementAccess = whileBody.writeVariableDeclaration(elementVar).initializer.writeExpression().writeIndexAccess();
//     //     elementAccess.index.writeVariableReference(indexVar);
//     //     elementAccess.source.writeVariableReference(this.readResult(enumerableBop).result!);
//     //     whileCond.writeLiteralBool(true);

//     //     const incrementStmt = whileBody.writeAssignmentStatement();
//     //     incrementStmt.ref.writeVariableReference(indexVar);
//     //     const incrementExpr = incrementStmt.value.writeBinaryOperation(CodeBinaryOperator.Add);
//     //     incrementExpr.lhs.writeVariableReference(indexVar);
//     //     incrementExpr.rhs.writeLiteralInt(1);

//     //     this.writeBlock(body, whileBody);
//     //     return {};
//     //   },
//     // };
//   } else if (ts.isForStatement(node)) {
//     // if (!(node.initializer && node.condition && node.incrementor)) {
//     //   this.logAssert(`Malformed for statement.`);
//     //   return;
//     // }
//     // const initializerBop = this.visitInBlock(node.initializer, CodeScopeType.Local);
//     // const oldBlock = this.block;
//     // this.block = initializerBop;
//     // const conditionBop = this.visitInBlockFull(node.condition, CodeScopeType.Local);
//     // const updateBop = this.visitInBlock(node.incrementor, CodeScopeType.Local);
//     // const body = this.visitInBlock(node.statement, CodeScopeType.Local);
//     // this.block = oldBlock;

//     // return {
//     //   produceResult: () => {
//     //     this.writeBlock(initializerBop, this.blockWriter);
//     //     const whileLoop = this.blockWriter.writeWhileLoop();
//     //     const whileCond = whileLoop.condition;
//     //     const whileBody = whileLoop.body;
//     //     whileCond.writeLiteralBool(true);
//     //     this.writeBlock(conditionBop.block, whileBody);
//     //     const condVar = this.writeCoersionFromExpr(conditionBop.bop, this.booleanType, whileBody);
//     //     const breakCond = whileBody.writeConditional(1).branches[0];
//     //     breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeVariableReference(condVar);
//     //     breakCond.blockWriter.writeBreakStatement();

//     //     this.writeBlock(body, whileBody);
//     //     this.writeBlock(updateBop, whileBody);
//     //     return {};
//     //   },
//     // };
//   } else if (ts.isWhileStatement(node)) {
//     // const oldBlock = this.block;
//     // const innerBlock = oldBlock.createChildBlock(CodeScopeType.Local);
//     // this.block = innerBlock;
//     // const conditionBop = this.visitInBlockFull(node.expression, CodeScopeType.Local);
//     // const body = this.visitInBlock(node.statement, CodeScopeType.Local);
//     // this.block = oldBlock;

//     // return {
//     //   produceResult: () => {
//     //     const whileLoop = this.blockWriter.writeWhileLoop();
//     //     const whileCond = whileLoop.condition;
//     //     const whileBody = whileLoop.body;
//     //     whileCond.writeLiteralBool(true);
//     //     this.writeBlock(conditionBop.block, whileBody);
//     //     const condVar = this.writeCoersionFromExpr(conditionBop.bop, this.booleanType, whileBody);
//     //     const breakCond = whileBody.writeConditional(1).branches[0];
//     //     breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeVariableReference(condVar);
//     //     breakCond.blockWriter.writeBreakStatement();

//     //     this.writeBlock(body, whileBody);
//     //     return {};
//     //   },
//     // };
//   } else if (ts.isPropertyAccessExpression(node)) {
//     // const fromBop = this.visitChild(node.expression);
//     // return {
//     //   resolveIdentifiers: () => {
//     //   },
//     //   produceResult: () => {
//     //     const fromBopVar = this.readResult(fromBop);
//     //     const fromVar = fromBopVar.result!;
//     //     const propertyRef = createBopReference(node.name.text, fromBopVar.lookupBlockOverride ?? fromBopVar.bopType.innerBlock);
//     //     this.resolve(propertyRef);

//     //     if (!this.verifyNotNulllike(propertyRef.resolvedRef, `Property ${propertyRef.identifier} is undefined.`)) {
//     //       return;
//     //     }
//     //     const outBopType = propertyRef.resolvedRef.bopType;
//     //     const isProperty = !!propertyRef.resolvedRef.propertyResult;
//     //     let outType = propertyRef.resolvedRef.type;
//     //     let isDirectAccess = false;
//     //     if (asAssignableRef) {
//     //       outType = outType.toReference();
//     //       if (isProperty || outType.asPrimitive === CodePrimitiveType.Function) {
//     //         isDirectAccess = true;
//     //       }
//     //     }
//     //     if (propertyRef.resolvedRef.requiresDirectAccess) {
//     //       isDirectAccess = true;
//     //     }

//     //     let outBopVar;
//     //     if (isDirectAccess) {
//     //       outBopVar = propertyRef.resolvedRef;
//     //     } else {
//     //       const propAccessor = propertyRef.resolvedRef.propertyResult;
//     //       const propVar = propertyRef.resolvedRef.result;
//     //       if (propAccessor) {
//     //         // This is calling a getter property.
//     //         const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.getter, thisVar: fromBopVar, functionOf: propAccessor.getter.bopType.functionOf!.overloads[0] }), []);
//     //         if (!callBop) {
//     //           return;
//     //         }
//     //         this.doProduceResult(callBop);
//     //         const result = this.readResult(callBop);
//     //         result.requiresDirectAccess = fromBopVar.requiresDirectAccess;
//     //         return {
//     //           expressionResult: result,
//     //           thisResult: fromBopVar,
//     //         };
//     //       } else if (propVar) {
//     //         const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType, node.name.text);
//     //         outBopVar = outTmpBopVar;
//     //         const ret = this.blockWriter.writeVariableDeclaration(outVar);
//     //         let accessExpr = ret.initializer.writeExpression();
//     //         if (fromBopVar.requiresDirectAccess) {
//     //           accessExpr = accessExpr.writeDereferenceExpr().value;
//     //         }
//     //         let sourceExpr;
//     //         if (fromBopVar.requiresDirectAccess) {
//     //           sourceExpr = accessExpr.writePropertyReferenceAccess(propVar.identifierToken).source;
//     //         } else {
//     //           sourceExpr = accessExpr.writePropertyAccess(propVar.identifierToken).source;
//     //         }
//     //         sourceExpr.writeVariableReference(fromVar);
//     //       } else {
//     //         this.logAssert(`Property ${propertyRef.identifier} is undefined.`);
//     //         return;
//     //       }
//     //       outBopVar.requiresDirectAccess = fromBopVar.requiresDirectAccess;
//     //     }
//     //     return {
//     //       expressionResult: outBopVar,
//     //       thisResult: fromBopVar,
//     //     };
//     //   },
//     //   isAssignableRef: asAssignableRef && fromBop.isAssignableRef,
//     // };
//   } else if (ts.isElementAccessExpression(node)) {
//     // const indexBop = this.visitChild(node.argumentExpression);
//     // const fromBop = this.visitChild(node.expression);
//     // const resultType = this.resolveType(this.tc.getTypeAtLocation(node));
//     // return {
//     //   resolveIdentifiers: () => {
//     //   },
//     //   produceResult: () => {
//     //     const indexBopVar = this.readResult(indexBop);
//     //     const fromBopVar = this.readResult(fromBop);

//     //     let outType = resultType.tempType;
//     //     let isDirectAccess = false;
//     //     if (asAssignableRef) {
//     //       outType = outType.toReference();
//     //       isDirectAccess = true;
//     //     }

//     //     const [accessVar, accessBopVar] = allocTmpOut(outType, resultType);
//     //     const indexAccess = this.blockWriter.writeVariableDeclaration(accessVar).initializer.writeExpression().writeIndexAccess();
//     //     indexAccess.source.writeVariableReference(fromBopVar.result!);
//     //     indexAccess.index.writeVariableReference(indexBopVar.result!);
//     //     accessBopVar.requiresDirectAccess = isDirectAccess;
//     //     return {
//     //       expressionResult: accessBopVar,
//     //     };
//     //   },
//     //   isAssignableRef: asAssignableRef,
//     // };
//   } else if (ts.isIdentifier(node) || tsIsThisExpression(node)) {
//     return new BapIdentifierExpressionVisitor().impl(node);
//   } else if (ts.isCallExpression(node)) {
//     return new BapCallExpressionVisitor().impl(node);
//   } else if (ts.isObjectLiteralExpression(node)) {
//     // const willCoerceFieldsTo = new Map<string, CoersionRef>();
//     // const initializers: Array<{ field: string, valueBop: BopStage, propertyRef: () => BopReference }> = [];
//     // for (const p of node.properties) {
//     //   if (ts.isPropertyAssignment(p)) {
//     //     const field = p.name.getText();
//     //     const valueBop = this.visitChild(p.initializer);
//     //     initializers.push({ field, valueBop, propertyRef: utils.lazy(() => createBopReference(field, asType.innerBlock)) });
//     //     willCoerceFieldsTo.set(field, { assignedFromBop: valueBop });
//     //   } else {
//     //     this.logAssert(`Unknown object literal syntax.`);
//     //     continue;
//     //   }
//     // }

//     // const asType = this.resolveType(this.tc.getTypeAtLocation(node), { willCoerceFieldsTo });
//     // // const storage = createStorage(asType);

//     // return {
//     //   resolveIdentifiers: () => {
//     //     initializers.forEach(e => this.resolve(e.propertyRef()));
//     //   },
//     //   // resolveStorage: () => {
//     //   //   this.resolveStorage(storage);
//     //   // },
//     //   produceResult: () => {
//     //     const initializerVars: Array<{ identifierToken: CodeNamedToken, valueVar: CodeVariable }> = [];
//     //     for (const initializer of initializers) {
//     //       const prop = initializer.propertyRef().resolvedRef;
//     //       const propRef = prop?.result;
//     //       if (!this.verifyNotNulllike(prop, `Property ${initializer.field} is undefined.`) ||
//     //           !this.verifyNotNulllike(propRef, `Property ${initializer.field} is undefined.`)) {
//     //         return;
//     //       }
//     //       initializerVars.push({ identifierToken: propRef.identifierToken, valueVar: this.writeCoersionFromExpr(initializer.valueBop, prop.bopType, this.blockWriter) });
//     //     }

//     //     const [outVar, outBopVar] = allocTmpOut(asType.tempType, asType, asType.debugName);
//     //     const ret = this.blockWriter.writeVariableDeclaration(outVar);
//     //     for (const initializer of initializerVars) {
//     //       ret.initializer.writeAssignStructField(initializer.identifierToken).value.writeVariableReference(initializer.valueVar);
//     //     }
//     //     return { expressionResult: outBopVar };
//     //   },
//     // };
//   } else if (ts.isNewExpression(node)) {
//     return new BapNewExpressionVisitor().impl(node);
//   } else if (ts.isPrefixUnaryExpression(node)) {
//     // const opType =
//     //     // node.operator === ts.SyntaxKind.PlusPlusToken ? CodeUnaryOperator.PlusPlus :
//     //     // node.operator === ts.SyntaxKind.MinusMinusToken ? CodeUnaryOperator.MinusMinus :
//     //     node.operator === ts.SyntaxKind.PlusToken ? CodeUnaryOperator.Plus :
//     //     node.operator === ts.SyntaxKind.MinusToken ? CodeUnaryOperator.Negate :
//     //     node.operator === ts.SyntaxKind.TildeToken ? CodeUnaryOperator.BitwiseNegate :
//     //     node.operator === ts.SyntaxKind.ExclamationToken ? CodeUnaryOperator.LogicalNot :
//     //     undefined;
//     // if (!this.verifyNotNulllike(opType, `Unknown operator ${node.operator}.`)) {
//     //   return;
//     // }

//     // const isLogicalOp =
//     //     opType === CodeUnaryOperator.Negate ||
//     //     false;

//     // const opName = utils.findEnumName(CodeUnaryOperator, opType);
//     // const customOperatorName = `operator${opName}`;

//     // const lhs = this.visitChild(node.operand);
//     // const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.operand), { allowWouldBeAny: true }));

//     // let exprType: BopType;
//     // let lhsType: BopType;
//     // let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
//     // const thisStage: BopStage = {
//     //   getAuxTypeInference: () => {
//     //     // TODO: Support operators with different type patterns.
//     //     const lhsAuxType = lhs.getAuxTypeInference?.();
//     //     const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
//     //     if (lhsCustomOperatorType) {
//     //       const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
//     //       const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
//     //       if (lhsOverloads) {
//     //         let overloads = lhsOverloads;
//     //         const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType ]);

//     //         if (resolvedCustomOperator) {
//     //           customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
//     //           lhsType = resolvedCustomOperator.args[0].type;
//     //           exprType = resolvedCustomOperator.returnType;
//     //           return { bopType: resolvedCustomOperator.returnType };
//     //         }
//     //       }
//     //     }

//     //     if (isLogicalOp) {
//     //       exprType = this.booleanType;
//     //       lhsType = lhsCustomOperatorType ?? exprType;
//     //       return {};
//     //     }

//     //     if (lhsAuxType) {
//     //       const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int;
//     //       exprType = asInt ? this.intType : this.floatType;
//     //     } else {
//     //       exprType = this.resolveType(this.tc.getTypeAtLocation(node));
//     //     }
//     //     lhsType = exprType;
//     //     return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
//     //   },
//     //   produceResult: () => {
//     //     thisStage.getAuxTypeInference!();
//     //     const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
//     //     if (customOperator) {
//     //       const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
//     //       const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar ]);
//     //       if (!callBop) {
//     //         return;
//     //       }
//     //       this.doProduceResult(callBop);
//     //       return { expressionResult: this.readResult(callBop) };
//     //     } else {
//     //       const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
//     //       const ret = this.blockWriter.writeVariableDeclaration(outVar);
//     //       const op = ret.initializer.writeExpression().writeUnaryOperation(opType);
//     //       op.value.writeVariableReference(lhsVar);
//     //       return { expressionResult: outBopVar };
//     //     }
//     //   },
//     // };
//     // return thisStage;
//   } else if (ts.isBinaryExpression(node)) {
//     return new BapBinaryExpressionVisitor().impl(node);
//   } else if (ts.isParenthesizedExpression(node)) {
//     // return this.delegateToChild(node.expression);
//     return delegateToChild(node);
//   } else if (ts.isNumericLiteral(node)) {
//     return new BapNumericLiteralVisitor().impl(node);
//   } else if (
//       tsIsTrueLiteral(node) ||
//       tsIsFalseLiteral(node)) {
//     return new BapBooleanLiteralVisitor().impl(node);
//   }
// }

// function tsIsTrueLiteral(node: ts.Node): node is ts.TrueLiteral {
//   return node.kind === ts.SyntaxKind.TrueKeyword;
// }

// function tsIsFalseLiteral(node: ts.Node): node is ts.FalseLiteral {
//   return node.kind === ts.SyntaxKind.FalseKeyword;
// }

// function tsIsThisExpression(node: ts.Node): node is ts.ThisExpression {
//   return node.kind === ts.SyntaxKind.ThisKeyword;
// }

