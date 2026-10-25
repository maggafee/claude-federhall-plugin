#pragma once

#include "DspUtils.h"

namespace dub
{
/*  Spring tank model after Välimäki, Parker & Abel, "Parametric spring
    reverberation effect" (JAES 2010), simplified for real-time use.

    Every spring has two feedback loops:
      - low-chirp loop: a long cascade of "stretched" first order allpass
        filters (z^-1 replaced by z^-K). Their group delay falls with
        frequency up to fs/(2K), so each echo arrives as the descending
        "drip" chirp typical of spring tanks. Because the signal passes the
        cascade again on every round trip, later echoes get more and more
        smeared - exactly like a real spring.
      - high-chirp loop: a short cascade of plain allpasses for the bright
        splash above the transition frequency.
    The loop delay is modulated slowly by smoothed noise (spring wobble).
    In "dirty" mode the loop saturates softly: hard hits make the springs
    crash and compress like an overdriven tank.

    The tank holds three springs like the unit in the artwork: spring 1
    feeds the left output, spring 2 the right, spring 3 both.
*/

struct StretchedAllpassCascade
{
    int stages = 0, K = 1, idx = 0;
    float a = -0.55f;
    std::vector<float> state;  // [stage * K + ringIndex]

    void prepare (int numStages, int stretch, float coeff)
    {
        stages = numStages; K = std::max (1, stretch); a = coeff;
        state.assign ((size_t) (stages * K), 0.0f);
        idx = 0;
    }

    void reset() { std::fill (state.begin(), state.end(), 0.0f); }

    inline float process (float x)
    {
        float* s = state.data() + idx;
        for (int i = 0; i < stages; ++i, s += K)
        {
            const float wd = *s;          // w[n-K]
            const float wn = x - a * wd;  // w[n]
            *s = wn;
            x = a * wn + wd;
        }
        if (++idx >= K) idx = 0;
        return x;
    }

    // group delay (samples) at normalised frequency w (rad/sample)
    float groupDelay (float w) const
    {
        const float c = std::cos (w * (float) K);
        return (float) stages * (float) K * (1 - a * a) / (1 + 2 * a * c + a * a);
    }
};

class Spring
{
public:
    struct Design
    {
        float loopMs;       // round trip time of the low-chirp loop
        int lowStages;      // dispersion amount
        float lowCoeff;     // stretched allpass coefficient (<0: descending chirp)
        float highLoopMs;
        int highStages;
        float modDepthMs;
        uint32_t seed;
    };

    void prepare (double sampleRate, const Design& d)
    {
        fs = sampleRate;
        design = d;
        K = std::max (1, (int) std::lround (fs / (2.0 * 4300.0)));
        const float fc = (float) fs / (2.0f * (float) K);  // chirp transition frequency

        low.prepare (d.lowStages, K, d.lowCoeff);
        high.prepare (d.highStages, 1, 0.62f);

        // the cascade adds group delay; subtract its mid-band value so the
        // round trip matches the design time
        const float gdMid = low.groupDelay (2 * kPi * 0.35f * fc / (float) fs);
        lowDelaySamples = std::max (8.0f, d.loopMs * 0.001f * (float) fs - gdMid);
        const float gdHigh = high.groupDelay (2 * kPi * 7000.0f / (float) fs);
        highDelaySamples = std::max (8.0f, d.highLoopMs * 0.001f * (float) fs - gdHigh);
        roundTripLow = d.loopMs * 0.001f;
        roundTripHigh = d.highLoopMs * 0.001f;

        const int maxMod = (int) (d.modDepthMs * 0.001 * fs) + 8;
        lowDelay.prepare ((int) lowDelaySamples + maxMod);
        highDelay.prepare ((int) highDelaySamples + maxMod);

        lp1.lowpass (fs, fc * 0.92f, 0.54f);
        lp2.lowpass (fs, fc * 0.92f, 1.31f);
        loopHp.highpass (fs, 55.0f, 0.6f);
        hiHp.highpass (fs, fc * 1.05f, 0.7071f);
        hiLp.lowpass (fs, std::min (11000.0f, (float) fs * 0.45f), 0.7071f);

        noise.seed (d.seed);
        noise.prepare (fs, 1.7f);
        modDepth = d.modDepthMs * 0.001f * (float) fs;
        reset();
    }

    void reset()
    {
        low.reset(); high.reset(); lowDelay.reset(); highDelay.reset();
        lp1.reset(); lp2.reset(); loopHp.reset(); hiHp.reset(); hiLp.reset();
        fbLow = fbHigh = 0;
    }

    // t60 in seconds
    void setDecay (float t60)
    {
        gLow = std::pow (10.0f, -3.0f * roundTripLow / t60);
        gHigh = std::pow (10.0f, -3.0f * roundTripHigh / (t60 * 0.55f));
        gLow = std::min (gLow, 0.985f);
        gHigh = std::min (gHigh, 0.95f);
    }

    void setDirty (bool d) { dirty = d; }

    inline float process (float x)
    {
        // low chirp loop
        float v = x + gLow * fbLow;
        v = low.process (v);
        lowDelay.push (v);
        const float m = noise.next() * modDepth;
        float y = lowDelay.read (lowDelaySamples + m);
        y = lp2.process (lp1.process (y));
        y = loopHp.process (y);
        if (dirty)
            y = softClip (y * 1.6f) * (1.0f / 1.6f);
        fbLow = y;

        // high chirp loop
        float h = x + gHigh * fbHigh;
        h = high.process (h);
        highDelay.push (h);
        float hy = highDelay.read (highDelaySamples + m * 0.5f);
        hy = hiLp.process (hiHp.process (hy));
        fbHigh = hy;

        return y + 0.12f * hy;
    }

private:
    double fs = 44100.0;
    Design design {};
    int K = 5;
    StretchedAllpassCascade low, high;
    DelayLine lowDelay, highDelay;
    Biquad lp1, lp2, loopHp, hiHp, hiLp;
    SmoothNoise noise;
    float lowDelaySamples = 1000, highDelaySamples = 500;
    float roundTripLow = 0.04f, roundTripHigh = 0.02f;
    float modDepth = 0;
    float gLow = 0.8f, gHigh = 0.6f;
    float fbLow = 0, fbHigh = 0;
    bool dirty = false;
};

class SpringTank
{
public:
    void prepare (double sampleRate)
    {
        fs = sampleRate;
        // three slightly different springs (lengths/tension), like a
        // classic three-spring tank
        springs[0].prepare (fs, { 37.3f, 64, -0.56f, 19.1f, 36, 0.35f, 0x1234567u });
        springs[1].prepare (fs, { 41.9f, 72, -0.54f, 21.7f, 40, 0.42f, 0x89ABCDEu });
        springs[2].prepare (fs, { 33.1f, 58, -0.58f, 17.3f, 32, 0.30f, 0x2468ACEu });
        // input / output transducers: band limited
        inHp.highpass (fs, 90.0f, 0.6f);
        outLp.lowpass (fs, std::min (6500.0f, (float) fs * 0.45f), 0.6f);
        outLpR = outLp;
        reset();
    }

    void reset()
    {
        for (auto& s : springs) s.reset();
        inHp.reset(); outLp.reset(); outLpR.reset();
    }

    void setDecay (float t60)
    {
        for (auto& s : springs) s.setDecay (t60);
        // keep the level roughly constant across decay times
        const float g = std::pow (10.0f, -3.0f * 0.038f / t60);
        norm = std::sqrt (1.0f - g * g) * 1.5f;
    }

    void setDirty (bool d) { for (auto& s : springs) s.setDirty (d); }

    inline void process (float in, float& outL, float& outR)
    {
        const float x = inHp.process (in);
        const float s1 = springs[0].process (x);
        const float s2 = springs[1].process (x);
        const float s3 = springs[2].process (x);
        outL = outLp.process ((s1 + 0.6f * s3) * norm);
        outR = outLpR.process ((s2 + 0.6f * s3) * norm);
    }

    // every spring gets its own input (used when a single spring is struck)
    inline void process3 (const float* in, float& outL, float& outR)
    {
        const float s1 = springs[0].process (in[0]);
        const float s2 = springs[1].process (in[1]);
        const float s3 = springs[2].process (in[2]);
        outL = outLp.process ((s1 + 0.6f * s3) * norm);
        outR = outLpR.process ((s2 + 0.6f * s3) * norm);
    }

private:
    double fs = 44100.0;
    Spring springs[3];
    Biquad inHp, outLp, outLpR;
    float norm = 0.5f;
};
} // namespace dub
