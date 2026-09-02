import { useEffect } from "react";
import type { WolfClient, WolfMessage } from "../lib/wolf-client.js";

export function useLiveUpdates(
  client: WolfClient | null,
  type: string,
  callback: (msg: WolfMessage) => void
): void {
  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type === type) callback(msg);
    });
  }, [client, type, callback]);
}
