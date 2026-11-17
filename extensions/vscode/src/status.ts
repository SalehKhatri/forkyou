import * as vscode from "vscode";
import { formatDuration } from "./format.js";
import type { StopReason } from "./sync.js";

export type StatusState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "today"; seconds: number }
  | { kind: "stopped"; reason: StopReason };

/** The ForkYou item in the status bar: today's coding time, or what needs the user's attention. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor(private readonly extensionId: string) {
    this.item.name = "ForkYou";
    this.item.show();
  }

  show(state: StatusState): void {
    switch (state.kind) {
      case "loading":
        this.item.text = "$(clock) ForkYou";
        this.item.tooltip = "ForkYou: loading today's coding time";
        this.item.command = "forkyou.openDashboard";
        this.item.backgroundColor = undefined;
        break;
      case "signedOut":
        this.item.text = "$(key) ForkYou";
        this.item.tooltip = "ForkYou: add your API key to start tracking";
        this.item.command = "forkyou.configureApiKey";
        this.item.backgroundColor = undefined;
        break;
      case "today":
        this.item.text = `$(clock) ${formatDuration(state.seconds)}`;
        this.item.tooltip =
          "ForkYou: your coding time today (updates after each upload). Click to open your dashboard.";
        this.item.command = "forkyou.openDashboard";
        this.item.backgroundColor = undefined;
        break;
      case "stopped":
        this.item.text = "$(warning) ForkYou";
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        if (state.reason === "unauthorized") {
          this.item.tooltip = "ForkYou: your API key was rejected. Click to enter a new one.";
          this.item.command = "forkyou.configureApiKey";
        } else {
          this.item.tooltip = "ForkYou: this version is no longer supported. Click to update.";
          this.item.command = {
            title: "Show extension",
            command: "extension.open",
            arguments: [this.extensionId],
          };
        }
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
