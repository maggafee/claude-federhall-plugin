#include "Widgets.h"
#include "BinaryData.h"
#include <map>

using namespace juce;

namespace Assets
{
Image get (const char* name)
{
    static std::map<String, Image> cache;
    auto it = cache.find (name);
    if (it != cache.end())
        return it->second;

    int size = 0;
    const char* data = BinaryData::getNamedResource (name, size);
    Image img;
    if (data != nullptr)
        img = ImageFileFormat::loadFrom (data, (size_t) size);
    if (img.isValid())
        img = img.convertedToFormat (Image::ARGB);
    cache[name] = img;
    return img;
}
} // namespace Assets

//==============================================================================
DubKnob::DubKnob (const Layout::KnobGeom& g, bool small)
{
    sc = g.capR / 44.0f;
    const float half = 82.0f * sc;
    const auto b = Rectangle<float> (g.skirtX - half, g.skirtY - half, 2 * half, 2 * half).getSmallestIntegerContainer();
    setBounds (b);
    geom = { g.capX - (float) b.getX(), g.capY - (float) b.getY(), g.capR,
             g.skirtX - (float) b.getX(), g.skirtY - (float) b.getY() };

    cap = Assets::get (small ? "knobcap_s_png" : "knobcap_l_png");

    setSliderStyle (Slider::RotaryHorizontalVerticalDrag);
    setTextBoxStyle (Slider::NoTextBox, false, 0, 0);
    setRotaryParameters (MathConstants<float>::pi * 1.25f, MathConstants<float>::pi * 2.75f, true);
    setMouseDragSensitivity (240);
    setPaintingIsUnclipped (true);
    setMouseCursor (MouseCursor::PointingHandCursor);
}

bool DubKnob::hitTest (int x, int y)
{
    const float dx = (float) x - geom.skirtX, dy = (float) y - geom.skirtY;
    return dx * dx + dy * dy < (72.0f * sc) * (72.0f * sc);
}

void DubKnob::paint (Graphics& g)
{
    const float prop = (float) valueToProportionOfLength (getValue());
    const float ang = degreesToRadians (-135.0f + 270.0f * prop);
    const float s = std::sin (ang), c = -std::cos (ang);

    g.setImageResamplingQuality (Graphics::highResamplingQuality);

    // skirt marker (cream paint line on the skirt), hidden behind the cap
    {
        Graphics::ScopedSaveState state (g);
        Path clip;
        clip.addRectangle (getLocalBounds().toFloat());
        clip.addEllipse (geom.capX - geom.capR - 1.2f, geom.capY - geom.capR - 1.2f,
                         2 * geom.capR + 2.4f, 2 * geom.capR + 2.4f);
        clip.setUsingNonZeroWinding (false);
        g.reduceClipRegion (clip);

        const float r0 = 54.5f * sc, r1 = 64.0f * sc;
        Path mark;
        mark.startNewSubPath (geom.skirtX + s * r0, geom.skirtY + c * r0);
        mark.lineTo (geom.skirtX + s * r1, geom.skirtY + c * r1);
        g.setColour (Colours::black.withAlpha (0.5f));
        g.strokePath (mark, PathStrokeType (4.4f * sc, PathStrokeType::curved, PathStrokeType::rounded));
        g.setColour (Colour (0xffeadcb8));
        g.strokePath (mark, PathStrokeType (3.0f * sc, PathStrokeType::curved, PathStrokeType::rounded));
    }

    // static cap (light and perspective never change)
    g.drawImage (cap, Rectangle<float> (geom.capX - geom.capR, geom.capY - geom.capR, 2 * geom.capR, 2 * geom.capR));

    // pointer slot, a recess in the cap
    const float w = 5.6f * sc;
    Path slot;
    slot.addRoundedRectangle (-w * 0.5f, -geom.capR * 0.94f, w, geom.capR * 0.46f, w * 0.5f);
    const auto t = AffineTransform::rotation (ang).translated (geom.capX, geom.capY);
    slot.applyTransform (t);

    // lit lower inner wall (light comes from above, so it's always below)
    g.setColour (Colour (0xfff4ead2).withAlpha (0.45f));
    g.fillPath (slot, AffineTransform::translation (0.0f, 1.0f * sc));
    g.setColour (Colour (0xff050403).withAlpha (0.35f));
    g.fillPath (slot, AffineTransform::translation (0.0f, -0.8f * sc));
    ColourGradient grad (Colour (0xff0d0b09), geom.capX, geom.capY - geom.capR,
                         Colour (0xff2a2520), geom.capX, geom.capY + geom.capR, false);
    g.setGradientFill (grad);
    g.fillPath (slot);
}

//==============================================================================
LeverSwitch::LeverSwitch (Layout::Pt centre) : Button ("lever")
{
    const float half = Layout::leverSprite * 0.5f;
    setBounds (Rectangle<float> (centre.x - half, centre.y - half, 2 * half, 2 * half).getSmallestIntegerContainer());
    base = Assets::get ("lever_base_png");
    arm = Assets::get ("lever_arm_png");
    setClickingTogglesState (true);
    setMouseCursor (MouseCursor::PointingHandCursor);
    setPaintingIsUnclipped (true);
}

bool LeverSwitch::hitTest (int x, int y)
{
    const float dx = (float) x - getWidth() * 0.5f, dy = (float) y - getHeight() * 0.5f;
    return dx * dx + dy * dy < 34.0f * 34.0f;
}

void LeverSwitch::tick (float dt)
{
    const float target = getToggleState() ? 1.0f : -1.0f;
    if (std::abs (angle - target) < 1.0e-4f) return;
    const float step = dt / 0.07f * 2.0f;
    angle = target > angle ? std::min (target, angle + step) : std::max (target, angle - step);
    repaint();
}

void LeverSwitch::paintButton (Graphics& g, bool, bool down)
{
    g.setImageResamplingQuality (Graphics::highResamplingQuality);
    const auto b = getLocalBounds().toFloat();
    g.drawImage (base, b);

    const float cx = b.getCentreX(), cy = b.getCentreY();
    const float s = b.getWidth() / (float) arm.getWidth() * (down ? 0.71f : 0.72f);
    const float rot = -angle * degreesToRadians (58.0f);
    const auto t = AffineTransform::translation (-arm.getWidth() * 0.5f, -arm.getHeight() * 0.5f)
                       .scaled (s).rotated (rot).translated (cx, cy);

    g.setColour (Colours::black.withAlpha (0.45f));
    g.drawImageTransformed (arm, t.translated (1.8f, 3.0f), true);
    g.setOpacity (1.0f);
    g.drawImageTransformed (arm, t, false);
}

//==============================================================================
Lamp::Lamp (Layout::Pt centre, std::function<bool()> isOn) : state (std::move (isOn))
{
    setBounds (Rectangle<float> (centre.x - 32, centre.y - 32, 64, 64).getSmallestIntegerContainer());
    on = Assets::get ("lamp_on_png");
    off = Assets::get ("lamp_off_png");
    setInterceptsMouseClicks (false, false);
    level = state() ? 1.0f : 0.0f;
}

void Lamp::tick (float dt)
{
    const float target = state() ? 1.0f : 0.0f;
    // incandescent bulb: warms up a little faster than it cools down
    const float tau = target > level ? 0.05f : 0.12f;
    level += (target - level) * (1.0f - std::exp (-dt / tau));
    if (std::abs (level - shownLevel) > 0.004f)
        repaint();
}

void Lamp::paint (Graphics& g)
{
    shownLevel = level;
    g.setImageResamplingQuality (Graphics::highResamplingQuality);
    const auto c = getLocalBounds().toFloat().getCentre();
    if (level > 0.01f)
    {
        ColourGradient glow (Colour (0xffffa020).withAlpha (0.42f * level), c.x, c.y,
                             Colour (0xffff7a00).withAlpha (0.0f), c.x + 28.0f, c.y, true);
        glow.addColour (0.35, Colour (0xffff9418).withAlpha (0.20f * level));
        g.setGradientFill (glow);
        g.fillEllipse (c.x - 30, c.y - 30, 60, 60);
    }
    const auto r = Rectangle<float> (Layout::lampSize, Layout::lampSize).withCentre (c);
    g.drawImage (off, r);
    g.setOpacity (level);
    g.drawImage (on, r);
}

//==============================================================================
VUMeter::VUMeter (const Layout::VuGeom& g) : geom (g)
{
    setBounds (g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
    backdrop = Assets::get ("background_jpg").getClippedImage (getBounds());
    setOpaque (true);
    setInterceptsMouseClicks (false, false);
}

float VUMeter::angleForDb (float vu)
{
    // scale positions measured on the meter face artwork (degrees from vertical)
    static const float db[]  = { -26.0f, -20.0f, -10.0f, -7.0f, -5.0f, -3.0f, -1.0f, 0.0f, 3.0f, 4.5f };
    static const float deg[] = { -36.0f, -33.3f, -24.3f, -18.1f, -9.5f, 0.0f, 11.5f, 17.0f, 28.8f, 33.0f };
    if (vu <= db[0]) return deg[0];
    for (int i = 1; i < 10; ++i)
        if (vu <= db[i])
            return deg[i - 1] + (deg[i] - deg[i - 1]) * (vu - db[i - 1]) / (db[i] - db[i - 1]);
    return deg[9];
}

void VUMeter::tick (float dt, float rms)
{
    const float vu = 20.0f * std::log10 (std::max (rms, 1.0e-6f)) + 18.0f;
    const float target = angleForDb (vu);
    // VU ballistics: ~300 ms to reach the reading, ~1.5 % overshoot
    constexpr float omega = 13.5f, zeta = 0.80f;
    const int steps = 8;
    const float h = dt / (float) steps;
    for (int i = 0; i < steps; ++i)
    {
        const float acc = omega * omega * (target - angle) - 2.0f * zeta * omega * velocity;
        velocity += acc * h;
        angle += velocity * h;
        if (angle < -36.0f) { angle = -36.0f; velocity = std::abs (velocity) * 0.25f; }  // rest pin
        if (angle > 33.5f)  { angle = 33.5f;  velocity = -std::abs (velocity) * 0.25f; } // peg
    }
    if (std::abs (angle - drawnAngle) > 0.03f)
        repaint();
}

void VUMeter::paint (Graphics& g)
{
    drawnAngle = angle;
    g.drawImageAt (backdrop, 0, 0);

    const float px = geom.pivotX - (float) geom.x0, py = geom.pivotY - (float) geom.y0;
    const float a = degreesToRadians (angle);
    const float s = std::sin (a), c = -std::cos (a);
    const float nx = -c, ny = s;  // normal

    auto needle = [&] (float r0, float r1, float w0, float w1)
    {
        Path p;
        p.startNewSubPath (px + s * r0 + nx * w0, py + c * r0 + ny * w0);
        p.lineTo (px + s * r1 + nx * w1, py + c * r1 + ny * w1);
        p.lineTo (px + s * r1 - nx * w1, py + c * r1 - ny * w1);
        p.lineTo (px + s * r0 - nx * w0, py + c * r0 - ny * w0);
        p.closeSubPath();
        return p;
    };

    Graphics::ScopedSaveState state (g);
    Path window;
    window.addRoundedRectangle (getLocalBounds().toFloat().reduced (2.0f), 11.0f);
    g.reduceClipRegion (window);

    const auto shape = needle (110.0f, 229.0f, 1.6f, 0.7f);
    g.setColour (Colour (0xff3a2408).withAlpha (0.22f));
    g.fillPath (shape, AffineTransform::translation (4.0f, 5.0f));
    g.setColour (Colour (0xff17140f));
    g.fillPath (shape);
}
