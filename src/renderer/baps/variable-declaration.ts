import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodeStatementWriter, CodeTypeSpec, CodeVariable } from "../code-writer";
import { BopIdentifierPrefix } from '../bop-data';
import { BapSubtreeGenerator, BapTypeGenerator } from '../bap-value';
import { BapIdentifier, BapIdentifierInstance, bapIdentifierToNameHint } from "../bap-scope";

export class BapVariableDeclarationVisitor extends BapVisitor {
  identifierInstance?: BapIdentifierInstance;

  manual({
    newVars,
  }: {
    newVars: Array<{
      identifier: BapIdentifier;
      type: BapTypeGenerator;
      initializer?: BapSubtreeGenerator;
    }>
  }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const writerFuncs: Array<(prepare: CodeStatementWriter) => void> = [];
        for (const newVar of newVars) {
          const typeSpec = newVar.type.generate(context);
          const newValue = newVar.initializer?.generateRead(context) ?? { type: 'uninitialized' };
          let varValue = newValue;
          // TODO: Determine copyability!!!
          const isCopyable = true;
          if (isCopyable) {
            let codeVar: CodeVariable;
            writerFuncs.push((prepare) => {
              const newValueWriter = newValue.writeIntoExpression?.(prepare);
              const codeType = typeSpec?.codeTypeSpec ?? CodeTypeSpec.compileErrorType;
              codeVar = prepare.scope.allocateVariableIdentifier(codeType, BopIdentifierPrefix.Local, bapIdentifierToNameHint(newVar.identifier));
              const varDeclStmt = prepare.writeVariableDeclaration(codeVar);
              newValueWriter?.(varDeclStmt.initializer.writeExpression());
            });
            varValue = {
              type: 'cached',
              typeSpec: typeSpec,
              writeIntoExpression: (prepare) => {
                return (expr) => {
                  if (!this.verifyNotNulllike(codeVar, `Variable declaration was not prepared: ${bapIdentifierToNameHint(newVar.identifier)}`)) {
                    return;
                  }
                  expr.writeVariableReference(codeVar);
                };
              },
              generateWrite: (value) => {
                return (prepare) => {
                  // const isUsed = !!this.identifierInstance && context.scope.referencedInChildren.has(this.identifierInstance);
                  // console.log(isUsed, this.identifierInstance, context.scope.referencedInChildren);
                  const valueWriter = value.writeIntoExpression?.(prepare);
                  return (block) => {
                    const assignStmt = block.writeAssignmentStatement();
                    assignStmt.ref.writeVariableReference(codeVar);
                    valueWriter?.(assignStmt.value);
                  };
                };
              },
            };
          }
          this.identifierInstance = context.scope.declare(newVar.identifier, varValue);
        }
        let writerFunc;
        if (writerFuncs.length) {
          writerFunc = (prepare: CodeStatementWriter) => {
            for (const f of writerFuncs) {
              f(prepare);
            }
            return undefined;
          };
        }
        return {
          type: 'statement',
          writeIntoExpression: writerFunc,
        };
      },
    };
  }

  impl(node: ts.VariableStatement): BapSubtreeGenerator|undefined;
  impl(node: ts.VariableDeclarationList): BapSubtreeGenerator|undefined;
  impl(node: ts.VariableStatement|ts.VariableDeclarationList): BapSubtreeGenerator|undefined {
    const declarations = ts.isVariableDeclarationList(node) ? node.declarations : node.declarationList.declarations;
    const newVars = declarations.map(decl => {
      const identifier = decl.name.getText();
      const initializer = decl.initializer ? this.child(decl.initializer) : undefined;
      return {
        identifier,
        type: this.types.type(decl),
        initializer,
      };
    });
    return this.manual({ newVars });
  }
}
