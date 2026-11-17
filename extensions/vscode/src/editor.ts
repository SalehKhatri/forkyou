import * as vscode from "vscode";
import { countLines, type SessionTracker, type WorkContext } from "./tracker.js";

/**
 * Documents the user is actually editing. Leaves out output panels, Git and diff views, settings
 * editors and the like, whose changes aren't the user's coding.
 */
const TRACKED_SCHEMES = new Set([
  "file",
  "untitled",
  "vscode-remote",
  "vscode-vfs",
  "vscode-notebook-cell",
]);
const TICK_MS = 10_000;
const MAX_PROJECT_LENGTH = 128;

/**
 * Feeds activity in this window to `tracker` until disposed. Disposing closes the open session.
 * Only the language and the workspace folder name are read; file names and paths never leave this
 * function. Nothing counts while the window isn't focused.
 */
export function watchEditor(tracker: SessionTracker): vscode.Disposable {
  /** Activity in a code document: attributed to its language and project. */
  const onCode = (document: vscode.TextDocument, lines?: { added: number; removed: number }) => {
    if (!vscode.window.state.focused) return;
    const context = workContext(document);
    if (context) tracker.activity(context, lines);
  };
  /**
   * Activity elsewhere in VS Code (terminal, debugger, tasks, notebooks, focusing the window).
   * Attributed to the active editor if there is one; otherwise it only extends the open session.
   */
  const onWorkspace = () => {
    if (!vscode.window.state.focused) return;
    const document = vscode.window.activeTextEditor?.document;
    const context = document && workContext(document);
    if (context) tracker.activity(context);
    else tracker.keepAlive();
  };
  const timer = setInterval(() => tracker.tick(), TICK_MS);

  return vscode.Disposable.from(
    // Code: edits, cursor moves, scrolling, switching editors.
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Edits to background documents (formatters, Git, other extensions) aren't the user typing.
      if (event.contentChanges.length === 0) return;
      if (event.document !== vscode.window.activeTextEditor?.document) return;
      onCode(event.document, countLines(event.contentChanges));
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => onCode(event.textEditor.document)),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => onCode(event.textEditor.document)),
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && onCode(editor.document)),
    // Focus: coming back counts as activity; leaving ends the session.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) onWorkspace();
      else tracker.end();
    }),
    // Terminal, tasks, debugger, notebooks.
    vscode.window.onDidChangeActiveTerminal(onWorkspace),
    vscode.window.onDidChangeTerminalState(onWorkspace),
    ...optionalEvents(vscode.window, [
      "onDidStartTerminalShellExecution",
      "onDidEndTerminalShellExecution",
    ]).map((event) => event(onWorkspace)),
    vscode.tasks.onDidStartTask(onWorkspace),
    vscode.tasks.onDidEndTask(onWorkspace),
    vscode.debug.onDidStartDebugSession(onWorkspace),
    vscode.debug.onDidTerminateDebugSession(onWorkspace),
    vscode.debug.onDidChangeBreakpoints(onWorkspace),
    vscode.debug.onDidChangeActiveStackItem(onWorkspace),
    vscode.workspace.onDidChangeNotebookDocument((event) => {
      if (event.notebook !== vscode.window.activeNotebookEditor?.notebook) return;
      // Cells added/removed or a run starting/finishing. Not output: a long-running cell streams
      // output with nobody at the keyboard.
      const ranCell = event.cellChanges.some((change) => change.executionSummary !== undefined);
      if (event.contentChanges.length > 0 || ranCell) onWorkspace();
    }),
    {
      dispose: () => {
        clearInterval(timer);
        tracker.end();
      },
    },
  );
}

/**
 * Events added after the VS Code version in `engines` (e.g. terminal shell execution, 1.93).
 * Used when present, so older editors keep working without them.
 */
function optionalEvents(api: object, names: string[]): vscode.Event<unknown>[] {
  return names
    .map((name) => Reflect.get(api, name) as vscode.Event<unknown> | undefined)
    .filter((event): event is vscode.Event<unknown> => typeof event === "function");
}

function workContext(document: vscode.TextDocument): WorkContext | undefined {
  if (!TRACKED_SCHEMES.has(document.uri.scheme)) return undefined;
  const sendProject = vscode.workspace
    .getConfiguration("forkyou", document.uri)
    .get<boolean>("sendProjectName", true);
  const folder = sendProject ? vscode.workspace.getWorkspaceFolder(document.uri)?.name : undefined;
  return {
    language: document.languageId,
    ...(folder ? { project: folder.slice(0, MAX_PROJECT_LENGTH) } : {}),
  };
}
