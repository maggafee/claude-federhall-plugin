#pragma once

#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>

// All coordinates are in the native pixel space of the panel artwork
// (1448 x 1086). The editor scales the whole panel with one transform.
namespace Layout
{
constexpr int width = 1448, height = 1086;

struct KnobGeom { float capX, capY, capR, skirtX, skirtY; };
constexpr KnobGeom input    { 141.0f, 749.5f, 44.0f, 149.0f, 746.0f };
constexpr KnobGeom predelay { 324.5f, 750.5f, 30.5f, 330.0f, 748.1f };
constexpr KnobGeom reverb   { 511.0f, 749.5f, 44.0f, 519.0f, 746.0f };
constexpr KnobGeom dwell    { 715.5f, 750.0f, 43.5f, 723.4f, 746.5f };
constexpr KnobGeom tone     { 917.0f, 750.0f, 44.0f, 925.0f, 746.5f };
constexpr KnobGeom mix      { 1116.5f, 749.5f, 43.5f, 1124.4f, 746.0f };
constexpr KnobGeom output   { 1306.5f, 750.0f, 44.0f, 1314.5f, 746.5f };

struct VuGeom { float pivotX, pivotY; int x0, y0, x1, y1; };
constexpr VuGeom vuIn  { 509.0f, 464.0f, 344, 205, 664, 343 };
constexpr VuGeom vuOut { 953.0f, 464.0f, 788, 205, 1108, 343 };

struct Pt { float x, y; };
constexpr Pt lampSpring { 237.5f, 900.5f }, lampPlate { 451.0f, 901.0f };
constexpr Pt lampFlat { 626.0f, 902.0f },  lampDub { 768.5f, 902.0f };
constexpr Pt lampClean { 1007.5f, 902.5f }, lampDirty { 1214.0f, 902.0f };
constexpr float lampSize = 20.0f;

constexpr Pt toggleMode { 345.0f, 903.0f }, toggleEq { 718.0f, 903.0f }, toggleDrive { 1108.0f, 903.0f };
constexpr float leverSprite = 88.986f;  // panel size of the lever sprite square

constexpr int tankX0 = 92, tankY0 = 405, tankX1 = 1358, tankY1 = 595;
struct SpringGeom { int y0, y1, x0, x1; };
constexpr SpringGeom springs[3] { { 446, 477, 259, 1192 }, { 493, 524, 259, 1192 }, { 538, 565, 259, 1192 } };
}

namespace Assets
{
juce::Image get (const char* name);  // cached, converted to ARGB
}

//==============================================================================
// Rotary knob: the knob body never moves (so light and perspective stay the
// same in every position); only the pointer slot on the cap and the marker on
// the skirt rotate, like the paint on a real knob.
class DubKnob : public juce::Slider
{
public:
    explicit DubKnob (const Layout::KnobGeom& g, bool small);

    void paint (juce::Graphics&) override;
    bool hitTest (int x, int y) override;

private:
    Layout::KnobGeom geom;   // in local coordinates after construction
    juce::Image cap;
    float sc = 1.0f;
};

//==============================================================================
// Two position lever switch (artwork's round lever switches). Off = lever to
// the left label, on = lever to the right label.
class LeverSwitch : public juce::Button
{
public:
    explicit LeverSwitch (Layout::Pt centre);
    void paintButton (juce::Graphics&, bool highlighted, bool down) override;
    bool hitTest (int x, int y) override;
    void tick (float dt);  // lever animation

private:
    juce::Image base, arm;
    float angle = -1.0f;   // -1 left .. +1 right
};

//==============================================================================
class Lamp : public juce::Component
{
public:
    Lamp (Layout::Pt centre, std::function<bool()> isOn);
    void paint (juce::Graphics&) override;
    void tick (float dt);

private:
    std::function<bool()> state;
    juce::Image on, off;
    float level = 0.0f, shownLevel = -1.0f;
};

//==============================================================================
// Moving-coil VU meter with real ballistics (second order, ~300 ms, slight
// overshoot). 0 VU = -18 dBFS RMS.
class VUMeter : public juce::Component
{
public:
    explicit VUMeter (const Layout::VuGeom& g);
    void paint (juce::Graphics&) override;
    void tick (float dt, float rmsLinear);

private:
    static float angleForDb (float vu);
    Layout::VuGeom geom;
    juce::Image backdrop;
    float angle = -36.0f, velocity = 0.0f, drawnAngle = 1000.0f;
};
