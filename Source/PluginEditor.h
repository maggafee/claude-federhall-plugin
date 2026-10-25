#pragma once

#include "PluginProcessor.h"
#include "gui/SpringTankView.h"
#include "gui/Widgets.h"

// Native-size panel (1448 x 1086) holding every control; the editor scales it.
class DubascoPanel : public juce::Component
{
public:
    DubascoPanel();
    void paint (juce::Graphics&) override;

private:
    juce::Image background;
};

class DubascoEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit DubascoEditor (DubascoProcessor&);
    ~DubascoEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    DubascoProcessor& proc;
    DubascoPanel panel;
    juce::LookAndFeel_V4 lnf;

    DubKnob input { Layout::input, false }, predelay { Layout::predelay, true }, reverb { Layout::reverb, false },
            dwell { Layout::dwell, false }, tone { Layout::tone, false }, mix { Layout::mix, false },
            output { Layout::output, false };
    LeverSwitch modeSw { Layout::toggleMode }, eqSw { Layout::toggleEq }, driveSw { Layout::toggleDrive };
    std::unique_ptr<Lamp> lamps[6];
    VUMeter vuIn { Layout::vuIn }, vuOut { Layout::vuOut };
    SpringTankView tank;

    using SA = juce::AudioProcessorValueTreeState::SliderAttachment;
    using BA = juce::AudioProcessorValueTreeState::ButtonAttachment;
    std::unique_ptr<SA> attIn, attPd, attRev, attDw, attTone, attMix, attOut;
    std::unique_ptr<BA> attMode, attEq, attDrive;

    double lastTime = 0.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DubascoEditor)
};
