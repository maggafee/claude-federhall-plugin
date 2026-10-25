#pragma once

#include "SpringTank.h"

namespace dub
{
/*  The famous King Tubby "spring crash": the tank gets kicked or the springs
    get plucked/scraped by hand. The springs slam into each other, the
    transducers overload and the whole tank explodes into a metallic boom.

    It has its own (always dirty) three-spring tank so the crash rings out
    independently of the Mix knob and of Spring/Plate mode. Hits are fed in
    from the GUI: each hit excites the touched spring with a short burst of
    noise plus a low thump; a fast drag produces many small hits = scrape.
*/
class SpringCrash
{
public:
    void prepare (double sampleRate)
    {
        fs = sampleRate;
        tank.prepare (fs);
        tank.setDirty (true);
        burstDecay = std::exp (-1.0f / (0.006f * (float) fs));
        thumpDecay = std::exp (-1.0f / (0.045f * (float) fs));
        thumpInc = 2 * kPi * 62.0f / (float) fs;
        for (int i = 0; i < 3; ++i)
        {
            colour[i].lowpass (fs, 5200.0f, 0.9f);
            body[i].peak (fs, 900.0f + 350.0f * (float) i, 1.2f, 6.0f);
        }
        outHp.highpass (fs, 70.0f, 0.7071f);
        outHpR = outHp;
        noise.seed (0xC0FFEEu);
        reset();
    }

    void reset()
    {
        tank.reset();
        for (int i = 0; i < 3; ++i)
        {
            burst[i] = thump[i] = 0; thumpPhase[i] = 0;
            colour[i].reset(); body[i].reset();
        }
        outHp.reset(); outHpR.reset();
        silentSamples = 1 << 30;
    }

    void setDecay (float t60) { tank.setDecay (std::max (2.2f, t60 * 1.2f)); }

    // strength ~0.1 (light scrape) .. 2 (violent kick)
    void hit (int spring, float strength)
    {
        // panel order top/middle/bottom -> tank springs left/centre/right
        static constexpr int toTank[3] = { 0, 2, 1 };
        spring = toTank[std::clamp (spring, 0, 2)];
        strength = std::clamp (strength, 0.0f, 2.0f);
        burst[spring] = std::max (burst[spring], strength);
        thump[spring] = std::max (thump[spring], strength * strength * 0.5f);
        thumpPhase[spring] = 0;
        silentSamples = 0;
    }

    bool isActive() const { return silentSamples < (int) (fs * 8.0); }

    inline void process (float& outL, float& outR)
    {
        if (! isActive()) { outL = outR = 0; return; }

        float in[3];
        bool exciting = false;
        for (int i = 0; i < 3; ++i)
        {
            float x = 0;
            if (burst[i] > 1.0e-4f || thump[i] > 1.0e-4f)
            {
                exciting = true;
                x = noise.white() * burst[i] * 2.5f;
                x = body[i].process (colour[i].process (x));
                x += std::sin (thumpPhase[i]) * thump[i] * 3.0f;
                thumpPhase[i] += thumpInc * (1.0f + 2.0f * thump[i]);  // pitch drops as it decays
                burst[i] *= burstDecay;
                thump[i] *= thumpDecay;
            }
            in[i] = x;
        }
        tank.process3 (in, outL, outR);
        // transducer overload: the crash is loud and hairy, but bounded
        outL = softClip (outHp.process (outL) * 2.2f) * 0.9f;
        outR = softClip (outHpR.process (outR) * 2.2f) * 0.9f;

        if (exciting || std::abs (outL) + std::abs (outR) > 1.0e-4f) silentSamples = 0;
        else ++silentSamples;
    }

private:
    double fs = 44100.0;
    SpringTank tank;
    SmoothNoise noise;
    Biquad colour[3], body[3], outHp, outHpR;
    float burst[3] {}, thump[3] {}, thumpPhase[3] {};
    float burstDecay = 0.99f, thumpDecay = 0.999f, thumpInc = 0.01f;
    int silentSamples = 1 << 30;
};
} // namespace dub
