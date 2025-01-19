import ts from "typescript/lib/typescript";
import { BapWriteAsStatementFunc, BapWriteIntoExpressionFunc, BapSubtreeGenerator, BapGenerateContext, BapSubtreeValue } from "./bap-value";
import { BapVisitorRootContext } from "./bap-visitor";

export class BapRootContextMixin {
  get program() { return this.rootContext.program; }
  get sourceRoot() { return this.rootContext.sourceRoot; }
  get tc() { return this.rootContext.tc; }
  get types() { return this.rootContext.types; }

  constructor(protected readonly rootContext: BapVisitorRootContext) {}

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
      const writer = func(prepare);
      return (expr) => {
        expr.discard();
        writer?.(prepare);
      };
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


  protected getSymbolType(s: ts.Symbol|undefined) {
    if (s?.valueDeclaration) {
      return this.stringifyType(this.tc.getTypeAtLocation(s.valueDeclaration));
    }
    return '???';
  }

  protected stringifyType(type: ts.Type): string {
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
}