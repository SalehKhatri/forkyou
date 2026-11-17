/** Where ForkYou 1.x kept its API key: plain `globalState`, not secret storage. */
export const LEGACY_KEY = "forkyou.apiKey";

/** The subset of `vscode.Memento` this module uses. */
export interface StateStore {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
 * Deletes a 1.x API key left in `globalState`. 1.x keys no longer exist on the server, so the key
 * is never sent anywhere. Returns true if one was found, so the caller can ask for a new key.
 */
export async function removeLegacyKey(state: StateStore): Promise<boolean> {
  if (state.get(LEGACY_KEY) === undefined) return false;
  await state.update(LEGACY_KEY, undefined);
  return true;
}
