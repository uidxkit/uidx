# Third-party notices

The [MIT license](LICENSE) applies to original uidx code. Third-party code,
fonts, and data retain their respective licenses and copyrights.

## Bundled components

| Component | License | Source and local notice |
| --- | --- | --- |
| Open Pencil core, scene graph, and Vue integration 0.14.0 | MIT | [Source](https://github.com/open-pencil/open-pencil/tree/v0.14.0), [license](third-party/licenses/open-pencil-MIT.txt) |
| Open Pencil's Yoga layout fork | MIT | [Yoga](https://github.com/facebook/yoga/tree/v3.2.1), [upstream license](third-party/licenses/yoga-MIT.txt); Open Pencil's notice also applies |
| CanvasKit 0.40.0 | BSD-3-Clause | [Skia](https://skia.org/), [license](third-party/licenses/CanvasKit-BSD.txt) |
| Inter font family | SIL OFL 1.1 | [Source](https://github.com/rsms/inter/tree/v4.1), [license](third-party/licenses/Inter-OFL.txt) |
| Noto Naskh Arabic font | SIL OFL 1.1 | [Source](https://github.com/notofonts/arabic), [license](third-party/licenses/NotoNaskhArabic-OFL.txt) |
| AI SDK | Apache-2.0 | [Source](https://github.com/vercel/ai), [copyright notice](third-party/licenses/AI-SDK-Apache-notice.txt), [license](third-party/licenses/Apache-2.0.txt) |
| StackBlur 2.7.0 | MIT | [Source](https://github.com/flozz/StackBlur/tree/v2.7.0), [notice from shipped source](third-party/licenses/StackBlur-MIT.txt) |
| format 0.2.2 | MIT | [Source](https://github.com/samsonjs/format), [license and npm README copyright](third-party/licenses/format-MIT.txt) |

The viewer build generates `third-party-notices.txt` from the dependency modules
included in its JavaScript. It includes their complete license texts, the font
notices, and the CanvasKit notice, and is served beside the viewer. Building fails
if a bundled JavaScript dependency has no known license text. Additional notices
above fill gaps in upstream npm archives; retain them when updating dependencies.

The npm release includes this document, `third-party/licenses/`, and licenses
inside bundled dependency directories. The `pptxgenjs` and locally patched
`image-size` packages retain their upstream MIT licenses. Dependencies installed
separately by npm carry their own licenses in their packages.

uidx modifies Open Pencil and image-size through the patches in `patches/`.
Those changes are shipped in the npm bundle. See [SECURITY.md](SECURITY.md) for
the image-size security backport and how it is verified.

The example map builders use [Natural Earth](https://www.naturalearthdata.com/)
geographic data, which is public domain. User-imported fonts, images, and design
assets are not relicensed by uidx; their owners' terms still apply.
