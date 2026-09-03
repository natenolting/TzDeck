interface WalletInitializationOptions<T> {
  initialize: () => Promise<T>;
  isMounted: () => boolean;
  onReady: (value: T) => void;
  onError: (error: unknown) => void;
}

export async function runWalletInitialization<T>({
  initialize,
  isMounted,
  onReady,
  onError,
}: WalletInitializationOptions<T>): Promise<void> {
  try {
    const value = await initialize();
    if (isMounted()) onReady(value);
  } catch (error) {
    if (isMounted()) onError(error);
  }
}
