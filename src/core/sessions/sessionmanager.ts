export default class SessionManager {
  private static KEY = 'rrweb_session';
  private static MAX_DURATION_MS = 30 * 60 * 1000; // 30 min

  static getSession() {
    const raw = sessionStorage.getItem(this.KEY);

    if (!raw) {
      return this.createSession();
    }

    const session = JSON.parse(raw);

    const expired =
      Date.now() - session.startedAt > this.MAX_DURATION_MS;

    if (expired) {
      return this.createSession(true);
    }

    return session;
  }

  static getSessionId(): string {
    return this.getSession().id;
  }

  static isExpired(): boolean {
    const raw = sessionStorage.getItem(this.KEY);
    if (!raw) return false;

    const { startedAt } = JSON.parse(raw);
    return Date.now() - startedAt > this.MAX_DURATION_MS;
  }

  static createSession(expired = false) {
    const session = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      expiredFromPrevious: expired,
    };

    sessionStorage.setItem(this.KEY, JSON.stringify(session));
    return session;
  }

  static reset() {
    sessionStorage.removeItem(this.KEY);
  }
}
