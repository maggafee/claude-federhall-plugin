#pragma once

#include "Widgets.h"
#include <array>
#include <vector>

// The backlit spring compartment. The three coil strips are cut from the
// artwork and redrawn every frame column by column with a vertical
// displacement: standing modes driven by the reverb level plus ripple packets
// that run along the spring on every transient. The backlight swells with the
// signal.
class SpringTankView : public juce::Component
{
public:
    SpringTankView();
    void paint (juce::Graphics&) override;
    void tick (float dt, float wetLevel, float kickLevel);

private:
    void render();

    juce::Image base, hot, frame;
    juce::Image strip[3], stripHot[3];

    struct Pulse { float pos, amp, age, dir; };
    struct SpringState
    {
        std::array<float, 4> phase {};
        std::array<float, 4> freq {};
        float amp = 0.0f;
        std::vector<Pulse> pulses;
        std::vector<float> disp;
    };
    SpringState springs[3];

    float glow = 0.0f, flicker = 0.0f, time = 0.0f, lastKick = 0.0f, kickFloor = 0.0f;
    juce::Random rng;
};
