/* Firebase adapter for the sync engine (Web SDK v10, loaded on demand with dynamic import so the app
   still starts offline). Data layout, per signed-in user:
     users/{uid}/cards/{cardId}   one document per word: schedule fields plus `t` (updated time, newest wins)
     users/{uid}/days/{date}      daily counters, changed only with increment()
     users/{uid}/state/main       settings and the frozen daily plans, with `t`
   Firestore uses persistentLocalCache, so writes made offline are kept and sent later. */
(function (root) {
  'use strict';
  var VERSION = '10.12.2';
  var BASE = 'https://www.gstatic.com/firebasejs/' + VERSION + '/';
  var ACK_MS = 6000;

  function FirebaseAdapter(config) { this.config = config; this._p = null; }
  var P = FirebaseAdapter.prototype;

  P._init = function () {
    var self = this;
    if (this._p) return this._p;
    this._p = Promise.all([
      import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')
    ]).then(function (m) {
      self.m = { app: m[0], auth: m[1], fs: m[2] };
      self.app = self.m.app.initializeApp(self.config);
      self.auth = self.m.auth.getAuth(self.app);
      try {
        self.db = self.m.fs.initializeFirestore(self.app, {
          localCache: self.m.fs.persistentLocalCache({ tabManager: self.m.fs.persistentMultipleTabManager() })
        });
      } catch (e) {
        self.db = self.m.fs.getFirestore(self.app);   // e.g. private window without IndexedDB
      }
    });
    this._p.catch(function () { self._p = null; });   // allow a retry after a failed load (offline)
    return this._p;
  };

  P.isOnline = function () { return typeof navigator === 'undefined' || navigator.onLine !== false; };

  function mapUser(u) { return u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null; }

  P.onAuth = function (cb) {
    var self = this, off = null, stopped = false;
    this._init().then(function () {
      if (stopped) return;
      off = self.m.auth.onAuthStateChanged(self.auth, function (u) { cb(mapUser(u)); });
    }).catch(function () { self._pendingAuthCb = cb; cb(null); });   // SDK not reachable (offline): retry() runs this again
    return function () { stopped = true; if (off) off(); };
  };
  P.retry = function () { var cb = this._pendingAuthCb; if (cb) { this._pendingAuthCb = null; this.onAuth(cb); } };

  P.signIn = function () {
    var self = this;
    return this._init().then(function () {
      var provider = new self.m.auth.GoogleAuthProvider();
      return self.m.auth.signInWithPopup(self.auth, provider);
    }).then(function (r) { return mapUser(r.user); });
  };
  P.signOut = function () {
    var self = this;
    return this._init().then(function () { return self.m.auth.signOut(self.auth); });
  };

  /* Wait for the server, but not forever: while offline, Firestore keeps the write queued and sends it later. */
  function ack(promise) {
    return Promise.race([promise, new Promise(function (res) { setTimeout(res, ACK_MS); })]);
  }
  /* A write refused because the cloud copy is newer (see firestore.rules) is not an error. */
  function mapWriteError(err) {
    if (err && err.code === 'permission-denied') { var e = new Error('stale or not allowed'); e.stale = true; e.original = err; throw e; }
    throw err;
  }

  P.subscribe = function (uid, h) {
    var self = this, fs = null, unsubs = [], dead = false;
    this._init().then(function () {
      if (dead) return;
      fs = self.m.fs;
      var cards = fs.collection(self.db, 'users', uid, 'cards');
      var days = fs.collection(self.db, 'users', uid, 'days');
      var state = fs.doc(self.db, 'users', uid, 'state', 'main');
      var first = { c: true, d: true, s: true };
      function err(e) { if (h.onError) h.onError(e); }
      unsubs.push(fs.onSnapshot(cards, function (snap) {
        if (first.c) { first.c = false; h.onCards(snap.docs.map(function (d) { return { id: d.id, doc: d.data() }; }), true); }
        else h.onCards(snap.docChanges().map(function (c) { return { id: c.doc.id, doc: c.type === 'removed' ? null : c.doc.data() }; }), false);
      }, err));
      unsubs.push(fs.onSnapshot(days, function (snap) {
        if (first.d) { first.d = false; h.onDays(snap.docs.map(function (d) { return { id: d.id, doc: d.data() }; }), true); }
        else h.onDays(snap.docChanges().map(function (c) { return { id: c.doc.id, doc: c.type === 'removed' ? null : c.doc.data() }; }), false);
      }, err));
      unsubs.push(fs.onSnapshot(state, function (snap) {
        var initial = first.s; first.s = false;
        h.onState(snap.exists() ? snap.data() : null, initial);
      }, err));
    }).catch(function (e) { if (h.onError) h.onError(e); });
    return function () { dead = true; unsubs.forEach(function (u) { try { u(); } catch (e) { /* ignore */ } }); };
  };

  P.setCard = function (uid, id, doc) {
    var fs = this.m.fs;
    return ack(fs.setDoc(fs.doc(this.db, 'users', uid, 'cards', String(id)), doc)).catch(mapWriteError);
  };
  P.setState = function (uid, doc) {
    var fs = this.m.fs;
    return ack(fs.setDoc(fs.doc(this.db, 'users', uid, 'state', 'main'), doc)).catch(mapWriteError);
  };
  P.incrementDay = function (uid, date, field, n) {
    var fs = this.m.fs, data = {};
    data[field] = fs.increment(n);
    return ack(fs.setDoc(fs.doc(this.db, 'users', uid, 'days', date), data, { merge: true }));
  };
  P.resetAll = function (uid) {
    var self = this, fs = this.m.fs;
    function wipe(col) {
      return fs.getDocs(fs.collection(self.db, 'users', uid, col)).then(function (snap) {
        var docs = snap.docs, jobs = [];
        for (var i = 0; i < docs.length; i += 400) {
          var b = fs.writeBatch(self.db);
          docs.slice(i, i + 400).forEach(function (d) { b.delete(d.ref); });
          jobs.push(b.commit());
        }
        return Promise.all(jobs);
      });
    }
    return Promise.all([wipe('cards'), wipe('days'), wipe('state')]);
  };

  root.Lexora = root.Lexora || {};
  root.Lexora.FirebaseAdapter = FirebaseAdapter;
})(typeof self !== 'undefined' ? self : this);
