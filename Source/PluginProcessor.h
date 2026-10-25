#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include <atomic>

#include "dsp/DspUtils.h"
#include "dsp/PlateReverb.h"
#include "dsp/SpringTank.h"
#include "dsp/SpringCrash.h"

namespace ParamIDs
{
inline constexpr const char* input    = "input";
inline constexpr const char* predelay = "predelay";
inline constexpr const char* reverb   = "reverb";
inline constexpr const char* dwell    = "dwell";
inline constexpr const char* tone     = "tone";
inline constexpr const char* mix      = "mix";
inline constexpr const char* output   = "output";
inline constexpr const char* mode     = "mode";   // 0 spring, 1 plate
inline constexpr const char* eq       = "eq";     // 0 flat, 1 dub
inline constexpr const char* drive    = "drive";  // 0 clean, 1 dirty
}

class DubascoProcessor : public juce::AudioProcessor
{
public:
    DubascoProcessor();
    ~DubascoProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using juce::AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Dubasco Spring Reverb"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 8.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    // ---- metering for the GUI (written by the audio thread)
    std::atomic<float> inputRms { 0.0f };    // linear RMS, ~VU integration
    std::atomic<float> outputRms { 0.0f };
    std::atomic<float> springLevel { 0.0f }; // envelope of the tank output
    std::atomic<float> springKick { 0.0f };  // envelope of the tank input (fast)

    // GUI -> audio: hit a spring by hand (0 top .. 2 bottom), strength 0..2.
    // Lock-free; hits arriving within one audio block are summed.
    void strikeSpring (int spring, float strength);

private:
    void updateFilters (float tone, bool dub);

    double fs = 44100.0;

    juce::SmoothedValue<float> inGain, outGain, mixAmt, preDelayMs, dwellAmt;

    dub::DelayLine preDelay;
    dub::SpringTank spring;
    dub::PlateReverb plate;
    dub::SpringCrash crash;
    std::atomic<float> crashPending[3] {};

    // tank driver (2x oversampled saturation)
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
    juce::AudioBuffer<float> sendBuffer;
    dub::Biquad drvPre, drvPost, drvHp;
    dub::OnePoleLP dcBlock;

    // wet EQ: dub / flat + tone
    dub::Biquad eqHp1[2], eqHp2[2], eqPeak[2], eqLp[2], toneLp[2], toneShelf[2];
    float lastTone = -1.0f; int lastEq = -1;

    // mode crossfade so switching spring/plate never clicks
    float modeMix = 0.0f;
    int idleEngine = -1;  // engine that is silent and already cleared

    // meters
    float inEnv = 0, outEnv = 0, sprEnv = 0, kickEnv = 0;
    float vuCoeff = 0.999f, sprAtt = 0.9f, sprRel = 0.999f, kickAtt = 0.5f, kickRel = 0.99f;

    std::atomic<float>* pInput = nullptr; std::atomic<float>* pPredelay = nullptr;
    std::atomic<float>* pReverb = nullptr; std::atomic<float>* pDwell = nullptr;
    std::atomic<float>* pTone = nullptr; std::atomic<float>* pMix = nullptr;
    std::atomic<float>* pOutput = nullptr; std::atomic<float>* pMode = nullptr;
    std::atomic<float>* pEq = nullptr; std::atomic<float>* pDrive = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DubascoProcessor)
};
