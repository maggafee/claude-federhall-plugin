#pragma once

#include "DspUtils.h"

namespace dub
{
/*  Plate reverb after Jon Dattorro, "Effect Design Part 1" (JAES 1997),
    the classic figure-of-eight plate tank. Delay lengths are given for
    29761 Hz and scaled to the running sample rate.
*/
class PlateReverb
{
public:
    void prepare (double sampleRate)
    {
        fs = sampleRate;
        r = (float) (fs / 29761.0);
        auto sc = [this] (int n) { return std::max (1, (int) std::lround ((float) n * r)); };

        const int inLens[4] = { 142, 107, 379, 277 };
        for (int i = 0; i < 4; ++i) { inAp[i].prepare (sc (inLens[i])); }

        excursion = 16.0f * r;
        apMod[0].prepare (sc (672) + (int) excursion + 4);  apModLen[0] = (float) sc (672);
        apMod[1].prepare (sc (908) + (int) excursion + 4);  apModLen[1] = (float) sc (908);
        del1[0].prepare (sc (4453)); del1Len[0] = sc (4453);
        del1[1].prepare (sc (4217)); del1Len[1] = sc (4217);
        ap2[0].prepare (sc (1800));
        ap2[1].prepare (sc (2656));
        del2[0].prepare (sc (3720)); del2Len[0] = sc (3720);
        del2[1].prepare (sc (3163)); del2Len[1] = sc (3163);

        // output taps
        const int tl[7] = { 266, 2974, 1913, 1996, 1990, 187, 1066 };
        const int tr[7] = { 353, 3627, 1228, 2673, 2111, 335, 121 };
        for (int i = 0; i < 7; ++i) { tapL[i] = sc (tl[i]); tapR[i] = sc (tr[i]); }

        lfoInc = 2 * kPi * 0.9f / (float) fs;
        reset();
    }

    void reset()
    {
        for (auto& a : inAp) a.clear();
        for (int i = 0; i < 2; ++i)
        {
            apMod[i].reset(); del1[i].reset(); ap2[i].clear(); del2[i].reset();
            damp[i] = 0;
        }
        bwState = 0; tankFb[0] = tankFb[1] = 0; lfo = 0;
    }

    void setDecay (float d)      { decay = std::clamp (d, 0.0f, 0.985f); }
    void setDamping (float d)    { damping = std::clamp (d, 0.0f, 0.95f); }
    void setBandwidth (float b)  { bandwidth = std::clamp (b, 0.05f, 0.9999f); }
    void setModDepth (float m)   { modScale = m; }

    inline void process (float in, float& outL, float& outR)
    {
        bwState += bandwidth * (in - bwState);
        float x = bwState;
        x = inAp[0].process (x, inDiff1);
        x = inAp[1].process (x, inDiff1);
        x = inAp[2].process (x, inDiff2);
        x = inAp[3].process (x, inDiff2);

        lfo += lfoInc; if (lfo > 2 * kPi) lfo -= 2 * kPi;
        const float mod[2] = { std::sin (lfo) * excursion * modScale, std::cos (lfo) * excursion * modScale };

        float sideOut[2];
        for (int s = 0; s < 2; ++s)
        {
            float v = x + tankFb[1 - s];
            // modulated allpass (decay diffusion 1, negative coefficient)
            {
                const float d = apMod[s].read (apModLen[s] + mod[s]);
                const float w = v + decDiff1 * d;
                apMod[s].push (w);
                v = d - decDiff1 * w;
            }
            del1[s].push (v);
            v = del1[s].readInt (del1Len[s]);
            damp[s] = v * (1 - damping) + damp[s] * damping;
            v = damp[s] * decay;
            v = ap2[s].process (v, -decDiff2);
            del2[s].push (v);
            sideOut[s] = del2[s].readInt (del2Len[s]) * decay;
        }
        tankFb[0] = sideOut[0];
        tankFb[1] = sideOut[1];

        // DelayLine::readInt(d) reads what was pushed d samples ago
        const float L = del1[1].readInt (tapL[0]) + del1[1].readInt (tapL[1]) - ap2[1].tap (tapL[2])
                      + del2[1].readInt (tapL[3]) - del1[0].readInt (tapL[4]) - ap2[0].tap (tapL[5])
                      - del2[0].readInt (tapL[6]);
        const float R = del1[0].readInt (tapR[0]) + del1[0].readInt (tapR[1]) - ap2[0].tap (tapR[2])
                      + del2[0].readInt (tapR[3]) - del1[1].readInt (tapR[4]) - ap2[1].tap (tapR[5])
                      - del2[1].readInt (tapR[6]);
        outL = L * 0.6f;
        outR = R * 0.6f;
    }

private:
    struct Allpass
    {
        std::vector<float> buf; int len = 1, pos = 0;
        void prepare (int n) { len = n; buf.assign ((size_t) n, 0.0f); pos = 0; }
        void clear() { std::fill (buf.begin(), buf.end(), 0.0f); }
        inline float process (float x, float g)
        {
            const float d = buf[(size_t) pos];
            const float w = x - g * d;
            buf[(size_t) pos] = w;
            if (++pos >= len) pos = 0;
            return d + g * w;
        }
        // value written n samples ago
        inline float tap (int n) const
        {
            int i = pos - n; while (i < 0) i += len;
            return buf[(size_t) i];
        }
    };

    double fs = 44100.0;
    float r = 1.0f;
    Allpass inAp[4], ap2[2];
    DelayLine apMod[2], del1[2], del2[2];
    float apModLen[2] {}, excursion = 16;
    int del1Len[2] {}, del2Len[2] {};
    int tapL[7] {}, tapR[7] {};
    float damp[2] {}, tankFb[2] {};
    float bwState = 0;
    float lfo = 0, lfoInc = 0, modScale = 1;

    float decay = 0.5f, damping = 0.0005f, bandwidth = 0.9995f;
    const float inDiff1 = 0.75f, inDiff2 = 0.625f, decDiff1 = 0.70f, decDiff2 = 0.50f;
};
} // namespace dub
