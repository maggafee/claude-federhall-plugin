// Offline test: renders test signals through the processor, writes WAVs,
// prints levels / CPU load, and saves GUI snapshots.
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace juce;

static void setParam (DubascoProcessor& p, const char* id, float value)
{
    auto* prm = p.apvts.getParameter (id);
    prm->setValueNotifyingHost (prm->convertTo0to1 (value));
}

static AudioBuffer<float> makeDrums (double fs, double seconds)
{
    AudioBuffer<float> b (2, (int) (fs * seconds));
    b.clear();
    Random r (42);
    // one-drop pattern: snare/rimshot on beat 3, kick, hats, plus a short
    // melodic stab -> classic stuff to send into a spring
    const double beat = 60.0 / 75.0;
    for (int bar = 0; bar < 2; ++bar)
    {
        const double t0 = bar * 4 * beat;
        auto hit = [&] (double t, float freq, float decay, float noise, float amp)
        {
            const int s0 = (int) (t * fs);
            for (int i = 0; i < (int) (fs * 0.6) && s0 + i < b.getNumSamples(); ++i)
            {
                const float tt = (float) i / (float) fs;
                const float env = std::exp (-tt / decay);
                const float v = amp * env * ((1 - noise) * std::sin (2 * MathConstants<float>::pi * freq * tt * (1 + 0.5f * std::exp (-tt * 30)))
                                             + noise * (r.nextFloat() * 2 - 1));
                b.addSample (0, s0 + i, v);
                b.addSample (1, s0 + i, v);
            }
        };
        hit (t0 + 2 * beat, 190, 0.09f, 0.65f, 0.55f);  // rimshot / snare
        hit (t0 + 2 * beat, 55, 0.25f, 0.0f, 0.6f);     // kick on the drop
        for (int e = 0; e < 8; ++e) hit (t0 + e * beat * 0.5, 7000, 0.02f, 1.0f, 0.12f);
        hit (t0 + 1.0 * beat, 440, 0.15f, 0.05f, 0.3f);  // skank
        hit (t0 + 3.0 * beat, 523, 0.15f, 0.05f, 0.3f);
    }
    return b;
}

static void writeWav (const File& f, const AudioBuffer<float>& b, double fs)
{
    f.deleteFile();
    WavAudioFormat wav;
    std::unique_ptr<AudioFormatWriter> w (wav.createWriterFor (new FileOutputStream (f), fs, (unsigned) b.getNumChannels(), 24, {}, 0));
    w->writeFromAudioSampleBuffer (b, 0, b.getNumSamples());
}

static float rmsDb (const AudioBuffer<float>& b, int start, int len)
{
    double s = 0;
    for (int c = 0; c < b.getNumChannels(); ++c)
        for (int i = start; i < start + len && i < b.getNumSamples(); ++i)
            s += b.getSample (c, i) * b.getSample (c, i);
    s /= (double) (len * b.getNumChannels());
    return (float) (10.0 * std::log10 (s + 1e-20));
}

int main (int argc, char** argv)
{
    ScopedJuceInitialiser_GUI init;
    const File outDir (argc > 1 ? argv[1] : "/tmp/dubasco");
    outDir.createDirectory();
    const double fs = 48000.0;
    const int block = 256;

    struct Case { const char* name; float mode, eq, drive, reverb, dwell, tone, mix; };
    const Case cases[] = {
        { "spring_dub_clean",   0, 1, 0, 0.55f, 0.45f, 0.5f, 1.0f },
        { "spring_dub_dirty",   0, 1, 1, 0.65f, 0.75f, 0.55f, 1.0f },
        { "spring_flat_clean",  0, 0, 0, 0.4f, 0.4f, 0.7f, 1.0f },
        { "plate_dub_clean",    1, 1, 0, 0.6f, 0.45f, 0.6f, 1.0f },
        { "plate_flat_clean",   1, 0, 0, 0.5f, 0.45f, 0.7f, 1.0f },
        { "spring_mix30",       0, 1, 0, 0.5f, 0.45f, 0.5f, 0.3f },
    };

    for (const auto& c : cases)
    {
        DubascoProcessor p;
        p.setPlayConfigDetails (2, 2, fs, block);
        setParam (p, ParamIDs::mode, c.mode);
        setParam (p, ParamIDs::eq, c.eq);
        setParam (p, ParamIDs::drive, c.drive);
        setParam (p, ParamIDs::reverb, c.reverb);
        setParam (p, ParamIDs::dwell, c.dwell);
        setParam (p, ParamIDs::tone, c.tone);
        setParam (p, ParamIDs::mix, c.mix);
        setParam (p, ParamIDs::predelay, 10.0f);
        p.prepareToPlay (fs, block);

        auto in = makeDrums (fs, 9.0);
        AudioBuffer<float> io (in);
        MidiBuffer midi;
        const double t0 = Time::getMillisecondCounterHiRes();
        for (int pos = 0; pos < io.getNumSamples(); pos += block)
        {
            const int n = std::min (block, io.getNumSamples() - pos);
            AudioBuffer<float> sub (io.getArrayOfWritePointers(), 2, pos, n);
            p.processBlock (sub, midi);
        }
        const double ms = Time::getMillisecondCounterHiRes() - t0;
        bool finite = true;
        for (int ch = 0; ch < 2; ++ch)
            for (int i = 0; i < io.getNumSamples(); ++i)
                finite &= std::isfinite (io.getSample (ch, i));
        writeWav (outDir.getChildFile (String (c.name) + ".wav"), io, fs);
        printf ("%-20s in %.1f dB  out %.1f dB  tail(7-9s) %.1f dB  peak %.2f  cpu %.2f%%  %s\n", c.name,
                rmsDb (in, 0, (int) (fs * 6.4)), rmsDb (io, 0, (int) (fs * 6.4)), rmsDb (io, (int) (fs * 7), (int) (fs * 2)),
                io.getMagnitude (0, io.getNumSamples()), ms / 9000.0 * 100.0, finite ? "ok" : "NaN!");
    }

    // impulse response of the spring (for inspection)
    {
        DubascoProcessor p;
        p.setPlayConfigDetails (2, 2, fs, block);
        setParam (p, ParamIDs::mix, 1.0f);
        setParam (p, ParamIDs::predelay, 0.0f);
        setParam (p, ParamIDs::eq, 0.0f);
        setParam (p, ParamIDs::tone, 1.0f);
        p.prepareToPlay (fs, block);
        AudioBuffer<float> io (2, (int) (fs * 4));
        io.clear();
        io.setSample (0, 0, 0.5f); io.setSample (1, 0, 0.5f);
        MidiBuffer midi;
        for (int pos = 0; pos < io.getNumSamples(); pos += block)
        {
            AudioBuffer<float> sub (io.getArrayOfWritePointers(), 2, pos, std::min (block, io.getNumSamples() - pos));
            p.processBlock (sub, midi);
        }
        writeWav (outDir.getChildFile ("spring_ir.wav"), io, fs);
    }

    // spring crash: kick, strum, scrape (silence in, mix fully dry)
    {
        DubascoProcessor p;
        p.setPlayConfigDetails (2, 2, fs, block);
        setParam (p, ParamIDs::mix, 0.0f);
        p.prepareToPlay (fs, block);
        AudioBuffer<float> io (2, (int) (fs * 8));
        io.clear();
        MidiBuffer midi;
        int blockNo = 0;
        for (int pos = 0; pos < io.getNumSamples(); pos += block, ++blockNo)
        {
            const double t = (double) pos / fs;
            if (blockNo == 2) p.strikeSpring (1, 2.0f);                        // violent kick
            if (t > 2.5 && t < 2.6 && blockNo % 2 == 0) p.strikeSpring (blockNo % 3, 1.2f); // strum over all
            if (t > 4.5 && t < 5.5 && blockNo % 6 == 0) p.strikeSpring (0, 0.25f);          // scrape
            AudioBuffer<float> sub (io.getArrayOfWritePointers(), 2, pos, std::min (block, io.getNumSamples() - pos));
            p.processBlock (sub, midi);
        }
        bool finite = true;
        for (int ch = 0; ch < 2; ++ch)
            for (int i = 0; i < io.getNumSamples(); ++i)
                finite &= std::isfinite (io.getSample (ch, i));
        printf ("crash               peak %.2f  rms(0-2s) %.1f dB  rms(4.5-6s) %.1f dB  %s\n", io.getMagnitude (0, io.getNumSamples()),
                rmsDb (io, 0, (int) (fs * 2)), rmsDb (io, (int) (fs * 4.5), (int) (fs * 1.5)), finite ? "ok" : "NaN!");
        writeWav (outDir.getChildFile ("crash.wav"), io, fs);
    }

    // GUI snapshots: idle and with signal
    if (argc > 2)
    {
        DubascoProcessor p;
        p.setPlayConfigDetails (2, 2, fs, block);
        p.prepareToPlay (fs, 1024);
        std::unique_ptr<AudioProcessorEditor> ed (p.createEditor());
        ed->setSize (Layout::width, Layout::height);
        auto snap = [&] (const char* name)
        {
            auto img = ed->createComponentSnapshot (ed->getLocalBounds(), true, 1.0f);
            PNGImageFormat png;
            File f = outDir.getChildFile (name);
            f.deleteFile();
            FileOutputStream os (f);
            png.writeImageToStream (img, os);
        };
        snap ("gui_idle.png");

        setParam (p, ParamIDs::reverb, 0.8f);
        setParam (p, ParamIDs::mode, 1.0f);
        setParam (p, ParamIDs::drive, 1.0f);
        setParam (p, ParamIDs::eq, 0.0f);
        setParam (p, ParamIDs::input, 6.0f);
        setParam (p, ParamIDs::mix, 0.85f);
        auto drums = makeDrums (fs, 3.0);
        MidiBuffer midi;
        auto* editor = dynamic_cast<DubascoEditor*> (ed.get());
        // run audio + gui ticks in lockstep at 60 fps
        const int perFrame = (int) (fs / 60.0);
        for (int pos = 0; pos + perFrame < (int) (fs * 1.75); pos += perFrame)
        {
            AudioBuffer<float> sub (drums.getArrayOfWritePointers(), 2, pos, perFrame);
            p.processBlock (sub, midi);
            MessageManager::getInstance()->runDispatchLoopUntil (16);
        }
        (void) editor;
        snap ("gui_active.png");
    }
    return 0;
}
