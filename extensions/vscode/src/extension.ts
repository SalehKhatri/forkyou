import { randomUUID } from "node:crypto";
import { ingestResultSchema, statsResponseSchema } from "@forkyou/shared";
import * as vscode from "vscode";
import { ApiClient } from "./api.js";
import { isApiKeyFormat, resolveApiUrl, webUrl } from "./config.js";
import { Credentials, keyCheckMessage } from "./credentials.js";
import { type ActivitySink, watchEditor } from "./editor.js";
import { removeLegacyKey } from "./legacy.js";
import { Presence } from "./presence.js";
import { SessionQueue } from "./queue.js";
import { StatusBar } from "./status.js";
import { Syncer } from "./sync.js";
import { SessionTracker } from "./tracker.js";

/** Set once we've suggested adding a key, so a fresh install doesn't nag on every start. */
const SETUP_PROMPTED = "forkyou.setupPrompted";
const SYNC_INTERVAL_MS = 60_000;
/** Today's time also refreshes after every upload; this catches midnight and other windows. */
const STATUS_INTERVAL_MS = 15 * 60_000;

/** Set by activate(): closes the open session and makes a last upload attempt. */
let shutdown: (() => Promise<void>) | undefined;

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
    // Close the open session, go offline and upload what's queued while the key still works.
    stopTracking();
    await presence.inactive();
    await queue.flushed();
    await syncer.flush();
    await credentials.clear();
    log.info("API key cleared");
    vscode.window.showInformationMessage("ForkYou: API key cleared. Tracking is off.");
  }

  const queue = new SessionQueue(context.globalStorageUri.fsPath, randomUUID(), Date.now);
  const tracker = new SessionTracker({
    now: Date.now,
    newId: randomUUID,
    onSession: (s) => {
      log.info(`Session closed: ${s.durationSeconds}s of ${s.language}`);
      queue.add(s).catch((error) => log.error(`Couldn't save a session: ${error}`));
    },
  });
  const syncer = new Syncer({
    queue,
    upload: (key, sessions) =>
      api.request("POST", "/v1/sessions", key, { sessions }, ingestResultSchema),
    getKey: () => credentials.get(),
    now: Date.now,
    log,
    onStopped: (reason) => void uploadsStopped(reason),
    onUploaded: () => void refreshStatus(),
  });
  const presence = new Presence({
    send: (key, body) => api.request("POST", "/v1/presence", key, body, null),
    getKey: () => credentials.get(),
    now: Date.now,
  });
  /** Every editor event goes to both the session tracker and presence. */
  const activity: ActivitySink = {
    activity: (workContext, lines) => {
      tracker.activity(workContext, lines);
      presence.active(workContext.language);
    },
    keepAlive: () => {
      tracker.keepAlive();
      presence.active();
    },
    end: () => {
      tracker.end();
      void presence.inactive();
    },
    tick: () => {
      tracker.tick();
      presence.tick();
    },
  };

  const status = new StatusBar(context.extension.id);
  status.show({ kind: "loading" });
  async function refreshStatus(): Promise<void> {
    const key = await credentials.get();
    if (!key) return status.show({ kind: "signedOut" });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await api.request(
      "GET",
      `/v1/me/stats?range=7d&tz=${encodeURIComponent(tz)}`,
      key,
      undefined,
      statsResponseSchema,
    );
    if (result.ok) {
      status.show({ kind: "today", seconds: result.data.days.at(-1)?.seconds ?? 0 });
    } else if (result.failure === "unauthorized" || result.failure === "outdated") {
      status.show({ kind: "stopped", reason: result.failure });
    }
    // Otherwise (offline, server error) keep showing the last value.
  }

  async function uploadsStopped(reason: "unauthorized" | "outdated"): Promise<void> {
    status.show({ kind: "stopped", reason });
    if (reason === "unauthorized") {
      const choice = await vscode.window.showWarningMessage(
        "ForkYou: your API key was rejected, so uploads are paused. Your time is still recorded.",
        "Enter new key",
      );
      if (choice === "Enter new key") await configureApiKey();
    } else {
      const choice = await vscode.window.showWarningMessage(
        "ForkYou: this version of the extension is no longer supported. Update it to keep uploading your time.",
        "Show extension",
      );
      if (choice === "Show extension") {
        await vscode.commands.executeCommand("extension.open", context.extension.id);
      }
    }
  }

  // Track only while signed in. Secrets are shared by all windows, so signing out anywhere stops
  // tracking everywhere.
  let watcher: vscode.Disposable | undefined;
  function stopTracking(): void {
    watcher?.dispose();
    watcher = undefined;
  }
  async function updateTracking(): Promise<void> {
    const signedIn = Boolean(await credentials.get());
    if (signedIn && !watcher) {
      watcher = watchEditor(activity);
      log.info("Tracking on");
    } else if (!signedIn) {
      if (watcher) log.info("Tracking off");
      stopTracking();
      // Signed out, maybe to switch accounts: the next key mustn't upload this account's time.
      await queue.flushed();
      if (queue.size > 0) log.info(`Discarded ${queue.size} sessions that weren't uploaded`);
      await queue.clear();
    }
  }

  const syncTimer = setInterval(() => void syncer.tick(), SYNC_INTERVAL_MS);
  const statusTimer = setInterval(() => void refreshStatus(), STATUS_INTERVAL_MS);
  shutdown = async () => {
    stopTracking();
    await Promise.all([presence.inactive(), queue.flushed().then(() => syncer.flush())]);
  };

  context.subscriptions.push(
    log,
    context.secrets.onDidChange(async () => {
      await updateTracking();
      syncer.resume();
      void syncer.tick();
      void refreshStatus();
    }),
    status,
    {
      dispose: () => {
        clearInterval(syncTimer);
        clearInterval(statusTimer);
        stopTracking();
      },
    },
    vscode.commands.registerCommand("forkyou.configureApiKey", configureApiKey),
    vscode.commands.registerCommand("forkyou.clearApiKey", clearApiKey),
    vscode.commands.registerCommand("forkyou.openDashboard", () => openWeb("/dashboard")),
    vscode.commands.registerCommand("forkyou.showLog", () => log.show()),
  );

  await queue.refresh().catch((error) => log.error(`Couldn't read queued sessions: ${error}`));
  await updateTracking();
  void syncer.tick();
  void refreshStatus();

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

export async function deactivate(): Promise<void> {
  await shutdown?.();
}
