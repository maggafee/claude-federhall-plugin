#include "PluginEditor.h"

using namespace juce;

DubascoPanel::DubascoPanel()
{
    setSize (Layout::width, Layout::height);
    background = Assets::get ("background_jpg");
    setOpaque (true);
}

void DubascoPanel::paint (Graphics& g)
{
    g.setImageResamplingQuality (Graphics::highResamplingQuality);
    g.drawImageAt (background, 0, 0);
}

//==============================================================================
DubascoEditor::DubascoEditor (DubascoProcessor& p) : AudioProcessorEditor (p), proc (p)
{
    // value bubble styling
    lnf.setColour (BubbleComponent::backgroundColourId, Colour (0xf0151310));
    lnf.setColour (BubbleComponent::outlineColourId, Colour (0xffc9a86a));
    lnf.setColour (TooltipWindow::textColourId, Colour (0xffeedcb0));
    panel.setLookAndFeel (&lnf);

    addAndMakeVisible (panel);
    panel.addAndMakeVisible (tank);
    panel.addAndMakeVisible (vuIn);
    panel.addAndMakeVisible (vuOut);

    auto& s = p.apvts;
    struct K { DubKnob& k; const char* id; double def; };
    for (auto& k : { K { input, ParamIDs::input, 0.0 }, K { predelay, ParamIDs::predelay, 20.0 },
                     K { reverb, ParamIDs::reverb, 0.5 }, K { dwell, ParamIDs::dwell, 0.45 },
                     K { tone, ParamIDs::tone, 0.5 }, K { mix, ParamIDs::mix, 0.3 },
                     K { output, ParamIDs::output, 0.0 } })
    {
        panel.addAndMakeVisible (k.k);
        k.k.setPopupDisplayEnabled (true, false, &panel);
        k.k.setDoubleClickReturnValue (true, k.def);
        k.k.setLookAndFeel (&lnf);
    }

    attIn = std::make_unique<SA> (s, ParamIDs::input, input);
    attPd = std::make_unique<SA> (s, ParamIDs::predelay, predelay);
    attRev = std::make_unique<SA> (s, ParamIDs::reverb, reverb);
    attDw = std::make_unique<SA> (s, ParamIDs::dwell, dwell);
    attTone = std::make_unique<SA> (s, ParamIDs::tone, tone);
    attMix = std::make_unique<SA> (s, ParamIDs::mix, mix);
    attOut = std::make_unique<SA> (s, ParamIDs::output, output);

    for (auto* b : { &modeSw, &eqSw, &driveSw })
        panel.addAndMakeVisible (b);
    attMode = std::make_unique<BA> (s, ParamIDs::mode, modeSw);
    attEq = std::make_unique<BA> (s, ParamIDs::eq, eqSw);
    attDrive = std::make_unique<BA> (s, ParamIDs::drive, driveSw);

    modeSw.setTooltip ("Spring / Plate");
    eqSw.setTooltip ("EQ: Flat / Dub");
    driveSw.setTooltip ("Tank Drive: Clean / Dirty");

    lamps[0] = std::make_unique<Lamp> (Layout::lampSpring, [this] { return ! modeSw.getToggleState(); });
    lamps[1] = std::make_unique<Lamp> (Layout::lampPlate, [this] { return modeSw.getToggleState(); });
    lamps[2] = std::make_unique<Lamp> (Layout::lampFlat, [this] { return ! eqSw.getToggleState(); });
    lamps[3] = std::make_unique<Lamp> (Layout::lampDub, [this] { return eqSw.getToggleState(); });
    lamps[4] = std::make_unique<Lamp> (Layout::lampClean, [this] { return ! driveSw.getToggleState(); });
    lamps[5] = std::make_unique<Lamp> (Layout::lampDirty, [this] { return driveSw.getToggleState(); });
    for (auto& l : lamps)
    {
        panel.addAndMakeVisible (*l);
        l->toBack();
    }

    // size: scalable, fixed aspect ratio; remembers the last scale
    const double savedScale = (double) s.state.getProperty ("uiScale", 0.7);
    setResizable (true, true);
    getConstrainer()->setFixedAspectRatio ((double) Layout::width / (double) Layout::height);
    setResizeLimits ((int) (Layout::width * 0.4), (int) (Layout::height * 0.4), Layout::width, Layout::height);
    setSize ((int) std::round (Layout::width * jlimit (0.4, 1.0, savedScale)),
             (int) std::round (Layout::height * jlimit (0.4, 1.0, savedScale)));

    lastTime = Time::getMillisecondCounterHiRes();
    startTimerHz (60);
}

DubascoEditor::~DubascoEditor()
{
    stopTimer();
    for (auto* k : { &input, &predelay, &reverb, &dwell, &tone, &mix, &output })
        k->setLookAndFeel (nullptr);
    panel.setLookAndFeel (nullptr);
}

void DubascoEditor::paint (Graphics& g)
{
    g.fillAll (Colours::black);
}

void DubascoEditor::resized()
{
    const float scale = (float) getWidth() / (float) Layout::width;
    panel.setTransform (AffineTransform::scale (scale));
    panel.setTopLeftPosition (0, 0);
    proc.apvts.state.setProperty ("uiScale", scale, nullptr);
}

void DubascoEditor::timerCallback()
{
    const double now = Time::getMillisecondCounterHiRes();
    const float dt = (float) jlimit (0.001, 0.1, (now - lastTime) * 0.001);
    lastTime = now;

    vuIn.tick (dt, proc.inputRms.load());
    vuOut.tick (dt, proc.outputRms.load());
    tank.tick (dt, proc.springLevel.load(), proc.springKick.load());
    for (auto* b : { &modeSw, &eqSw, &driveSw })
        b->tick (dt);
    for (auto& l : lamps)
        l->tick (dt);
}
