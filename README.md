# Dave Aiello, product design portfolio

Static site, no build step. Deployed on Vercel.

```
index.html            Design (home)
work/steady/          Steady case study
prototype/steady/     Clickable prototype (?frame=<id> deep links, ?bare for 390x844 frames)
about/                About
development/          Development
figma/                Figma plugin that rebuilds the prototype as a Figma file
```

Preview locally with `python3 -m http.server 8765` and open http://localhost:8765.

## Build the Steady Figma file

The plugin creates every screen as editable layers, with color variables, text styles, components with variants, annotations, and the prototype links already wired.

1. Install the Figma desktop app. Plugins in development only run there.
2. Download this repo (Code, then Download ZIP) and unzip it.
3. In Figma, create a new design file.
4. Open the main menu, then Plugins, Development, Import plugin from manifest, and pick `figma/plugin/manifest.json`.
5. Run it from Plugins, Development, Steady screens. It takes a few seconds.
6. Select the Home frame and press Present to click through.

If the prototype changes, regenerate the plugin data and screenshots:

```
python3 -m http.server 8765 &
node figma/build.js
```

`build.js` needs Node and Playwright.

## Placeholders

Anything Dave still needs to fill in is marked with the `todo` class and shows with a dashed yellow outline. Search the HTML for `class="todo` to find them.
