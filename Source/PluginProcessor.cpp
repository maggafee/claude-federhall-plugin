#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace dub;

namespace
{
juce::String dbText (float v, int)
{
    if (v <= -59.95f) return "-inf dB";
    return juce::String (v, 1) + " dB";
}

juce::String percentText (float v, int) { return juce::String (juce::roundToInt (v * 100.0f)) + " %"; }
} // namespace

juce::AudioProcessorValueTreeState::ParameterLayout DubascoProcessor::createLayout()
{
    using namespace juce;
    std::vector<std::unique_ptr<RangedAudioParameter>> p;

    auto gainRange = NormalisableRange<float> (-60.0f, 12.0f, 0.1f);
    gainRange.setSkewForCentre (-6.0f);

    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::input, 1 }, "Input", gainRange, 0.0f,
        AudioParameterFloatAttributes().withStringFromValueFunction (dbText).withLabel ("dB")));

    auto pdRange = NormalisableRange<float> (0.0f, 500.0f, 0.1f);
    pdRange.setSkewForCentre (120.0f);
    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::predelay, 1 }, "Pre-Delay", pdRange, 20.0f,
        AudioParameterFloatAttributes().withStringFromValueFunction ([] (float v, int) { return String (v, 0) + " ms"; })
                                       .withLabel ("ms")));

    auto unit = NormalisableRange<float> (0.0f, 1.0f, 0.001f);
    auto pct = AudioParameterFloatAttributes().withStringFromValueFunction (percentText);
    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::reverb, 1 }, "Reverb", unit, 0.5f, pct));
    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::dwell, 1 }, "Dwell", unit, 0.45f, pct));
    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::tone, 1 }, "Tone", unit, 0.5f, pct));
    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::mix, 1 }, "Mix", unit, 0.3f, pct));

    p.push_back (std::make_unique<AudioParameterFloat> (ParameterID { ParamIDs::output, 1 }, "Output", gainRange, 0.0f,
        AudioParameterFloatAttributes().withStringFromValueFunction (dbText).withLabel ("dB")));

    p.push_back (std::make_unique<AudioParameterChoice> (ParameterID { ParamIDs::mode, 1 }, "Spring Mode",
                                                         StringArray { "Spring", "Plate" }, 0));
    p.push_back (std::make_unique<AudioParameterChoice> (ParameterID { ParamIDs::eq, 1 }, "EQ",
                                                         StringArray { "Flat", "Dub" }, 1));
    p.push_back (std::make_unique<AudioParameterChoice> (ParameterID { ParamIDs::drive, 1 }, "Tank Drive",
                                                         StringArray { "Clean", "Dirty" }, 0));
    return { p.begin(), p.end() };
}

DubascoProcessor::DubascoProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "DubascoState", createLayout())
{
    pInput = apvts.getRawParameterValue (ParamIDs::input);
    pPredelay = apvts.getRawParameterValue (ParamIDs::predelay);
    pReverb = apvts.getRawParameterValue (ParamIDs::reverb);
    pDwell = apvts.getRawParameterValue (ParamIDs::dwell);
    pTone = apvts.getRawParameterValue (ParamIDs::tone);
    pMix = apvts.getRawParameterValue (ParamIDs::mix);
    pOutput = apvts.getRawParameterValue (ParamIDs::output);
    pMode = apvts.getRawParameterValue (ParamIDs::mode);
    pEq = apvts.getRawParameterValue (ParamIDs::eq);
    pDrive = apvts.getRawParameterValue (ParamIDs::drive);
}

bool DubascoProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    const auto in = layouts.getMainInputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo())
        return false;
    if (in != juce::AudioChannelSet::mono() && in != juce::AudioChannelSet::stereo())
        return false;
    // mono in -> stereo out is fine (the tank widens), stereo -> mono is not
    return ! (in == juce::AudioChannelSet::stereo() && out == juce::AudioChannelSet::mono());
}

static float gainFromDb (float db) { return db <= -59.95f ? 0.0f : dbToGain (db); }

void DubascoProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    fs = sampleRate;
    const int maxBlock = std::max (1, samplesPerBlock);

    inGain.reset (fs, 0.05);   inGain.setCurrentAndTargetValue (gainFromDb (pInput->load()));
    outGain.reset (fs, 0.05);  outGain.setCurrentAndTargetValue (gainFromDb (pOutput->load()));
    mixAmt.reset (fs, 0.05);   mixAmt.setCurrentAndTargetValue (pMix->load());
    preDelayMs.reset (fs, 0.25); preDelayMs.setCurrentAndTargetValue (pPredelay->load());
    dwellAmt.reset (fs, 0.05); dwellAmt.setCurrentAndTargetValue (pDwell->load());

    preDelay.prepare ((int) (0.52 * fs) + 8);
    spring.prepare (fs);
    plate.prepare (fs);

    oversampler = std::make_unique<juce::dsp::Oversampling<float>> (
        1, 1, juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, true);
    oversampler->initProcessing ((size_t) maxBlock);
    sendBuffer.setSize (1, maxBlock);

    const double osFs = fs * 2.0;
    drvHp.highpass (osFs, 70.0f, 0.6f);
    dcBlock.setCutoff (osFs, 12.0f);

    for (int c = 0; c < 2; ++c)
    {
        eqHp1[c].reset(); eqHp2[c].reset(); eqPeak[c].reset(); eqLp[c].reset();
        toneLp[c].reset(); toneShelf[c].reset();
    }
    lastTone = -1.0f; lastEq = -1;
    modeMix = pMode->load() > 0.5f ? 1.0f : 0.0f;

    vuCoeff = std::exp (-1.0f / (0.065f * (float) fs));
    sprAtt = std::exp (-1.0f / (0.006f * (float) fs));
    sprRel = std::exp (-1.0f / (0.30f * (float) fs));
    kickAtt = std::exp (-1.0f / (0.001f * (float) fs));
    kickRel = std::exp (-1.0f / (0.08f * (float) fs));
    inEnv = outEnv = sprEnv = kickEnv = 0;
}

void DubascoProcessor::updateFilters (float tone, bool dub)
{
    for (int c = 0; c < 2; ++c)
    {
        if (dub)
        {
            // classic dub send EQ: lean low end, forward "drip" mids, soft top
            eqHp1[c].highpass (fs, 190.0f, 0.54f);
            eqHp2[c].highpass (fs, 190.0f, 1.31f);
            eqPeak[c].peak (fs, 1500.0f, 0.8f, 5.0f);
            eqLp[c].lowpass (fs, 7000.0f, 0.7071f);
        }
        else
        {
            eqHp1[c].highpass (fs, 45.0f, 0.54f);
            eqHp2[c].highpass (fs, 45.0f, 1.31f);
            eqPeak[c].peak (fs, 1500.0f, 0.8f, 0.0f);
            eqLp[c].lowpass (fs, 19000.0f, 0.7071f);
        }
        const float cutoff = 1600.0f * std::pow (16000.0f / 1600.0f, tone);
        toneLp[c].lowpass (fs, cutoff, 0.6f);
        toneShelf[c].highShelf (fs, 2500.0f, (tone - 0.5f) * 10.0f);
    }
}

void DubascoProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const int numIn = getTotalNumInputChannels();
    const int numOut = getTotalNumOutputChannels();
    const int n = buffer.getNumSamples();
    if (n == 0) return;

    for (int c = numIn; c < numOut; ++c)
        buffer.copyFrom (c, 0, buffer, 0, 0, n);  // mono in -> duplicate

    if (sendBuffer.getNumSamples() < n)  // host broke its promise; stay safe
    {
        sendBuffer.setSize (1, n, false, false, true);
        oversampler->initProcessing ((size_t) n);
    }

    // ---- parameters
    inGain.setTargetValue (gainFromDb (pInput->load()));
    outGain.setTargetValue (gainFromDb (pOutput->load()));
    mixAmt.setTargetValue (pMix->load());
    preDelayMs.setTargetValue (pPredelay->load());
    dwellAmt.setTargetValue (pDwell->load());

    const float reverb = pReverb->load();
    const float tone = pTone->load();
    const bool dubEq = pEq->load() > 0.5f;
    const bool dirty = pDrive->load() > 0.5f;
    const bool plateMode = pMode->load() > 0.5f;

    if (std::abs (tone - lastTone) > 0.001f || (int) dubEq != lastEq)
    {
        updateFilters (tone, dubEq);
        lastTone = tone; lastEq = (int) dubEq;
    }

    const float t60 = 0.6f * std::pow (10.0f, reverb);  // 0.6 s .. 6 s
    spring.setDecay (t60);
    spring.setDirty (dirty);
    plate.setDecay (0.30f + 0.67f * reverb);
    plate.setDamping (0.55f - 0.5f * tone);
    plate.setBandwidth (0.55f + 0.4499f * tone);

    float* L = buffer.getWritePointer (0);
    float* R = numOut > 1 ? buffer.getWritePointer (1) : nullptr;
    float* send = sendBuffer.getWritePointer (0);

    // ---- stage 1: input gain, input meter, pre-delay into the tank send
    for (int i = 0; i < n; ++i)
    {
        const float g = inGain.getNextValue();
        L[i] *= g;
        if (R) R[i] *= g;
        const float mono = R ? 0.5f * (L[i] + R[i]) : L[i];
        const float sq = R ? 0.5f * (L[i] * L[i] + R[i] * R[i]) : L[i] * L[i];
        inEnv = sq + vuCoeff * (inEnv - sq);

        preDelay.push (mono);
        const float d = preDelayMs.getNextValue() * 0.001f * (float) fs;
        send[i] = d < 1.0f ? mono : preDelay.read (d);
    }

    // ---- stage 2: tank driver, 2x oversampled
    {
        const float dw0 = dwellAmt.getCurrentValue();
        dwellAmt.skip (n);
        const float dw1 = dwellAmt.getCurrentValue();
        juce::dsp::AudioBlock<float> block (sendBuffer.getArrayOfWritePointers(), 1, (size_t) n);
        auto up = oversampler->processSamplesUp (block);
        float* u = up.getChannelPointer (0);
        const int un = (int) up.getNumSamples();
        const double osFs = fs * 2.0;
        if (dirty)
        {
            drvPre.peak (osFs, 1200.0f, 0.7f, 7.0f);
            drvPost.peak (osFs, 1200.0f, 0.7f, -5.0f);
        }
        else
        {
            drvPre.peak (osFs, 1200.0f, 0.7f, 0.0f);
            drvPost.peak (osFs, 1200.0f, 0.7f, 0.0f);
        }
        for (int i = 0; i < un; ++i)
        {
            const float dw = dw0 + (dw1 - dw0) * (float) i / (float) un;
            const float g = dbToGain (-8.0f + 30.0f * dw);
            float x = drvHp.process (u[i]);
            x = drvPre.process (x) * g;
            float y;
            if (dirty)
            {
                // biased tube driver: asymmetric, gritty
                constexpr float bias = 0.3f;
                y = (std::tanh (1.7f * x + bias) - std::tanh (bias)) * (1.0f / 1.7f);
            }
            else
            {
                y = softClip (0.6f * x) * (1.0f / 0.6f);
            }
            y = drvPost.process (y);
            y -= dcBlock.process (y);
            // dwell drives the springs harder, but only part of the gain
            // reaches the output
            u[i] = y / std::sqrt (std::max (1.0f, g));
        }
        oversampler->processSamplesDown (block);
    }

    // ---- stage 3: tank, wet EQ, mix, output
    const float fadeStep = 1.0f / (0.03f * (float) fs);
    for (int i = 0; i < n; ++i)
    {
        const float x = send[i];
        float sL = 0, sR = 0, pL = 0, pR = 0;

        if (plateMode) modeMix = std::min (1.0f, modeMix + fadeStep);
        else           modeMix = std::max (0.0f, modeMix - fadeStep);

        if (modeMix < 1.0f) spring.process (x, sL, sR);
        if (modeMix > 0.0f) plate.process (x * 0.9f, pL, pR);

        float wL = sL + (pL - sL) * modeMix;
        float wR = sR + (pR - sR) * modeMix;

        wL = toneLp[0].process (toneShelf[0].process (eqLp[0].process (eqPeak[0].process (eqHp2[0].process (eqHp1[0].process (wL))))));
        wR = toneLp[1].process (toneShelf[1].process (eqLp[1].process (eqPeak[1].process (eqHp2[1].process (eqHp1[1].process (wR))))));

        // meters for the spring animation
        const float a = std::abs (x);
        kickEnv = a + (a > kickEnv ? kickAtt : kickRel) * (kickEnv - a);
        const float w = 0.5f * (std::abs (wL) + std::abs (wR));
        sprEnv = w + (w > sprEnv ? sprAtt : sprRel) * (sprEnv - w);

        const float m = mixAmt.getNextValue();
        const float dryG = std::cos (m * 0.5f * kPi);
        const float wetG = std::sin (m * 0.5f * kPi);
        const float og = outGain.getNextValue();

        const float oL = (L[i] * dryG + wL * wetG) * og;
        L[i] = oL;
        float sq = oL * oL;
        if (R)
        {
            const float oR = (R[i] * dryG + wR * wetG) * og;
            R[i] = oR;
            sq = 0.5f * (sq + oR * oR);
        }
        outEnv = sq + vuCoeff * (outEnv - sq);
    }

    // reset the idle engine once the crossfade is complete
    const int idle = modeMix >= 1.0f ? 0 : (modeMix <= 0.0f ? 1 : -1);
    if (idle != idleEngine)
    {
        if (idle == 0) spring.reset();
        if (idle == 1) plate.reset();
        idleEngine = idle;
    }

    if (! std::isfinite (inEnv)) inEnv = 0;
    if (! std::isfinite (outEnv)) outEnv = 0;
    inputRms.store (std::sqrt (inEnv));
    outputRms.store (std::sqrt (outEnv));
    springLevel.store (sprEnv);
    springKick.store (kickEnv);
}

void DubascoProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());
    copyXmlToBinary (*xml, destData);
}

void DubascoProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml (getXmlFromBinary (data, sizeInBytes));
    if (xml != nullptr && xml->hasTagName (apvts.state.getType()))
        apvts.replaceState (juce::ValueTree::fromXml (*xml));
}

juce::AudioProcessorEditor* DubascoProcessor::createEditor()
{
    return new DubascoEditor (*this);
}

#if ! DUBASCO_NO_PLUGIN_ENTRY
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new DubascoProcessor();
}
#endif
