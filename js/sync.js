/* Lexora sync engine. Talks to the cloud only through an adapter, so the same code runs against Firebase
   in the app and against a fake server in the tests.

   Adapter interface (all methods may return promises):
     onAuth(cb)                       cb({uid,name,email,photo} | null); returns an unsubscribe function
     signIn() / signOut()
     subscribe(uid, handlers)         handlers.onCards(changes, initial), onState(doc, initial), onDays(changes, initial)
                                      changes: [{id, doc|null}] (days use {id: date}); returns an unsubscribe function
     setCard(uid, id, doc)            write one card document
     setState(uid, doc)               write the settings and plan document
     incrementDay(uid, date, field, n) add n to a daily counter (atomic increment)
     resetAll(uid)                    delete all of this user's documents
     isOnline()                       optional

   Rules the engine follows:
     - every card is its own document and carries an updated time `t`; the newest `t` wins
     - daily counters are sent as increments, so two devices add up instead of overwriting
     - progress from a device that was never signed in is merged into the account on first login
     - progress that belongs to another account is never merged: it is replaced by the signed-in account's data
     - changes made offline stay marked as dirty (and counter increments stay pending) until they can be sent */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Lexora = root.Lexora || {}; root.Lexora.sync = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function SyncEngine(store, adapter, opts) {
    opts = opts || {};
    this.store = store;
    this.adapter = adapter;
    this.debounce = opts.debounce != null ? opts.debounce : 800;
    this.initialTimeout = opts.initialTimeout != null ? opts.initialTimeout : 8000;
    this.retryMs = opts.retryMs != null ? opts.retryMs : 5000;
    this.setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    this.clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
    this.user = null;
    this.status = 'signed-out';       // signed-out | syncing | synced | offline | error
    this.attached = false;
    this.remote = { cards: null, state: undefined, days: null };
    this.statusListeners = [];
    this.flushing = false;
    this.again = false;
    this.timer = null;
    this.unsub = null;
    this.lastResult = null;
    var self = this;
    store.on(function (what) {
      if (self.attached && (what === 'card' || what === 'day' || what === 'settings')) self.schedule();
    });
  }
  var P = SyncEngine.prototype;

  P.onStatus = function (fn) { this.statusListeners.push(fn); };
  P._set = function (s) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach(function (fn) { try { fn(s); } catch (e) { /* ignore */ } });
  };
  P.online = function () { return typeof this.adapter.isOnline === 'function' ? this.adapter.isOnline() : true; };

  /* Start listening to sign-in changes. */
  P.init = function () {
    var self = this;
    return this.adapter.onAuth(function (user) { return user ? self.attach(user) : self.detach(); });
  };

  P.attach = function (user) {
    var self = this;
    if (this.user && this.user.uid === user.uid && this.unsub) return Promise.resolve(this.lastResult);
    this.detach(true);
    this.user = user;
    this.remote = { cards: null, state: undefined, days: null };
    this.reconciled = false;
    this._set('syncing');
    var ready;
    var done = new Promise(function (res) { ready = res; });
    this._ready = ready;
    var handlers = {
      onCards: function (changes, initial) { self._cards(changes, initial); },
      onState: function (doc, initial) { self._state(doc, initial); },
      onDays: function (changes, initial) { self._days(changes, initial); },
      onError: function () { self._set(self.online() ? 'error' : 'offline'); }
    };
    this.unsub = this.adapter.subscribe(user.uid, handlers);
    var timeout = new Promise(function (res) {
      self.setTimer(function () { if (!self.reconciled) { self._set('offline'); } res(null); }, self.initialTimeout);
    });
    return Promise.race([done, timeout]);
  };

  P.detach = function (keepStatus) {
    if (this.unsub) { try { this.unsub(); } catch (e) { /* ignore */ } }
    this.unsub = null; this.attached = false; this.user = null; this.reconciled = false;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    if (!keepStatus) this._set('signed-out');
  };

  /* ---------- remote events ---------- */
  P._cards = function (changes, initial) {
    var self = this;
    if (!this.reconciled) {
      if (!this.remote.cards) this.remote.cards = {};
      changes.forEach(function (c) { if (c.doc) self.remote.cards[c.id] = c.doc; else delete self.remote.cards[c.id]; });
      if (initial || this.remote.cards) this._cardsInit = true;
      return this._maybeReconcile();
    }
    var changed = false;
    changes.forEach(function (c) { if (c.doc && self.store.mergeRemoteCard(c.id, c.doc)) changed = true; });
    if (changed) { this.store.save(); this.store.emit('remote'); }
  };
  P._state = function (doc, initial) {
    if (!this.reconciled) { this.remote.state = doc || null; this._stateInit = true; return this._maybeReconcile(); }
    if (this.store.mergeRemoteState(doc)) { this.store.save(); this.store.emit('remote'); }
  };
  P._days = function (changes, initial) {
    var self = this;
    if (!this.remote.days) this.remote.days = {};
    changes.forEach(function (c) { if (c.doc) self.remote.days[c.id] = c.doc; else delete self.remote.days[c.id]; });
    if (!this.reconciled) { this._daysInit = true; return this._maybeReconcile(); }
    changes.forEach(function (c) { self._recomputeDay(c.id); });
    this.store.save(); this.store.emit('remote');
  };
  P._maybeReconcile = function () {
    if (this.reconciled || !this._cardsInit || !this._stateInit || !this._daysInit) return;
    this._reconcile();
  };

  /* ---------- first contact with an account ---------- */
  P._reconcile = function () {
    var st = this.store, uid = this.user.uid, result = { replaced: false, merged: false, pushed: 0, pulled: 0 };
    this.reconciled = true;
    this._cardsInit = this._stateInit = this._daysInit = false;
    var s = st.s;
    if (s.owner && s.owner !== uid) {
      // progress on this device belongs to another account: do not merge it, load this account's data instead
      st.wipeProgress();
      s = st.s;
      result.replaced = true;
    } else if (!s.owner) {
      result.merged = Object.keys(s.cards).length > 0;
    }
    st.setOwner(uid);
    var rc = this.remote.cards || {}, ids = {};
    Object.keys(rc).forEach(function (k) { ids[k] = 1; });
    Object.keys(s.cards).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (k) {
      var l = s.cards[k], r = rc[k];
      if (r && (!l || (r.t || 0) > (l.t || 0))) { if (st.mergeRemoteCard(k, r)) result.pulled++; }
      else if (l && (!r || (l.t || 0) > (r.t || 0))) { s.dirtyCards[k] = 1; result.pushed++; }
    });
    var rs = this.remote.state;
    if (rs && (rs.t || 0) > (s.stateT || 0)) st.mergeRemoteState(rs);
    else if ((s.stateT || 0) > 0 && (!rs || s.stateT > (rs.t || 0))) s.dirtyState = true;
    var self = this;
    Object.keys(this.remote.days || {}).concat(Object.keys(s.pending)).forEach(function (d) { self._recomputeDay(d); });
    st.save();
    this.attached = true;
    this.lastResult = result;
    this._set(this.online() ? 'syncing' : 'offline');
    st.emit('remote');
    if (this._ready) this._ready(result);
    this.flush();
  };

  P._recomputeDay = function (date) {
    var r = (this.remote.days && this.remote.days[date]) || {}, p = this.store.s.pending[date] || {};
    var d = this.store.s.days[date] || (this.store.s.days[date] = { newDone: 0, reviewed: 0 });
    d.newDone = (r.newDone || 0) + (p.newDone || 0);
    d.reviewed = (r.reviewed || 0) + (p.reviewed || 0);
  };

  /* ---------- sending ---------- */
  P.schedule = function () {
    var self = this;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(function () { self.timer = null; self.flush(); }, this.debounce);
  };

  /* The cloud refuses a write that is older than what it holds (see firestore.rules). That is not an error:
     the newer version arrives through the listener and wins. */
  function staleOk(err) { if (err && err.stale) return; throw err; }

  P.flush = function () {
    var self = this;
    if (!this.attached || !this.user) return Promise.resolve();
    if (!this.online()) { this._set('offline'); return Promise.resolve(); }
    if (this.flushing) { this.again = true; return Promise.resolve(); }
    this.flushing = true;
    var uid = this.user.uid, st = this.store, s = st.s;
    this._set('syncing');
    var job = Promise.resolve();
    Object.keys(s.dirtyCards).forEach(function (id) {
      job = job.then(function () {
        var c = s.cards[id];
        if (!c) { delete s.dirtyCards[id]; return; }
        var t = c.t;
        return Promise.resolve(self.adapter.setCard(uid, id, c)).catch(staleOk).then(function () {
          if (s.cards[id] && s.cards[id].t === t) delete s.dirtyCards[id];
        });
      });
    });
    job = job.then(function () {
      if (!s.dirtyState) return;
      var doc = st.stateDoc(), t = doc.t;
      return Promise.resolve(self.adapter.setState(uid, doc)).catch(staleOk).then(function () { if (s.stateT === t) s.dirtyState = false; });
    });
    Object.keys(s.pending).forEach(function (date) {
      Object.keys(s.pending[date]).forEach(function (field) {
        job = job.then(function () {
          var n = s.pending[date] && s.pending[date][field];
          if (!n) return;
          // take the increment out of "pending" before sending, so a snapshot that already includes it is not counted twice
          s.pending[date][field] -= n;
          if (!s.pending[date][field]) delete s.pending[date][field];
          if (!Object.keys(s.pending[date]).length) delete s.pending[date];
          return Promise.resolve(self.adapter.incrementDay(uid, date, field, n)).catch(function (err) {
            var p = s.pending[date] || (s.pending[date] = {});
            p[field] = (p[field] || 0) + n;
            throw err;
          });
        });
      });
    });
    return job.then(function () {
      st.save();
      self.flushing = false;
      self._set('synced');
      if (self.again || Object.keys(s.dirtyCards).length || s.dirtyState) {
        self.again = false;
        if (self.attached) self.schedule();
      }
    }, function (err) {
      self.flushing = false; self.lastError = err;
      self._set(self.online() ? 'error' : 'offline');
      if (self.attached && self.online()) { self.timer = self.setTimer(function () { self.timer = null; self.flush(); }, self.retryMs); }
    });
  };

  P.goOnline = function () { return this.flush(); };

  P.resetCloud = function () {
    if (!this.user) return Promise.resolve();
    this.remote.cards = {}; this.remote.days = {};
    return Promise.resolve(this.adapter.resetAll(this.user.uid));
  };

  return { SyncEngine: SyncEngine };
});
