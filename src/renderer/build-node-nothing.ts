import { html, css, LitElement, PropertyValueMap } from 'lit';
import {} from 'lit/html';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { action, autorun, runInAction, observable, observe, makeObservable } from 'mobx';
import { RecyclerView } from './recycler-view';
import { CandidateCompletion, CommandParser, CommandResolvedArg, CommandSpec } from './command-parser';
import * as utils from '../utils';
import * as constants from './constants';
import * as fileUtils from './file-utils';
import * as environment from './environment';
import './simple-icon-element';
import { getCommands } from './app-commands';
import { getBrowserWindow } from './renderer-ipc';
import { PathsDirectoryHandle, createUrl, handlesFromDataTransfer, revokeUrl, showDirectoryPicker } from './paths';
import { PointerDragOp } from './pointer-drag-op';
import { adoptCommonStyleSheets } from './stylesheets';
import * as ts from "typescript";










interface Literal {
  boolValue?: boolean;
  intValue?: number;
  floatValue?: number;
  stringValue?: string;
}

enum PrimitiveType {
  Int = 'int',
  Float = 'float',
  Bool = 'bool',
  String = 'string',
  Array = 'array',
  Unknown = 'unknown',
  Any = 'any',
  Void = 'void',
}

interface TypeParameter {
  identifier: string;
  typeConstraints: TypeContraint[];
}

enum TypeConstraintType {
  Exactly = 'exactly',
  Convertible = 'convertible',
  SameAsInputs = 'same-as-inputs',
  ConvertibleToInputs = 'convertible-to-inputs',
  StatementLike = 'statement-like',
}

interface TypeConstraintInput {
  inputIndex?: number;
  aliasRef?: AliasRef;
  subpropertyName?: string;
}

interface TypeContraint {
  type: TypeConstraintType;
  inputs: TypeConstraintInput[];
}

interface Type {
  primitiveType?: PrimitiveType;
  genericTypeParameters?: TypeParameter[];
  literal?: Literal;
}

interface TypeSpec {
  types: Type[];
}

interface ExpressionInput {
  expr: Expression;
  typeConstraints: TypeContraint[];
}

interface ExpressionOutput {
  typeSpec: TypeSpec;
}

interface AliasSnapshot {
  index: number;
  inputExpressions: Expression[];
  typeConstraints: TypeContraint[];
}

interface AliasRef {
  identifier: string;
  snapshotIndex: number;
}

interface AliasDef {
  identifier: string;
  snapshots: AliasSnapshot[];
}

interface Expression {
  inputs: ExpressionInput[];
  outputs: ExpressionOutput[];
  outputTypeConstraints: TypeContraint[];
  aliases: AliasDef[];

  get isReferenceLike(): boolean;

  resolvedType?: TypeSpec;
  resolvedAsStatementLike?: boolean;
}



enum InternalIdentifiers {
  This = 'this',
  Return = 'return',
}

abstract class ExpressionBase extends Object implements Expression {
  abstract inputs: ExpressionInput[];
  abstract outputs: ExpressionOutput[];
  abstract outputTypeConstraints: TypeContraint[];
  abstract aliases: AliasDef[];
  resolvedType?: TypeSpec;
  resolvedAsStatementLike?: boolean;

  isReferenceLike = false;

  constructor(public readonly sourceNode: ts.Node, public readonly sourceFile: ts.SourceFile) { super(); }

  override toString() {
    const sourceMapRange = ts.getSourceMapRange(this.sourceNode);
    const sourceFile = sourceMapRange.source ?? this.sourceFile;
    return sourceFile?.text.substring(sourceMapRange.pos, sourceMapRange.end).trim();
  }
}

class LiteralExpression extends ExpressionBase {
  inputs = [];
  outputs;
  outputTypeConstraints = [];
  aliases = [];
  readonly primitiveType: PrimitiveType;

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      public readonly literal: Literal) {
    super(sourceNode, sourceFile);
    if (literal.boolValue !== undefined) {
      this.primitiveType = PrimitiveType.Bool;
    } else if (literal.intValue !== undefined) {
      this.primitiveType = PrimitiveType.Int;
    } else if (literal.floatValue !== undefined) {
      this.primitiveType = PrimitiveType.Float;
    } else if (literal.stringValue !== undefined) {
      this.primitiveType = PrimitiveType.String;
    } else {
      this.primitiveType = PrimitiveType.Unknown;
    }
    this.outputs = [ { typeSpec: typeSpecFromPrimitive(this.primitiveType) } ];
  }
}

class UndefinedExpression extends ExpressionBase {
  inputs = [];
  outputs = [];
  outputTypeConstraints = [];
  aliases = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile) {
    super(sourceNode, sourceFile);
  }
}

enum BinaryOpType {
  Add = 'add',
  Subtract = 'subtract',
  Multiply = 'multiply',
  Divide = 'divide',
}

class BinaryOpExpression extends ExpressionBase {
  inputs: ExpressionInput[] = [
    { expr: this.lhs, typeConstraints: [] },
    { expr: this.rhs, typeConstraints: [] },
  ];
  outputs: ExpressionOutput[] = [];
  outputTypeConstraints: TypeContraint[] = [ {
    type: TypeConstraintType.SameAsInputs,
    inputs: [
      { inputIndex: 0 },
      { inputIndex: 1 },
    ]
  } ];
  aliases: AliasDef[] = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      readonly op: BinaryOpType, readonly lhs: Expression, readonly rhs: Expression) {
    super(sourceNode, sourceFile);
  }
}

class AssignmentExpression extends ExpressionBase {
  inputs: ExpressionInput[] = [
    { expr: this.lhs, typeConstraints: [] },
    { expr: this.rhs, typeConstraints: [] },
  ];
  outputs: ExpressionOutput[] = [];
  outputTypeConstraints: TypeContraint[] = [ {
    type: TypeConstraintType.SameAsInputs,
    inputs: [
      { inputIndex: 0 },
      { inputIndex: 1 },
    ]
  } ];
  aliases: AliasDef[] = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      readonly lhs: Expression, readonly rhs: Expression) {
    super(sourceNode, sourceFile);
  }
}

class PropertyAccessExpression extends ExpressionBase {
  inputs: ExpressionInput[] = [
    { expr: this.lhs, typeConstraints: [] },
  ];
  outputs: ExpressionOutput[] = [];
  outputTypeConstraints: TypeContraint[] = [ {
    type: TypeConstraintType.SameAsInputs,
    inputs: [
      { inputIndex: 0, subpropertyName: this.rhs },
    ]
  } ];
  aliases: AliasDef[] = [];
  isReferenceLike = true;

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      readonly lhs: Expression, readonly rhs: string) {
    super(sourceNode, sourceFile);
  }
}

class AliasRefExpression extends ExpressionBase {
  inputs: ExpressionInput[] = [];
  outputs: ExpressionOutput[] = [ { typeSpec: typeSpecUnknown() } ];
  outputTypeConstraints: TypeContraint[] = [ {
    type: TypeConstraintType.SameAsInputs,
    inputs: [ { aliasRef: { identifier: this.identifier, snapshotIndex: this.snapshotIndex } } ]
  } ];
  aliases: AliasDef[] = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      readonly identifier: string, readonly snapshotIndex: number) {
    super(sourceNode, sourceFile);
  }
}

class BlockExpression {
  constructor(readonly statements: Expression[]) {}
}

class ReturnStatementExpression extends ExpressionBase {
  inputs: ExpressionInput[] = [ {
    expr: this.child,
    typeConstraints: [ {
      type: TypeConstraintType.ConvertibleToInputs,
      inputs: [ { aliasRef: { identifier: InternalIdentifiers.Return, snapshotIndex: 0 } } ]
    } ]
  } ];
  outputs: ExpressionOutput[] = [ { typeSpec: typeSpecVoid() } ];
  outputTypeConstraints: TypeContraint[] = [];
  aliases: AliasDef[] = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      readonly child: Expression) {
    super(sourceNode, sourceFile);
  }
}

class StatementsExpression extends ExpressionBase {
  inputs: ExpressionInput[] = this.statements.map(e => utils.upcast({
    expr: e,
    typeConstraints: [],
  }));
  outputs: ExpressionOutput[] = [];
  outputTypeConstraints: TypeContraint[] = [ {
    type: TypeConstraintType.StatementLike,
    inputs: this.statements.map((e, i) => utils.upcast({
      inputIndex: i,
    })),
  } ];
  aliases: AliasDef[] = [];

  constructor(
      sourceNode: ts.Node, sourceFile: ts.SourceFile,
      public statements: Expression[]) {
    super(sourceNode, sourceFile);
  }
}

interface LocalDecl {
  identifier: string;
  typeSpec: TypeSpec;
}

class FunctionExpression {
  constructor(
    readonly identifier: string,
    readonly parameters: LocalDecl[],
    readonly returnType: TypeSpec,
    readonly genericTypeParameters: TypeParameter[],
    readonly statements: Expression[]) {}
}


function typeSpecFromPrimitive(type: PrimitiveType): TypeSpec {
  return { types: [ {
    primitiveType: type,
  } ] };
}

function typeSpecUnknown(): TypeSpec {
  return typeSpecFromPrimitive(PrimitiveType.Unknown);
}

function typeSpecVoid(): TypeSpec {
  return typeSpecFromPrimitive(PrimitiveType.Void);
}


function typeSpecToString(t: TypeSpec) {
  return t.types.map(typeToString).join('|');
}

function typeToString(t: Type) {
  if (t.literal) {
    if (t.literal.boolValue !== undefined) {
      return t.literal.boolValue.toString();
    }
    if (t.literal.intValue !== undefined) {
      return t.literal.intValue.toString();
    }
    if (t.literal.floatValue !== undefined) {
      return t.literal.floatValue.toString();
    }
    if (t.literal.stringValue !== undefined) {
      return t.literal.stringValue.toString();
    }
    return 'unknown';
  }
  if (t.primitiveType != undefined) {
    return t.primitiveType.toString();
  }
  return 'unknown';
}

function constraintToString(c: BuildNodeConstraint) {
  return typeSpecToString(c.type);
}




interface CompiledAliasSnapshot {
  index: number;
  type: Type;
}

interface CompiledAliasDef {
  snapshots: CompiledAliasSnapshot[];
}

interface ResolvedAlias {
}

interface CompiledExpression {
  expr: Expression;
  inputTypes: Type[];
  outputTypes: Type[];
  aliases: CompiledAliasDef[];
  resolvedAliases: ResolvedAlias[];
}

enum BuildEdgeConstraint {
  Same = 'same',
  Convertible = 'convertible',
  StatementLike = 'statement-like',
}

enum BuildConstraintLocationType {
  Root,
  GenericParameter,
}

interface BuildConstraintLocation {
  type: BuildConstraintLocationType;
  index: number;
  subproperty?: string;
}

interface BuildEdge {
  in: BuildNode;
  out: BuildNode;
  constraint: BuildEdgeConstraint;
  location: BuildConstraintLocation;
  allowBackwardsInference: boolean;
}

interface BuildNodeConstraint {
  mode: BuildEdgeConstraint;
  type: TypeSpec;
}

interface DisplayLocation {
  text?: string;
}

class BuildNode extends Object {
  displayLocation?: DisplayLocation;
  expr: Expression|undefined;
  ins: BuildEdge[] = [];
  outs: BuildEdge[] = [];
  isDefinite: boolean = false;
  constraints: BuildNodeConstraint[] = [];

  override toString() {
    const descStr = this.displayLocation?.text ?? super.toString();
    const constraintsStr = this.constraints.map(constraintToString).join(')&(') ?? 'unknown';
    return `${descStr} (${constraintsStr})`;
  }
}

// class BuildAlias {
//   identifier: string;
//   snapshots: BuildNode[];
// }

// class BuildReturnScope {
//   a;
// }

// class BuildScope {
//   aliases: BuildAlias[];
//   returnScope;
// }





// function compile() {


//   const nodeList: BuildNode[] = [];
//   const createNode = (displayName: string) => {
//     const newNode =  new BuildNode();
//     newNode.displayLocation = { text: displayName };
//     nodeList.push(newNode);
//     return newNode;
//   };
//   const addEdge = (inNode: BuildNode, outNode: BuildNode, constrait: BuildEdgeConstraint, subproperty?: string) => {
//     const edge: BuildEdge = {
//       in: inNode,
//       out: outNode,
//       constraint: constrait,
//       location: { type: BuildConstraintLocationType.Root, index: 0, subproperty: subproperty },
//       allowBackwardsInference: false,
//     };
//     inNode.outs.push(edge);
//     outNode.ins.push(edge);
//   };

//   const isConstraintStrictSubset = (lhs: BuildNodeConstraint, rhs: BuildNodeConstraint) => {
//     if (lhs.mode === BuildEdgeConstraint.StatementLike || rhs.mode === BuildEdgeConstraint.Convertible) {
//       return lhs.mode === rhs.mode;
//     }
//     // TODO: Implement!!!
//     return lhs.type.types[0].primitiveType === rhs.type.types[0].primitiveType;
//   };
//   const addCoalescedConstraint = (node: BuildNode, newConstraint: BuildNodeConstraint) => {
//     for (const oldConstraint of node.constraints) {
//       if (oldConstraint.mode === BuildEdgeConstraint.StatementLike) {
//         return false;
//       }
//       if (isConstraintStrictSubset(newConstraint, oldConstraint)) {
//         // New constraint is already fully specified by old constraint.
//         return false;
//       }
//     }

//     // The new constraint can be added. Clean up old constraints first.
//     utils.deleteWhere(node.constraints, (oldConstraint) => {
//       if (isConstraintStrictSubset(oldConstraint, newConstraint)) {
//         // This old constraint will be fully subsumed by adding the new constraint, so delete it.
//         return true;
//       }
//       return false;
//     });
//     node.constraints.push(newConstraint);
//     return true;
//   };

//   const enumerateChildrenRec = function* (root: BuildNode) {
//     const toVisit = new utils.Queue<BuildNode>();
//     toVisit.enqueue(root);

//     while (true) {
//       let node = toVisit.dequeue();
//       if (!node) {
//         break;
//       }
//       yield node;
//       for (const child of node.ins) {
//         toVisit.enqueue(child.in);
//       }
//     }
//   };

//   // const addNode = createNode('1 + (2 + 3)');
//   // const addLhsNode = createNode('1');
//   // const add2Node = createNode('2 + 3');
//   // const add2LhsNode = createNode('2');
//   // const add2RhsNode = createNode('3');

//   // addEdge(addLhsNode, addNode, BuildEdgeConstraint.Same);
//   // addEdge(add2Node, addNode, BuildEdgeConstraint.Same);
//   // addLhsNode.constraints.push({ mode: BuildEdgeConstraint.Same, type: typeSpecFromPrimitive(PrimitiveType.Int) });
//   // addEdge(add2RhsNode, add2Node, BuildEdgeConstraint.Same);
//   // addEdge(add2LhsNode, add2Node, BuildEdgeConstraint.Same);
//   // add2LhsNode.constraints.push({ mode: BuildEdgeConstraint.Same, type: typeSpecFromPrimitive(PrimitiveType.Int) });
//   // add2RhsNode.constraints.push({ mode: BuildEdgeConstraint.Same, type: typeSpecFromPrimitive(PrimitiveType.Int) });

//   // const rootNode = addNode;


//   const buildNodeMap = new Map<Expression, BuildNode>();

//   const makeBuildNode = (expr: Expression) => {
//     const node = createNode(expr.toString());
//     buildNodeMap.set(expr, node);
//     const inputNodes = expr.inputs.map(input => makeBuildNode(input.expr));
//     // for (const input of expr.inputs) {
//     //   for (const c of input.typeConstraints) {
//     //     const typeNode = createNode(c.type.toString());
//     //     addEdge(childNode, node, BuildEdgeConstraint.Same);
//     //   }
//     // }

//     for (const output of expr.outputs) {
//       const typeNode = createNode(output.typeSpec.toString());
//       typeNode.constraints.push({
//         mode: BuildEdgeConstraint.Same,
//         type: output.typeSpec,
//       });
//       addEdge(typeNode, node, BuildEdgeConstraint.Same);
//     }
//     for (const output of expr.outputTypeConstraints) {
//       switch (output.type) {
//         case TypeConstraintType.Exactly:
//           break;
//         case TypeConstraintType.Convertible:
//           break;
//         case TypeConstraintType.SameAsInputs:
//         case TypeConstraintType.ConvertibleToInputs:
//         case TypeConstraintType.StatementLike: {
//           const edgeConstraint =
//               output.type === TypeConstraintType.SameAsInputs ? BuildEdgeConstraint.Same :
//               output.type === TypeConstraintType.ConvertibleToInputs ? BuildEdgeConstraint.Convertible :
//               BuildEdgeConstraint.StatementLike;
//           for (const input of output.inputs) {
//             if (input.inputIndex !== undefined) {
//               addEdge(inputNodes[input.inputIndex], node, edgeConstraint);
//             }
//           }
//           break;
//         }
//       }
//     }

//     return node;
//   };

//   const rootNode = makeBuildNode(rootExpr);
//   const allNodes = Array.from(enumerateChildrenRec(rootNode));

//   // Mark nodes with no inputs and at least one type constraint as definite.
//   for (const node of nodeList) {
//     if (node.ins.length !== 0 || node.constraints.length === 0) {
//       continue;
//     }
//     // Validate constraints.
//     node.isDefinite = true;
//   }

//   const toVisit = new utils.Queue<BuildNode>();
//   toVisit.enqueueRange(Array.from(allNodes).reverse());
//   const queuedSet = new Map<BuildNode, void>();
//   for (const node of toVisit.values()) {
//     queuedSet.set(node);
//   }

//   while (true) {
//     const node = toVisit.dequeue();
//     if (!node) {
//       break;
//     }
//     queuedSet.delete(node);

//     if (!node.constraints) {
//       continue;
//     }

//     for (const edge of node.outs) {
//       const dep = edge.out;
//       for (const constraint of node.constraints) {
//         // TODO: Confirm logic!!!
//         const isStatementLike =
//             edge.constraint === BuildEdgeConstraint.StatementLike ||
//             constraint.mode === BuildEdgeConstraint.StatementLike;
//         const isSame =
//             edge.constraint === BuildEdgeConstraint.Same &&
//             constraint.mode === BuildEdgeConstraint.Same;
//         const newMode =
//             isStatementLike ? BuildEdgeConstraint.StatementLike :
//             isSame ? BuildEdgeConstraint.Same :
//             BuildEdgeConstraint.Convertible;

//         addCoalescedConstraint(dep, {
//           mode: newMode,
//           type: newMode === BuildEdgeConstraint.StatementLike ? { types: [] } : constraint.type,
//         });
//       }
//     }
//   }

//   // Check for any type inconsistencies.
//   // ^^^ actually this should happen in place, as the errors should be produced
//   //     as they happen, and bad types should not propagate.
//   // Check for any non-definite nodes.

//   // // Solve until all BuildNodes are definite.
//   // const waitSet = new Map<BuildNode, void>()
//   // for (const node of nodeList) {
//   //   waitSet.set(node);
//   // }
//   // const readySet = new Map<BuildNode, void>();
//   // const queued: BuildNode[] = [];
//   // const queueVisit = (node: BuildNode) => {
//   //   if (readySet.has(node)) {
//   //     return;
//   //   }
//   //   readySet.set(node);
//   //   waitSet.delete(node);
//   //   queued.push(node);
//   //   // console.log(`queue: ${node} ${Array.from(readySet.keys())}`);
//   // };
//   // const maybeQueue = (node: BuildNode) => {
//   //   if (readySet.has(node)) {
//   //     return;
//   //   }
//   //   // console.log(`maybeQueue: ${node}`);
//   //   for (const edge of node.ins) {
//   //     // console.log(`in ${edge.in} is ready: ${readySet.has(edge.in)}`);
//   //     if (!readySet.has(edge.in)) {
//   //       return;
//   //     }
//   //   }
//   //   for (const edge of node.outs) {
//   //     if (!edge.allowBackwardsInference) {
//   //       continue;
//   //     }
//   //     // console.log(`out ${edge.out} is ready: ${readySet.has(edge.out)}`);
//   //     if (!readySet.has(edge.out)) {
//   //       return;
//   //     }
//   //   }
//   //   queueVisit(node);
//   // }

//   // const f: (n: number) => number = (n) => n + 123;

//   // // First, add all nodes that are already definite.
//   // for (const node of nodeList.filter(n => n.isDefinite)) {
//   //   queueVisit(node);
//   // }
//   // // Then dequeue until no more nodes are ready.
//   // while (queued.length > 0) {
//   //   const node = queued.shift()!;
//   //   console.log(`visit: ${node}`);
//   //   for (const edge of node.ins) {
//   //     maybeQueue(edge.in);
//   //   }
//   //   for (const edge of node.outs) {
//   //     maybeQueue(edge.out);
//   //   }
//   // }

//   // // Check return is assigned.
//   console.log(allNodes);
//   console.log(rootNode.toString());

//   for (const [expr, node] of buildNodeMap) {
//     if (node.constraints.length === 1) {
//       const constraint = node.constraints[0];
//       if (constraint.mode === BuildEdgeConstraint.StatementLike) {
//         expr.resolvedAsStatementLike = true;
//         console.log(`Resolved as statement ${expr}`);
//       } else {
//         expr.resolvedType = constraint.type;
//         console.log(`Resolved type for ${expr} (${typeSpecToString(expr.resolvedType)})`);
//       }
//     } else {
//       console.log(`Unable to resolve type for ${expr} (${node})`);
//     }
//   }
// }





  // const makeUndefinedExpr = (node: ts.Node): UndefinedExpression => {
  //   return new UndefinedExpression(node, root);
  // };

  // function verify<T>(value: T, predicate: (v: T) => boolean, errorFormatter: () => string): T {
  //   if (!predicate(value)) {
  //     console.log(errorFormatter());
  //   }
  //   return value;
  // };

  // const makeExpression = (node: ts.Node): Expression => {
  //   console.log(node);
  //   const sourceMapRange = ts.getSourceMapRange(node);
  //   console.log(`${tsGetSyntaxTypeLabel(node.kind)}   inner code: ${(sourceMapRange.source ?? root).text.substring(sourceMapRange.pos, sourceMapRange.end).trim()}`);

  //   const childMap = new Map<ts.Node, Expression>();
  //   const children = node.getChildren(root);
  //   const getExpr = (child: ts.Node): Expression => {
  //     const oldExpr = childMap.get(child)
  //     if (oldExpr) {
  //       return oldExpr;
  //     }
  //     const newExpr = makeExpression(child);
  //     childMap.set(node, newExpr);
  //     return newExpr;
  //   };
  //   const getAllExprs = (): Expression[] => {
  //     return children.map(getExpr);
  //   }
  //   const getUndefinedExpr = () => makeUndefinedExpr(node);

  //   if (ts.isSourceFile(node)) {
  //     return new StatementsExpression(node, root, node.statements.map(getExpr));
  //   } else if (ts.isExpressionStatement(node)) {
  //     return new StatementsExpression(node, root, [ getExpr(node.expression) ]);
  //   } else if (ts.isPropertyAccessExpression(node)) {
  //     // TODO: Handle node.questionDotToken
  //     return new PropertyAccessExpression(node, root, getExpr(node.expression), node.name.text);
  //   } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
  //     return new AssignmentExpression(
  //       node, root,
  //       verify(
  //         getExpr(node.left),
  //         e => e.isReferenceLike,
  //         () => `LHS of assignment must be an assignable reference.`),
  //       getExpr(node.right),
  //     );
  //   } else if (ts.isBinaryExpression(node)) {
  //     const opType =
  //         ts.isPlusToken(node.operatorToken) ? BinaryOpType.Add :
  //         ts.isMinusToken(node.operatorToken) ? BinaryOpType.Subtract :
  //         ts.isAsteriskToken(node.operatorToken) ? BinaryOpType.Multiply :
  //         node.operatorToken.kind === ts.SyntaxKind.SlashToken ? BinaryOpType.Divide :
  //         undefined;
  //     if (!opType) {
  //       return getUndefinedExpr();
  //     }
  //     return new BinaryOpExpression(node, root, opType, getExpr(node.left), getExpr(node.right));
  //   } else if (ts.isParenthesizedExpression(node)) {
  //     return getExpr(node.expression);
  //   } else if (ts.isNumericLiteral(node)) {
  //     return new LiteralExpression(node, root, { intValue: parseInt(node.text) });
  //   }
  //   return getUndefinedExpr();
  // };
  // const rootExpr = makeExpression(root)!;
  // console.log(rootExpr);








