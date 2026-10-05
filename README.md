RUN HERE: https://kamil-kielczewski.github.io/svg-canvas-performance-test/

# Canvas 2D vs SVG — 2D rendering benchmark

Jedna aplikacja, jeden model sceny, jeden generator, jeden cache geometrii,
jedna konfiguracja i jeden benchmark — **dwa wymienne backendy renderujące**.

## Uruchomienie

Nie wymaga żadnej instalacji ani build-stepu.

```
# najprościej: otwórz plik w przeglądarce
open index.html          # macOS
xdg-open index.html      # Linux
```

Albo (zalecane, jeśli chcesz podmieniać ikonę przez `IconAsset.loadFromUrl`):

```
python3 -m http.server 8080
# http://localhost:8080/
```

Aplikacja działa z `file://` — wszystkie skrypty są klasycznymi `<script>`
(nie ES-modules), a ikona SVG jest wbudowana jako string, więc nie jest
potrzebny żaden `fetch()`.

- `index.html` — strona startowa
- `canvas.html` — backend Canvas 2D
- `svg.html` — backend SVG DOM

### Liczba poziomów hierarchii

`Hierarchy levels` to **stepper, nie suwak**: domyślnie `6` (1 365 pomieszczeń),
minimum `1`, **bez górnego ograniczenia** — zmienia się o jeden przyciskiem
`◀` / `▶` (lub strzałkami w lewo/prawo). Wartość można też wpisać ręcznie.
Etykieta jest wyróżniona na czerwono, bo to ustawienie najmocniej decyduje
o wyniku pomiaru.

Każdy kolejny poziom **naprawdę dorysowuje** kolejne, mniejsze pomieszczenia —
nie ma żadnego minimalnego rozmiaru w jednostkach sceny. Grubość ściany jest
przycinana do 25 % rozmiaru własnego pomieszczenia (`MAX_THICKNESS_RATIO`),
więc `minThickness` ani tryb `constant` nie są w stanie sprawić, że ściany
przerosną pomieszczenie i zatrzymają rekurencję.

### Brak jakichkolwiek limitów — celowo

Generator **nie ma** budżetu pomieszczeń, limitu węzłów, timeoutu ani progu
pamięci. `Hierarchy levels` jest honorowane dosłownie:

| poziomy | pomieszczenia | odcinki ścian |
|---:|---:|---:|
| 6 | 1 365 | 6 825 |
| 8 | 21 845 | 109 225 |
| 10 | 349 525 | 1 747 625 |
| 12 | 5 592 405 | 27 962 025 |

Przy ~350 tys. pomieszczeń model zajmuje rzędu 2 GB sterty, więc **poziom 11+
zawiesi lub ubije kartę** — i tak ma być. Narzędzie służy do znalezienia
granicy obu technologii, a nie do jej ukrywania.

Jedynym warunkiem przerwania rekurencji jest prawdziwa degeneracja (dziecko
o zerowym lub ujemnym rozmiarze). W zakresach dostępnych w panelu nie da się
jej wywołać — nawet przy skrajnych marginesach drzewo jest zawsze kompletne.
Statystyka **`Levels built`** i tak pokazuje, ile poziomów faktycznie powstało.

Zoom sięga do 1e9×, żeby najgłębsze poziomy (ułamki jednostki sceny) dało się
w ogóle obejrzeć.

Przycisk **„open same config in …”** otwiera drugi backend **w nowej karcie**
(`target="_blank"`) z _dokładnie tą samą konfiguracją_ **oraz aktualnym widokiem**
(zoom i przesunięcie), więc obie technologie można porównywać obok siebie. W `location.hash`
zapisywane są wszystkie pola konfiguracji plus `_cx/_cy/_s` — punkt sceny
w środku ekranu i skala — dzięki czemu widok zgadza się nawet przy innym
rozmiarze okna.

## Sterowanie

| akcja                                                      | efekt                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| drag na **pojedynczym odcinku ściany**                     | **deformuje pomieszczenie** — przesuwa dwa wierzchołki polilinii; sąsiednie odcinki zostają połączone, a **zawartość pomieszczenia się nie rusza** |
| drag na **ikonie**                                         | przesuwa ikonę                                                                                                                                     |
| cokolwiek innego                                           | nic — całych pomieszczeń celowo nie da się przeciągać                                                                                              |
| drag gdziekolwiek indziej (także po wnętrzu pomieszczenia) | panowanie widoku                                                                                                                                   |
| shift-drag / środkowy przycisk                             | panowanie (zawsze)                                                                                                                                 |
| kółko myszy                                                | zoom względem kursora                                                                                                                              |
| prawy przycisk                                             | **własne menu przeglądarki** — nie jest blokowane                                                                                                  |
| `f` / `r`                                                  | fit do sceny / pojedynczy render                                                                                                                   |

Przeciągalne są **wyłącznie ikony i pojedyncze odcinki ścian**. Wnętrza
pomieszczeń nie są uchwytami, dzięki czemu panowanie działa w każdym miejscu
rysunku. Przeciągnięcie ściany zmienia tylko kształt (shell) pomieszczenia —
dzieci i ikony mają własne lokalne transformacje, więc zostają na miejscu.

## Struktura plików

```
/index.html                      strona startowa
/canvas.html                     podstrona Canvas 2D
/svg.html                        podstrona SVG DOM
/README.md

/css/style.css                   wspólny styl (identyczny layout obu podstron)

/assets/icon.svg                 ikona (kopia referencyjna)

/js/shared/                      KOD WSPÓŁDZIELONY (zero wiedzy o Canvas/SVG)
    geometry.js                  czysta matematyka: offset polilinii, hit-test
    colors.js                    paleta 16 kolorów + 4 warianty każdego
    icon-asset.js                parser SVG -> Path2D (Canvas) + <symbol> (SVG)
    model.js                     Room / Wall / IconItem / SceneModel
    scene-generator.js           [1] generowanie sceny
    geometry-builder.js          [2] przygotowanie + cache geometrii
    configuration.js             konfiguracja + schemat UI + hash URL
    benchmark.js                 RenderTimer / FpsMeter / BenchmarkRunner
    renderer.js                  Viewport + WSPÓLNY INTERFEJS RENDERERA
    interaction-controller.js    wspólna warstwa interakcji
    ui.js                        generator panelu konfiguracji
    app.js                       logika wyższego poziomu (identyczna dla obu)

/js/canvas/
    canvas-renderer.js           [3] rendering: Canvas 2D
    canvas-interaction.js        hit-test analityczny

/js/svg/
    svg-renderer.js              [3] rendering: tworzenie/aktualizacja DOM
    svg-interaction.js           hit-test natywny (event.target) + fallback
```

## Układ panelu bocznego

```
header            tytuł + link do drugiego backendu
Benchmark         ustawienia benchmarku + przyciski + wyniki
Render / FPS / Scene / Selection   statystyki
Scene / Walls / Rooms / Icons      konfiguracja sceny
```

Sekcja `Benchmark` jest generowana ze schematu do `#bench-config` (pole
`container: 'bench'` w `ConfigSchema`), dzięki czemu wszystkie kontrolki
benchmarku leżą razem **nad** statystykami renderowania.

## Kolory

Kolor pochodzi z 16-kolorowej palety wybieranej cyklicznie (`pomieszczenie N →
kolor N % 16`), a przy wyłączonym `Colour rooms` — z jednego pola `Base colour`.
Jedna reguła, jedna ścieżka kodu (`Colors.variants(hex, transparent)`), więc
trybu „bez kolorowania" nie da się rozjechać z trybem paletowym.

Przełącznik **`Transparent colours`** (sekcja Scene, domyślnie **włączony**)
decyduje, jak kolor bazowy rozwija się na trzy części pomieszczenia:

| element               | `Transparent colours` **ON** | **OFF**                                    |
| --------------------- | ---------------------------- | ------------------------------------------ |
| obwódka ściany        | kolor bazowy, alpha `1.0`    | ciemny odcień HSL, nieprzezroczysty        |
| wnętrze ściany        | kolor bazowy, alpha `0.8`    | jasny odcień HSL, nieprzezroczysty         |
| wnętrze pomieszczenia | kolor bazowy, alpha `0.2`    | najjaśniejszy odcień HSL, nieprzezroczysty |

Tryb `OFF` odtwarza pierwotny wygląd **co do piksela**. Obie palety są budowane
raz przy ładowaniu, a przełącznik jest czystą zmianą stylu — **nie dotyka
geometrii** i oczywiście obowiązuje również w benchmarku (renderery czytają
wyłącznie przygotowany `room.style` i w ogóle nie wiedzą o istnieniu trybu).

Obie technologie zapisują to tak, jak jest dla nich naturalne, ale składają
identycznie (source-over): Canvas dostaje gotowy string CSS na część,
SVG — parę `fill` + `fill-opacity` (w trybie nieprzezroczystym atrybut opacity
w ogóle się nie pojawia). Oba warianty są wyliczane raz, w kroku przygotowania
stylów, nigdy w pętli renderowania.

## Potok danych

```
zmiana konfiguracji
      |
      v
[1] SceneGenerator.generate()      topologia + polilinie   (NIE mierzone)
      |
      v
[2] GeometryBuilder.prepare()      cache geometrii i stylów (NIE mierzone)
      |
      v
[3] renderer.renderFrame()         <-- JEDYNY mierzony fragment
```

Przeciąganie elementu **nie uruchamia [1] ani [2]** (poza jednym wyjątkiem:
przesunięcie odcinka ściany przelicza geometrię _tylko tego jednego
pomieszczenia_ — 5 wielokątów ścian + 1 wielokąt wnętrza).

## Co jest mierzone

| metryka                          | zakres pomiaru                                    |
| -------------------------------- | ------------------------------------------------- |
| `Last render` / `Average render` | wyłącznie `renderer.renderFrame()`                |
| `Benchmark` (N iteracji)         | wyłącznie `renderer.renderScene()` (pełny render) |

Benchmark **przełącza tło naprzemiennie biały ↔ czarny** na każdym cyklu
(`beforeEach`, poza mierzonym regionem). Samej pary „wyczyść → narysuj" nie da
się zobaczyć — obie operacje są w jednym synchronicznym zadaniu JS, a
przeglądarka kompozytuje dopiero między zadaniami — ale migające tło pokazuje,
że każdy cykl naprawdę odrysowuje całą scenę od zera. Po zakończeniu biegu tło
wraca do białego.
| `FPS`, `Min/Max FPS (10 s)` | realnie wyrenderowane klatki w `requestAnimationFrame` |

Odczyt FPS ma **2 miejsca po przecinku, a poniżej 1 fps — 4 miejsca**. Licznik
mierzy odstęp między ostatnimi klatkami (zawsze zachowuje ≥ 2 znaczniki czasu),
więc pozostaje sensowny również przy jednej klatce na kilkanaście sekund —
czyli dokładnie tam, gdzie SVG przy ~100 tys. elementów robi się ciekawy.
Gdy nic się nie renderuje, wartość **opada** do zera (`1000 / czas_oczekiwania`),
zamiast zamarzać na ostatnim odczycie.

Poza pomiarem: generowanie sceny, przygotowanie geometrii, wyliczanie kolorów,
parsowanie ikony, hit-testing, obsługa UI, `beforeEach()` benchmarku.
