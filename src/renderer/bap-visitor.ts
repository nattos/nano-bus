import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { BapFields, BapGenerateContext, BapSubtreeGenerator, BapSubtreeValue, BapTypeGenerator, BapTypeSpec, BapWriteAsStatementFunc, BapWriteIntoExpressionFunc } from "./bap-value";
import { getNodeLabel } from "./ts-helpers";
import { CodeNamedToken, CodePrimitiveType, CodeScope, CodeScopeType, CodeTypeSpec, CodeVariable, CodeWriter } from './code-writer';
import { BopIdentifierPrefix } from './bop-data';
import { BapPrototypeScope, BapScope, BapThisSymbol } from './bap-scope';
import { BapTypes } from './bap-types';
import { BapRootContextMixin } from './bap-root-context-mixin';

type AnyPossibleNode<TType extends ts.SyntaxKind> = ts.Node&{ readonly kind: TType };
export type BapVisitorImpl<TNode> = BapVisitor&{ impl(node: TNode|Node): BapSubtreeGenerator|undefined; };
type BapVisitorImplConstructor<TNode> = { new (): BapVisitorImpl<TNode>; };

export interface BapVisitorRootContext {
  readonly program: ts.Program;
  readonly sourceRoot: ts.SourceFile;
  readonly tc: ts.TypeChecker;
  readonly types: BapTypes;
  readonly globals: {
    prepareFuncs: CodeVariable[];
  };
}

interface VistorDecl {
  predicate?: (node: ts.Node) => boolean;
  visit: (node: ts.Node) => BapSubtreeGenerator|undefined;
}

export class BapVisitor extends BapRootContextMixin {
  protected static currentParent?: BapVisitor;
  private static readonly nodeTypeMap = new Map<ts.SyntaxKind, Array<VistorDecl>>();

  constructor(rootContext?: BapVisitorRootContext) {
    let parentContext = rootContext ?? BapVisitor.currentParent?.rootContext;
    if (!parentContext) {
      throw new Error('Visitor not constructed within a context.');
    }
    super(parentContext);
  }

  asParent<T>(f: () => T) {
    const oldParent = BapVisitor.currentParent;
    BapVisitor.currentParent = this;
    try {
      return f();
    } finally {
      BapVisitor.currentParent = oldParent;
    }
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
