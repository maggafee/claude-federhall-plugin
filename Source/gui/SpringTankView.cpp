#include "SpringTankView.h"

using namespace juce;

SpringTankView::SpringTankView()
{
    setBounds (Layout::tankX0, Layout::tankY0, Layout::tankX1 - Layout::tankX0, Layout::tankY1 - Layout::tankY0);
    setOpaque (true);
    setInterceptsMouseClicks (false, false);

    base = Assets::get ("tank_base_png");
    hot = Assets::get ("tank_hot_png");
    const char* names[3] = { "spring1_png", "spring2_png", "spring3_png" };
    const char* hotNames[3] = { "springhot1_png", "springhot2_png", "springhot3_png" };
    for (int i = 0; i < 3; ++i)
    {
        strip[i] = Assets::get (names[i]);
        stripHot[i] = Assets::get (hotNames[i]);
    }
    frame = Image (Image::ARGB, getWidth(), getHeight(), true);

    // every spring has its own tension -> own set of mode frequencies (Hz)
    const float base_[3] = { 6.1f, 5.3f, 7.0f };
    for (int i = 0; i < 3; ++i)
    {
        auto& s = springs[i];
        for (int m = 0; m < 4; ++m)
        {
            s.freq[(size_t) m] = base_[i] * (float) (m + 1) * (1.0f + 0.07f * (float) m);
            s.phase[(size_t) m] = rng.nextFloat() * MathConstants<float>::twoPi;
        }
        s.disp.assign ((size_t) strip[i].getWidth(), 0.0f);
    }
    render();
}

void SpringTankView::tick (float dt, float wetLevel, float kickLevel)
{
    time += dt;

    // reverb level -> 0..1 (roughly logarithmic so quiet tails still move)
    const float db = 20.0f * std::log10 (std::max (wetLevel, 1.0e-5f));
    const float level = jlimit (0.0f, 1.0f, (db + 48.0f) / 42.0f);

    // backlight: slow tube-like swell plus a faint flicker
    const float targetGlow = level * level;
    glow += (targetGlow - glow) * (1.0f - std::exp (-dt / (targetGlow > glow ? 0.05f : 0.35f)));
    flicker += ((rng.nextFloat() - 0.5f) * 0.06f - flicker) * 0.3f;

    // transient detection on the tank input -> ripple packets
    const float kdb = 20.0f * std::log10 (std::max (kickLevel, 1.0e-5f));
    kickFloor = std::min (kdb, kickFloor + dt * 25.0f);  // follows the signal floor upward slowly
    const bool kick = kdb > -45.0f && kdb - kickFloor > 6.0f && kdb > lastKick + 1.5f;
    lastKick = kdb;
    if (kick) kickFloor = kdb;

    for (int i = 0; i < 3; ++i)
    {
        auto& s = springs[i];
        s.amp += (level - s.amp) * (1.0f - std::exp (-dt / (level > s.amp ? 0.04f : 0.45f)));
        for (int m = 0; m < 4; ++m)
            s.phase[(size_t) m] = std::fmod (s.phase[(size_t) m] + MathConstants<float>::twoPi * s.freq[(size_t) m] * dt,
                                             MathConstants<float>::twoPi);

        if (kick && s.pulses.size() < 8)
            s.pulses.push_back ({ 0.0f, jlimit (0.3f, 1.0f, (kdb + 45.0f) / 30.0f) * (0.8f + 0.1f * (float) i), 0.0f, 1.0f });

        for (auto& p : s.pulses)
        {
            p.age += dt;
            p.pos += p.dir * dt * (1.9f + 0.25f * (float) i);  // spring lengths per second
            if (p.pos > 1.0f) { p.pos = 2.0f - p.pos; p.dir = -1.0f; }  // reflect at the far end
            if (p.pos < 0.0f) { p.pos = -p.pos; p.dir = 1.0f; }
        }
        s.pulses.erase (std::remove_if (s.pulses.begin(), s.pulses.end(), [] (const Pulse& p) { return p.age > 1.6f; }),
                        s.pulses.end());

        // displacement per column (pixels)
        const int w = (int) s.disp.size();
        const float maxAmp = 3.6f;
        for (int x = 0; x < w; ++x)
        {
            const float u = (float) x / (float) (w - 1);
            float d = 0.0f;
            const float weights[4] = { 1.0f, 0.55f, 0.35f, 0.22f };
            for (int m = 0; m < 4; ++m)
                d += weights[m] * std::sin ((float) (m + 1) * MathConstants<float>::pi * u) * std::sin (s.phase[(size_t) m]);
            d *= s.amp * 0.55f;

            for (const auto& p : s.pulses)
            {
                const float k = (u - p.pos) / 0.045f;
                const float env = std::exp (-k * k) * std::exp (-p.age * 2.6f);
                d += p.amp * env * std::sin ((u - p.pos) * 140.0f - time * 30.0f) * 1.1f;
            }
            // ends are anchored in the transducers
            const float anchor = std::min (1.0f, std::min (u, 1.0f - u) * 25.0f);
            s.disp[(size_t) x] = jlimit (-1.0f, 1.0f, d) * maxAmp * anchor;
        }
    }

    render();
    repaint();
}

void SpringTankView::render()
{
    const float g = jlimit (0.0f, 1.0f, 0.08f + glow * 0.92f + flicker * (0.4f + glow));
    const int gi = (int) (g * 256.0f);
    const int W = frame.getWidth(), H = frame.getHeight();

    Image::BitmapData dst (frame, Image::BitmapData::writeOnly);
    Image::BitmapData b0 (base, Image::BitmapData::readOnly);
    Image::BitmapData b1 (hot, Image::BitmapData::readOnly);

    for (int y = 0; y < H; ++y)
    {
        auto* d = reinterpret_cast<PixelARGB*> (dst.getLinePointer (y));
        const auto* p0 = reinterpret_cast<const PixelARGB*> (b0.getLinePointer (y));
        const auto* p1 = reinterpret_cast<const PixelARGB*> (b1.getLinePointer (y));
        for (int x = 0; x < W; ++x)
        {
            const int r = p0[x].getRed() + (((p1[x].getRed() - p0[x].getRed()) * gi) >> 8);
            const int gg = p0[x].getGreen() + (((p1[x].getGreen() - p0[x].getGreen()) * gi) >> 8);
            const int bb = p0[x].getBlue() + (((p1[x].getBlue() - p0[x].getBlue()) * gi) >> 8);
            d[x].setARGB (255, (uint8) r, (uint8) gg, (uint8) bb);
        }
    }

    for (int i = 0; i < 3; ++i)
    {
        const auto& geo = Layout::springs[i];
        Image::BitmapData s0 (strip[i], Image::BitmapData::readOnly);
        Image::BitmapData s1 (stripHot[i], Image::BitmapData::readOnly);
        const int sw = strip[i].getWidth(), sh = strip[i].getHeight();
        const int ox = geo.x0 - Layout::tankX0, oy = geo.y0 - Layout::tankY0;
        const auto& disp = springs[i].disp;

        for (int x = 0; x < sw; ++x)
        {
            const float dv = disp[(size_t) x];
            const int dx = ox + x;
            if (dx < 0 || dx >= W) continue;
            const int yStart = std::max (0, oy + (int) std::floor (dv) - 1);
            const int yEnd = std::min (H, oy + sh + (int) std::ceil (dv) + 1);
            for (int yd = yStart; yd < yEnd; ++yd)
            {
                const float sy = (float) (yd - oy) - dv;
                const int i0 = (int) std::floor (sy);
                const int f = (int) ((sy - (float) i0) * 256.0f);
                int acc[4] = { 0, 0, 0, 0 };
                for (int k = 0; k < 2; ++k)
                {
                    const int row = i0 + k;
                    if (row < 0 || row >= sh) continue;
                    const int wgt = k == 0 ? 256 - f : f;
                    const auto& a = *reinterpret_cast<const PixelARGB*> (s0.getPixelPointer (x, row));
                    const auto& h = *reinterpret_cast<const PixelARGB*> (s1.getPixelPointer (x, row));
                    const int ca = a.getAlpha(), cr = a.getRed() + (((h.getRed() - a.getRed()) * gi) >> 8);
                    const int cg = a.getGreen() + (((h.getGreen() - a.getGreen()) * gi) >> 8);
                    const int cb = a.getBlue() + (((h.getBlue() - a.getBlue()) * gi) >> 8);
                    acc[0] += ca * wgt; acc[1] += cr * wgt; acc[2] += cg * wgt; acc[3] += cb * wgt;
                }
                const int sa = acc[0] >> 8;
                if (sa <= 0) continue;
                auto& o = *reinterpret_cast<PixelARGB*> (dst.getPixelPointer (dx, yd));
                const int inv = 255 - sa;  // premultiplied "over"
                o.setARGB (255,
                           (uint8) jmin (255, (acc[1] >> 8) + ((o.getRed() * inv) >> 8)),
                           (uint8) jmin (255, (acc[2] >> 8) + ((o.getGreen() * inv) >> 8)),
                           (uint8) jmin (255, (acc[3] >> 8) + ((o.getBlue() * inv) >> 8)));
            }
        }
    }
}

void SpringTankView::paint (Graphics& g)
{
    g.setImageResamplingQuality (Graphics::mediumResamplingQuality);
    g.drawImage (frame, getLocalBounds().toFloat());
}
