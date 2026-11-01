import localFont from "next/font/local";

// Every face comes from a version-locked Fontsource package, so a build needs nothing from Google
// and the same commit always builds the same fonts. next/font's arguments have to be literals,
// which is why nothing here is shared.
//
// Each family is one or two calls with the same font-family, which next/font wants to match the
// first constant's name: Latin, always, and Latin Extended where the family has it. The second
// carries a unicode-range, so a browser only fetches it for a name like Łukasz. Other alphabets
// fall back to the device's font.
//
// Only the first three are preloaded (Sticker Book, where everyone starts): a browser fetches the
// rest when something on the page uses them, so nobody downloads the looks they aren't wearing.

export const nunito = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2", weight: "200 1000", style: "normal" },
  ],
  variable: "--font-nunito",
  declarations: [{ prop: "font-family", value: "nunito" }],
});
export const nunitoExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/nunito/files/nunito-latin-ext-wght-normal.woff2", weight: "200 1000", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "nunito" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const baloo = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/baloo-2/files/baloo-2-latin-wght-normal.woff2", weight: "400 800", style: "normal" },
  ],
  variable: "--font-baloo",
  declarations: [{ prop: "font-family", value: "baloo" }],
});
export const balooExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/baloo-2/files/baloo-2-latin-ext-wght-normal.woff2", weight: "400 800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "baloo" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const gaegu = localFont({
  src: [
    { path: "../node_modules/@fontsource/gaegu/files/gaegu-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-gaegu",
  declarations: [{ prop: "font-family", value: "gaegu" }],
});

export const archivoBlack = localFont({
  src: [
    { path: "../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-archivo-black",
  declarations: [{ prop: "font-family", value: "archivoBlack" }],
  preload: false,
});
export const archivoBlackExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/archivo-black/files/archivo-black-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "archivoBlack" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const spaceGrotesk = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", weight: "300 700", style: "normal" },
  ],
  variable: "--font-space-grotesk",
  declarations: [{ prop: "font-family", value: "spaceGrotesk" }],
  preload: false,
});
export const spaceGroteskExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2", weight: "300 700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "spaceGrotesk" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const unifraktur = localFont({
  src: [
    { path: "../node_modules/@fontsource/unifrakturcook/files/unifrakturcook-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-unifraktur",
  declarations: [{ prop: "font-family", value: "unifraktur" }],
  preload: false,
  adjustFontFallback: "Times New Roman",
});

export const grenze = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/grenze-gotisch/files/grenze-gotisch-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-grenze",
  declarations: [{ prop: "font-family", value: "grenze" }],
  preload: false,
  adjustFontFallback: "Times New Roman",
});
export const grenzeExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/grenze-gotisch/files/grenze-gotisch-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "grenze" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const spectral = localFont({
  src: [
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-600-italic.woff2", weight: "600", style: "italic" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-spectral",
  declarations: [{ prop: "font-family", value: "spectral" }],
  preload: false,
  adjustFontFallback: "Times New Roman",
});
export const spectralExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-600-italic.woff2", weight: "600", style: "italic" },
    { path: "../node_modules/@fontsource/spectral/files/spectral-latin-ext-700-italic.woff2", weight: "700", style: "italic" },
  ],
  declarations: [
    { prop: "font-family", value: "spectral" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const orbitron = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/orbitron/files/orbitron-latin-wght-normal.woff2", weight: "400 900", style: "normal" },
  ],
  variable: "--font-orbitron",
  declarations: [{ prop: "font-family", value: "orbitron" }],
  preload: false,
});

export const dafoe = localFont({
  src: [
    { path: "../node_modules/@fontsource/mr-dafoe/files/mr-dafoe-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-dafoe",
  declarations: [{ prop: "font-family", value: "dafoe" }],
  preload: false,
});
export const dafoeExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/mr-dafoe/files/mr-dafoe-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "dafoe" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const exo = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/exo-2/files/exo-2-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-exo",
  declarations: [{ prop: "font-family", value: "exo" }],
  preload: false,
});
export const exoExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/exo-2/files/exo-2-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "exo" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const mochiy = localFont({
  src: [
    { path: "../node_modules/@fontsource/mochiy-pop-one/files/mochiy-pop-one-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-mochiy",
  declarations: [{ prop: "font-family", value: "mochiy" }],
  preload: false,
});

export const mplus = localFont({
  src: [
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-mplus",
  declarations: [{ prop: "font-family", value: "mplus" }],
  preload: false,
});
export const mplusExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-ext-800-normal.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "mplus" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const playfair = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2", weight: "400 900", style: "normal" },
    { path: "../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2", weight: "400 900", style: "italic" },
  ],
  variable: "--font-playfair",
  declarations: [{ prop: "font-family", value: "playfair" }],
  preload: false,
  adjustFontFallback: "Times New Roman",
});
export const playfairExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-ext-wght-normal.woff2", weight: "400 900", style: "normal" },
    { path: "../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-ext-wght-italic.woff2", weight: "400 900", style: "italic" },
  ],
  declarations: [
    { prop: "font-family", value: "playfair" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const garamond = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2", weight: "400 800", style: "normal" },
    { path: "../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2", weight: "400 800", style: "italic" },
  ],
  variable: "--font-garamond",
  declarations: [{ prop: "font-family", value: "garamond" }],
  preload: false,
  adjustFontFallback: "Times New Roman",
});
export const garamondExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-normal.woff2", weight: "400 800", style: "normal" },
    { path: "../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-italic.woff2", weight: "400 800", style: "italic" },
  ],
  declarations: [
    { prop: "font-family", value: "garamond" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const pixelify = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/pixelify-sans/files/pixelify-sans-latin-wght-normal.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-pixelify",
  declarations: [{ prop: "font-family", value: "pixelify" }],
  preload: false,
});
export const pixelifyExt = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/pixelify-sans/files/pixelify-sans-latin-ext-wght-normal.woff2", weight: "400 700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "pixelify" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const silkscreen = localFont({
  src: [
    { path: "../node_modules/@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-silkscreen",
  declarations: [{ prop: "font-family", value: "silkscreen" }],
  preload: false,
});
export const silkscreenExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/silkscreen/files/silkscreen-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "silkscreen" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

export const plex = localFont({
  src: [
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex",
  declarations: [{ prop: "font-family", value: "plex" }],
  preload: false,
});
export const plexExt = localFont({
  src: [
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plex" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  preload: false,
  adjustFontFallback: false,
});

/** Goes on <html>, so every look can reach every family through its CSS variable. */
export const fontVariables = [
  nunito.variable,
  baloo.variable,
  gaegu.variable,
  archivoBlack.variable,
  spaceGrotesk.variable,
  unifraktur.variable,
  grenze.variable,
  spectral.variable,
  orbitron.variable,
  dafoe.variable,
  exo.variable,
  mochiy.variable,
  mplus.variable,
  playfair.variable,
  garamond.variable,
  pixelify.variable,
  silkscreen.variable,
  plex.variable,
].join(" ");
