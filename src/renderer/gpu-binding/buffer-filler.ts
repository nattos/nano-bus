import { BapRootContextMixin } from '../bap-root-context-mixin';
import { BapGenerateContext, BapTypeSpec } from '../bap-value';
import { CodeVariable, CodeStatementWriter, CodeExpressionWriter, CodeBinaryOperator } from '../code-writer/code-writer';


/** A util to help marshal GPU buffers. */
export class BufferFiller extends BapRootContextMixin {
  gpuVar: CodeVariable = null as any;
  baseOffsetVar?: CodeVariable;

  constructor(readonly context: BapGenerateContext, readonly cpuVar: CodeVariable) {
    super(context.scope.rootContext);
  }

  writeCpu(copyAsType: BapTypeSpec, byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    if (!this.verifyNotNulllike(copyAsType.libType, `Cannot marshal type ${copyAsType.debugName}.`)) {
      return body.writeExpressionStatement().expr;
    }
    const callExpr = body.writeExpressionStatement().expr.writeMethodCall(this.context.globalWriter.makeInternalToken('write_' + copyAsType.libType.identifier));
    callExpr.source.writeVariableReference(this.cpuVar);
    if (this.baseOffsetVar) {
      const addOp = callExpr.addArg().writeBinaryOperation(CodeBinaryOperator.Add);
      addOp.lhs.writeVariableReference(this.baseOffsetVar);
      addOp.rhs.writeLiteralInt(byteOffset);
    } else {
      callExpr.addArg().writeLiteralInt(byteOffset);
    }
    return callExpr.addArg();
  }
}
