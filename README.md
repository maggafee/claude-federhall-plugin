# DUBASCO Spring Reverb Unit

Federhall-Plugin im Stil der jamaikanischen Dub-Studios der 70er/80er (King Tubby, Black Ark):
drei Federn mit dem typischen „Drip“-Chirp, umschaltbar auf Plate, Dub-EQ und übersteuerbarer Tank-Treiber.

Formate: **VST3** (Ableton, Cubase, Studio One, Reaper …), **Audio Unit** (Logic, GarageBand), **CLAP** (Bitwig, Reaper) und **Standalone**.
macOS (Apple Silicon + Intel), Windows, Linux.

## Bedienelemente

| Regler / Schalter | Funktion |
|---|---|
| **Input** (−∞ … +12 dB) | Eingangspegel. Das linke VU-Meter zeigt den Pegel nach diesem Regler (0 VU = −18 dBFS RMS). |
| **Pre-Delay** (0 … 500 ms) | Verzögerung bevor das Signal in den Tank geht. |
| **Reverb** (Min … Max) | Nachhallzeit, ca. 0,6 s bis 6 s. |
| **Dwell** (Min … Max) | Wie hart der Röhrentreiber die Federn anfährt (wie beim Fender-Tank): mehr Dichte, mehr Pegel, mehr Sättigung. |
| **Tone** (Dark … Bright) | Klangfarbe des Halls (Tiefpass + Höhen-Shelf, bei Plate zusätzlich die Dämpfung im Tank). |
| **Mix** (Dry … Wet) | Mischung trocken/nass (equal power). Für den Einsatz als Send-Effekt auf Wet stellen. |
| **Output** (−∞ … +12 dB) | Ausgangspegel. Rechtes VU-Meter zeigt den Ausgang. |
| **Spring Mode**: Spring / Plate | Federhall (3 Federn) oder Plattenhall (Dattorro-Plate). Weiche Überblendung beim Umschalten. |
| **EQ**: Flat / Dub | Dub = klassischer Dub-Send-EQ: Bass raus (190 Hz, 24 dB/Okt.), Mitten-Präsenz bei 1,5 kHz, weiche Höhen. |
| **Tank Drive**: Clean / Dirty | Dirty = asymmetrisch übersteuerter Röhrentreiber (2× Oversampling) und Federn, die bei harten Schlägen „crashen“. |

**Federn krachen lassen (King-Tubby-Crash):** Mit der Maus oder dem Finger über die Federn fahren.
Antippen zupft eine Feder, quer drüberstreichen lässt sie krachen (je schneller, desto lauter), längs
entlangfahren kratzt und rasselt. Auch ohne Klicken kracht es, wenn die Maus schnell über die Federn wischt.
Der Krach läuft durch einen eigenen, übersteuerten Feder-Tank und ist unabhängig von Mix und Spring/Plate immer zu hören.

Doppelklick auf einen Regler setzt ihn zurück. Das Fenster ist frei skalierbar (Ecke ziehen).

## Klangmodell

* **Spring**: Modell nach Välimäki/Parker/Abel („Parametric spring reverberation effect“, JAES 2010).
  Jede Feder ist eine Rückkopplungsschleife mit einer Kaskade aus 58–72 „gestreckten“ Allpässen. Dadurch
  kommt jedes Echo als absteigender Chirp an, und mit jedem Umlauf wird er stärker verschmiert, so wie bei
  einer echten Feder. Dazu eine zweite, kurze Schleife für das helle Zischeln, langsam modulierte Laufzeit
  (Federwackeln), Wandler-Bandbegrenzung 90 Hz…6,5 kHz. Drei unterschiedlich lange Federn: Feder 1 links,
  Feder 2 rechts, Feder 3 Mitte.
* **Plate**: Dattorro-Plate (Figure-8-Tank) mit Modulation.
* Mono-Send in den Tank (wie im Original), Stereo-Ausgang.

## Oberfläche

* Hintergrund ist das Originalbild. Zeiger, VU-Nadeln und Lampen wurden aus dem Bild entfernt und werden live gezeichnet.
* **Knöpfe**: Knopfkörper und Kappe bleiben fest stehen, Licht und Perspektive ändern sich also nie. Nur der Zeigerschlitz
  auf der Kappe und die Markierung auf dem Rand drehen sich, wie die Farbe auf einem echten Knopf.
* **Federn**: Die drei Federn werden in jedem Frame Spalte für Spalte neu gezeichnet und schwingen mit dem Hallsignal
  (stehende Wellen), bei jedem Schlag läuft eine Welle über die Feder und wird am Ende reflektiert. Die Hintergrundbeleuchtung
  glüht mit dem Signal auf.
* **VU-Meter**: echte VU-Ballistik (ca. 300 ms, leichtes Überschwingen), Skala nach der Bildvorlage kalibriert.

## Bauen

Voraussetzungen: CMake ≥ 3.22, C++17-Compiler (Xcode / Visual Studio 2022 / GCC). JUCE 8 und die CLAP-Erweiterung werden automatisch geladen.

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --target DubascoSpringReverb_All DubascoSpringReverb_CLAP
```

macOS Universal Binary: `-DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"`.
Linux braucht: `libasound2-dev libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libfreetype-dev libfontconfig1-dev libgl1-mesa-dev`.

Die fertigen Plugins liegen unter `build/DubascoSpringReverb_artefacts/Release/`.

**Automatisch per GitHub**: Das Repo enthält `.github/workflows/build.yml`. Nach jedem Push baut GitHub Actions
macOS- (AU, VST3, CLAP, App) und Windows-Pakete (VST3, CLAP, EXE). Die ZIPs findest du im Tab *Actions* > letzter Lauf > *Artifacts*.
Installationshinweise liegen in den ZIPs (`packaging/INSTALL_*.txt`).

Offline-Test (Audio-Renders, CPU, GUI-Screenshot): `-DDUBASCO_BUILD_TESTS=ON`, dann `DubascoRenderTest <ausgabeordner> gui`.

## Grafik neu erzeugen

`tools/make_assets.py` erzeugt alle Grafiken in `Assets/` aus den Originalbildern in `assets_src/` (Python 3, OpenCV, NumPy).

## Lizenz-Hinweis

Gebaut mit JUCE 8 (AGPLv3 oder JUCE-Lizenz; für persönliche Nutzung und kleine Projekte gibt es die kostenlose JUCE-„Starter“-Lizenz).
