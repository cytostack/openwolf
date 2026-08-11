type MessageHandler = (msg: any) => void;

export function getDashboardToken(): string {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem("openwolf-dashboard-token", token);
    params.delete("token");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    return token;
  }
  return sessionStorage.getItem("openwolf-dashboard-token") || "";
}

export function dashboardFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${getDashboardToken()}` },
  });
}

export class WolfClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: number | null = null;
  private url: string;

  constructor(url?: string) {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const token = encodeURIComponent(getDashboardToken());
    this.url = url || `${wsProtocol}//${location.host}/ws?token=${token}`;
  }

  connect(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          for (const handler of this.handlers) handler(msg);
        } catch { /* ignore parse errors */ }
      };
      this.ws.onclose = () => {
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
