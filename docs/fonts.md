# Fonts

Open **Fonts** beside **Elements** and **Tokens** in the workspace navigation.
This is a project library: imported faces are available to every page in the
document. The current Fonts view survives reloads and browser navigation.

- **Project fonts** searches families and filters all fonts, fonts used in this
  file (across its pages), Google Fonts, or uploaded fonts. Hover or focus a
  family to preview it; edit the sample text to check your own content.
- **Add Google font** accepts any Google Fonts family name, with suggestions for
  common families. Choose a weight and normal or italic, then import the style.
  Repeat to add the other styles you use. No API key is needed.
- **Upload fonts** accepts multiple static `.ttf` and `.otf` files, up to 20 MB
  each. Family, weight and italic are read from the font’s metadata.
- In the text inspector, click **Font** for a compact popup to search and apply
  a project font. Use the arrow keys and Enter, or click a family. **Manage
  fonts…** opens the Fonts page to import more families.
  The existing Style and Italic controls choose the face. Applying a family is
  a normal document edit, with undo and token binding support.

Inter Regular, Medium, Semibold and Bold remain bundled. Missing families,
missing styles, and unsupported characters are reported on the canvas.

For Hebrew or Arabic, import a font that includes the script, such as Noto Sans
Hebrew or Noto Sans Arabic. In the text inspector, **Typography → Text direction**
offers **Auto**, **LTR**, and **RTL**. Auto detects direction from the text; LTR
and RTL override it for the whole text layer, including mixed-language text.
The choice is saved as `textDirection="AUTO"`, `"LTR"`, or `"RTL"` and supports
undo. The Content field follows the same direction while you edit.

## Storage and loading

The server stores imported files and `fonts/fonts.json` beside the document’s
`uidx.json`. Include that directory when committing or sharing the project.
Font files are content-addressed; importing the same face again is idempotent.
A conflicting file for the same family, weight and italic is rejected until the
existing face is removed. Removing a face leaves the document’s text references
intact. Reload the viewer to clear removed fonts from open rendering sessions.

Imported and uploaded fonts keep their own license; uidx does not relicense
them. A Google Fonts import is usually SIL Open Font License 1.1, but some
families (Roboto and its variants, for example) are Apache License 2.0, and a
few are the Ubuntu Font License or CC BY-SA. Check the family’s license on
[fonts.google.com](https://fonts.google.com/) before committing or sharing a
project that bundles it, and keep that family’s notice with it the same way
you would for any other third-party asset.

Only an explicit Google import uses the internet. The server requests a full,
static TrueType face and saves it locally. The canvas, thumbnails and image
exports use these same saved bytes through the SDK font manager. Imported
families are never replaced with Inter under the requested family’s name.

Custom WOFF/WOFF2 files, variable font files, automatic discovery of installed
system fonts, and a full Google catalog browser are not included yet. Use static
TTF/OTF styles or import a particular Google style. Google family lookup needs a
network connection only when importing.

If an older running server returns HTML at the font endpoint, the viewer asks
you to restart the uidx server instead of showing a JSON parser exception.

## Reference

The workflow follows Figma’s [search, collection filters and font previews](https://help.figma.com/hc/en-us/articles/360041308034-Browse-and-apply-fonts)
and [custom font uploads](https://help.figma.com/hc/en-us/articles/360039956774-Upload-custom-fonts-to-an-organization).
Google style requests use its [CSS2 API](https://developers.google.com/fonts/docs/css2).
