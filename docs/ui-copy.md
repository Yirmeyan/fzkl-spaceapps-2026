# Interface copy

The words a visitor reads in the explorer, written for someone who has never heard of SPHEREx.
This file is the reference for the labels, for the sentence under each control and for the welcome window.

**Where it stands.** In the interface: the welcome window, the labels and the sentences below, kept in one table, `frontend/src/ui/copy.ts`, with a test that refuses the old words. Also in: the place line above the picture, one fold named Advanced tools, closed at the first opening, that holds every setting, and a page that fits a phone without sideways scroll.

## Rules

- **Three words carry the tool: visit, detector, infrared color.** Detector is the word of the mission, so the interface keeps it and explains it. It does not say pass, λ, hop or FOV. The API keeps its own names.
- **Every group of controls shows one sentence under its label**, visible without hovering. A phone has no hover.
- **The sentence shown is the one of the selected option.** Choosing another option changes the sentence.
- **Every button carries its sentence** as its `title`. Its label stays the name a screen reader says.
- **One action, one name.** "Share" is kept for the public journal. A link is copied with "Copy link".
- **The made-up example always says so.** The word SYNTHETIC stays on its button, on its picture and in its sentence.
- **A number comes with its unit in words the first time**: "10.4 arcseconds (an arcsecond is 1/3600 of a degree)".

## Welcome window

Shown at the first opening, over the page that loads behind it. Reopened at any time with **How it works**.

> ## Watch the sky change
>
> SPHEREx is a NASA space telescope. Since 2025 it photographs the whole sky in infrared light, which our eyes cannot see.
>
> It comes back to each place about every six months. Each return is a **visit**, and each visit brings many images, one infrared color at a time.
>
> Compare the visits of one place and you see what changed: a star that moved, a star that grew brighter or fainter, perhaps a distant planet that nobody has found yet.
>
> **How to start**
>
> 1. Pick one of the examples, or type a star name or coordinates.
> 2. Press **Play** to watch the images.
> 3. Press **Blink** to flip between the first and the last visit. What jumps has moved.
>
> **Three words to know**
>
> - **Visit**: one return of SPHEREx to this place, about every six months.
> - **Detector**: SPHEREx has six, like six cameras behind one telescope. Each one sees a range of infrared colors.
> - **Infrared color**: a wavelength, counted in micrometers (µm). Cooler objects glow at larger numbers.
>
> You can reopen this at any time with How it works.
>
> [ Start exploring ] [ Take the guided tour ]

The two buttons stay in sight while the text scrolls, so the window closes at once on a phone. It also closes with the cross, with Escape and with a click outside. It does not open by itself when the address starts the guided tour.

## Top of the page

| Today | Becomes | Sentence |
|---|---|---|
| Service ok • v0.1.0 | moves into Technical details | |
| Journal | Journal | What our search and other visitors have found so far. |
| Sky map | Sky map | The whole sky as SPHEREx sees it. Click a place to open it here. |
| Share (menu) | Copy link | Copy the address of exactly what you see, to send it to someone. |
| Help | How it works | Reopen the introduction. |

The guided tour has its own button, next to Copy link. The buttons of the header always sit on one row under the title, so the header never changes shape.

## Examples

Label above the buttons: **Five places to try, and one made-up example**. The sentence of the selected example is shown under the row.

| Button | Sentence |
|---|---|
| Barnard's Star | A nearby star that moves fast. Watch it change place between visits. |
| Epsilon Indi B | Brown dwarfs, objects too small to shine like stars. Their infrared colors give them away. |
| WISE 0855 | One of the coldest and faintest neighbors of the Sun, at the limit of what SPHEREx can see. |
| RW Aurigae | A young star whose brightness changes from one visit to the next. |
| R Draconis | A giant star so bright that it saturates the detectors. A test of the limits of the tool. |
| Synthetic Planet X · SYNTHETIC | Not a real object. We added a made-up moving dot to real SPHEREx images, to show what a distant planet would look like here. |

## Search and place

| Today | Becomes | Sentence |
|---|---|---|
| search field | A star name, or coordinates | Type a name (Barnard, Luhman 16) or coordinates (133.7951, -7.2451), then Go. |
| Go | Go | Find this place and load its SPHEREx images. |
| (nothing) | **Barnard's Star · RA 269.452° · Dec +4.693° · 3 visits, Aug 2025 to Aug 2026** | The place on the sky you are looking at. The cross marks it. |

The place line is new. It sits right above the picture and follows the place shown, whatever opened it: an example, a search, the sky map or a link.

## Three ways to look

| Today | Becomes | Sentence |
|---|---|---|
| Watch | Watch | Play the images one after the other. Each one is a slightly different infrared color. |
| Blink | Blink | Flip between the first and the last visit. What jumps has moved. |
| Move | Subtract | Subtract one visit from another. What stayed put disappears. What moved leaves a bright spot next to a dark one. |
| More | Average | Average the images of a visit. Faint objects such as WISE 0855 come out of the noise. |

Under the picture:

| Today | Becomes | Sentence |
|---|---|---|
| Infrared color · 1.10 µm | Visit 1, Aug 2025 · detector 1 · infrared color 1.10 µm | |
| Play | Play | Show the images one after the other. |
| frame slider | | Drag to choose an image. |
| HOP | First visit, difference, last visit | Tap a picture to show it large. |
| Visit 1 / Diff / Visit 3 | Visit 1, Aug 2025 / Difference / Visit 3, Aug 2026 | |
| Share hop | removed | Copy link at the top does it, keeps the view, and works for a place opened by its coordinates. |
| second row Blink, Move | shown with the advanced tools | The row under the picture keeps Play and the slider. |

## Detectors

Label: **Detectors**. Sentence of the group: SPHEREx has six detectors, like six cameras behind one telescope. Each sees a different range of infrared colors. The coldest objects show up mostly in detectors 5 and 6.

| Today | Becomes | Sentence |
|---|---|---|
| All | All detectors | Use the images of all six detectors. |
| D1 0.9 µm | Detector 1 · 0.9 µm | Colors from 0.74 to 1.11 µm, the closest to visible light. 60 images. |
| D2 1.4 µm | Detector 2 · 1.4 µm | Colors from 1.09 to 1.66 µm. 62 images. |
| D3 2.0 µm | Detector 3 · 2.0 µm | Colors from 1.62 to 2.42 µm. 61 images. |
| D4 3.1 µm | Detector 4 · 3.1 µm | Colors from 2.42 to 3.80 µm. 59 images. |
| D5 4.1 µm | Detector 5 · 4.1 µm | Colors from 3.80 to 4.43 µm, where cold objects start to glow. 62 images. |
| D6 4.7 µm | Detector 6 · 4.7 µm | Colors from 4.40 to 5.00 µm, where the coldest objects are brightest. 60 images. |

The numbers of images are those of the place shown.

## What the tool found

| Today | Becomes | Sentence |
|---|---|---|
| What moved | What the tool found here | Objects that changed place or brightness between visits, measured automatically. |
| Study this | Open this object | Center the tool on this object and load its colors. |
| It moves / It changes brightness / It appears... | Seen something? Add it to the public journal. | |
| Share this finding | Share this finding | Adds a pin to the journal and to the sky map. It records the place and your choice, nothing about you. |

## Advanced tools

Closed at the first opening. Everything below lives there.

| Today | Becomes | Sentence |
|---|---|---|
| PASS · All, 1, 2, 3 | Visit · All visits, Visit 1 · Aug 2025... | Use the images of every visit, or of one only. |
| MODE | How images are combined | |
| Single | One image | One image at a time. |
| Stack | Average | Average the images of a visit. Faint objects come out of the noise. |
| Difference | Subtract | Same as Subtract above, between the two visits you choose. |
| Track | Follow the target | Average the images while following the motion of the target. A moving object stays sharp and the fixed stars smear. (Nicolas: correct this sentence if the tool does something else.) |
| WAVELENGTH | Infrared colors | |
| All λ | All colors | Play every infrared color. |
| Match this λ | This color only | Keep the images close to the color shown, so that visits compare like with like. |
| CONTRAST | Contrast | Slide to bring out faint details, or to tame bright ones. |
| COLOR | Colors of the picture | |
| IR heat | Heat | Black to yellow, like a thermal camera. These colors are a choice: infrared has none. |
| Gray | Gray | Black to white. |
| LOOK · Soft | Smooth | A smoothed picture, easier on the eye. |
| LOOK · Sharp | Pixels | The true square pixels of the detector. |
| Path off / on | Path | Draw where the object was at each visit. |
| FIELD OF VIEW | Size of the picture | |
| 0.1° · 128² | Close · 0.1° | A tenth of a degree across, a fifth of the width of the full Moon. |
| 0.3° · 256² | Wide · 0.3° | Three times wider. It takes longer to load. |
| OTHER TELESCOPES | Compare with other surveys | |
| Gaia DR3 | Gaia stars | Circle the stars measured by the Gaia space telescope. |
| AllWISE 2010 | WISE in 2010 | Show where the WISE telescope saw these objects around 2010. |
| 2010 → now | Path since 2010 | Draw the path from the 2010 position to today. |
| Play years | Play the years | Animate the years between 2010 and now. |
| Tint flagged pixels | Show unreliable pixels | Tint in pink the pixels that SPHEREx itself flags as unreliable, for example saturated ones. |
| Frame a point | Mark a spot | Click the picture to put a small frame around something you noticed. |
| Blend | Overlay | Show the first and the last visit on top of each other. |
| Split | Side by side | Show two visits next to each other. |
| Catalog hop | What the catalogs predict | How far star catalogs say this object should move between visits. |
| SKY CONTEXT | Where this is on the sky | |
| Infrared timeline | Colors and brightness over time | The spectrum is the brightness in each infrared color. The light curve is the brightness at each visit. |
| Copy verdict, Save postcard | unchanged | Copy the result as text. Save the picture with its result. |
| Eyepiece | (no button) | The view that shows only the sky keeps its key, E. |
| Timed walkthrough | (no button) | The demonstration that plays by itself is only reached by a link, `?demo=1`. |
| (new) | Guided tour | Nine short steps, from the sky map to this page. You only press Next. |
| Technical details | Technical details | The raw numbers, for reviewers. The state of the service is here. |

## Where the site opens

The bare address of the site opens the sky map: a visitor first sees the whole sky and chooses a place. The explorer opens when its address names a place or a view, which every link to it does. The link "SPHEREx Explorer" of the map opens the explorer on Barnard's Star.

## Guided tour

Nine cards, one after the other. The visitor only presses **Next**. Each card points at a real element of the page, with a ring around it, and never blocks the page. Back goes one card back, End tour and Escape close it. The words live in `frontend/src/tour/steps.ts`, where a test holds them to the rules of this page.

The tour starts on the sky map and goes on in the explorer, on Barnard's Star, which loads at once from the files of the site. The address carries the step from one page to the other (`?tour=4`).

| Step | Page | Points at | Title |
| --- | --- | --- | --- |
| 1 | Sky map | The map | The whole sky, seen by SPHEREx |
| 2 | Sky map | The controls | Move around the sky |
| 3 | Sky map | The map, with the pin of Barnard's Star pressed | Choose any place |
| 4 | Explorer | The picture | A film of one place |
| 5 | Explorer | First visit, difference, last visit | Visits, six months apart |
| 6 | Explorer | The four tabs, with Blink pressed | Four ways to compare visits |
| 7 | Explorer | What the tool found here | What the tool measured by itself |
| 8 | Explorer | The detectors | Six detectors, six ranges of color |
| 9 | Explorer | The search box | Your turn |

The cards name the words of the mission and explain them: an exposure gives six images, one for each detector, and a visit comes with each survey of the whole sky.

## Legend of the rings

Shown under the picture while Gaia stars or WISE in 2010 is on.

- Purple ring: a star of the Gaia catalog, placed where it is at the date of this image.
- Green ring: an object of the WISE catalog, where it was in 2010.
- Gray hatching: no data in this image.
- A green ring left behind its star means that the star has moved since 2010. Only the 100 brightest of each catalog are drawn.
