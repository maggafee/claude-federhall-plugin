/*
 * Federhall – browser version of the DUBASCO Spring Reverb Unit.
 *
 * Draws the original panel (knobs, VU meters, lamps, lever switches and the
 * animated spring tank) on a canvas, runs the reverb in an AudioWorklet and
 * adds the player bar: track dropdown, transport, heart likes, A/B and
 * recording. One script serves every [federhall] instance on a page.
 */
(function () {
	'use strict';

	// ------------------------------------------------------------ layout
	// All coordinates in the native pixel space of the artwork (1448 x 1086).
	var W = 1448, H = 1086;
	var KNOBS = [
		{ id: 'input',    capX: 141.0,  capY: 749.5, capR: 44.0, skirtX: 149.0,  skirtY: 746.0, small: false, min: -60, max: 12, centre: -6, def: 0, fmt: 'db', label: 'Input' },
		{ id: 'predelay', capX: 324.5,  capY: 750.5, capR: 30.5, skirtX: 330.0,  skirtY: 748.1, small: true,  min: 0, max: 500, centre: 120, def: 20, fmt: 'ms', label: 'Pre-Delay' },
		{ id: 'reverb',   capX: 511.0,  capY: 749.5, capR: 44.0, skirtX: 519.0,  skirtY: 746.0, small: false, min: 0, max: 1, def: 0.5, fmt: 'pct', label: 'Reverb' },
		{ id: 'dwell',    capX: 715.5,  capY: 750.0, capR: 43.5, skirtX: 723.4,  skirtY: 746.5, small: false, min: 0, max: 1, def: 0.45, fmt: 'pct', label: 'Dwell' },
		{ id: 'tone',     capX: 917.0,  capY: 750.0, capR: 44.0, skirtX: 925.0,  skirtY: 746.5, small: false, min: 0, max: 1, def: 0.5, fmt: 'pct', label: 'Tone' },
		{ id: 'mix',      capX: 1116.5, capY: 749.5, capR: 43.5, skirtX: 1124.4, skirtY: 746.0, small: false, min: 0, max: 1, def: 0.3, fmt: 'pct', label: 'Mix' },
		{ id: 'output',   capX: 1306.5, capY: 750.0, capR: 44.0, skirtX: 1314.5, skirtY: 746.5, small: false, min: -60, max: 12, centre: -6, def: 0, fmt: 'db', label: 'Output' }
	];
	var VUS = [
		{ pivotX: 509, pivotY: 464, x0: 344, y0: 205, x1: 664, y1: 343 },
		{ pivotX: 953, pivotY: 464, x0: 788, y0: 205, x1: 1108, y1: 343 }
	];
	var SWITCHES = [
		{ id: 'mode',  x: 345, y: 903, lampOff: [237.5, 900.5], lampOn: [451.0, 901.0], label: 'Spring / Plate' },
		{ id: 'eq',    x: 718, y: 903, lampOff: [626.0, 902.0], lampOn: [768.5, 902.0], label: 'EQ: Flat / Dub' },
		{ id: 'drive', x: 1108, y: 903, lampOff: [1007.5, 902.5], lampOn: [1214.0, 902.0], label: 'Tank Drive: Clean / Dirty' }
	];
	var LEVER = 88.986, LAMP = 20;
	var TANK = { x0: 92, y0: 405, x1: 1358, y1: 595 };
	var SPRINGS = [{ y0: 446, y1: 477, x0: 259, x1: 1192 }, { y0: 493, y1: 524, x0: 259, x1: 1192 }, { y0: 538, y1: 565, x0: 259, x1: 1192 }];

	function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
	function skewOf(k) { return k.centre === undefined ? 1 : Math.log(0.5) / Math.log((k.centre - k.min) / (k.max - k.min)); }
	function toProp(k, v) { return Math.pow(clamp((v - k.min) / (k.max - k.min), 0, 1), k.skew); }
	function fromProp(k, p) { p = clamp(p, 0, 1); return k.min + (k.max - k.min) * (p <= 0 ? 0 : Math.exp(Math.log(p) / k.skew)); }
	function fmtValue(k, v) {
		if (k.fmt === 'db') return v <= -59.95 ? '-inf dB' : v.toFixed(1) + ' dB';
		if (k.fmt === 'ms') return Math.round(v) + ' ms';
		return Math.round(v * 100) + ' %';
	}
	function fmtTime(s) {
		if (!isFinite(s) || s < 0) s = 0;
		var m = Math.floor(s / 60), r = Math.floor(s % 60);
		return m + ':' + (r < 10 ? '0' : '') + r;
	}
	KNOBS.forEach(function (k) { k.skew = skewOf(k); });

	// ------------------------------------------------------------ shared bits
	var images = null;
	function loadImages(base) {
		if (images) return images;
		var names = ['knobcap_l.png', 'knobcap_s.png', 'lamp_off.png', 'lamp_on.png', 'lever_arm.png', 'lever_base.png',
			'spring1.png', 'spring2.png', 'spring3.png', 'springhot1.png', 'springhot2.png', 'springhot3.png', 'tank_base.jpg', 'tank_hot.jpg'];
		var map = {};
		images = Promise.all(names.map(function (n) {
			return new Promise(function (res, rej) {
				var img = new Image();
				img.onload = function () { map[n.replace(/\.(png|jpg)$/, '')] = img; res(); };
				img.onerror = rej;
				img.src = base + n;
			});
		})).then(function () { return map; });
		return images;
	}

	var audioCtx = null, workletReady = null;
	function getAudio(workletUrl) {
		if (!audioCtx) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return null;
			audioCtx = new AC({ latencyHint: 'playback' });
			workletReady = audioCtx.audioWorklet ? audioCtx.audioWorklet.addModule(workletUrl) : Promise.reject(new Error('no AudioWorklet'));
		}
		return audioCtx;
	}

	function visitorId() {
		var key = 'federhall_vid', v = null;
		try { v = localStorage.getItem(key); } catch (e) {}
		if (!v || !/^[a-zA-Z0-9-]{16,64}$/.test(v)) {
			v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
				'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
			try { localStorage.setItem(key, v); } catch (e) {}
		}
		return v;
	}

	var instances = [];

	// ------------------------------------------------------------ instance
	function Federhall(root, cfg) {
		this.root = root;
		this.cfg = cfg;
		this.t = cfg.i18n || {};
		this.opt = cfg.options || {};
		this.params = {};
		var d = cfg.defaults || {};
		var self = this;
		KNOBS.forEach(function (k) { self.params[k.id] = d[k.id] !== undefined ? +d[k.id] : k.def; });
		SWITCHES.forEach(function (s) { self.params[s.id] = d[s.id] !== undefined ? +d[s.id] : (s.id === 'eq' ? 1 : 0); });
		this.params.bypass = 0;
		this.defaults = JSON.parse(JSON.stringify(this.params));

		this.tracks = cfg.tracks || [];
		this.current = -1;
		this.vid = visitorId();
		this.meters = { inRms: 0, outRms: 0, spring: 0, kick: 0 };
		this.vu = [{ angle: -36, vel: 0 }, { angle: -36, vel: 0 }];
		this.lever = { mode: this.params.mode ? 1 : -1, eq: this.params.eq ? 1 : -1, drive: this.params.drive ? 1 : -1 };
		this.lampLevel = {};
		SWITCHES.forEach(function (s) { self.lampLevel[s.id] = self.params[s.id] ? 1 : 0; });
		this.counted = {};
		this.visible = true;

		this.initTank();
		this.build();
		this.bindPanel();
		this.bindBar();

		var self2 = this;
		loadImages(cfg.assetsUrl).then(function (img) {
			self2.img = img;
			self2.prepareSprites();
			self2.root.classList.add('fh-ready');
			self2.lastFrame = performance.now();
			requestAnimationFrame(function (t) { self2.frame(t); });
		}).catch(function () { self2.status(self2.t.loadError || 'Grafik konnte nicht geladen werden.'); });

		if ('IntersectionObserver' in window) {
			new IntersectionObserver(function (es) { self2.visible = es[0].isIntersecting; }).observe(this.panel);
		}
		this.refreshStats();
		instances.push(this);
	}

	Federhall.prototype.build = function () {
		var t = this.t, opt = this.opt, self = this;
		var r = this.root;
		r.innerHTML = '';

		// panel
		var panel = el('div', 'fh-panel');
		var bg = el('img', 'fh-bg');
		bg.src = this.cfg.assetsUrl + 'background.jpg';
		bg.alt = 'DUBASCO Spring Reverb Unit';
		bg.draggable = false;
		var cv = el('canvas', 'fh-canvas');
		cv.width = W; cv.height = H;
		panel.appendChild(bg);
		panel.appendChild(cv);
		this.panel = panel; this.canvas = cv; this.ctx = cv.getContext('2d');

		// interactive zones (percent positioned, so they scale with the panel)
		this.knobEls = {};
		KNOBS.forEach(function (k) {
			var rr = 72 * k.capR / 44;
			var z = zone('fh-zone fh-knob', k.skirtX - rr, k.skirtY - rr, 2 * rr, 2 * rr);
			z.setAttribute('role', 'slider');
			z.setAttribute('tabindex', '0');
			z.setAttribute('aria-label', k.label);
			z.dataset.knob = k.id;
			panel.appendChild(z);
			self.knobEls[k.id] = z;
		});
		this.switchEls = {};
		SWITCHES.forEach(function (s) {
			var z = zone('fh-zone fh-switch', s.x - 36, s.y - 36, 72, 72, 'button');
			z.type = 'button';
			z.setAttribute('aria-label', s.label);
			z.dataset.sw = s.id;
			panel.appendChild(z);
			self.switchEls[s.id] = z;
			// clicking a label/lamp selects that side directly
			[[s.lampOff, 0], [s.lampOn, 1]].forEach(function (lp) {
				// lamp plus its label: the label sits right of the left lamp and left of the right lamp
				var lz = zone('fh-zone fh-lampzone', lp[0][0] + (lp[1] ? -72 : -18), lp[0][1] - 22, 90, 44, 'button');
				lz.type = 'button';
				lz.tabIndex = -1;
				lz.setAttribute('aria-hidden', 'true');
				lz.addEventListener('click', function () { self.setParam(s.id, lp[1]); });
				panel.appendChild(lz);
			});
		});
		var tz = zone('fh-zone fh-tank', TANK.x0, TANK.y0, TANK.x1 - TANK.x0, TANK.y1 - TANK.y0);
		tz.setAttribute('aria-label', t.tankLabel || 'Federn: antippen, drüberstreichen oder kratzen');
		tz.title = t.tankLabel || '';
		panel.appendChild(tz);
		this.tankEl = tz;

		this.bubble = el('div', 'fh-bubble');
		panel.appendChild(this.bubble);
		r.appendChild(panel);

		// player bar
		var bar = el('div', 'fh-bar');
		var sel = el('select', 'fh-select');
		sel.setAttribute('aria-label', t.chooseTrack || 'Titel wählen');
		this.select = sel;
		this.fillSelect();

		var prev = button('fh-btn fh-prev', t.prev || 'Vorheriger Titel', svg('prev'));
		var play = button('fh-btn fh-play', t.play || 'Abspielen', svg('play'));
		var next = button('fh-btn fh-next', t.next || 'Nächster Titel', svg('next'));
		this.playBtn = play; this.prevBtn = prev; this.nextBtn = next;

		var seekWrap = el('div', 'fh-seek');
		var seek = el('input', 'fh-range');
		seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.value = 0; seek.step = 1;
		seek.setAttribute('aria-label', t.position || 'Position');
		var time = el('span', 'fh-time');
		time.textContent = '0:00 / 0:00';
		seekWrap.appendChild(seek); seekWrap.appendChild(time);
		this.seek = seek; this.time = time;

		var like = button('fh-btn fh-like', t.like || 'Gefällt mir', svg('heart'));
		var likeCount = el('span', 'fh-like-count');
		like.appendChild(likeCount);
		this.likeBtn = like; this.likeCount = likeCount;
		if (!opt.likes) like.style.display = 'none';

		var ab = button('fh-btn fh-ab', t.bypassTitle || 'Effekt aus/an (A/B-Vergleich)', document.createTextNode('A/B'));
		ab.setAttribute('aria-pressed', 'false');
		this.abBtn = ab;

		var reset = button('fh-btn fh-reset', t.resetTitle || 'Regler zurücksetzen', svg('reset'));
		this.resetBtn = reset;

		var rec = button('fh-btn fh-rec', t.recordTitle || 'Aufnahme starten', svg('rec'));
		this.recBtn = rec;
		if (!opt.record || typeof MediaRecorder === 'undefined') rec.style.display = 'none';

		var row1 = el('div', 'fh-row fh-row-main');
		row1.appendChild(sel);
		var transport = el('div', 'fh-transport');
		transport.appendChild(prev); transport.appendChild(play); transport.appendChild(next);
		row1.appendChild(transport);
		row1.appendChild(like);
		var row2 = el('div', 'fh-row fh-row-sub');
		row2.appendChild(seekWrap);
		var tools = el('div', 'fh-tools');
		tools.appendChild(ab); tools.appendChild(reset); tools.appendChild(rec);
		row2.appendChild(tools);
		bar.appendChild(row1); bar.appendChild(row2);

		this.meta = el('div', 'fh-meta');
		bar.appendChild(this.meta);
		this.statusEl = el('div', 'fh-status');
		this.statusEl.setAttribute('role', 'status');
		bar.appendChild(this.statusEl);
		if (opt.hint) {
			var hint = el('p', 'fh-hint');
			hint.textContent = opt.hint;
			bar.appendChild(hint);
		}
		r.appendChild(bar);

		var audio = new Audio();
		audio.preload = 'metadata';
		this.audio = audio;

		if (!this.tracks.length) {
			sel.disabled = true; play.disabled = true; prev.disabled = true; next.disabled = true; like.disabled = true;
		} else {
			var start = 0;
			if (this.cfg.startTrack) {
				for (var i = 0; i < this.tracks.length; i++) if (this.tracks[i].id === this.cfg.startTrack) start = i;
			}
			this.selectTrack(start, false);
		}
		this.syncAria();

		function zone(cls, x, y, w, h, tag) {
			var z = el(tag || 'div', cls);
			z.style.left = (x / W * 100) + '%';
			z.style.top = (y / H * 100) + '%';
			z.style.width = (w / W * 100) + '%';
			z.style.height = (h / H * 100) + '%';
			return z;
		}
	};

	Federhall.prototype.fillSelect = function () {
		var sel = this.select, t = this.t, self = this;
		sel.innerHTML = '';
		if (!this.tracks.length) {
			var o = el('option');
			o.textContent = t.noTracks || 'Noch keine Titel vorhanden';
			sel.appendChild(o);
			return;
		}
		this.tracks.forEach(function (tr, i) {
			var o = el('option');
			o.value = i;
			o.textContent = self.trackLabel(tr);
			sel.appendChild(o);
		});
		if (this.current >= 0) sel.value = this.current;
	};

	Federhall.prototype.trackLabel = function (tr) {
		var s = tr.title + (tr.artist ? ' – ' + tr.artist : '');
		if (this.opt.likes && this.opt.showLikeCount && tr.likes) s += '  ♥ ' + tr.likes;
		return s;
	};

	// ------------------------------------------------------------ audio
	Federhall.prototype.ensureEngine = function () {
		var self = this;
		if (this.enginePromise) return this.enginePromise;
		var ctx = getAudio(this.cfg.workletUrl);
		if (!ctx) {
			this.status(this.t.noAudio || 'Dein Browser unterstützt kein Web Audio.');
			return (this.enginePromise = Promise.resolve(false));
		}
		this.enginePromise = workletReady.then(function () {
			var node = new AudioWorkletNode(ctx, 'federhall-processor', {
				numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
				processorOptions: { params: self.params }
			});
			node.port.onmessage = function (e) {
				if (e.data && e.data.type === 'meter') self.meters = e.data;
			};
			self.node = node;
			if (self.needsCors()) self.audio.crossOrigin = 'anonymous';
			self.source = ctx.createMediaElementSource(self.audio);
			self.source.connect(node);
			node.connect(ctx.destination);
			return true;
		}).catch(function (err) {
			// no AudioWorklet (very old browser): play dry so the music still works
			if (window.console) console.warn('Federhall:', err);
			self.status(self.t.noWorklet || 'Dein Browser kann den Federhall nicht berechnen, der Titel läuft ohne Effekt.');
			return false;
		});
		return this.enginePromise;
	};

	Federhall.prototype.needsCors = function () {
		var tr = this.tracks[this.current];
		if (!tr) return false;
		try { return new URL(tr.url, location.href).origin !== location.origin; } catch (e) { return false; }
	};

	Federhall.prototype.sendParam = function (name) {
		if (this.node) this.node.port.postMessage({ type: 'param', name: name, value: this.params[name] });
	};

	Federhall.prototype.setParam = function (name, value) {
		this.params[name] = value;
		this.sendParam(name);
		this.syncAria();
	};

	Federhall.prototype.strike = function (spring, u, strength) {
		var self = this;
		if (this.node) this.node.port.postMessage({ type: 'strike', spring: spring, strength: strength });
		else if (!this.engineStarting) {
			// the springs are playable even before a track runs
			this.engineStarting = true;
			this.ensureEngine().then(function () {
				if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
				if (self.node) self.node.port.postMessage({ type: 'strike', spring: spring, strength: strength });
			});
		}
		if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
		this.tankStrike(spring, u, strength);
	};

	Federhall.prototype.selectTrack = function (i, autoplay) {
		if (!this.tracks.length) return;
		i = (i + this.tracks.length) % this.tracks.length;
		var tr = this.tracks[i];
		var wasPlaying = !this.audio.paused;
		this.current = i;
		this.select.value = i;
		if (this.source && this.needsCors() && !this.audio.crossOrigin) this.audio.crossOrigin = 'anonymous';
		this.audio.src = tr.url;
		this.seek.value = 0;
		this.time.textContent = '0:00 / ' + (tr.duration ? fmtTime(tr.duration) : '0:00');
		this.updateLike();
		this.updateMeta();
		if (autoplay || wasPlaying) this.play();
	};

	Federhall.prototype.play = function () {
		var self = this;
		if (!this.tracks.length) return;
		instances.forEach(function (o) { if (o !== self && !o.audio.paused) o.audio.pause(); });
		this.ensureEngine().then(function () {
			if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
			var p = self.audio.play();
			if (p && p.catch) p.catch(function (e) {
				if (e && e.name !== 'AbortError') self.status(self.t.playError || 'Der Titel konnte nicht abgespielt werden.');
			});
		});
	};

	Federhall.prototype.countPlay = function () {
		var tr = this.tracks[this.current];
		if (!tr || this.counted[tr.id]) return;
		this.counted[tr.id] = true;
		var self = this;
		api(restUrl(this.cfg.restUrl, 'play'), { track: tr.id, vid: this.vid }).then(function (res) {
			if (res && typeof res.plays === 'number') { tr.plays = res.plays; self.updateMeta(); }
		}).catch(function () {});
	};

	// ------------------------------------------------------------ likes
	Federhall.prototype.refreshStats = function () {
		var self = this;
		if (!this.tracks.length) return;
		fetch(restUrl(this.cfg.restUrl, 'tracks', { vid: this.vid, ids: this.tracks.map(function (t) { return t.id; }).join(',') }), {
			credentials: 'omit', cache: 'no-store'
		}).then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
			if (!res || !res.tracks) return;
			var byId = {};
			res.tracks.forEach(function (t) { byId[t.id] = t; });
			self.tracks.forEach(function (t) {
				var s = byId[t.id];
				if (s) { t.likes = s.likes; t.plays = s.plays; t.liked = !!s.liked; }
			});
			self.fillSelect();
			self.updateLike();
			self.updateMeta();
		}).catch(function () {});
	};

	Federhall.prototype.toggleLike = function () {
		var tr = this.tracks[this.current], self = this;
		if (!tr || this.likeBusy) return;
		this.likeBusy = true;
		var before = { liked: tr.liked, likes: tr.likes || 0 };
		tr.liked = !tr.liked;
		tr.likes = Math.max(0, (tr.likes || 0) + (tr.liked ? 1 : -1));
		this.updateLike(true);
		api(restUrl(this.cfg.restUrl, 'like'), { track: tr.id, vid: this.vid }).then(function (res) {
			if (res && typeof res.likes === 'number') { tr.likes = res.likes; tr.liked = !!res.liked; }
			else throw new Error('bad response');
		}).catch(function () {
			tr.liked = before.liked; tr.likes = before.likes;
			self.status(self.t.likeError || 'Like konnte nicht gespeichert werden.');
		}).then(function () {
			self.likeBusy = false;
			self.updateLike();
			self.fillSelect();
		});
	};

	Federhall.prototype.updateLike = function (pop) {
		var tr = this.tracks[this.current];
		if (!tr) return;
		this.likeBtn.classList.toggle('is-liked', !!tr.liked);
		this.likeBtn.setAttribute('aria-pressed', tr.liked ? 'true' : 'false');
		this.likeBtn.title = tr.liked ? (this.t.unlike || 'Gefällt mir nicht mehr') : (this.t.like || 'Gefällt mir');
		this.likeCount.textContent = this.opt.showLikeCount ? String(tr.likes || 0) : '';
		if (pop) {
			this.likeBtn.classList.remove('fh-pop');
			void this.likeBtn.offsetWidth;
			this.likeBtn.classList.add('fh-pop');
		}
	};

	Federhall.prototype.updateMeta = function () {
		var tr = this.tracks[this.current];
		if (!tr) { this.meta.textContent = ''; return; }
		var parts = [];
		if (tr.description) parts.push(tr.description);
		if (this.opt.showPlays) parts.push((tr.plays || 0) + ' ' + (this.t.plays || 'mal gespielt'));
		this.meta.textContent = parts.join(' · ');
	};

	Federhall.prototype.status = function (msg) {
		var s = this.statusEl;
		s.textContent = msg;
		s.classList.add('is-on');
		clearTimeout(this.statusTimer);
		this.statusTimer = setTimeout(function () { s.classList.remove('is-on'); }, 5000);
	};

	// ------------------------------------------------------------ recording
	Federhall.prototype.toggleRecord = function () {
		var self = this;
		if (this.recorder && this.recorder.state === 'recording') { this.recorder.stop(); return; }
		this.ensureEngine().then(function (ok) {
			if (!ok || !self.node) return;
			if (!self.recDest) {
				self.recDest = audioCtx.createMediaStreamDestination();
				self.node.connect(self.recDest);
			}
			var chunks = [];
			var mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].filter(function (m) {
				return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);
			})[0];
			var rec;
			try { rec = mime ? new MediaRecorder(self.recDest.stream, { mimeType: mime }) : new MediaRecorder(self.recDest.stream); }
			catch (e) { self.status(self.t.recordError || 'Aufnahme wird von diesem Browser nicht unterstützt.'); return; }
			rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
			rec.onstop = function () {
				self.recBtn.classList.remove('is-recording');
				self.recBtn.title = self.t.recordTitle || 'Aufnahme starten';
				var type = rec.mimeType || 'audio/webm';
				var blob = new Blob(chunks, { type: type });
				var ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
				var a = document.createElement('a');
				var tr = self.tracks[self.current];
				var name = (tr ? tr.title : 'Federhall').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'Federhall';
				a.href = URL.createObjectURL(blob);
				a.download = name + ' (Federhall).' + ext;
				document.body.appendChild(a);
				a.click();
				setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
				self.status(self.t.recordDone || 'Aufnahme gespeichert.');
			};
			rec.start(1000);
			self.recorder = rec;
			self.recBtn.classList.add('is-recording');
			self.recBtn.title = self.t.recordStop || 'Aufnahme beenden und speichern';
			self.status(self.t.recordStart || 'Aufnahme läuft. Nochmal klicken zum Speichern.');
			if (self.audio.paused) self.play();
		});
	};

	// ------------------------------------------------------------ events
	Federhall.prototype.bindBar = function () {
		var self = this, a = this.audio;
		this.select.addEventListener('change', function () { self.selectTrack(+self.select.value, true); });
		this.playBtn.addEventListener('click', function () { if (a.paused) self.play(); else a.pause(); });
		this.prevBtn.addEventListener('click', function () {
			if (a.currentTime > 3) a.currentTime = 0; else self.selectTrack(self.current - 1, !a.paused);
		});
		this.nextBtn.addEventListener('click', function () { self.selectTrack(self.current + 1, !a.paused); });
		this.likeBtn.addEventListener('click', function () { self.toggleLike(); });
		this.abBtn.addEventListener('click', function () {
			self.setParam('bypass', self.params.bypass ? 0 : 1);
			self.abBtn.classList.toggle('is-on', !!self.params.bypass);
			self.abBtn.setAttribute('aria-pressed', self.params.bypass ? 'true' : 'false');
			self.root.classList.toggle('fh-bypassed', !!self.params.bypass);
		});
		this.resetBtn.addEventListener('click', function () {
			Object.keys(self.defaults).forEach(function (k) { if (k !== 'bypass') self.params[k] = self.defaults[k]; });
			if (self.node) self.node.port.postMessage({ type: 'params', values: self.params });
			self.syncAria();
		});
		this.recBtn.addEventListener('click', function () { self.toggleRecord(); });

		var seeking = false;
		this.seek.addEventListener('input', function () {
			seeking = true;
			if (isFinite(a.duration)) self.time.textContent = fmtTime(self.seek.value / 1000 * a.duration) + ' / ' + fmtTime(a.duration);
		});
		this.seek.addEventListener('change', function () {
			if (isFinite(a.duration)) a.currentTime = self.seek.value / 1000 * a.duration;
			seeking = false;
		});
		a.addEventListener('timeupdate', function () {
			if (seeking || !isFinite(a.duration) || !a.duration) return;
			self.seek.value = Math.round(a.currentTime / a.duration * 1000);
			self.time.textContent = fmtTime(a.currentTime) + ' / ' + fmtTime(a.duration);
			if (a.currentTime > 5) self.countPlay();
		});
		a.addEventListener('loadedmetadata', function () { self.time.textContent = fmtTime(a.currentTime) + ' / ' + fmtTime(a.duration); });
		a.addEventListener('play', function () {
			self.playBtn.innerHTML = ''; self.playBtn.appendChild(svg('pause'));
			self.playBtn.title = self.t.pause || 'Pause';
			self.root.classList.add('fh-playing');
		});
		a.addEventListener('pause', function () {
			self.playBtn.innerHTML = ''; self.playBtn.appendChild(svg('play'));
			self.playBtn.title = self.t.play || 'Abspielen';
			self.root.classList.remove('fh-playing');
		});
		a.addEventListener('ended', function () {
			if (self.opt.loop === 'track') { a.currentTime = 0; self.play(); return; }
			if (self.opt.autoNext && (self.current < self.tracks.length - 1 || self.opt.loop === 'all')) self.selectTrack(self.current + 1, true);
		});
		a.addEventListener('error', function () {
			if (a.src) self.status(self.t.playError || 'Der Titel konnte nicht abgespielt werden.');
		});
	};

	Federhall.prototype.panelPoint = function (e) {
		var r = this.panel.getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, scale: r.width / W };
	};

	Federhall.prototype.bindPanel = function () {
		var self = this;

		// knobs: drag up/right to turn up, shift = fine, double click resets, wheel and arrow keys work too
		KNOBS.forEach(function (k) {
			var z = self.knobEls[k.id], drag = null;
			z.addEventListener('pointerdown', function (e) {
				e.preventDefault();
				z.setPointerCapture(e.pointerId);
				z.focus({ preventScroll: true });
				var now = performance.now();
				if (self.lastTap && self.lastTap.k === k.id && now - self.lastTap.t < 320) {
					self.setParam(k.id, self.defaults[k.id]);
					self.lastTap = null;
					self.showBubble(k);
					return;
				}
				self.lastTap = { k: k.id, t: now };
				drag = { x: e.clientX, y: e.clientY, p: toProp(k, self.params[k.id]) };
				self.showBubble(k);
			});
			z.addEventListener('pointermove', function (e) {
				if (!drag) return;
				var scale = self.panel.getBoundingClientRect().width / W;
				var sens = 240 * Math.max(0.55, scale) * (e.shiftKey ? 4 : 1);
				var p = drag.p + ((e.clientX - drag.x) - (e.clientY - drag.y)) / sens;
				self.setParam(k.id, fromProp(k, p));
				self.showBubble(k);
			});
			var end = function () { drag = null; self.hideBubble(); };
			z.addEventListener('pointerup', end);
			z.addEventListener('pointercancel', end);
			z.addEventListener('wheel', function (e) {
				e.preventDefault();
				var step = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.005 : 0.025);
				self.setParam(k.id, fromProp(k, toProp(k, self.params[k.id]) + step));
				self.showBubble(k);
				clearTimeout(self.wheelTimer);
				self.wheelTimer = setTimeout(function () { self.hideBubble(); }, 700);
			}, { passive: false });
			z.addEventListener('keydown', function (e) {
				var step = e.shiftKey ? 0.01 : 0.04, p = toProp(k, self.params[k.id]);
				if (e.key === 'ArrowUp' || e.key === 'ArrowRight') p += step;
				else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') p -= step;
				else if (e.key === 'Home') p = 0;
				else if (e.key === 'End') p = 1;
				else if (e.key === 'Delete' || e.key === 'Backspace') p = toProp(k, self.defaults[k.id]);
				else return;
				e.preventDefault();
				self.setParam(k.id, fromProp(k, p));
				self.showBubble(k);
				clearTimeout(self.wheelTimer);
				self.wheelTimer = setTimeout(function () { self.hideBubble(); }, 900);
			});
			z.addEventListener('blur', function () { self.hideBubble(); });
		});

		SWITCHES.forEach(function (s) {
			self.switchEls[s.id].addEventListener('click', function () { self.setParam(s.id, self.params[s.id] ? 0 : 1); });
		});

		// spring tank: tap plucks, strum across crashes, drag along scrapes, fast hover swipe crashes too
		var tz = this.tankEl, pressed = false;
		tz.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			tz.setPointerCapture(e.pointerId);
			pressed = true;
			self.hasLast = false;
			var p = self.panelPoint(e);
			self.handleMotion(p, e.timeStamp, true);
			var best = -1, bestDist = 18;
			for (var i = 0; i < 3; i++) {
				var g = SPRINGS[i], d = Math.abs(p.y - 0.5 * (g.y0 + g.y1));
				if (d < bestDist) { bestDist = d; best = i; }
			}
			if (best >= 0) {
				var gg = SPRINGS[best];
				if (p.x > gg.x0 && p.x < gg.x1) self.strike(best, (p.x - gg.x0) / (gg.x1 - gg.x0), 0.9);
			}
		});
		tz.addEventListener('pointermove', function (e) {
			var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
			if (!evs || !evs.length) evs = [e];
			for (var i = 0; i < evs.length; i++) self.handleMotion(self.panelPoint(evs[i]), evs[i].timeStamp, pressed);
		});
		var up = function () { pressed = false; };
		tz.addEventListener('pointerup', up);
		tz.addEventListener('pointercancel', up);
		tz.addEventListener('pointerleave', function () { self.hasLast = false; });
	};

	Federhall.prototype.handleMotion = function (pos, timeMs, pressed) {
		if (!this.hasLast) { this.lastPos = pos; this.lastTime = timeMs; this.hasLast = true; return; }
		var dt = Math.max(0.004, (timeMs - this.lastTime) * 0.001);
		var from = this.lastPos;
		var speed = Math.hypot(pos.x - from.x, pos.y - from.y) / dt;  // panel pixels per second
		this.lastPos = pos; this.lastTime = timeMs;
		var minSpeed = pressed ? 60 : 700;  // a resting mouse stays quiet
		if (speed < minSpeed) return;
		this.lastScrape = this.lastScrape || [0, 0, 0];
		for (var i = 0; i < 3; i++) {
			var g = SPRINGS[i], cy = 0.5 * (g.y0 + g.y1);
			var a = from.y - cy, b = pos.y - cy;
			if ((a < 0) !== (b < 0)) {
				var t = a / (a - b), cx = from.x + (pos.x - from.x) * t;
				if (cx > g.x0 - 10 && cx < g.x1 + 10) {
					var strength = clamp((pressed ? 0.35 : 0) + speed / 1800, 0.25, 2);
					this.strike(i, clamp((cx - g.x0) / (g.x1 - g.x0), 0, 1), strength);
					continue;
				}
			}
			if (Math.abs(b) < 13 && pos.x > g.x0 && pos.x < g.x1 && timeMs - this.lastScrape[i] > 28) {
				this.lastScrape[i] = timeMs;
				this.strike(i, (pos.x - g.x0) / (g.x1 - g.x0), clamp(speed / 3500, 0.06, 0.7));
			}
		}
	};

	Federhall.prototype.showBubble = function (k) {
		var b = this.bubble;
		b.textContent = k.label + ': ' + fmtValue(k, this.params[k.id]);
		b.style.left = (k.skirtX / W * 100) + '%';
		b.style.top = ((k.skirtY - 96) / H * 100) + '%';
		b.classList.add('is-on');
	};
	Federhall.prototype.hideBubble = function () { this.bubble.classList.remove('is-on'); };

	Federhall.prototype.syncAria = function () {
		var self = this;
		KNOBS.forEach(function (k) {
			var z = self.knobEls[k.id], v = self.params[k.id];
			z.setAttribute('aria-valuemin', k.min);
			z.setAttribute('aria-valuemax', k.max);
			z.setAttribute('aria-valuenow', Math.round(v * 1000) / 1000);
			z.setAttribute('aria-valuetext', fmtValue(k, v));
		});
		var names = { mode: ['Spring', 'Plate'], eq: ['Flat', 'Dub'], drive: ['Clean', 'Dirty'] };
		SWITCHES.forEach(function (s) {
			var z = self.switchEls[s.id];
			z.setAttribute('aria-pressed', self.params[s.id] ? 'true' : 'false');
			z.title = s.label + ' – ' + names[s.id][self.params[s.id] ? 1 : 0];
		});
	};

	// ------------------------------------------------------------ spring tank animation
	Federhall.prototype.initTank = function () {
		var base = [6.1, 5.3, 7.0];
		this.springs = [];
		for (var i = 0; i < 3; i++) {
			var s = { phase: [], freq: [], amp: 0, pulses: [], disp: new Float32Array(SPRINGS[i].x1 - SPRINGS[i].x0) };
			for (var m = 0; m < 4; m++) {
				s.freq.push(base[i] * (m + 1) * (1 + 0.07 * m));
				s.phase.push(Math.random() * Math.PI * 2);
			}
			this.springs.push(s);
		}
		this.glow = 0; this.flicker = 0; this.tankTime = 0; this.lastKick = 0; this.kickFloor = 0;
	};

	Federhall.prototype.tankStrike = function (spring, u, strength) {
		var s = this.springs[spring];
		var a = clamp(strength * 1.4, 0.3, 2.2);
		if (s.pulses.length < 14) {
			s.pulses.push({ pos: u, amp: a, age: 0, dir: 1 });
			s.pulses.push({ pos: u, amp: a * 0.8, age: 0, dir: -1 });
		}
		s.amp = Math.max(s.amp, Math.min(1.6, strength));
		for (var i = 0; i < 3; i++) if (i !== spring) this.springs[i].amp = Math.max(this.springs[i].amp, Math.min(1, strength * 0.45));
		this.glow = Math.max(this.glow, Math.min(1, 0.35 + 0.5 * strength));
	};

	Federhall.prototype.tickTank = function (dt, wetLevel, kickLevel) {
		this.tankTime += dt;
		var db = 20 * Math.log10(Math.max(wetLevel, 1e-5));
		var level = clamp((db + 48) / 42, 0, 1);
		var targetGlow = level * level;
		this.glow += (targetGlow - this.glow) * (1 - Math.exp(-dt / (targetGlow > this.glow ? 0.05 : 0.35)));
		this.flicker += ((Math.random() - 0.5) * 0.06 - this.flicker) * 0.3;

		var kdb = 20 * Math.log10(Math.max(kickLevel, 1e-5));
		this.kickFloor = Math.min(kdb, this.kickFloor + dt * 25);
		var kick = kdb > -45 && kdb - this.kickFloor > 6 && kdb > this.lastKick + 1.5;
		this.lastKick = kdb;
		if (kick) this.kickFloor = kdb;

		var weights = [1, 0.55, 0.35, 0.22];
		for (var i = 0; i < 3; i++) {
			var s = this.springs[i];
			s.amp += (level - s.amp) * (1 - Math.exp(-dt / (level > s.amp ? 0.04 : 0.45)));
			for (var m = 0; m < 4; m++) s.phase[m] = (s.phase[m] + 2 * Math.PI * s.freq[m] * dt) % (2 * Math.PI);
			if (kick && s.pulses.length < 8) s.pulses.push({ pos: 0, amp: clamp((kdb + 45) / 30, 0.3, 1) * (0.8 + 0.1 * i), age: 0, dir: 1 });
			for (var p = 0; p < s.pulses.length; p++) {
				var pu = s.pulses[p];
				pu.age += dt;
				pu.pos += pu.dir * dt * (1.9 + 0.25 * i);
				if (pu.pos > 1) { pu.pos = 2 - pu.pos; pu.dir = -1; }
				if (pu.pos < 0) { pu.pos = -pu.pos; pu.dir = 1; }
			}
			s.pulses = s.pulses.filter(function (q) { return q.age <= 1.6; });

			var w = s.disp.length, sinPh = [Math.sin(s.phase[0]), Math.sin(s.phase[1]), Math.sin(s.phase[2]), Math.sin(s.phase[3])];
			var still = s.amp < 0.002 && !s.pulses.length;
			for (var x = 0; x < w; x += 2) {
				if (still) { s.disp[x] = 0; continue; }
				var u = x / (w - 1), d = 0;
				for (m = 0; m < 4; m++) d += weights[m] * Math.sin((m + 1) * Math.PI * u) * sinPh[m];
				d *= s.amp * 0.55;
				for (p = 0; p < s.pulses.length; p++) {
					pu = s.pulses[p];
					var k = (u - pu.pos) / 0.045;
					if (k > 4 || k < -4) continue;
					d += pu.amp * Math.exp(-k * k) * Math.exp(-pu.age * 2.6) * Math.sin((u - pu.pos) * 140 - this.tankTime * 30) * 1.1;
				}
				var anchor = Math.min(1, Math.min(u, 1 - u) * 25);
				s.disp[x] = clamp(d, -2.3, 2.3) * 3.6 * anchor;
			}
		}
	};

	Federhall.prototype.tickVu = function (vu, dt, rms) {
		var db = 20 * Math.log10(Math.max(rms, 1e-6)) + 18;
		var target = vuAngle(db), omega = 13.5, zeta = 0.8, steps = 8, h = dt / steps;
		for (var i = 0; i < steps; i++) {
			var acc = omega * omega * (target - vu.angle) - 2 * zeta * omega * vu.vel;
			vu.vel += acc * h;
			vu.angle += vu.vel * h;
			if (vu.angle < -36) { vu.angle = -36; vu.vel = Math.abs(vu.vel) * 0.25; }
			if (vu.angle > 33.5) { vu.angle = 33.5; vu.vel = -Math.abs(vu.vel) * 0.25; }
		}
	};

	function vuAngle(vu) {
		var db = [-26, -20, -10, -7, -5, -3, -1, 0, 3, 4.5];
		var deg = [-36, -33.3, -24.3, -18.1, -9.5, 0, 11.5, 17, 28.8, 33];
		if (vu <= db[0]) return deg[0];
		for (var i = 1; i < 10; i++) if (vu <= db[i]) return deg[i - 1] + (deg[i] - deg[i - 1]) * (vu - db[i - 1]) / (db[i] - db[i - 1]);
		return deg[9];
	}

	// ------------------------------------------------------------ drawing
	Federhall.prototype.prepareSprites = function () {
		var img = this.img;
		// lever arm shadow = arm alpha filled black
		var a = img.lever_arm, c = document.createElement('canvas');
		c.width = a.width; c.height = a.height;
		var x = c.getContext('2d');
		x.drawImage(a, 0, 0);
		x.globalCompositeOperation = 'source-in';
		x.fillStyle = '#000';
		x.fillRect(0, 0, c.width, c.height);
		this.armShadow = c;
		// blended spring strips are rebuilt each frame into these
		this.stripCv = [0, 1, 2].map(function (i) {
			var s = img['spring' + (i + 1)], cv = document.createElement('canvas');
			cv.width = s.width; cv.height = s.height;
			return cv;
		});
	};

	Federhall.prototype.frame = function (now) {
		var self = this;
		requestAnimationFrame(function (t) { self.frame(t); });
		var dt = clamp((now - this.lastFrame) / 1000, 0.001, 0.1);
		this.lastFrame = now;
		if (!this.visible || document.hidden) return;

		var m = this.meters;
		if (!this.node || (this.audio.paused && audioCtx && audioCtx.state !== 'running')) {
			m.inRms *= 0.9; m.outRms *= 0.9; m.spring *= 0.95; m.kick *= 0.9;
		}
		this.tickVu(this.vu[0], dt, m.inRms);
		this.tickVu(this.vu[1], dt, m.outRms);
		this.tickTank(dt, m.spring, m.kick);
		for (var id in this.lever) {
			var target = this.params[id] ? 1 : -1, step = dt / 0.07 * 2;
			this.lever[id] = target > this.lever[id] ? Math.min(target, this.lever[id] + step) : Math.max(target, this.lever[id] - step);
			var lt = this.params[id] ? 1 : 0, tau = 0.05;
			this.lampLevel[id] += (lt - this.lampLevel[id]) * (1 - Math.exp(-dt / tau));
		}
		this.draw();
	};

	Federhall.prototype.draw = function () {
		var ctx = this.ctx, img = this.img, self = this;
		ctx.clearRect(0, 0, W, H);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';

		// spring tank
		var g = clamp(0.08 + this.glow * 0.92 + this.flicker * (0.4 + this.glow), 0, 1);
		ctx.drawImage(img.tank_base, TANK.x0, TANK.y0);
		ctx.globalAlpha = g;
		ctx.drawImage(img.tank_hot, TANK.x0, TANK.y0);
		ctx.globalAlpha = 1;
		for (var i = 0; i < 3; i++) {
			var cold = img['spring' + (i + 1)], hot = img['springhot' + (i + 1)], cv = this.stripCv[i], sx = cv.getContext('2d');
			sx.globalCompositeOperation = 'copy';
			sx.globalAlpha = 1;
			sx.drawImage(cold, 0, 0);
			sx.globalCompositeOperation = 'source-atop';
			sx.globalAlpha = g;
			sx.drawImage(hot, 0, 0);
			var geo = SPRINGS[i], disp = this.springs[i].disp, sw = cv.width, sh = cv.height;
			for (var x = 0; x < sw; x += 2) {
				var wcol = Math.min(2, sw - x);
				ctx.drawImage(cv, x, 0, wcol, sh, geo.x0 + x, geo.y0 + disp[x], wcol, sh);
			}
		}

		// VU needles
		this.vu.forEach(function (vu, idx) {
			var gm = VUS[idx];
			ctx.save();
			roundRect(ctx, gm.x0 + 2, gm.y0 + 2, gm.x1 - gm.x0 - 4, gm.y1 - gm.y0 - 4, 11);
			ctx.clip();
			var a = vu.angle * Math.PI / 180, s = Math.sin(a), c = -Math.cos(a), nx = -c, ny = s;
			var px = gm.pivotX, py = gm.pivotY;
			var needle = function (ox, oy) {
				var r0 = 110, r1 = 229, w0 = 1.6, w1 = 0.7;
				ctx.beginPath();
				ctx.moveTo(px + s * r0 + nx * w0 + ox, py + c * r0 + ny * w0 + oy);
				ctx.lineTo(px + s * r1 + nx * w1 + ox, py + c * r1 + ny * w1 + oy);
				ctx.lineTo(px + s * r1 - nx * w1 + ox, py + c * r1 - ny * w1 + oy);
				ctx.lineTo(px + s * r0 - nx * w0 + ox, py + c * r0 - ny * w0 + oy);
				ctx.closePath();
				ctx.fill();
			};
			ctx.fillStyle = 'rgba(58,36,8,0.22)';
			needle(4, 5);
			ctx.fillStyle = '#17140f';
			needle(0, 0);
			ctx.restore();
		});

		// knobs
		KNOBS.forEach(function (k) {
			var sc = k.capR / 44, prop = toProp(k, self.params[k.id]);
			var ang = (-135 + 270 * prop) * Math.PI / 180, s = Math.sin(ang), c = -Math.cos(ang);
			ctx.save();
			ctx.beginPath();
			ctx.rect(k.skirtX - 90 * sc, k.skirtY - 90 * sc, 180 * sc, 180 * sc);
			ctx.arc(k.capX, k.capY, k.capR + 1.2, 0, Math.PI * 2);
			ctx.clip('evenodd');
			var r0 = 54.5 * sc, r1 = 64 * sc;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(k.skirtX + s * r0, k.skirtY + c * r0);
			ctx.lineTo(k.skirtX + s * r1, k.skirtY + c * r1);
			ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4.4 * sc; ctx.stroke();
			ctx.strokeStyle = '#eadcb8'; ctx.lineWidth = 3 * sc; ctx.stroke();
			ctx.restore();

			ctx.drawImage(k.small ? img.knobcap_s : img.knobcap_l, k.capX - k.capR, k.capY - k.capR, 2 * k.capR, 2 * k.capR);

			// pointer slot, a recess in the cap: lit lower wall, dark upper edge, then the slot itself
			var pts = slotPoly(k, ang, 5.6 * sc);
			fillPoly(pts, 0, 1.0 * sc, 'rgba(244,234,210,0.45)');
			fillPoly(pts, 0, -0.8 * sc, 'rgba(5,4,3,0.35)');
			var gr = ctx.createLinearGradient(0, k.capY - k.capR, 0, k.capY + k.capR);
			gr.addColorStop(0, '#0d0b09'); gr.addColorStop(1, '#2a2520');
			fillPoly(pts, 0, 0, gr);
		});
		function fillPoly(pts, ox, oy, style) {
			ctx.fillStyle = style;
			ctx.beginPath();
			ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
			for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0] + ox, pts[j][1] + oy);
			ctx.closePath();
			ctx.fill();
		}

		// lamps
		SWITCHES.forEach(function (sw) {
			var lv = self.lampLevel[sw.id];
			drawLamp(sw.lampOff, 1 - lv);
			drawLamp(sw.lampOn, lv);
		});
		function drawLamp(p, level) {
			if (level > 0.01) {
				var gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 28);
				gr.addColorStop(0, 'rgba(255,160,32,' + (0.42 * level) + ')');
				gr.addColorStop(0.35, 'rgba(255,148,24,' + (0.2 * level) + ')');
				gr.addColorStop(1, 'rgba(255,122,0,0)');
				ctx.fillStyle = gr;
				ctx.beginPath(); ctx.arc(p[0], p[1], 30, 0, Math.PI * 2); ctx.fill();
			}
			ctx.drawImage(img.lamp_off, p[0] - LAMP / 2, p[1] - LAMP / 2, LAMP, LAMP);
			ctx.globalAlpha = clamp(level, 0, 1);
			ctx.drawImage(img.lamp_on, p[0] - LAMP / 2, p[1] - LAMP / 2, LAMP, LAMP);
			ctx.globalAlpha = 1;
		}

		// lever switches
		SWITCHES.forEach(function (sw) {
			ctx.drawImage(img.lever_base, sw.x - LEVER / 2, sw.y - LEVER / 2, LEVER, LEVER);
			var arm = img.lever_arm, s = LEVER / arm.width * 0.72, rot = -self.lever[sw.id] * 58 * Math.PI / 180;
			var drawArm = function (src, ox, oy, alpha) {
				ctx.save();
				ctx.globalAlpha = alpha;
				ctx.translate(sw.x + ox, sw.y + oy);
				ctx.rotate(rot);
				ctx.scale(s, s);
				ctx.drawImage(src, -arm.width / 2, -arm.height / 2);
				ctx.restore();
			};
			drawArm(self.armShadow, 1.8, 3.0, 0.45);
			drawArm(arm, 0, 0, 1);
		});
	};

	// pointer slot outline in panel coordinates (rounded ends approximated)
	function slotPoly(k, ang, w) {
		var pts = [], r = w * 0.5, top = -k.capR * 0.94, bot = top + k.capR * 0.46;
		var local = [];
		var n = 6, i, a;
		for (i = 0; i <= n; i++) { a = Math.PI + Math.PI * i / n; local.push([Math.cos(a) * r, top + r + Math.sin(a) * r]); }
		for (i = 0; i <= n; i++) { a = Math.PI * i / n; local.push([Math.cos(a) * r, bot - r + Math.sin(a) * r]); }
		var cs = Math.cos(ang), sn = Math.sin(ang);
		for (i = 0; i < local.length; i++) {
			var x = local[i][0], y = local[i][1];
			pts.push([k.capX + x * cs - y * sn, k.capY + x * sn + y * cs]);
		}
		return pts;
	}

	function roundRect(ctx, x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2);
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	// ------------------------------------------------------------ helpers
	function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
	function button(cls, title, child) {
		var b = el('button', cls);
		b.type = 'button';
		b.title = title;
		b.setAttribute('aria-label', title);
		if (child) b.appendChild(child);
		return b;
	}
	var ICONS = {
		play: 'M8 5v14l11-7z',
		pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
		prev: 'M6 6h2v12H6zM9.5 12L18 18V6z',
		next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
		heart: 'M12 21s-7.5-4.6-10-9.3C.4 8.4 2.2 4.5 6 4.5c2.2 0 3.6 1.3 4.4 2.5.4.6 1 .6 1.4 0 .8-1.2 2.2-2.5 4.4-2.5 3.8 0 5.6 3.9 4 7.2C19.5 16.4 12 21 12 21z',
		reset: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
		rec: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'
	};
	function svg(name) {
		var ns = 'http://www.w3.org/2000/svg';
		var s = document.createElementNS(ns, 'svg');
		s.setAttribute('viewBox', '0 0 24 24');
		s.setAttribute('aria-hidden', 'true');
		s.setAttribute('class', 'fh-icon fh-icon-' + name);
		var p = document.createElementNS(ns, 'path');
		p.setAttribute('d', ICONS[name]);
		s.appendChild(p);
		return s;
	}
	// works with pretty permalinks (/wp-json/federhall/v1/) and plain ones (?rest_route=/federhall/v1/)
	function restUrl(base, route, query) {
		var q = query ? Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&') : '';
		var i = base.indexOf('?');
		if (i === -1) return base + route + (q ? '?' + q : '');
		return base + route + (q ? '&' + q : '');
	}
	function api(url, body) {
		return fetch(url, {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
	}

	// ------------------------------------------------------------ boot
	function boot() {
		var nodes = document.querySelectorAll('.federhall[data-federhall]:not(.fh-init)');
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			n.classList.add('fh-init');
			var cfg;
			try { cfg = JSON.parse(n.getAttribute('data-federhall')); } catch (e) { continue; }
			new Federhall(n, cfg);
		}
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
	window.Federhall = { boot: boot };
})();
