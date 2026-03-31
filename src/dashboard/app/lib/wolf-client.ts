type MessageHandler = (msg: any) => void;
type StatusHandler = (connected: boolean) => void;

export class WolfClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private reconnectTimer: number | null = null;
  private url: string;

  constructor(url?: string) {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.url = url || `${wsProtocol}//${location.host}/ws`;
  }

  connect(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        for (const h of this.statusHandlers) h(true);
      };
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          for (const handler of this.handlers) handler(msg);
        } catch { /* ignore parse errors */ }
      };
      this.ws.onclose = () => {
        for (const h of this.statusHandlers) h(false);
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

  onStatusChange(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
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
