(() => {
  // Android does not offer frame navigations to the navigation check, so a frame from another site is stopped here.
  if (window !== top) {
    try {
      void top.location.href;
    } catch {
      if (location.protocol !== 'about:') {
        window.stop();
        location.replace('about:blank');
      }
      return;
    }
  }
  const S = window.AgentViewShell;
  if (!S || window.__agentview) return;
  const handlers = {};
  const on = (type, f) => (handlers[type] = handlers[type] || []).push(f);
  window.__agentview = { emit: (type, data) => (handlers[type] || []).forEach((f) => f(data)) };
  const define = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, configurable: true, writable: true });
    } catch {}
  };
  const fire = (target, type, props) => {
    const e = Object.assign(new Event(type), props);
    target.dispatchEvent(e);
    if (typeof target['on' + type] === 'function') target['on' + type].call(target, e);
  };

  const save = (a) =>
    fetch(a.href)
      .then((r) => r.blob())
      .then((b) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve([b.type, String(reader.result).split(',')[1] || '']);
        reader.onerror = reject;
        reader.readAsDataURL(b);
      }))
      .then(([type, data]) => S.save(a.download || decodeURIComponent(new URL(a.href).pathname.split('/').pop()) || 'download', type, data))
      .catch(() => S.open(a.href));

  const handle = (a) => {
    if (!a.href) return false;
    const u = new URL(a.href);
    if (a.hasAttribute('download')) {
      save(a);
      return true;
    }
    // A same-tab link is a navigation, which the app allows or opens in the browser.
    if (a.target !== '_blank') return false;
    const web = u.protocol === 'http:' || u.protocol === 'https:';
    if (!web && !/^(mailto|tel|sms|geo|intent|market):$/.test(u.protocol)) return false;
    S.open(u.href);
    return true;
  };
  // Captured, so a stopPropagation in the page cannot hide the click; checked after the page has handled it.
  window.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(a instanceof HTMLAnchorElement) || e.button !== 0) return;
    if (a.hasAttribute('download')) {
      e.preventDefault();
      return save(a);
    }
    setTimeout(() => { if (!e.defaultPrevented) handle(a); });
  }, true);
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.isConnected || !handle(this)) anchorClick.call(this);
  };
  const windowOpen = window.open;
  window.open = function (url, ...rest) {
    if (!url) return windowOpen.call(window, url, ...rest);
    S.open(String(new URL(url, location.href)));
    return null;
  };

  if (!navigator.clipboard) {
    define(navigator, 'clipboard', {
      writeText: (text) => (S.copy(String(text)), Promise.resolve()),
      readText: () => Promise.resolve(S.paste()),
    });
  }
  if (!navigator.share) {
    define(navigator, 'share', (d = {}) => (S.share(d.title || '', d.text || '', d.url || ''), Promise.resolve()));
    define(navigator, 'canShare', (d = {}) => !(d.files && d.files.length));
  }

  let locks = 0;
  define(navigator, 'wakeLock', {
    request: () => {
      locks++;
      S.keepAwake(true);
      const lock = Object.assign(new EventTarget(), { type: 'screen', released: false, onrelease: null });
      lock.release = () => {
        if (!lock.released) {
          lock.released = true;
          if (--locks === 0) S.keepAwake(false);
          fire(lock, 'release');
        }
        return Promise.resolve();
      };
      return Promise.resolve(lock);
    },
  });

  const notifications = new Map();
  const permissionWaiters = [];
  let seq = (Date.now() % 1000000) * 1000;
  class ShellNotification extends EventTarget {
    constructor(title, options = {}) {
      super();
      Object.assign(this, { title: String(title), body: options.body || '', tag: options.tag || '', data: options.data, icon: options.icon || '' });
      this.onclick = this.onclose = this.onshow = this.onerror = null;
      this._id = ++seq;
      notifications.set(this._id, this);
      S.notify(this._id, this.title, String(this.body), String(this.tag));
      setTimeout(() => fire(this, 'show'));
    }
    close() {
      if (!notifications.delete(this._id)) return;
      S.closeNotification(this._id, String(this.tag));
      fire(this, 'close');
    }
    static get permission() {
      return S.notificationPermission();
    }
    static requestPermission() {
      return new Promise((resolve) => {
        permissionWaiters.push(resolve);
        S.requestNotifications();
      });
    }
  }
  on('notify-permission', (d) => permissionWaiters.splice(0).forEach((f) => f(d.state)));
  on('notification-click', (d) => {
    const n = notifications.get(d.id);
    if (!n) return;
    notifications.delete(d.id);
    fire(n, 'click');
  });
  define(window, 'Notification', ShellNotification);

  let recognition = null;
  class ShellRecognition extends EventTarget {
    constructor() {
      super();
      Object.assign(this, { lang: '', continuous: false, interimResults: false, maxAlternatives: 1 });
      this.onresult = this.onerror = this.onend = this.onstart = this.onaudiostart = this.onspeechstart = this.onnomatch = null;
      this._results = [];
      this._stopped = true;
    }
    start() {
      if (recognition && recognition !== this) recognition.abort();
      recognition = this;
      this._stopped = false;
      this._started = false;
      this._idle = 0;
      this._results = [];
      this._listen();
    }
    stop() {
      this._stopped = true;
      S.stopListening();
    }
    abort() {
      this._stopped = true;
      S.abortListening();
    }
    _listen() {
      S.listen(this.lang || navigator.language || '', !!this.interimResults);
    }
  }
  on('speech-start', () => {
    const r = recognition;
    if (!r || r._started) return;
    r._started = true;
    fire(r, 'start');
  });
  on('speech', (d) => {
    const r = recognition;
    if (!r) return;
    const list = r._results;
    const last = list[list.length - 1];
    const index = last && !last.isFinal ? list.length - 1 : list.length;
    list[index] = Object.assign([{ transcript: (index ? ' ' : '') + d.text, confidence: 1 }], { isFinal: !!d.final });
    r._idle = 0;
    fire(r, 'result', { results: list.slice(), resultIndex: index });
  });
  on('speech-end', (d) => {
    const r = recognition;
    if (!r) return;
    const list = r._results;
    const last = list[list.length - 1];
    if (last && !last.isFinal) {
      last.isFinal = true;
      fire(r, 'result', { results: list.slice(), resultIndex: list.length - 1 });
    }
    const quiet = d.error === 'no-speech' && ++r._idle < 3;
    if (r.continuous && !r._stopped && (!d.error || quiet)) return r._listen();
    recognition = null;
    r._stopped = true;
    if (d.error) fire(r, 'error', { error: d.error, message: d.error });
    fire(r, 'end');
  });
  define(window, 'SpeechRecognition', ShellRecognition);
  define(window, 'webkitSpeechRecognition', ShellRecognition);

  const utterances = new Map();
  let utteranceSeq = 0;
  class ShellUtterance extends EventTarget {
    constructor(text = '') {
      super();
      Object.assign(this, { text: String(text), lang: '', rate: 1, pitch: 1, volume: 1, voice: null });
      this.onstart = this.onend = this.onerror = this.onpause = this.onresume = this.onboundary = this.onmark = null;
    }
  }
  const synth = Object.assign(new EventTarget(), { pending: false, speaking: false, paused: false, onvoiceschanged: null });
  const settle = () => {
    synth.speaking = synth.pending = utterances.size > 0;
  };
  synth.speak = (u) => {
    const id = String(++utteranceSeq);
    utterances.set(id, u);
    settle();
    S.speak(id, String(u.text), u.lang || navigator.language || '', Number(u.rate) || 1, Number(u.pitch) || 1);
  };
  const flush = (error) => {
    const all = [...utterances.values()];
    utterances.clear();
    settle();
    all.forEach((u) => fire(u, 'error', { error }));
  };
  synth.cancel = () => {
    S.cancelSpeech();
    flush('canceled');
  };
  synth.pause = () => {};
  synth.resume = () => {};
  synth.getVoices = () => [];
  on('tts', (d) => {
    const u = utterances.get(d.id);
    if (!u) return;
    if (d.type === 'start') return fire(u, 'start');
    utterances.delete(d.id);
    settle();
    fire(u, d.type === 'error' ? 'error' : 'end', d.type === 'error' ? { error: 'synthesis-failed' } : {});
  });
  on('tts-unavailable', () => flush('synthesis-unavailable'));
  define(window, 'speechSynthesis', synth);
  define(window, 'SpeechSynthesisUtterance', ShellUtterance);
})();
