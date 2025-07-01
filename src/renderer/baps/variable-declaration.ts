import ts from "typescript/lib/typescript";
import * as utils from '../../utils';
import { BapVisitor } from "../bap-visitor";
import { CodeStatementWriter, CodeTypeSpec, CodeVariable } from "../code-writer/code-writer";
import { BapIdentifierPrefix } from '../bap-constants';
import { BapGenerateContext, BapGenerateOptions, BapSubtreeGenerator, BapSubtreeValue, BapTypeGenerator, BapTypeSpec } from '../bap-value';
import { BapIdentifier, BapIdentifierInstance, bapIdentifierToNameHint } from "../bap-scope";
import { BapPropertyAccessExpressionVisitor } from "./property-access-expression";

export class BapVariableDeclarationVisitor extends BapVisitor {
  identifierInstance?: BapIdentifierInstance;

  manual({
    newVars,
  }: {
    newVars: Array<{
      identifier: BapIdentifier;
      type: BapTypeGenerator;
      initializer?: BapSubtreeGenerator;
    }|{
      bindings: Array<{
        fromProperty: BapIdentifier;
        asIdentifier: BapIdentifier;
        type: BapTypeGenerator;
      }>;
      initializer: BapSubtreeGenerator;
    }>
  }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const writerFuncs: Array<(prepare: CodeStatementWriter) => void> = [];
        for (const newVar of newVars) {
          const newValue = newVar.initializer?.generateRead(context) ?? { type: 'uninitialized' };

          const isBindings = 'bindings' in newVar;
          let typeSpec: BapTypeSpec | undefined;
          let nameHint: string;
          if (isBindings) {
            typeSpec = newValue.typeSpec;
            nameHint = typeSpec?.debugName ?? 'tmp';
          } else {
            typeSpec = newVar.type.generate(context);
            nameHint = newVar.identifier.toString();
          }

          let varValue = newValue;
          // TODO: Determine copyability!!!
          const isCopyable = newValue?.noCopy !== true;
          if (isCopyable) {
            let codeVar: CodeVariable;
            writerFuncs.push((prepare) => {
              const newValueWriter = newValue.writeIntoExpression?.(prepare);
              const codeType = typeSpec?.codeTypeSpec ?? CodeTypeSpec.compileErrorType;
              codeVar = prepare.scope.allocateVariableIdentifier(codeType, BapIdentifierPrefix.Local, bapIdentifierToNameHint(nameHint));
              const varDeclStmt = prepare.writeVariableDeclaration(codeVar);
              newValueWriter?.(varDeclStmt.initializer.writeExpression());
            });
            if (isBindings) {
              for (const binding of newVar.bindings) {
                this.asParent(() => {
                  const asVarType = binding.type.generate(context);
                  let asCodeVar: CodeVariable;

                  const propAccessGen = new BapPropertyAccessExpressionVisitor().manual({
                    thisGen: {
                      generateRead: function (context: BapGenerateContext, options?: BapGenerateOptions): BapSubtreeValue {
                        return {
                          type: 'cached',
                          typeSpec: typeSpec,
                          writeIntoExpression: (prepare) => {
                            return (expr) => {
                              expr.writeVariableReference(codeVar);
                            };
                          },
                        };
                      }
                    },
                    identifierName: binding.fromProperty,
                  });
                  writerFuncs.push((prepare) => {
                    if (!this.verifyNotNulllike(codeVar, `Variable declaration was not prepared: ${bapIdentifierToNameHint(nameHint)}`)) {
                      return;
                    }
                    const propAccessWriter = propAccessGen?.generateRead(context).writeIntoExpression?.(prepare);
                    asCodeVar = prepare.scope.allocateVariableIdentifier(asVarType?.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, bapIdentifierToNameHint(binding.asIdentifier));
                    const varDeclStmt = prepare.writeVariableDeclaration(asCodeVar);
                    propAccessWriter?.(varDeclStmt.initializer.writeExpression());
                  });
                  varValue = {
                    type: 'cached',
                    typeSpec: asVarType,
                    writeIntoExpression: (prepare) => {
                      return (expr) => {
                        if (!this.verifyNotNulllike(asCodeVar, `Variable declaration was not prepared: ${bapIdentifierToNameHint(nameHint)}`)) {
                          return;
                        }
                        expr.writeVariableReference(asCodeVar);
                      };
                    },
                    // generateWrite: (value) => {
                    //   return (prepare) => {
                    //     const valueWriter = value.writeIntoExpression?.(prepare);
                    //     return (block) => {
                    //       const assignStmt = block.writeAssignmentStatement();
                    //       assignStmt.ref.writeVariableReference(codeVar);
                    //       valueWriter?.(assignStmt.value);
                    //     };
                    //   };
                    // },
                  };
                  context.scope.declare(binding.asIdentifier, varValue);
                });
              }
            } else {
              varValue = {
                type: 'cached',
                typeSpec: typeSpec,
                writeIntoExpression: (prepare) => {
                  return (expr) => {
                    if (!this.verifyNotNulllike(codeVar, `Variable declaration was not prepared: ${bapIdentifierToNameHint(nameHint)}`)) {
                      return;
                    }
                    expr.writeVariableReference(codeVar);
                  };
                },
                generateWrite: (value) => {
                  return (prepare) => {
                    const valueWriter = value.writeIntoExpression?.(prepare);
                    return (block) => {
                      const assignStmt = block.writeAssignmentStatement();
                      assignStmt.ref.writeVariableReference(codeVar);
                      valueWriter?.(assignStmt.value);
                    };
                  };
                },
              };
              this.identifierInstance = context.scope.declare(newVar.identifier, varValue);
            }
          }
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
    const newVars = utils.filterNulllike(declarations.map(decl => {
      const initializer = decl.initializer ? this.child(decl.initializer) : undefined;

      if (ts.isObjectBindingPattern(decl.name)) {
        if (!this.verifyNotNulllike(initializer, `Object binding patterns must include an initializer.`)) {
          return;
        }
        const bindings = [];
        for (const binding of decl.name.elements) {
          const propertyName = binding.propertyName?.getText() ?? binding.name.getText();
          const varName = binding.name.getText();
          bindings.push({
            asIdentifier: varName,
            fromProperty: propertyName,
            type: this.types.type(binding.name),
          });
        }
        return {
          bindings: bindings,
          initializer,
        };
      } else {
        const identifier = decl.name.getText();
        return {
          identifier,
          type: this.types.type(decl),
          initializer,
        };
      }
    }));
    return this.manual({ newVars });
  }
}
