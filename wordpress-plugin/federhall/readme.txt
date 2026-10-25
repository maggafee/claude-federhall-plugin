=== Federhall – DUBASCO Spring Reverb ===
Contributors: maggafee
Tags: audio, player, reverb, mp3, likes
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Der DUBASCO Federhall im Browser: MP3-Player mit Feder-/Plattenhall, animierten Federn, King-Tubby-Federkrach und Herz-Likes.

== Description ==

Besucher deiner Website wählen einen deiner MP3-Titel aus dem Dropdown, spielen ihn ab und experimentieren live mit dem Federhall:

* Originale DUBASCO-Oberfläche mit sieben Reglern (Input, Pre-Delay, Reverb, Dwell, Tone, Mix, Output), zwei VU-Metern und drei Kippschaltern (Spring/Plate, Flat/Dub, Clean/Dirty).
* Die drei Federn schwingen mit dem Hall und lassen sich anfassen: antippen, quer drüberstreichen (Crash) oder längs kratzen.
* A/B-Vergleich, Regler zurücksetzen, Aufnahme des Experiments als Audiodatei.
* Herz-Likes pro Titel. Im Backend siehst du das Ranking, Likes pro Tag und kannst alles als CSV exportieren.

Der Hall läuft komplett im Browser des Besuchers (Web Audio / AudioWorklet), dein Server liefert nur die MP3s aus.

== Installation ==

1. In WordPress unter Plugins > Installieren > Plugin hochladen die ZIP-Datei auswählen und aktivieren.
2. Links im Menü „Federhall Plugin“ > „Titel & Upload“ öffnen und MP3s hochladen.
3. Auf einer Seite den Block „Federhall Player“ einfügen oder den Shortcode [federhall] verwenden.

== Shortcode ==

* [federhall] – alle aktiven Titel
* [federhall tracks="3,5,8"] – nur diese Titel-IDs in dieser Reihenfolge
* [federhall track="5"] – mit Titel 5 starten
* [federhall width="800"] – maximale Breite in Pixel

== Datenschutz ==

Für Likes und Plays wird ein mit dem Salt deiner Installation gehashter Wert gespeichert (Zufalls-ID aus dem localStorage des Browsers oder, je nach Einstellung, die IP-Adresse). Es werden keine Klartext-IPs, keine Cookies und keine personenbezogenen Daten gespeichert. Es werden keine externen Dienste geladen.

== Changelog ==

= 1.0.0 =
* Erste Version.
