# MatUlanzi.HomeAssistant — Home Assistant für UlanziDeck

Ein UlanziDeck-Plugin (Ulanzi Studio), das Home Assistant steuert. Entstanden aus
einem konkreten Ärgernis mit dem offiziellen Ulanzi-HA-Plugin: dessen Entity-Suche
zeigt nur den Anzeigenamen — und wenn drei Lampen „Deckenlicht" heißen, ist nicht
erkennbar, welche gemeint ist.

## Was hier anders ist

Das offizielle Plugin (`com.ulanzi.ulanzideck.homeAssistant`) spricht die
Home-Assistant-WebSocket-API, fragt aber weder `area_registry` noch
`device_registry` ab. Es *kann* also gar keine Räume anzeigen.

Dieses Plugin joint stattdessen vier Registries — Areas, Devices, Floors, Entities —
und macht daraus einen Index, in dem jede Zeile so aussieht:

```
● Deckenlicht        Wohnzimmer · Hue Ceiling WZ · light.decke_wz     an  ⚡
```

Daraus ergibt sich:

- **Suche über Raum, Gerät, Etage, Name und entity_id.** „licht küche" findet das
  Küchenlicht, auch wenn das Ding „Deckenlicht" heißt.
- **Deutsche Synonyme** als Domain-Filter: „licht", „steckdose", „rollo",
  „heizung" … schränken automatisch auf die passende Domain ein.
- **Umlaut-Toleranz:** „kueche" findet „Küche".
- **Diagnose-/Config-Entities und versteckte Entities sind ausgeblendet** — das
  ist der Großteil des Rauschens in einer gewachsenen Installation.
- **Identify-Knopf (⚡)** pro Zeile: schaltet Licht/Schalter/Lüfter kurz, damit du
  siehst, welches Gerät gemeint ist. Bewusst *nicht* für Schlösser und Rollos.
- **Raumname auf der Taste**, damit die Belegung auch später noch lesbar ist.

## Stand

Version 0.1.0 — Schritt 1 von 5. Vorhanden:

| Baustein | Status |
| --- | --- |
| HA-WebSocket-Client (Auth, Reconnect mit Backoff, Ping/Pong, Live-Push) | ✅ |
| Registry-Join + Suche | ✅ |
| Canvas-Renderer für Tasten (Zustand, Farbe, Balken, „nicht verfügbar") | ✅ |
| Action „Toggle" mit Live-Zustand und Long-Press-Identify | ✅ |
| Raumbewusster Entity-Picker | ✅ |
| Stil-Engine: Farben, Icons, Text-Templates, HTML-Modus | ✅ |
| Button-Bibliothek + mehrere HA-Verbindungen | ✅ |
| Ordner (Designer-Organisation, Filter-Dropdown) | ✅ |
| Gruppen: mehrere Entities pro Button, Vorrang EIN/AUS | ✅ |
| Typen: Button (schaltet) und Info (nur Anzeige, mit Intervall) | ✅ |
| 123 mitgelieferte MDI-Icons mit Suche, plus eigene Dateien | ✅ |
| Designer-Fenster (openView) mit Live-Vorschau | ✅ |
| Selbsttest (92 Assertions) | ✅ |
| In Ulanzi Studio geladen (D200) | ⚠️ teilweise — Designer öffnete nach dem Schließen nicht erneut, gefixt |

Geplant: Control-Fenster beim Tastendruck (Dimmer, RGBW, Thermostat) — auf dem
Gerät selbst gibt es kein Untermenü, weil das SDK keine programmatische
Seiten-Navigation kennt. Danach: Service-Call-Action, Szenen-Vorlagen,
Encoder-Actions (nur für Geräte mit Drehknopf, z.B. D200X).

## Bibliothek & Designer

Buttons werden **nicht pro Taste** konfiguriert. Sie leben in einer Bibliothek in
den Global Settings; eine Taste speichert nur eine Referenz:

```
Taste  →  { button: "btn-abc123" }  →  Bibliothek
                                        ├── connections[]  mehrere HA-Instanzen
                                        └── buttons[]      Name, Verbindung, Entity, Stil
```

Damit liegt derselbe Button auf beliebig vielen Tasten, und eine Änderung im
Designer aktualisiert alle davon gleichzeitig. Die Tasteneinstellung im Property
Inspector besteht deshalb nur aus einem Dropdown, einer Vorschau und optionalen
Overrides (Beschriftung, Raum ein/aus).

Der Designer (`$UD.openView`, eigenes Fenster) enthält:

- **Verbindungen**: mehrere Home-Assistant-Instanzen mit Name, URL und Token,
  jede mit Live-Statuspunkt. Beim Anlegen eines Buttons wählt man die Instanz.
- **Buttons**: Liste links, Editor mitte, Live-Vorschau rechts. Der Editor
  enthält den raumbewussten Entity-Picker und alle Stil-Felder.
- **Vorschau**: eine echte Action-Instanz, die durch den echten `KeyRenderer`
  gegen die echte Verbindung rendert — das Bild ist exakt das, was die Taste
  später zeigt, inklusive Live-Zustand.

Alte Tasten, die noch eine Entity direkt gespeichert haben, funktionieren weiter
(`resolveKey` erkennt den Altbestand), und eine alte flache Verbindung wird beim
Laden automatisch in die erste Verbindung der Bibliothek migriert.

### Typ „Öffnen"

Ein Tastendruck springt in Home Assistant an die passende Stelle — Ziel wird im
Designer gewählt, mit Live-Vorschau der Adresse:

| Ziel | Adresse |
| --- | --- |
| Entität | `…/?more-info-entity-id=light.decke_wz` (Info-Dialog über dem Standard-Dashboard) |
| Raum | `…/config/areas/area/wohnzimmer` |
| Dashboard | `…/lovelace/0`, Pfad frei wählbar |
| freie Adresse | wie eingegeben, ein nackter Host bekommt `https://` |

Solche Tasten brauchen keine Entität; die Raumliste ist nach Etage und Raum
sortiert (`DG › Dachboden`, `EG › Büro`, …). Gebaut wird die Adresse in
`plugin/src/ha-links.js`, absichtlich als reine Funktion — eine falsche Adresse
öffnet lautlos die falsche Seite, also ist genau das der Teil mit Tests.

**Was der Host dabei kann und was nicht:** `openUrl` öffnet eine vollständige
`https`-Adresse zuverlässig im Standardbrowser. Mit `local: true` öffnet es
**gar nichts** — weder relativ noch absolut, ohne Fehlermeldung. Deshalb ist
jedes Ziel hier eine Remote-Adresse.

### Nur angehakte Felder werden gesendet

Jedes Feld trägt ein Häkchen. Der Grund ist unangenehm banal: ein Schieberegler
steht *immer* irgendwo, auch wenn sein Wert gar nicht Teil des Aufrufs ist. Ohne
Häkchen sah ein unberührter Farbregler so aus, als würde die Farbe mitgeschickt,
und beim Speichern fiel sie stillschweigend weg.

Jetzt ist es sichtbar: nicht angehakte Felder sind ausgegraut und fehlen im
JSON. Wer einen Regler anfasst, hakt ihn damit automatisch an. Das erzeugte JSON
steht darunter und wächst mit:

```
Helligkeit bewegt   →  {"brightness_pct":35}
Farbe bewegt        →  {"rgb_color":[255,51,255],"brightness_pct":35}
Kelvin bewegt       →  {"rgb_color":[...],"color_temp_kelvin":2700,"brightness_pct":35}
Helligkeit erneut   →  die anderen bleiben, nur der eine Wert ändert sich
```

Sind Farbe und Farbtemperatur gleichzeitig gesetzt, wird gewarnt — Home Assistant
nimmt in dem Fall nur eines davon und sagt nicht, welches.

### Ein Button, drei Auslöser, eine Kachel

Das Modell ist absichtlich klein: **eine** Sorte Button, eine Kachel, und eine
Liste von Aktionen mit drei möglichen Auslösern.

| Auslöser | wann |
| --- | --- |
| Kurzer Druck | sofort |
| Doppelklick | zwei Drücke binnen 320 ms |
| Langer Druck | ab 600 ms |

Der einfache Druck wird nur dann zurückgehalten, wenn der Button überhaupt eine
Doppelklick-Aktion hat — sonst feuert er ohne jede Verzögerung. Wer keinen
Doppelklick benutzt, zahlt also nichts dafür.

Und eine Aktion muss kein Home-Assistant-Dienst sein: **„Steuerfenster öffnen"**
steht als Aktionsart daneben. Damit kann eine Taste schalten *und* auf Wunsch
die Regler zeigen:

```
Kurzer Druck  ·  Dienst    ·  cover.toggle
Doppelklick   ·  Fenster   ·  (dieselbe Entität)
Langer Druck  ·  Dienst    ·  cover.stop_cover
```

Genau so am Wohnzimmer-Rollo gemessen: langer Druck stoppte, zwei schnelle
Drücke öffneten das Fenster ohne zu schalten, ein einzelner Druck schaltete.

### Aktionsliste: wann, worauf, was

Ein Button trägt eine Liste von Aktionen statt fester Felder. Jede Zeile sagt,
wann sie läuft, auf welche Entität, und welchen Dienst mit welchen Daten:

```
Kurzer Druck · Alle Entitäten          · light.turn_on   {"brightness_pct": 30}
Kurzer Druck · SwitchBot Floor Lamp    · light.turn_on   {"rgb_color": [255,0,128]}
Langer Druck · Alle Entitäten          · light.turn_off  { }
```

Damit sind „Longpress das, Shortpress dies" und „pro Lampe eine andere Farbe"
dasselbe Werkzeug. Die Zeilen laufen der Reihe nach; eine Zeile ohne Entität
trifft alle Entitäten des Buttons, und bei einer Kontext-Taste das Gerät, dem
sie gerade folgt.

**Alte Buttons bleiben unangetastet.** Eine leere Liste heißt: verhalte dich wie
bisher. Deshalb war für den Umstieg keine Datenwanderung nötig — was gemessen
auch so eintritt: mit einer Aktion nur auf langem Druck schaltet ein kurzer
Druck weiterhin die ganze Gruppe über `homeassistant.turn_off`.

Ungültiges JSON in einer Zeile überspringt nur diese Zeile und nennt sie beim
Namen (`light.turn_on: Daten sind kein gültiges JSON`), statt den ganzen
Tastendruck fallen zu lassen.

### Aktionen kommen aus Home Assistant selbst

Eine handgepflegte Liste von Aktionen war ein Fehler: sie kannte für Rollos
genau eine Aktion, während Home Assistant zehn kennt — und eine unbekannte
Integration hätte sie nie abgedeckt. `get_services` liefert alles, und zu jedem
Feld einen Selector, der genau beschreibt, was es annimmt. Daraus baut sich der
Editor selbst:

```
cover.buro   →  38 Aktionen angeboten
   cover.open_cover, close_cover, stop_cover, set_cover_position,
   toggle + vier Tilt-Varianten
   homeassistant.turn_on / turn_off / toggle   (generisch)

set_cover_position.position  →  {min:0, max:100, step:1, unit:"%"}  →  Prozentregler
light.turn_on.rgb_color      →  color_rgb                          →  Farbwähler
light.turn_on.color_temp_kelvin → {unit:"kelvin", min:2000, max:6500} → Kelvin-Regler
```

Gemessen an einer echten Instanz: 76 Domains. Die vorkommenden Selectors sind
text (144), number (76), boolean (42), select (38) und object (38); alles, was
sich nicht sinnvoll darstellen lässt, bleibt über das JSON-Feld erreichbar und
der Dienst wird als unvollständig markiert.

**Eine Ausnahme ist bewusst gesetzt:** die Domain `homeassistant` enthält auch
`restart` und `stop`. Beides hat einen Fehlgriff entfernt auf einem Tastengerät
nichts verloren, deshalb werden dort nur `turn_on`, `turn_off`, `toggle` und
`update_entity` angeboten. Von Hand eintippen kann man alles.

### Standard-Aktionen statt JSON tippen

Für die alltäglichen Wünsche gibt es fertige Aktionen mit echten Eingabefeldern;
das JSON entsteht daraus und bleibt darunter sichtbar und bearbeitbar:

| Aktion | Domain/Dienst | Felder |
| --- | --- | --- |
| Licht einschalten | `light.turn_on` | Helligkeit, Farbe (Farbwähler), Farbtemperatur, Übergang |
| Solltemperatur setzen | `climate.set_temperature` | Solltemperatur |
| Betriebsart setzen | `climate.set_hvac_mode` | off, heat, cool, auto, dry, fan_only |
| Lautstärke setzen | `media_player.volume_set` | Lautstärke in Prozent |
| Position setzen | `cover.set_cover_position` | Position |
| Stufe setzen | `fan.set_percentage` | Stufe |
| Wert setzen | `number.set_value` | Wert |
| Szene aktivieren | `scene.turn_on` | Übergang |
| Benachrichtigung | `notify.persistent_notification` | Titel, Nachricht |

Angeboten wird nur, was zur gewählten Entität passt. Zwei Fallen nimmt der
Katalog dabei ab: **Lautstärke** will Home Assistant als `0..1`, das Feld rechnet
aus Prozent um — sonst schickt man hundertmal zu viel. Und **Temperatur,
Lautstärke, Position** gehen *nicht* über `turn_on`, sondern brauchen je einen
eigenen Dienst; deshalb trägt jede Aktion ihren mit.

Im Schalt-Editor erscheinen die Licht-Felder direkt über dem JSON, weil `turn_on`
bei Licht als einziger Domain Farbe und Helligkeit direkt annimmt. Ein leeres
Feld wird nicht gesendet: Home Assistant unterscheidet einen fehlenden Schlüssel
deutlich von einem `null`.

### Was „EIN" bedeuten soll

Ein `toggle` kann keine Parameter tragen — deshalb sagt ein Button nicht nur,
*dass* geschaltet wird, sondern auf Wunsch auch *wie*. Sobald etwas eingetragen
ist, schickt die Taste statt eines Umschaltens ein ausdrückliches
`turn_on`/`turn_off` in der Domain der Entität:

```
Beim Schalten:  [ Alle Entitäten ▾ ]
EIN   {"brightness_pct": 15}
AUS   {"transition": 2}

Beim Schalten:  [ SwitchBot Floor Lamp • ▾ ]        ← eigene Daten
EIN   {"brightness_pct": 40, "rgbw_color": [255,160,60,0]}
```

Die Einstellung pro Entität schlägt die für alle, ein `•` markiert die Entitäten
mit eigenen Daten. So bekommt eine Gruppe aus drei Lampen eine gemeinsame
Grundhelligkeit und trotzdem eine davon ihre eigene Farbe. Ungültiges JSON wird
unter den Feldern benannt, samt Entität — ein Tippfehler darf nicht erst beim
Drücken auffallen, wenn stillschweigend nichts passiert.

Nicht-Standard-Richtungen sind berücksichtigt: `cover` wird `open_cover` /
`close_cover`, `lock` wird `lock` / `unlock`, und `scene`, `script`, `button`,
`automation` behalten ihren einen sinnvollen Dienst.

### Typ „Dienst-Aufruf"

Ruft einen beliebigen Home-Assistant-Dienst mit eigenen JSON-Daten auf —
`climate.set_hvac_mode`, `notify.*`, `cover.set_position`, alles. Die gewählte
Entität wird als Ziel mitgeschickt, Dienste ohne Ziel lässt man einfach ohne.
Der Designer prüft das JSON beim Tippen und zeigt an, was die Taste senden wird;
ungültiges JSON wird rot, statt später stumm nichts zu tun.

### Typ „Schritt"

Verstellt relativ — das ist die Tastenfeld-Antwort auf den Drehknopf, den der
D200 nicht hat. Die Schrittweite steht in der Einheit, die man sieht:

| Domain | Dienst | Einheit |
| --- | --- | --- |
| `climate` | `set_temperature` | Grad, begrenzt auf `min_temp`/`max_temp` |
| `light` | `turn_on` mit `brightness_pct` | Prozent, 0 % schaltet aus |
| `cover` | `set_cover_position` | Prozent |
| `fan` | `set_percentage` | Prozent, gerastert auf `percentage_step` |
| `media_player` | `volume_set` | Prozent |
| `number`, `input_number` | `set_value` | eigene Einheit, eigene Grenzen |

Begrenzt wird immer auf den Bereich, den die Entität selbst meldet: Home
Assistant ignoriert einen Wert außerhalb stillschweigend, und die Taste sähe
kaputt aus.

### Kontext-Tasten: eine Steuerseite für alle Geräte

Eine Taste kann statt auf ihre eigene Entität auf **das zuletzt gewählte Gerät**
wirken. Damit bedient eine einzige Seite jedes Thermostat, statt eine Seite pro
Gerät zu brauchen:

```
Seite 1:  Thermostat lang drücken        → Ziel = climate.buero
Seite 2:  −1°   COOL   +1°   Info        → wirken alle auf climate.buero
          (nach zwei Minuten ohne Nutzung verfällt das Ziel)
```

Was ein langer Druck tut, ist pro Button einstellbar: identifizieren, als
Kontext-Gerät merken, in Home Assistant öffnen, nichts — oder **einen beliebigen
anderen Button aus der Bibliothek ausführen**. Damit ist der lange Druck frei
definierbar, ohne eine zweite Konfigurationssprache: er kann alles, was ein
Button kann. Ausgeführt wird nur dessen *Druck*-Aktion, nie wieder ein langer
Druck, damit zwei Buttons sich nicht gegenseitig aufrufen können.

Ein **kleines Fenster an einer gewünschten Stelle** ist dagegen sehr wohl
möglich. `openView` beachtet Größe *und* Position genau — zweimal gemessen:

```
angefordert 380x260 an 700,400  →  Fenster 396x299 an 692,400
angefordert 620x430 an 200,150  →  Fenster 636x469 an 192,150
```

Die Differenz ist genau der Fensterrahmen. (Eine frühere Notiz hier behauptete,
die Größe werde ignoriert — das war ein Messfehler an einem anderen, noch
offenen Fenster.)

Was die Plugin-Seite nicht kann, ist die **Mausposition** kennen oder ein
Betriebssystem-Menü öffnen. Dafür bräuchte es ein kleines lokales
Hilfsprogramm — und der Draht dorthin steht: eine Plugin-Seite in Studio
erreicht `http://127.0.0.1:<port>` problemlos, gemessen mit einem Testserver.

Das ist bewusst die Übersetzung des „Smart Dialer"-Musters anderer Plugins auf
ein Tastenfeld. Der echte Dialer braucht einen Encoder; dieses Gerät ist laut
Studios eigener Konfiguration ein `Ulanzi Deck 5x3` ohne Drehknöpfe.

### Tastengruppen: Nachbartasten folgen einer Leittaste

Eine Taste kann auf **das Gerät einer anderen Taste** wirken. Damit wird aus
drei nebeneinander gelegten Tasten eine Bedieneinheit:

```
[ − 0.5° ]      [ Klima Büro  23° ]      [ + 0.5° ]
  folgt              Leittaste             folgt
```

Die Folge-Tasten brauchen keine eigene Entität und **zeigen den Livewert der
Leittaste mit** — im Test stand auf der „+"-Taste ebenfalls „Klima Büro 23°".
Ein Druck schickte `climate.set_temperature {temperature: 23.5}` an die Entität
der Leittaste, „−" entsprechend 22.5.

Das Muster passt auf alles: Helligkeit ±10 % neben einer Lampe, Position neben
einem Rollo, Lautstärke neben einem Lautsprecher. Ein langer Druck auf der
Leittaste kann zusätzlich einen beliebigen anderen Button ausführen.

Das ist übrigens die ehrliche Antwort auf „Untermenü": Nachbartasten, die
*unsere* Action tragen, dürfen wir bemalen und ihre Drücke empfangen. Nur an
fremde Tasten kommt man nicht heran — und Seiten umschalten kann ein Plugin
nicht.

### Steuerfenster: die Regler am Rechner

Ein Button vom Typ „Steuerfenster" öffnet beim Druck ein kleines Fenster mit
genau den Reglern, die das Gerät hat. Die Werte stammen aus der Entität selbst,
nicht aus Annahmen:

```
Thermostat   An/Aus · Solltemperatur 23° (jetzt 22°)
             − 0.5°  + 0.5°      ← Schrittweite aus target_temp_step
             off · fan_only · heat · cool · heat_cool · dry  ← alle aus hvac_modes
             Lüfter · Schwenken · Voreinstellung als Auswahl

Lampe        An/Aus · Helligkeit · Farbe (Farbwähler) · Farbtemperatur
Rollo        ▲ ■ ▼ · Position
Media        ⏮ ⏯ ⏭ · Lautstärke
```

Das Fenster ist 420×520 groß und lässt sich pro Button positionieren; `openView`
beachtet beides genau. Ein zweiter Tastendruck auf ein anderes Gerät **lenkt das
offene Fenster um**, statt ein zweites zu öffnen.

Es hängt an einer eigenen uuid (`…matUlanziHa.control`), getrennt von der des
Designers — sonst reißt das Schließen des einen Fensters die Host-Buchhaltung
des anderen mit (siehe designer-window.js). Schieberegler senden gebündelt,
damit Ziehen nicht jede Zwischenstufe an Home Assistant schickt.

### Kein Untermenü auf dem Gerät

Ein Untermenü, das sich auf Nachbartasten legt, ist mit diesem Host nicht
möglich: `setBaseDataIcon`, `setTitle` und `setState` adressieren immer einen
`context`, also **nur Tasten, die diese Action tragen**. Es gibt kein
Profil-, Seiten- oder Layout-Kommando, und an eine Taste mit fremdem Plugin
kommt man nicht heran. `setFeedbackLayout`/`setFeedback` gelten nur für
Drehknopf-Displays, die der D200 nicht hat. Machbar wären ein Steuerfenster am
PC (`openView`) oder ein Untermenü auf den eigenen Tasten — beides bewusst
zurückgestellt.

## Tastenlayout & Stil

**Die Kachel ist kein HTML, sie ist ein Bild.** Das SDK kennt nur
`setStateIcon` (Index aus dem Manifest), `setPathIcon` (Datei),
`setBaseDataIcon` (base64-PNG) und `setGifDataIcon`/`setGifPathIcon` (GIF) —
jeweils plus einen Text, den der Host selbst über das Icon legt. Es gibt keinen
DOM auf der Taste und damit **keine Events in der Kachel**: nur `keydown`,
`keyup` und `run` (kurz/lang über die Druckdauer), Dreh-Events ausschließlich auf
Geräten mit Knopf.

Dieses Plugin rendert deshalb jede Taste selbst auf ein 196×196-Canvas. Zwei
Modi, konfiguriert über das Stil-Objekt in `key-style.js`:

**`classic`** — drei Textzonen (oben links, groß mittig, unten), Farben für An/Aus,
optionale Icons für An/Aus, Füllbalken. Die Textzonen sind Templates:

| Platzhalter | Inhalt |
| --- | --- |
| `{{name}}` | Anzeigename (bzw. eigene Beschriftung) |
| `{{area}}` `{{floor}}` `{{device}}` | Raum, Etage, Gerät aus der Registry |
| `{{value}}` | die aufbereitete Anzeige (z.B. `71%`, `21.4°C`, `Aus`) |
| `{{state}}` | Rohzustand aus HA |
| `{{brightness}}` | Helligkeit in Prozent |
| `{{entity_id}}` `{{domain}}` `{{unit}}` | technische Felder |
| `{{attr:xyz}}` | beliebiges Attribut, z.B. `{{attr:temperature}}` |

Filter per Pipe: `{{name|upper}}`, `{{attr:temperature|round}}`, `|lower`, `|title`.

**`html`** — eigenes HTML+CSS, gerendert über `<svg><foreignObject>` → Canvas →
PNG. Funktioniert (in Chromium verifiziert, Canvas bleibt exportierbar), aber mit
harten Grenzen: **kein JavaScript** wird ausgeführt, externe Bilder und Fonts
müssen als Data-URL eingebettet sein. Ein kaputtes Template fällt automatisch auf
`classic` zurück, damit die Taste nie schwarz bleibt.

Der Stil gehört zum Button in der Bibliothek. Eine Taste kann einzelne Felder
überschreiben; dabei gilt: ein **leeres** Override-Feld erbt vom Button, ein
leeres Feld **im Button selbst** heißt „diese Zone bleibt leer".

Die Größe des Property-Inspector-Panels ist von Ulanzi Studio vorgegeben, das
`manifest.json` hat dafür kein Feld. Deshalb läuft der Editor über
`$UD.openView(url, width, height)` in einem eigenen Fenster.

## Installation

1. **Long-Lived Access Token** in Home Assistant erzeugen:
   Profil (unten links) → Tab *Sicherheit* → *Langlebige Zugriffstoken* → *Token erstellen*.
2. Plugin ins Ulanzi-Verzeichnis kopieren:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

3. Ulanzi Studio neu starten.
4. Action *Schalten* auf eine Taste ziehen und im Property Inspector auf
   **Designer** klicken.
5. Im Designer links *+ Verbindung*: Name, URL (`http://homeassistant.local:8123`)
   und Token. Der Statuspunkt wird grün.
6. *+ Button*: Verbindung wählen, Entity suchen, Aussehen einstellen — die
   Vorschau rechts zeigt live, was die Taste anzeigt.
7. Zurück im Property Inspector den Button im Dropdown auswählen.

Verbindungen und Buttons liegen in den Global Settings von Ulanzi Studio, nicht in
diesem Repo. Mehrere Verbindungen sind möglich; jeder Button gehört zu einer.

## Entwicklung

Kein Build-Schritt, kein npm — reine Classic Scripts, weil der Main Service und
die Property Inspectors unter `file://` in der Qt-WebView laufen und ES-Module
dort an CORS scheitern.

**Syntaxprüfung.** Ulanzi Studio bringt ein Node v20.12.2 mit, auch wenn keins auf
dem PATH liegt — brauchbar für einen schnellen Vorab-Check:

```powershell
$node = 'C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe'
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notlike '*\libs\*' } | ForEach-Object { & $node --check $_.FullName }
```

**Selbsttest** (Registry-Join, Suche, Domain-Semantik, Renderer) im Browser:

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Dann http://127.0.0.1:8791/tools/selftest.html öffnen. Der Test läuft gegen
Fixtures mit drei gleichnamigen Deckenlichtern und rendert alle Tastenvarianten.

**UI-Vorschau ohne Ulanzi Studio.** Bei laufendem Server:

```
http://127.0.0.1:8791/com.ulanzi.matUlanziHa.ulanziPlugin/property-inspector/toggle/inspector.html?preview=1&uuid=com.ulanzi.ulanzistudio.matUlanziHa.toggle&key=1&actionid=1&language=de_DE
```

`preview=1` lädt `tools/ud-stub.js`, das nur `window.WebSocket` ersetzt und damit
*beide* Gegenseiten simuliert — die Ulanzi-Studio-Bridge und Home Assistant.
Der restliche Code ist unverändert der ausgelieferte. Unten rechts zeigt ein
Panel, was an Ulanzi Studio gesendet würde. `language=en` schaltet die Sprache um.

**Main Service im Browser laufen lassen** — er malt dann echte Tastenbilder, die
unten links als Kacheln erscheinen:

```
http://127.0.0.1:8791/com.ulanzi.matUlanziHa.ulanziPlugin/plugin/app.html?preview=1&key=1&actionid=1&language=de_DE
```

Das Designer-Fenster direkt:

```
http://127.0.0.1:8791/com.ulanzi.matUlanziHa.ulanziPlugin/property-inspector/designer/designer.html?preview=1&uuid=com.ulanzi.ulanzistudio.matUlanziHa.toggle&key=1&actionid=1&language=de_DE
```

Im Preview simuliert der Stub zwei Verbindungen — eine funktioniert, eine hat
absichtlich ein falsches Token, damit der Fehlerzustand sichtbar ist.

**Im Simulator** (aus dem [SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)):
Plugin-Ordner nach `UlanziDeckSimulator/plugins/` kopieren, `npm start`, dann
http://127.0.0.1:39069.

**Execution Policy.** PowerShell blockt `.ps1` standardmäßig; für jedes Tool gibt
es deshalb einen `.cmd`-Wrapper: `tools\serve.cmd`, `tools\install.cmd`,
`tools\studio-debug.cmd`. Der DevTools-Client `tools\cdp.cmd` braucht kein
PowerShell, er läuft auf dem Node, das Studio mitbringt.

**In den laufenden Main Service hineinschauen.** Studio mit `--webRemoteDebug`
starten, dann liefert `http://127.0.0.1:9292/json/list` die Debug-Ziele. Mit
`tools\cdp.cmd` lässt sich direkt im laufenden Plugin Code auswerten — das ist
der schnellste Weg an die Wahrheit:

```bash
tools\cdp.cmd list
```

```bash
tools\cdp.cmd eval "main service" "JSON.stringify(haDebug.library().buttons.map(b => b.name))"
```

Weitere Kommandos: `run` (auswerten und 3 s mithören), `watch <Sekunden>`
(Konsole und Exceptions live) und `click "<Titel>" "<CSS-Selektor>"` — damit
lässt sich die Oberfläche fernsteuern und beobachten, ohne Studio anzufassen.

`window.haDebug` im Main Service gibt Zugriff auf Pool, Registry, die
Action-Instanzen und `haDebug.designer` (Zustand des Designer-Fensters).
Jede Seite sammelt außerdem ihre Fehler in `window.__errors`.

## Aufbau

```
com.ulanzi.matUlanziHa.ulanziPlugin/
├── manifest.json              Plugin- und Action-Definition
├── en.json / de_DE.json       Lokalisierung (Plugin-Liste + Property Inspector)
├── libs/                      SDK-Kopie aus common-html
├── plugin/
│   ├── service.html           Main Service (dauerhaft geladen)
│   ├── app.html               Weiterleitung auf service.html
│   └── src/
│       ├── ha-client.js       WebSocket-API: Auth, Commands, Events, Reconnect
│       ├── ha-registry.js     Areas+Devices+Floors+Entities → Suchindex
│       ├── ha-domains.js      Was heißt „an" pro Domain, welcher Service, welche Anzeige
│       ├── key-renderer.js    196x196-Canvas → PNG für setBaseDataIcon
│       ├── key-style.js       Stil-Modell, Text-Templates, HTML-Modus
│       ├── i18n.js            Strings für die Tastenbeschriftung
│       ├── designer-window.js Öffnet den Designer, umgeht die openView-Fallen
│       ├── mdi-icons.js        Pfaddaten der mitgelieferten Icons
│       ├── library.js          Verbindungen, Ordner, Buttons
│       ├── ha-pool.js          eine Verbindung pro HA-Instanz
│       ├── error-trap.js       sammelt Fehler in window.__errors
│       ├── main.js            Verdrahtung der UlanziStudio-Events
│       └── actions/key-action.js
└── property-inspector/
    ├── common/entity-picker.js   der raumbewusste Picker
    ├── common/pi.css
    ├── designer/                 das Designer-Fenster
    └── toggle/inspector.html|js  Tasteneinstellung (Dropdown + Vorschau)
```

Zustände kommen per `subscribe_events` gepusht, es wird nicht gepollt. Die
Bibliothek selbst liest der Main Service dagegen alle 8 s neu und zusätzlich
sofort, wenn der Designer per `sendToPlugin` Bescheid gibt — der Host weckt den
Main Service beim Schreiben der Global Settings nicht zuverlässig.

**Wichtig, und im SDK nicht dokumentiert:** „Global Settings" sind nicht global,
sondern **pro UUID**. Designer und Property Inspectors laufen unter der
*Action*-UUID, der Main Service unter der *Plugin*-UUID — fragt er als er selbst,
bekommt er einen leeren Eimer und kennt keinen einzigen Button. Deshalb ruft er
`getGlobalSettings(context)` mit den Contexts der belegten Tasten auf und
verwirft leere Antworten, damit sie eine geladene Bibliothek nicht überschreiben.
Nachgewiesen per DevTools-Protokoll: derselbe Zeitpunkt, Property Inspector sah
zwei Buttons, Main Service null.

Das **Designer-Fenster** kostete die meiste Zeit, weil `openView` drei
undokumentierte Bedingungen hat, die alle stumm fehlschlagen: es funktioniert
nur, wenn der **Main Service** es ruft (aus einem Property Inspector passiert
gar nichts, ohne Fehler), die URL darf **keine Query** tragen (Parameter gehören
in das `param`-Objekt) und der Pfad muss **absolut** sein — der Host setzt stumpf
`file://` davor, aus einem relativen Pfad wird ein Servername und das Fenster
landet auf einer Chromium-Fehlerseite. Genau das ist ein "leeres Fenster".

Die vierte Bedingung war die teuerste: **das Fenster darf sich seine UUID nicht
mit einer Action teilen.** Der Host führt seine Buchhaltung pro UUID und wirft
beim Schließen einer View alles darunter weg. Lief das Fenster unter der
Action-UUID, war der Property Inspector danach vollständig vom Host
abgeschnitten — Socket offen, aber `sendToPlugin` *und* jede
Settings-Anfrage verschwanden — und der Host weigerte sich außerdem, eine zweite
View zu öffnen. Zwei Symptome, eine Ursache. Unter eigener UUID
(`…matUlanziHa.designer`) geht das Fenster beliebig oft auf und zu, gemessen
~270 ms von Klick bis fertig, und `sendToPlugin` erreicht den Main Service
weiterhin, weil der Host ihn über das Abschneiden des letzten UUID-Segments
findet.

Noch eine Host-Eigenheit, die den Knopf lange totgestellt hat: **schließt man das
Fenster mit seinem eigenen X, zerstört der Host das Fenster, lässt die Seite aber
laufen.** Sie schickte weiter Lebenszeichen, der Main Service hielt den Designer
für offen und antwortete auf jeden weiteren Klick mit „ist schon offen" — sichtbar
war nichts. Nachgewiesen über `EnumWindows`: kein Fenster auf dem Bildschirm,
Seite im DevTools-Listing weiterhin geladen. Anwesenheit hängt deshalb jetzt an
`document.visibilityState`, nicht an der Existenz der Seite; eine Seite ohne
Fenster meldet sich ab und wird beim nächsten Öffnen zum Schließen aufgefordert,
damit sie ihre Home-Assistant-Verbindung freigibt.

Der Designer-Knopf zeigt währenddessen einen Spinner und ist gesperrt: bei einer
unveränderten Schaltfläche klickt man nach — und zwei Klicks öffneten früher zwei
Fenster.
Aus demselben Grund schickt der Property Inspector die Tasteneinstellung doppelt:
über `sendParamFromPlugin` (der dokumentierte Weg, der sie speichert) **und** über
`sendToPlugin` direkt an den Main Service. Ohne den zweiten Weg aktualisiert sich
nur die Vorschau im Inspector, nicht die Taste auf dem Gerät. Der Property Inspector baut
eine eigene, kurzlebige Verbindung auf, damit der Picker unabhängig vom Main
Service immer die aktuelle Registry sieht.

## Namenskonvention

Ulanzi schreibt die Struktur vor: der Plugin-Ordner heißt
`com.ulanzi.{pluginName}.ulanziPlugin`, die Haupt-UUID muss **genau vier**
Punkt-Segmente haben (`com.ulanzi.ulanzistudio.{pluginName}`), Action-UUIDs
mindestens fünf. `{pluginName}` darf also keinen Punkt enthalten — deshalb kann
der Repo-Name `MatUlanzi.HomeAssistant` nicht direkt als Plugin-Name dienen.

Konvention für weitere Plugins: Hersteller-Präfix `matUlanzi` + Kürzel, in
camelCase wie bei Ulanzis eigenen Plugins (`homeAssistant`, `HardwareMonitor`).

| | dieses Plugin | Beispiel: OBS |
| --- | --- | --- |
| Ordner | `com.ulanzi.matUlanziHa.ulanziPlugin` | `com.ulanzi.matUlanziObs.ulanziPlugin` |
| Plugin-UUID | `com.ulanzi.ulanzistudio.matUlanziHa` | `com.ulanzi.ulanzistudio.matUlanziObs` |
| Action-UUID | `…matUlanziHa.toggle` | `…matUlanziObs.scene` |
| Anzeigename | `MatUlanzi.HomeAssistant` | `MatUlanzi.OBS` |
| Kategorie | `MatUlanzi` | `MatUlanzi` |

Die gemeinsame Kategorie gruppiert alle eigenen Plugins in der Studio-Liste. Der
Anzeigename ist freier Text und darf Punkte enthalten. Wichtig: der Ordnername
darf sich nicht mit dem offiziellen Plugin
(`com.ulanzi.homeAssistant.ulanziPlugin`) beißen — Windows unterscheidet keine
Groß-/Kleinschreibung.

## Lizenz

Für den eigenen Code noch nicht festgelegt. Mitgeliefert: das Ulanzi-SDK
(Apache-2.0) und Pfaddaten aus Material Design Icons (Apache-2.0, Pictogrammers)
— siehe NOTICE.
