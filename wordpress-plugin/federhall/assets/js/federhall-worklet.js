/*
 * Federhall – DSP (AudioWorklet)
 *
 * JavaScript port of the Dubasco Spring Reverb engine (Source/dsp/*.h):
 * three-spring tank after Välimäki/Parker/Abel, Dattorro plate, tube driver,
 * dub send EQ and the hand-played "spring crash".
 */
'use strict';

const PI = Math.PI;
const dbToGain = (db) => Math.pow(10, db * 0.05);
const gainFromDb = (db) => (db <= -59.95 ? 0 : dbToGain(db));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function softClip(x) {
	if (x > 3) return 1;
	if (x < -3) return -1;
	const x2 = x * x;
	return (x * (27 + x2)) / (27 + 9 * x2);
}

// ---------------------------------------------------------------- utilities
class Biquad {
	constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
	reset() { this.z1 = this.z2 = 0; }
	process(x) {
		const y = this.b0 * x + this.z1;
		this.z1 = this.b1 * x - this.a1 * y + this.z2;
		this.z2 = this.b2 * x - this.a2 * y;
		return y;
	}
	set(B0, B1, B2, A0, A1, A2) {
		const inv = 1 / A0;
		this.b0 = B0 * inv; this.b1 = B1 * inv; this.b2 = B2 * inv; this.a1 = A1 * inv; this.a2 = A2 * inv;
	}
	lowpass(fs, f, q = 0.7071) {
		const w = (2 * PI * Math.min(f, fs * 0.49)) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q);
		this.set((1 - c) * 0.5, 1 - c, (1 - c) * 0.5, 1 + a, -2 * c, 1 - a);
	}
	highpass(fs, f, q = 0.7071) {
		const w = (2 * PI * Math.min(f, fs * 0.49)) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q);
		this.set((1 + c) * 0.5, -(1 + c), (1 + c) * 0.5, 1 + a, -2 * c, 1 - a);
	}
	peak(fs, f, q, gainDb) {
		const A = Math.pow(10, gainDb / 40);
		const w = (2 * PI * Math.min(f, fs * 0.49)) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q);
		this.set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
	}
	highShelf(fs, f, gainDb, slope = 0.8) {
		const A = Math.pow(10, gainDb / 40);
		const w = (2 * PI * Math.min(f, fs * 0.49)) / fs, c = Math.cos(w), s = Math.sin(w);
		const a = (s / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
		const sq = 2 * Math.sqrt(A) * a;
		this.set(A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq),
			(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq);
	}
	copyFrom(o) { this.b0 = o.b0; this.b1 = o.b1; this.b2 = o.b2; this.a1 = o.a1; this.a2 = o.a2; }
}

class OnePoleLP {
	constructor() { this.a = 0; this.z = 0; }
	setCutoff(fs, f) { this.a = Math.exp((-2 * PI * f) / fs); }
	process(x) { this.z = x + this.a * (this.z - x); return this.z; }
	reset() { this.z = 0; }
}

// circular delay with cubic Hermite fractional read
class DelayLine {
	prepare(maxSamples) {
		let n = 1;
		while (n < maxSamples + 4) n <<= 1;
		this.buf = new Float32Array(n);
		this.mask = n - 1;
		this.w = 0;
	}
	reset() { this.buf.fill(0); }
	push(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
	read(d) {
		const rp = this.w - d;
		const i = Math.floor(rp), f = rp - i, m = this.mask, b = this.buf;
		const xm1 = b[(i - 1) & m], x0 = b[i & m], x1 = b[(i + 1) & m], x2 = b[(i + 2) & m];
		const c1 = 0.5 * (x1 - xm1);
		const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
		const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
		return ((c3 * f + c2) * f + c1) * f + x0;
	}
	readInt(d) { return this.buf[(this.w - d) & this.mask]; }
}

class SmoothNoise {
	constructor() { this.s = 0x9e3779b9 >>> 0; this.y = 0; this.target = 0; this.coeff = 0.999; this.counter = 0; this.period = 2048; }
	seed(v) { this.s = v >>> 0 || 1; }
	white() {
		let s = this.s;
		s ^= s << 13; s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5; s >>>= 0;
		this.s = s;
		return (s & 0xffffff) / 0x7fffff - 1;
	}
	prepare(fs, rateHz) {
		this.period = Math.max(1, Math.floor(fs / Math.max(0.05, rateHz)));
		this.coeff = Math.exp((-2 * PI * rateHz) / fs);
	}
	next() {
		if (--this.counter <= 0) { this.counter = this.period; this.target = this.white(); }
		this.y = this.target + this.coeff * (this.y - this.target);
		return this.y;
	}
}

class Ramp {
	constructor(v = 0) { this.cur = v; this.target = v; this.steps = 0; this.inc = 0; this.len = 1; }
	reset(fs, sec) { this.len = Math.max(1, Math.floor(fs * sec)); }
	setNow(v) { this.cur = this.target = v; this.steps = 0; }
	setTarget(v) {
		if (v === this.target) return;
		this.target = v; this.steps = this.len; this.inc = (v - this.cur) / this.len;
	}
	next() {
		if (this.steps > 0) { this.cur += this.inc; if (--this.steps === 0) this.cur = this.target; }
		return this.cur;
	}
}

// --------------------------------------------------------------- spring tank
class StretchedAllpassCascade {
	prepare(stages, stretch, coeff) {
		this.stages = stages; this.K = Math.max(1, stretch); this.a = coeff;
		this.state = new Float64Array(stages * this.K);
		this.idx = 0;
	}
	reset() { this.state.fill(0); }
	process(x) {
		const st = this.state, a = this.a, K = this.K;
		let p = this.idx;
		for (let i = 0; i < this.stages; ++i, p += K) {
			const wd = st[p];
			const wn = x - a * wd;
			st[p] = wn;
			x = a * wn + wd;
		}
		if (++this.idx >= K) this.idx = 0;
		return x;
	}
	groupDelay(w) {
		const c = Math.cos(w * this.K), a = this.a;
		return (this.stages * this.K * (1 - a * a)) / (1 + 2 * a * c + a * a);
	}
}

class Spring {
	constructor() {
		this.low = new StretchedAllpassCascade(); this.high = new StretchedAllpassCascade();
		this.lowDelay = new DelayLine(); this.highDelay = new DelayLine();
		this.lp1 = new Biquad(); this.lp2 = new Biquad(); this.loopHp = new Biquad(); this.hiHp = new Biquad(); this.hiLp = new Biquad();
		this.noise = new SmoothNoise();
		this.gLow = 0.8; this.gHigh = 0.6; this.fbLow = 0; this.fbHigh = 0; this.dirty = false;
	}
	prepare(fs, d) {
		const K = Math.max(1, Math.round(fs / (2 * 4300)));
		const fc = fs / (2 * K);
		this.low.prepare(d.lowStages, K, d.lowCoeff);
		this.high.prepare(d.highStages, 1, 0.62);
		const gdMid = this.low.groupDelay((2 * PI * 0.35 * fc) / fs);
		this.lowDelaySamples = Math.max(8, d.loopMs * 0.001 * fs - gdMid);
		const gdHigh = this.high.groupDelay((2 * PI * 7000) / fs);
		this.highDelaySamples = Math.max(8, d.highLoopMs * 0.001 * fs - gdHigh);
		this.roundTripLow = d.loopMs * 0.001;
		this.roundTripHigh = d.highLoopMs * 0.001;
		const maxMod = Math.floor(d.modDepthMs * 0.001 * fs) + 8;
		this.lowDelay.prepare(Math.floor(this.lowDelaySamples) + maxMod);
		this.highDelay.prepare(Math.floor(this.highDelaySamples) + maxMod);
		this.lp1.lowpass(fs, fc * 0.92, 0.54);
		this.lp2.lowpass(fs, fc * 0.92, 1.31);
		this.loopHp.highpass(fs, 55, 0.6);
		this.hiHp.highpass(fs, fc * 1.05, 0.7071);
		this.hiLp.lowpass(fs, Math.min(11000, fs * 0.45), 0.7071);
		this.noise.seed(d.seed);
		this.noise.prepare(fs, 1.7);
		this.modDepth = d.modDepthMs * 0.001 * fs;
		this.reset();
	}
	reset() {
		this.low.reset(); this.high.reset(); this.lowDelay.reset(); this.highDelay.reset();
		this.lp1.reset(); this.lp2.reset(); this.loopHp.reset(); this.hiHp.reset(); this.hiLp.reset();
		this.fbLow = this.fbHigh = 0;
	}
	setDecay(t60) {
		this.gLow = Math.min(Math.pow(10, (-3 * this.roundTripLow) / t60), 0.985);
		this.gHigh = Math.min(Math.pow(10, (-3 * this.roundTripHigh) / (t60 * 0.55)), 0.95);
	}
	process(x) {
		let v = x + this.gLow * this.fbLow;
		v = this.low.process(v);
		this.lowDelay.push(v);
		const m = this.noise.next() * this.modDepth;
		let y = this.lowDelay.read(this.lowDelaySamples + m);
		y = this.lp2.process(this.lp1.process(y));
		y = this.loopHp.process(y);
		if (this.dirty) y = softClip(y * 1.6) * (1 / 1.6);
		this.fbLow = y;

		let h = x + this.gHigh * this.fbHigh;
		h = this.high.process(h);
		this.highDelay.push(h);
		let hy = this.highDelay.read(this.highDelaySamples + m * 0.5);
		hy = this.hiLp.process(this.hiHp.process(hy));
		this.fbHigh = hy;
		return y + 0.12 * hy;
	}
}

class SpringTank {
	constructor() {
		this.springs = [new Spring(), new Spring(), new Spring()];
		this.inHp = new Biquad(); this.outLp = new Biquad(); this.outLpR = new Biquad();
		this.norm = 0.5;
		this.out = [0, 0];
	}
	prepare(fs) {
		this.springs[0].prepare(fs, { loopMs: 37.3, lowStages: 64, lowCoeff: -0.56, highLoopMs: 19.1, highStages: 36, modDepthMs: 0.35, seed: 0x1234567 });
		this.springs[1].prepare(fs, { loopMs: 41.9, lowStages: 72, lowCoeff: -0.54, highLoopMs: 21.7, highStages: 40, modDepthMs: 0.42, seed: 0x89abcde });
		this.springs[2].prepare(fs, { loopMs: 33.1, lowStages: 58, lowCoeff: -0.58, highLoopMs: 17.3, highStages: 32, modDepthMs: 0.30, seed: 0x2468ace });
		this.inHp.highpass(fs, 90, 0.6);
		this.outLp.lowpass(fs, Math.min(6500, fs * 0.45), 0.6);
		this.outLpR.copyFrom(this.outLp);
		this.reset();
	}
	reset() {
		for (const s of this.springs) s.reset();
		this.inHp.reset(); this.outLp.reset(); this.outLpR.reset();
	}
	setDecay(t60) {
		for (const s of this.springs) s.setDecay(t60);
		const g = Math.pow(10, (-3 * 0.038) / t60);
		this.norm = Math.sqrt(1 - g * g) * 1.5;
	}
	setDirty(d) { for (const s of this.springs) s.dirty = d; }
	process(input) {
		const x = this.inHp.process(input);
		const s1 = this.springs[0].process(x), s2 = this.springs[1].process(x), s3 = this.springs[2].process(x);
		this.out[0] = this.outLp.process((s1 + 0.6 * s3) * this.norm);
		this.out[1] = this.outLpR.process((s2 + 0.6 * s3) * this.norm);
		return this.out;
	}
	process3(a, b, c) {
		const s1 = this.springs[0].process(a), s2 = this.springs[1].process(b), s3 = this.springs[2].process(c);
		this.out[0] = this.outLp.process((s1 + 0.6 * s3) * this.norm);
		this.out[1] = this.outLpR.process((s2 + 0.6 * s3) * this.norm);
		return this.out;
	}
}

// --------------------------------------------------------------- plate
class Allpass {
	prepare(n) { this.len = n; this.buf = new Float32Array(n); this.pos = 0; }
	clear() { this.buf.fill(0); }
	process(x, g) {
		const d = this.buf[this.pos];
		const w = x - g * d;
		this.buf[this.pos] = w;
		if (++this.pos >= this.len) this.pos = 0;
		return d + g * w;
	}
	tap(n) { let i = this.pos - n; while (i < 0) i += this.len; return this.buf[i]; }
}

class PlateReverb {
	constructor() {
		this.inAp = [new Allpass(), new Allpass(), new Allpass(), new Allpass()];
		this.ap2 = [new Allpass(), new Allpass()];
		this.apMod = [new DelayLine(), new DelayLine()];
		this.del1 = [new DelayLine(), new DelayLine()];
		this.del2 = [new DelayLine(), new DelayLine()];
		this.apModLen = [0, 0]; this.del1Len = [0, 0]; this.del2Len = [0, 0];
		this.tapL = []; this.tapR = [];
		this.damp = [0, 0]; this.tankFb = [0, 0]; this.side = [0, 0];
		this.bwState = 0; this.lfo = 0; this.modScale = 1;
		this.decay = 0.5; this.damping = 0.0005; this.bandwidth = 0.9995;
		this.out = [0, 0];
	}
	prepare(fs) {
		const r = fs / 29761;
		const sc = (n) => Math.max(1, Math.round(n * r));
		[142, 107, 379, 277].forEach((n, i) => this.inAp[i].prepare(sc(n)));
		this.excursion = 16 * r;
		this.apMod[0].prepare(sc(672) + Math.floor(this.excursion) + 4); this.apModLen[0] = sc(672);
		this.apMod[1].prepare(sc(908) + Math.floor(this.excursion) + 4); this.apModLen[1] = sc(908);
		this.del1[0].prepare(sc(4453)); this.del1Len[0] = sc(4453);
		this.del1[1].prepare(sc(4217)); this.del1Len[1] = sc(4217);
		this.ap2[0].prepare(sc(1800));
		this.ap2[1].prepare(sc(2656));
		this.del2[0].prepare(sc(3720)); this.del2Len[0] = sc(3720);
		this.del2[1].prepare(sc(3163)); this.del2Len[1] = sc(3163);
		this.tapL = [266, 2974, 1913, 1996, 1990, 187, 1066].map(sc);
		this.tapR = [353, 3627, 1228, 2673, 2111, 335, 121].map(sc);
		this.lfoInc = (2 * PI * 0.9) / fs;
		this.reset();
	}
	reset() {
		for (const a of this.inAp) a.clear();
		for (let i = 0; i < 2; ++i) {
			this.apMod[i].reset(); this.del1[i].reset(); this.ap2[i].clear(); this.del2[i].reset();
			this.damp[i] = 0;
		}
		this.bwState = 0; this.tankFb[0] = this.tankFb[1] = 0; this.lfo = 0;
	}
	setDecay(d) { this.decay = clamp(d, 0, 0.985); }
	setDamping(d) { this.damping = clamp(d, 0, 0.95); }
	setBandwidth(b) { this.bandwidth = clamp(b, 0.05, 0.9999); }
	process(input) {
		this.bwState += this.bandwidth * (input - this.bwState);
		let x = this.bwState;
		x = this.inAp[0].process(x, 0.75);
		x = this.inAp[1].process(x, 0.75);
		x = this.inAp[2].process(x, 0.625);
		x = this.inAp[3].process(x, 0.625);

		this.lfo += this.lfoInc; if (this.lfo > 2 * PI) this.lfo -= 2 * PI;
		const ex = this.excursion * this.modScale;
		const mod0 = Math.sin(this.lfo) * ex, mod1 = Math.cos(this.lfo) * ex;
		const decay = this.decay, damping = this.damping;

		for (let s = 0; s < 2; ++s) {
			let v = x + this.tankFb[1 - s];
			const am = this.apMod[s];
			const d = am.read(this.apModLen[s] + (s === 0 ? mod0 : mod1));
			const w = v + 0.7 * d;
			am.push(w);
			v = d - 0.7 * w;
			this.del1[s].push(v);
			v = this.del1[s].readInt(this.del1Len[s]);
			this.damp[s] = v * (1 - damping) + this.damp[s] * damping;
			v = this.damp[s] * decay;
			v = this.ap2[s].process(v, -0.5);
			this.del2[s].push(v);
			this.side[s] = this.del2[s].readInt(this.del2Len[s]) * decay;
		}
		this.tankFb[0] = this.side[0];
		this.tankFb[1] = this.side[1];

		const tl = this.tapL, tr = this.tapR, d1 = this.del1, d2 = this.del2, a2 = this.ap2;
		const L = d1[1].readInt(tl[0]) + d1[1].readInt(tl[1]) - a2[1].tap(tl[2]) + d2[1].readInt(tl[3])
			- d1[0].readInt(tl[4]) - a2[0].tap(tl[5]) - d2[0].readInt(tl[6]);
		const R = d1[0].readInt(tr[0]) + d1[0].readInt(tr[1]) - a2[0].tap(tr[2]) + d2[0].readInt(tr[3])
			- d1[1].readInt(tr[4]) - a2[1].tap(tr[5]) - d2[1].readInt(tr[6]);
		this.out[0] = L * 0.6;
		this.out[1] = R * 0.6;
		return this.out;
	}
}

// --------------------------------------------------------------- spring crash
class SpringCrash {
	constructor() {
		this.tank = new SpringTank();
		this.noise = new SmoothNoise();
		this.colour = [new Biquad(), new Biquad(), new Biquad()];
		this.body = [new Biquad(), new Biquad(), new Biquad()];
		this.outHp = new Biquad(); this.outHpR = new Biquad();
		this.burst = [0, 0, 0]; this.thump = [0, 0, 0]; this.thumpPhase = [0, 0, 0];
		this.silent = 1 << 30;
		this.out = [0, 0];
	}
	prepare(fs) {
		this.fs = fs;
		this.tank.prepare(fs);
		this.tank.setDirty(true);
		this.burstDecay = Math.exp(-1 / (0.006 * fs));
		this.thumpDecay = Math.exp(-1 / (0.045 * fs));
		this.thumpInc = (2 * PI * 62) / fs;
		for (let i = 0; i < 3; ++i) {
			this.colour[i].lowpass(fs, 5200, 0.9);
			this.body[i].peak(fs, 900 + 350 * i, 1.2, 6);
		}
		this.outHp.highpass(fs, 70, 0.7071);
		this.outHpR.copyFrom(this.outHp);
		this.noise.seed(0xc0ffee);
		this.reset();
	}
	reset() {
		this.tank.reset();
		for (let i = 0; i < 3; ++i) {
			this.burst[i] = this.thump[i] = this.thumpPhase[i] = 0;
			this.colour[i].reset(); this.body[i].reset();
		}
		this.outHp.reset(); this.outHpR.reset();
		this.silent = 1 << 30;
	}
	setDecay(t60) { this.tank.setDecay(Math.max(2.2, t60 * 1.2)); }
	hit(spring, strength) {
		// panel order top/middle/bottom -> tank springs left/centre/right
		spring = [0, 2, 1][clamp(spring | 0, 0, 2)];
		strength = clamp(strength, 0, 2);
		this.burst[spring] = Math.max(this.burst[spring], strength);
		this.thump[spring] = Math.max(this.thump[spring], strength * strength * 0.5);
		this.thumpPhase[spring] = 0;
		this.silent = 0;
	}
	isActive() { return this.silent < this.fs * 8; }
	process() {
		const out = this.out;
		if (!this.isActive()) { out[0] = out[1] = 0; return out; }
		let exciting = false;
		const inp = [0, 0, 0];
		for (let i = 0; i < 3; ++i) {
			if (this.burst[i] > 1e-4 || this.thump[i] > 1e-4) {
				exciting = true;
				let x = this.noise.white() * this.burst[i] * 2.5;
				x = this.body[i].process(this.colour[i].process(x));
				x += Math.sin(this.thumpPhase[i]) * this.thump[i] * 3;
				this.thumpPhase[i] += this.thumpInc * (1 + 2 * this.thump[i]);
				this.burst[i] *= this.burstDecay;
				this.thump[i] *= this.thumpDecay;
				inp[i] = x;
			}
		}
		const t = this.tank.process3(inp[0], inp[1], inp[2]);
		out[0] = softClip(this.outHp.process(t[0]) * 2.2) * 0.9;
		out[1] = softClip(this.outHpR.process(t[1]) * 2.2) * 0.9;
		if (exciting || Math.abs(out[0]) + Math.abs(out[1]) > 1e-4) this.silent = 0;
		else ++this.silent;
		return out;
	}
}

// --------------------------------------------------------------- processor
class FederhallProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const fs = sampleRate;
		this.fs = fs;
		const p = (options && options.processorOptions && options.processorOptions.params) || {};
		this.params = Object.assign({
			input: 0, predelay: 20, reverb: 0.5, dwell: 0.45, tone: 0.5, mix: 0.3, output: 0,
			mode: 0, eq: 1, drive: 0, bypass: 0,
		}, p);

		this.inGain = new Ramp(); this.outGain = new Ramp(); this.mixAmt = new Ramp();
		this.preDelayMs = new Ramp(); this.dwellAmt = new Ramp(); this.wetOn = new Ramp(1);
		for (const r of [this.inGain, this.outGain, this.mixAmt, this.dwellAmt, this.wetOn]) r.reset(fs, 0.05);
		this.preDelayMs.reset(fs, 0.25);
		this.inGain.setNow(gainFromDb(this.params.input));
		this.outGain.setNow(gainFromDb(this.params.output));
		this.mixAmt.setNow(this.params.mix);
		this.preDelayMs.setNow(this.params.predelay);
		this.dwellAmt.setNow(this.params.dwell);
		this.wetOn.setNow(this.params.bypass ? 0 : 1);

		this.preDelay = new DelayLine(); this.preDelay.prepare(Math.floor(0.52 * fs) + 8);
		this.spring = new SpringTank(); this.spring.prepare(fs);
		this.plate = new PlateReverb(); this.plate.prepare(fs);
		this.crash = new SpringCrash(); this.crash.prepare(fs);
		this.crashPending = [0, 0, 0];

		this.drvPre = new Biquad(); this.drvPost = new Biquad(); this.drvHp = new Biquad();
		this.drvHp.highpass(fs, 70, 0.6);
		this.dcBlock = new OnePoleLP(); this.dcBlock.setCutoff(fs, 12);
		this.lastDirty = -1;

		const mk = () => [new Biquad(), new Biquad()];
		this.eqHp1 = mk(); this.eqHp2 = mk(); this.eqPeak = mk(); this.eqLp = mk(); this.toneLp = mk(); this.toneShelf = mk();
		this.lastTone = -1; this.lastEq = -1;

		this.modeMix = this.params.mode > 0.5 ? 1 : 0;
		this.idleEngine = -1;

		this.inEnv = 0; this.outEnv = 0; this.sprEnv = 0; this.kickEnv = 0;
		this.vuCoeff = Math.exp(-1 / (0.065 * fs));
		this.sprAtt = Math.exp(-1 / (0.006 * fs));
		this.sprRel = Math.exp(-1 / (0.30 * fs));
		this.kickAtt = Math.exp(-1 / (0.001 * fs));
		this.kickRel = Math.exp(-1 / (0.08 * fs));
		this.blockCount = 0;
		this.send = new Float32Array(128);

		this.port.onmessage = (e) => {
			const m = e.data || {};
			if (m.type === 'param' && m.name in this.params) this.params[m.name] = +m.value;
			else if (m.type === 'params') Object.assign(this.params, m.values);
			else if (m.type === 'strike') {
				const s = m.spring | 0;
				if (s >= 0 && s < 3 && m.strength > 0) this.crashPending[s] += +m.strength;
			} else if (m.type === 'reset') {
				this.spring.reset(); this.plate.reset(); this.crash.reset(); this.preDelay.reset();
			}
		};
	}

	updateFilters(tone, dub) {
		const fs = this.fs;
		for (let c = 0; c < 2; ++c) {
			if (dub) {
				this.eqHp1[c].highpass(fs, 190, 0.54);
				this.eqHp2[c].highpass(fs, 190, 1.31);
				this.eqPeak[c].peak(fs, 1500, 0.8, 5);
				this.eqLp[c].lowpass(fs, 7000, 0.7071);
			} else {
				this.eqHp1[c].highpass(fs, 45, 0.54);
				this.eqHp2[c].highpass(fs, 45, 1.31);
				this.eqPeak[c].peak(fs, 1500, 0.8, 0);
				this.eqLp[c].lowpass(fs, 19000, 0.7071);
			}
			const cutoff = 1600 * Math.pow(16000 / 1600, tone);
			this.toneLp[c].lowpass(fs, cutoff, 0.6);
			this.toneShelf[c].highShelf(fs, 2500, (tone - 0.5) * 10);
		}
	}

	process(inputs, outputs) {
		const out = outputs[0];
		if (!out || out.length === 0) return true;
		const n = out[0].length;
		const inp = inputs[0] || [];
		const inL = inp[0] || null;
		const inR = inp[1] || inL;
		const L = out[0];
		const R = out[1] || null;
		if (this.send.length < n) this.send = new Float32Array(n);
		const send = this.send;
		const P = this.params, fs = this.fs;

		this.inGain.setTarget(gainFromDb(P.input));
		this.outGain.setTarget(gainFromDb(P.output));
		this.mixAmt.setTarget(P.mix);
		this.preDelayMs.setTarget(P.predelay);
		this.dwellAmt.setTarget(P.dwell);
		this.wetOn.setTarget(P.bypass > 0.5 ? 0 : 1);

		const reverb = P.reverb, tone = P.tone;
		const dubEq = P.eq > 0.5, dirty = P.drive > 0.5, plateMode = P.mode > 0.5;
		if (Math.abs(tone - this.lastTone) > 0.001 || (dubEq ? 1 : 0) !== this.lastEq) {
			this.updateFilters(tone, dubEq);
			this.lastTone = tone; this.lastEq = dubEq ? 1 : 0;
		}
		if ((dirty ? 1 : 0) !== this.lastDirty) {
			this.drvPre.peak(fs, 1200, 0.7, dirty ? 7 : 0);
			this.drvPost.peak(fs, 1200, 0.7, dirty ? -5 : 0);
			this.lastDirty = dirty ? 1 : 0;
		}

		const t60 = 0.6 * Math.pow(10, reverb);
		this.spring.setDecay(t60);
		this.spring.setDirty(dirty);
		this.crash.setDecay(t60);
		for (let s = 0; s < 3; ++s) {
			const hit = this.crashPending[s];
			if (hit > 0) { this.crash.hit(s, Math.min(hit, 2)); this.crashPending[s] = 0; }
		}
		this.plate.setDecay(0.30 + 0.67 * reverb);
		this.plate.setDamping(0.55 - 0.5 * tone);
		this.plate.setBandwidth(0.55 + 0.4499 * tone);

		// stage 1+2: input gain, input meter, pre-delay, tank driver
		const vuC = this.vuCoeff;
		let inEnv = this.inEnv;
		for (let i = 0; i < n; ++i) {
			const g = this.inGain.next();
			const l = inL ? inL[i] * g : 0;
			const r = inR ? inR[i] * g : 0;
			L[i] = l;
			if (R) R[i] = r;
			const mono = 0.5 * (l + r);
			const sq = 0.5 * (l * l + r * r);
			inEnv = sq + vuC * (inEnv - sq);

			this.preDelay.push(mono);
			const d = this.preDelayMs.next() * 0.001 * fs;
			let x = d < 1 ? mono : this.preDelay.read(d);

			const dg = dbToGain(-8 + 30 * this.dwellAmt.next());
			x = this.drvPre.process(this.drvHp.process(x)) * dg;
			let y;
			if (dirty) y = (Math.tanh(1.7 * x + 0.3) - Math.tanh(0.3)) * (1 / 1.7);
			else y = softClip(0.6 * x) * (1 / 0.6);
			y = this.drvPost.process(y);
			y -= this.dcBlock.process(y);
			send[i] = y / Math.sqrt(Math.max(1, dg));
		}
		this.inEnv = inEnv;

		// stage 3: tank, wet EQ, mix, output
		const fadeStep = 1 / (0.03 * fs);
		const e = this;
		let outEnv = this.outEnv, sprEnv = this.sprEnv, kickEnv = this.kickEnv;
		for (let i = 0; i < n; ++i) {
			const x = send[i];
			let sL = 0, sR = 0, pL = 0, pR = 0;
			if (plateMode) e.modeMix = Math.min(1, e.modeMix + fadeStep);
			else e.modeMix = Math.max(0, e.modeMix - fadeStep);
			if (e.modeMix < 1) { const o = e.spring.process(x); sL = o[0]; sR = o[1]; }
			if (e.modeMix > 0) { const o = e.plate.process(x * 0.9); pL = o[0]; pR = o[1]; }
			let wL = sL + (pL - sL) * e.modeMix;
			let wR = sR + (pR - sR) * e.modeMix;

			wL = e.toneLp[0].process(e.toneShelf[0].process(e.eqLp[0].process(e.eqPeak[0].process(e.eqHp2[0].process(e.eqHp1[0].process(wL))))));
			wR = e.toneLp[1].process(e.toneShelf[1].process(e.eqLp[1].process(e.eqPeak[1].process(e.eqHp2[1].process(e.eqHp1[1].process(wR))))));

			const a = Math.abs(x);
			kickEnv = a + (a > kickEnv ? e.kickAtt : e.kickRel) * (kickEnv - a);
			const c = e.crash.process();
			const cL = c[0], cR = c[1];
			const w = 0.5 * (Math.abs(wL) + Math.abs(wR) + Math.abs(cL) + Math.abs(cR));
			sprEnv = w + (w > sprEnv ? e.sprAtt : e.sprRel) * (sprEnv - w);

			const m = e.mixAmt.next();
			const dryG = Math.cos(m * 0.5 * PI);
			const wetG = Math.sin(m * 0.5 * PI);
			const og = e.outGain.next();
			// bypass (A/B compare) crossfades to the untouched input; the crash stays playable
			const on = e.wetOn.next(), off = 1 - on;

			const rawL = inL ? inL[i] : 0, rawR = inR ? inR[i] : 0;
			const oL = (L[i] * dryG + wL * wetG) * og * on + rawL * off + cL * og;
			L[i] = oL;
			let sq = oL * oL;
			if (R) {
				const oR = (R[i] * dryG + wR * wetG) * og * on + rawR * off + cR * og;
				R[i] = oR;
				sq = 0.5 * (sq + oR * oR);
			}
			outEnv = sq + vuC * (outEnv - sq);
		}
		for (let ch = 2; ch < out.length; ++ch) out[ch].set(L);

		const idle = this.modeMix >= 1 ? 0 : this.modeMix <= 0 ? 1 : -1;
		if (idle !== this.idleEngine) {
			if (idle === 0) this.spring.reset();
			if (idle === 1) this.plate.reset();
			this.idleEngine = idle;
		}

		if (!isFinite(this.inEnv)) this.inEnv = 0;
		if (!isFinite(outEnv)) outEnv = 0;
		if (!isFinite(sprEnv)) { sprEnv = 0; this.spring.reset(); this.plate.reset(); this.crash.reset(); }
		this.outEnv = outEnv; this.sprEnv = sprEnv; this.kickEnv = kickEnv;

		if (++this.blockCount >= 4) {
			this.blockCount = 0;
			this.port.postMessage({
				type: 'meter',
				inRms: Math.sqrt(this.inEnv), outRms: Math.sqrt(outEnv), spring: sprEnv, kick: kickEnv,
			});
		}
		return true;
	}
}

registerProcessor('federhall-processor', FederhallProcessor);
