# Federhall als WordPress-Plugin

Browser-Version des DUBASCO Spring Reverb als WordPress-Plugin: MP3-Player mit Dropdown, derselben Oberfläche
wie das VST/AU-Plugin (Regler, VU-Meter, Kippschalter, animierte Federn, Federkrach) und Herz-Likes pro Titel.

* `federhall/` ist der Plugin-Ordner. Als ZIP packen (`cd wordpress-plugin && zip -r federhall.zip federhall`)
  und in WordPress unter *Plugins > Installieren > Plugin hochladen* installieren.
* Der Hall läuft im Browser: `federhall/assets/js/federhall-worklet.js` ist eine Portierung von `Source/dsp/*.h`
  nach JavaScript (AudioWorklet). Änderungen am Klang bitte in beiden Versionen nachziehen.
* Die Grafiken in `federhall/assets/img/` stammen aus `Assets/` (Tank-Bilder als JPG für kleinere Downloads).

Admin-Menü **Federhall Plugin**: Titel & Upload (MP3s hochladen, sortieren, umbenennen, ausblenden),
Statistik & Likes (Ranking, Likes pro Tag, CSV-Export, Zurücksetzen), Einstellungen (Grundeinstellung des Sounds,
Likes, Aufnahme, Wiedergabe), Anleitung. Einbinden mit dem Block *Federhall Player* oder `[federhall]`.
