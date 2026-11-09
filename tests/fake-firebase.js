/* In-memory stand-in for Firebase, used by the sync tests. One FakeServer is shared by several FakeAdapter "devices". */
function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

class FakeServer {
  constructor() { this.users = {}; this.subs = []; this.writes = 0; }
  u(uid) { return this.users[uid] || (this.users[uid] = { cards: {}, state: null, days: {} }); }
  notify(uid, kind, payload) {
    this.subs.filter(s => s.uid === uid && s.adapter.online).forEach(s => {
      if (kind === 'cards') s.h.onCards(clone(payload), false);
      if (kind === 'state') s.h.onState(clone(payload), false);
      if (kind === 'days') s.h.onDays(clone(payload), false);
    });
  }
}

class FakeAdapter {
  constructor(server) { this.server = server; this.online = true; this.user = null; this.cbs = []; }
  isOnline() { return this.online; }
  onAuth(cb) { this.cbs.push(cb); return () => {}; }
  async signIn(user) { this.user = user; for (const cb of this.cbs) await cb(user); return user; }
  async signOut() { this.user = null; for (const cb of this.cbs) await cb(null); }
  subscribe(uid, h) {
    const sub = { uid, h, adapter: this };
    this.server.subs.push(sub);
    const send = () => {
      const u = this.server.u(uid);
      h.onCards(Object.keys(u.cards).map(id => ({ id, doc: clone(u.cards[id]) })), true);
      h.onState(clone(u.state), true);
      h.onDays(Object.keys(u.days).map(id => ({ id, doc: clone(u.days[id]) })), true);
    };
    if (this.online) Promise.resolve().then(send);
    else sub.pendingInit = send;
    return () => { this.server.subs = this.server.subs.filter(s => s !== sub); };
  }
  goOnline() {
    this.online = true;
    this.server.subs.filter(s => s.adapter === this && s.pendingInit).forEach(s => { s.pendingInit(); s.pendingInit = null; });
    // catch-up: the listener of a reconnecting client receives what changed while it was away
    this.server.subs.filter(s => s.adapter === this && !s.pendingInit).forEach(s => {
      const u = this.server.u(s.uid);
      s.h.onCards(Object.keys(u.cards).map(id => ({ id, doc: clone(u.cards[id]) })), false);
      if (u.state) s.h.onState(clone(u.state), false);
      s.h.onDays(Object.keys(u.days).map(id => ({ id, doc: clone(u.days[id]) })), false);
    });
  }
  _need() { if (!this.online) throw new Error('offline'); }
  _stale(uid, kind, id, have) {
    // like the Firestore rule: a write whose `t` is older than the stored one is refused, and this device is told the winner
    this.server.subs.filter(s => s.adapter === this && s.uid === uid).forEach(s => {
      if (kind === 'cards') s.h.onCards([{ id, doc: clone(have) }], false); else s.h.onState(clone(have), false);
    });
    const e = new Error('stale write'); e.stale = true; throw e;
  }
  async setCard(uid, id, doc) {
    this._need();
    const have = this.server.u(uid).cards[id];
    if (have && (have.t || 0) > (doc.t || 0)) this._stale(uid, 'cards', id, have);
    this.server.u(uid).cards[id] = clone(doc); this.server.writes++; this.server.notify(uid, 'cards', [{ id, doc }]);
  }
  async setState(uid, doc) {
    this._need();
    const have = this.server.u(uid).state;
    if (have && (have.t || 0) > (doc.t || 0)) this._stale(uid, 'state', null, have);
    this.server.u(uid).state = clone(doc); this.server.writes++; this.server.notify(uid, 'state', doc);
  }
  async incrementDay(uid, date, field, n) {
    this._need();
    const d = this.server.u(uid).days[date] || (this.server.u(uid).days[date] = {});
    d[field] = (d[field] || 0) + n; this.server.writes++;
    this.server.notify(uid, 'days', [{ id: date, doc: d }]);
  }
  async resetAll(uid) { this._need(); this.server.users[uid] = { cards: {}, state: null, days: {} }; }
}

module.exports = { FakeServer, FakeAdapter };
