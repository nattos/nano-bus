import { QueryTokenAtom, NanoApp } from "./app";
import { CommandSpec, CommandParser, CommandResolvedArg } from "./command-parser";
import * as environment from "./environment";

function executeSubcommandsFunc(command: CommandSpec, args: CommandResolvedArg[]) {
  for (const arg of args) {
    if (arg.subcommand) {
      arg.subcommand.command.func?.(arg.subcommand.command, arg.subcommand.args);
    }
  }
}

function beginPreviewSubcommandsFunc(command: CommandSpec, args: CommandResolvedArg[]) {
  for (const arg of args) {
    if (arg.subcommand) {
      arg.subcommand.command.beginPreviewFunc?.(arg.subcommand.command, arg.subcommand.args);
    }
  }
}

function cancelPreviewSubcommandsFunc(command: CommandSpec, args: CommandResolvedArg[]) {
  for (const arg of args) {
    if (arg.subcommand) {
      arg.subcommand.command.cancelPreviewFunc?.(arg.subcommand.command, arg.subcommand.args);
    }
  }
}

function chipLabelSubcommandsFunc(command: CommandSpec, args: CommandResolvedArg[]) {
  for (const arg of args) {
    if (arg.subcommand) {
      return arg.subcommand.command.chipLabelFunc?.(arg.subcommand.command, arg.subcommand.args);
    }
  }
  return undefined;
}

export function getCommands(app: NanoApp) {
  const commands: CommandSpec[] = [
    {
      name: 'Command palette',
      desc: 'Select command to execute.',
      atomPrefix: 'cmd:',
      enterAtomContext: true,
      canExitAtomContext: false,
      func: executeSubcommandsFunc,
      beginPreviewFunc: beginPreviewSubcommandsFunc,
      cancelPreviewFunc: cancelPreviewSubcommandsFunc,
      chipLabelFunc: chipLabelSubcommandsFunc,
      executeOnAutoComplete: true,
      argSpec: [
        {
          subcommands: [
            {
              // cmd:library-paths <show|add|add-indexed>
              name: 'Nothing',
              desc: 'Nothing.',
              atomPrefix: 'nothing',
              argSpec: [
                {
                  oneof: ['nothing'],
                },
              ],
              executeOnAutoComplete: true,
              func: CommandParser.bindFunc(app.doNothing, app),
            },
          ],
        }
      ],
    },
    {
      // <search> <query>...
      name: 'Search',
      desc: 'Filters library or playlist by search terms.',
      func: app.doSearchAccept.bind(app),
      beginPreviewFunc: app.doSearchBeginPreview.bind(app),
      cancelPreviewFunc: app.doSearchCancelPreview.bind(app),
      argSpec: [
        {
          isString: true,
          isRepeated: true,
          subcommands: [
            {
              // title:<title>
              name: 'Title',
              desc: 'Filters by title.',
              atomPrefix: 'title:',
              argSpec: [
                {
                  isString: true,
                }
              ],
              valueFunc: CommandParser.bindValueFunc(app.searchQueryTokenFromAtomFunc(QueryTokenAtom.Title), app, CommandParser.resolveStringArg()),
            },
            {
              // artist:<artist>
              name: 'Artist',
              desc: 'Filters by artist.',
              atomPrefix: 'artist:',
              argSpec: [
                {
                  isString: true,
                }
              ],
              valueFunc: CommandParser.bindValueFunc(app.searchQueryTokenFromAtomFunc(QueryTokenAtom.Artist), app, CommandParser.resolveStringArg()),
            },
            {
              // genre:<genre>
              name: 'Genre',
              desc: 'Filters by genre.',
              atomPrefix: 'genre:',
              argSpec: [
                {
                  isString: true,
                }
              ],
              valueFunc: CommandParser.bindValueFunc(app.searchQueryTokenFromAtomFunc(QueryTokenAtom.Genre), app, CommandParser.resolveStringArg()),
            },
            {
              // album:<album>
              name: 'Album',
              desc: 'Filters by album.',
              atomPrefix: 'album:',
              argSpec: [
                {
                  isString: true,
                }
              ],
              valueFunc: CommandParser.bindValueFunc(app.searchQueryTokenFromAtomFunc(QueryTokenAtom.Album), app, CommandParser.resolveStringArg()),
            },
            {
              // path:<path>
              name: 'File path',
              desc: 'Filters by file path.',
              atomPrefix: 'path:',
              argSpec: [
                {
                  isString: true,
                }
              ],
              valueFunc: CommandParser.bindValueFunc(app.searchQueryTokenFromAtomFunc(QueryTokenAtom.Path), app, CommandParser.resolveStringArg()),
            },
          ],
        },
      ],
    },
  ];
  return commands;
}

function ifElectron(commandSpec: CommandSpec): CommandSpec|undefined {
  if (environment.isElectron()) {
    return commandSpec;
  }
  return undefined;
}
