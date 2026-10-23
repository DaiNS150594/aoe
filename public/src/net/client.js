// WebSocket client for the lobby and the lockstep relay.
export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = 0;
    this.connected = false;
    this.key = localStorage.getItem('deche_key') || Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('deche_key', this.key); } catch { /* private mode */ }
  }
  on(type, fn) { this.handlers.set(type, fn); }
  off(type) { this.handlers.delete(type); }
  connect(name, url) {
    return new Promise((resolve, reject) => {
      const u = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws;
      try { ws = new WebSocket(u); } catch (e) { reject(e); return; }
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('Hết thời gian kết nối')); try { ws.close(); } catch { /* ignore */ } }, 6000);
      ws.onopen = () => { this.connected = true; this.send({ t: 'hello', name, key: this.key }); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.id = m.id; clearTimeout(timer); resolve(this); }
        const h = this.handlers.get(m.t);
        if (h) h(m);
        const any = this.handlers.get('*');
        if (any) any(m);
      };
      ws.onclose = () => {
        this.connected = false;
        clearTimeout(timer);
        const h = this.handlers.get('close');
        if (h) h();
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Không kết nối được tới máy chủ')); };
    });
  }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { try { this.ws && this.ws.close(); } catch { /* ignore */ } }
}
