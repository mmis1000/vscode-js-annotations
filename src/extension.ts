import * as vscode from "vscode";
import Commands from "./commands";
import * as decorator from "./decorator";
import * as parser from "./parser";

const decType = vscode.window.createTextEditorDecorationType({});
const errDecType = vscode.window.createTextEditorDecorationType({
  fontWeight: "800"
});

let diagCollection;
let diagnostics: vscode.Diagnostic[];
let timeoutId;

export function activate(ctx: vscode.ExtensionContext) {
  console.log("extension is now active!");

  // Update when a file opens
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    run(ctx, editor);
    runLens();
  });

  // Update when a file saves
  vscode.workspace.onWillSaveTextDocument((event) => {
    const openEditor = vscode.window.visibleTextEditors.filter((editor) => editor.document.uri === event.document.uri)[0];

    run(ctx, openEditor);
    runLens();
  });

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      const openEditor = vscode.window.visibleTextEditors.filter((editor) => editor.document.uri === event.document.uri)[0];
      run(ctx, openEditor);
      runLens();
    }, 100);
  });

  // Update if the config was changed
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("jsannotations")) {
      run(ctx, vscode.window.activeTextEditor);
      runLens();
    }
  });

  Commands.registerCommands();
}

export function deactivate() {
  console.log("DONE");
}

let lens: ReturnType<typeof vscode.languages.registerCodeLensProvider>;

function runLens() {
  const isEnabled = vscode.workspace.getConfiguration("jsannotations").get("enabled");

  if (isEnabled === (lens != null)) {
    return;
  }

  if (isEnabled) {
    lens = vscode.languages.registerCodeLensProvider(
      [
        { language: "javascript" },
        { language: "typescript" },
        { language: "javascriptreact" },
        { language: "typescriptreact" }
      ], {
      async provideCodeLenses(document, token) {
          // const result: vscode.CodeLens[] = [];

          const [decArray, errDecArray, lensArray] = await createDecorations(document, document.getText());

          // decArray.forEach(item => {
          //   result.push(new vscode.CodeLens(item.range, { title: item.renderOptions.before.contentText, command: null }));
          // });

          return lensArray;
      }
    });
  } else {
    lens.dispose();
    lens = null;
  }
}

async function run(ctx: vscode.ExtensionContext, editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor) {
    return;
  }

  const supportedLanguages = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

  if (supportedLanguages.indexOf(editor.document.languageId) === -1) {
    return;
  }

  // Setup variables for diagnostics when loading JS file
  if (diagCollection === undefined && editor.document.languageId === "javascript") {
    diagCollection = vscode.languages.createDiagnosticCollection("js-annot");
  }

  const isEnabled = vscode.workspace.getConfiguration("jsannotations").get("enabled");

  if (!isEnabled) {
    editor.setDecorations(decType, []);
    return;
  }

  // Get all of the text in said editor
  const sourceCode = editor.document.getText();

  const [decArray, errDecArray] = await createDecorations(editor.document, sourceCode);

  if (editor.document.languageId === "javascript") {
    diagCollection.set(editor.document.uri, diagnostics);
    ctx.subscriptions.push(diagCollection);
  }

  editor.setDecorations(decType, decArray);
  editor.setDecorations(errDecType, errDecArray);
}

export async function createDecorations(document: vscode.TextDocument, sourceCode: string): Promise<[vscode.DecorationOptions[], vscode.DecorationOptions[], vscode.CodeLens[]]> {
  diagnostics = [];

  const decArray: vscode.DecorationOptions[] = [];
  const errDecArray: vscode.DecorationOptions[] = [];
  const lensArray: vscode.CodeLens[] = [];
  // get an array of all said function calls in the file
  let fcArray = parser.getFunctionCalls(sourceCode, document);

  // grab the definitions for any of the function calls which can find a definition
  fcArray = await parser.getDefinitions(fcArray, document.uri);

  // cache for documents so they aren't loaded for every single call
  const documentCache: any = {};

  // filter down to function calls which actually have a definition
  const callsWithDefinitions = fcArray.filter((item) => item.definitionLocation !== undefined);

  for (const fc of callsWithDefinitions) {
    await decorator.decorateFunctionCall(document, documentCache, decArray, errDecArray, lensArray, fc, diagnostics);
  }

  return [decArray, errDecArray, lensArray];
}

export function getDiagnostics(): vscode.Diagnostic[] {
  if (!diagnostics) {
    return [];
  }

  // Returns a copy
  return diagnostics.slice();
}
