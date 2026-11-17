import * as vscode from "vscode";
import { ApiClient } from "./api.js";
import { isApiKeyFormat, resolveApiUrl, webUrl } from "./config.js";
import { Credentials, keyCheckMessage } from "./credentials.js";
import { removeLegacyKey } from "./legacy.js";

/** Set once we've suggested adding a key, so a fresh install doesn't nag on every start. */
const SETUP_PROMPTED = "forkyou.setupPrompted";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("ForkYou", { log: true });

  const apiUrl = (): string => {
    const { url, warning } = resolveApiUrl(
      vscode.workspace.getConfiguration("forkyou").get<string>("apiUrl"),
    );
    if (warning) log.warn(warning);
    return url;
  };
  const openWeb = (path: string) =>
    vscode.env.openExternal(vscode.Uri.parse(`${webUrl(apiUrl())}${path}`));
  const api = new ApiClient({ baseUrl: apiUrl });
  const credentials = new Credentials(context.secrets);

  async function configureApiKey(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: "ForkYou: API key",
      prompt: `Create a key in Settings on ${webUrl(apiUrl())} and paste it here.`,
      placeHolder: "fy_…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        isApiKeyFormat(value.trim()) ? undefined : "ForkYou API keys start with fy_",
    });
    if (input === undefined) return;
    const key = input.trim();

    const { result, saved } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "ForkYou: checking your API key…" },
      () => credentials.signIn(key, (k) => api.me(k)),
    );
    if (result.ok) {
      if (!saved) {
        log.info("Sign-in finished after the key was cleared or replaced; not saving it");
        return;
      }
      log.info(`Signed in as @${result.data.username}`);
      vscode.window.showInformationMessage(`ForkYou: signed in as @${result.data.username}.`);
      return;
    }
    log.warn(`API key check failed (${result.failure}): ${result.message}`);
    const choice = await vscode.window.showErrorMessage(
      keyCheckMessage(result.failure, apiUrl()),
      "Try again",
      "Create a key",
    );
    if (choice === "Try again") await configureApiKey();
    if (choice === "Create a key") await openWeb("/settings");
  }

  async function clearApiKey(): Promise<void> {
    await credentials.clear();
    log.info("API key cleared");
    vscode.window.showInformationMessage("ForkYou: API key cleared. Tracking is off.");
  }

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand("forkyou.configureApiKey", configureApiKey),
    vscode.commands.registerCommand("forkyou.clearApiKey", clearApiKey),
    vscode.commands.registerCommand("forkyou.openDashboard", () => openWeb("/dashboard")),
    vscode.commands.registerCommand("forkyou.showLog", () => log.show()),
  );

  if (await removeLegacyKey(context.globalState)) {
    log.info("Removed a ForkYou 1.x API key; 2.0 needs a new one");
    void promptForKey("ForkYou 2.0 needs a new API key. Your old key no longer works.");
  } else if (!(await credentials.get()) && !context.globalState.get(SETUP_PROMPTED)) {
    void promptForKey("ForkYou: add your API key to start tracking your coding time.");
  }

  async function promptForKey(message: string): Promise<void> {
    await context.globalState.update(SETUP_PROMPTED, true);
    const choice = await vscode.window.showInformationMessage(message, "Add key", "Create a key");
    if (choice === "Add key") await configureApiKey();
    if (choice === "Create a key") await openWeb("/settings");
  }
}

export function deactivate(): void {}
