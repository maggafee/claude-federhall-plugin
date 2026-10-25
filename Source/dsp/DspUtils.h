#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace dub
{
constexpr float kPi = 3.14159265358979323846f;

inline float dbToGain (float db) { return std::pow (10.0f, db * 0.05f); }

// RBJ biquad, transposed direct form II
struct Biquad
{
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float z1 = 0, z2 = 0;

    void reset() { z1 = z2 = 0; }

    inline float process (float x)
    {
        const float y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }

    void setNormalised (float B0, float B1, float B2, float A0, float A1, float A2)
    {
        const float inv = 1.0f / A0;
        b0 = B0 * inv; b1 = B1 * inv; b2 = B2 * inv; a1 = A1 * inv; a2 = A2 * inv;
    }

    void lowpass (double fs, float f, float q = 0.7071f)
    {
        const float w = 2 * kPi * std::min (f, (float) fs * 0.49f) / (float) fs;
        const float c = std::cos (w), a = std::sin (w) / (2 * q);
        setNormalised ((1 - c) * 0.5f, 1 - c, (1 - c) * 0.5f, 1 + a, -2 * c, 1 - a);
    }

    void highpass (double fs, float f, float q = 0.7071f)
    {
        const float w = 2 * kPi * std::min (f, (float) fs * 0.49f) / (float) fs;
        const float c = std::cos (w), a = std::sin (w) / (2 * q);
        setNormalised ((1 + c) * 0.5f, -(1 + c), (1 + c) * 0.5f, 1 + a, -2 * c, 1 - a);
    }

    void peak (double fs, float f, float q, float gainDb)
    {
        const float A = std::pow (10.0f, gainDb / 40.0f);
        const float w = 2 * kPi * std::min (f, (float) fs * 0.49f) / (float) fs;
        const float c = std::cos (w), a = std::sin (w) / (2 * q);
        setNormalised (1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
    }

    void highShelf (double fs, float f, float gainDb, float slope = 0.8f)
    {
        const float A = std::pow (10.0f, gainDb / 40.0f);
        const float w = 2 * kPi * std::min (f, (float) fs * 0.49f) / (float) fs;
        const float c = std::cos (w), s = std::sin (w);
        const float a = s / 2 * std::sqrt ((A + 1 / A) * (1 / slope - 1) + 2);
        const float sq = 2 * std::sqrt (A) * a;
        setNormalised (A * ((A + 1) + (A - 1) * c + sq),
                       -2 * A * ((A - 1) + (A + 1) * c),
                       A * ((A + 1) + (A - 1) * c - sq),
                       (A + 1) - (A - 1) * c + sq,
                       2 * ((A - 1) - (A + 1) * c),
                       (A + 1) - (A - 1) * c - sq);
    }

    void lowShelf (double fs, float f, float gainDb, float slope = 0.8f)
    {
        const float A = std::pow (10.0f, gainDb / 40.0f);
        const float w = 2 * kPi * std::min (f, (float) fs * 0.49f) / (float) fs;
        const float c = std::cos (w), s = std::sin (w);
        const float a = s / 2 * std::sqrt ((A + 1 / A) * (1 / slope - 1) + 2);
        const float sq = 2 * std::sqrt (A) * a;
        setNormalised (A * ((A + 1) - (A - 1) * c + sq),
                       2 * A * ((A - 1) - (A + 1) * c),
                       A * ((A + 1) - (A - 1) * c - sq),
                       (A + 1) + (A - 1) * c + sq,
                       -2 * ((A - 1) + (A + 1) * c),
                       (A + 1) + (A - 1) * c - sq);
    }
};

struct OnePoleLP
{
    float a = 0, z = 0;
    void setCutoff (double fs, float f) { a = std::exp (-2 * kPi * f / (float) fs); }
    void setCoeff (float c) { a = c; }
    inline float process (float x) { z = x + a * (z - x); return z; }
    void reset() { z = 0; }
};

// Circular delay with fractional (cubic Hermite) read
struct DelayLine
{
    std::vector<float> buf;
    int mask = 0, w = 0;

    void prepare (int maxSamples)
    {
        int n = 1;
        while (n < maxSamples + 4) n <<= 1;
        buf.assign ((size_t) n, 0.0f);
        mask = n - 1;
        w = 0;
    }

    void reset() { std::fill (buf.begin(), buf.end(), 0.0f); }

    inline void push (float x) { buf[(size_t) w] = x; w = (w + 1) & mask; }

    // delay in samples, >= 1
    inline float read (float d) const
    {
        const float rp = (float) w - d;
        int i = (int) std::floor (rp);
        const float f = rp - (float) i;
        const float xm1 = buf[(size_t) ((i - 1) & mask)];
        const float x0  = buf[(size_t) (i & mask)];
        const float x1  = buf[(size_t) ((i + 1) & mask)];
        const float x2  = buf[(size_t) ((i + 2) & mask)];
        const float c1 = 0.5f * (x1 - xm1);
        const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
        const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
        return ((c3 * f + c2) * f + c1) * f + x0;
    }

    inline float readInt (int d) const { return buf[(size_t) ((w - d) & mask)]; }
};

// Cheap xorshift noise + smoothing for slow random modulation
struct SmoothNoise
{
    uint32_t s = 0x9E3779B9u;
    float y = 0, target = 0, coeff = 0.999f;
    int counter = 0, period = 2048;

    void seed (uint32_t v) { s = v ? v : 1u; }
    inline float white()
    {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        return (float) (s & 0xFFFFFF) / (float) 0x7FFFFF - 1.0f;
    }
    void prepare (double fs, float rateHz)
    {
        period = std::max (1, (int) (fs / std::max (0.05f, rateHz)));
        coeff = std::exp (-2 * kPi * rateHz / (float) fs);
    }
    inline float next()
    {
        if (--counter <= 0) { counter = period; target = white(); }
        y = target + coeff * (y - target);
        return y;
    }
};

inline float softClip (float x)  // smooth, unity slope at 0, saturates at +-1
{
    if (x > 3.0f) return 1.0f;
    if (x < -3.0f) return -1.0f;
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}
} // namespace dub
