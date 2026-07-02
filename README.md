# SCADLite

<a href="https://raw.githubusercontent.com/myoung8223/scadlite/refs/heads/main/title.png" target="_blank">
<img alt="image" src="https://github.com/myoung8223/scadlite2/blob/main/title_20260628.png" />
</a>

SCADLite is a lightweight, browser-optimized Progressive Web App (PWA) that pairs a feature-rich development workspace with a high-performance 3D viewport. It compiles and renders OpenSCAD geometry entirely client-side using WebAssembly (WASM) and functions 100% offline once installed. Write, preview, and iterate on 3D models instantly without local desktop installations. 

The core purpose of this project is to make OpenSCAD design fully accessible on web-based platforms, especially ChromeOS. OpenSCAD has tremendous potential in K-12 education, a domain currently dominated by Chromebooks in the United States. This app gives students and educators a zero-setup, privacy-first, free and open source, OpenSCAD design environment.

👉 **[Link to GitHub Pages-hosted PWA](https://myoung8223.github.io/scadlite2)**

## Current Features

- **True Client-Side Compilation:** Leverages a browser-optimized WASM engine to compile `.scad` geometry on the fly with zero backend server dependencies.
- **Smart Code Editor (CodeMirror 6):** A fluid text-editing interface built on a custom CodeMirror 6 bundle, equipped with real-time OpenSCAD syntax highlighting, toggleable bracket matching, toggleable active-line highlighting, and optional line numbers.
- **Multi-Line Block Indentation:** Standard `Tab` and `Shift + Tab` commands indent or outdent multiple lines of selected code simultaneously, powered by CodeMirror's native editing commands.
- **Line-Faithful Error Checking:** A dedicated pre-pass evaluates your raw `.scad` code before the multi-pass preview runs, catching syntax, undefined-variable, and type errors and highlighting the exact offending editor line—because the check runs against unmodified code, reported line numbers map 1:1 to what you see.
- **Privacy-First Offline Architecture:** Built as an installable PWA that caches its entire runtime locally. Works completely offline with absolutely no network telemetry, data tracking, or cloud storage—your designs stay 100% your own.
- **Interactive Split-Pane Workspace:** Features a fully adjustable, draggable center divider to let you seamlessly balance your screen real estate between code writing and 3D visualization, plus a draggable console splitter for resizing terminal output.
- **Persistent Workspace Cache:** Automatically backs up your active script to `localStorage`, safely restoring your draft and layout configurations the exact millisecond you reload or reopen the application. Custom fonts, STL, and SVG imports persist separately in IndexedDB.
- **Automatic Preview on Load:** Intelligently triggers an immediate 3D scene compilation upon uploading any local `.scad` file, eliminating extra button clicks.
- **Dedicated Workspace Settings Panel (⚙️):** Quick-access configuration options to change editor options, reset the 3D camera view, access font, STL, and SVG imports, view third-party licenses, among other settings.
- **Streamlined Diagnostic Console:** A real-time terminal UI stripped of misleading native engine filesystem warnings, focusing on compilation and rendering information, and syntax errors. An optional debug toggle surfaces the verbose intermediate code emitted by each modifier pass.
- **Native Color & Modifier Support:** Bypasses legacy monochromatic pipelines by rendering directly to the 3MF specification. The viewport natively respects script-defined `color()` functions, custom RGB configurations, and transparency. It introduces a custom multi-pass pre-parsing layer to isolate design modifiers—rendering ghost geometry (`%`) as translucent smoky glass (pale cyan) and highlights (`#`) as a glowing semi-transparent red alert mesh. *(Note: While robust for standard structures, the experimental parsing engine may diverge slightly from native desktop OpenSCAD behavior during deeply nested combinations of ghost `%` and highlight `#` modifiers.)*

## Improvements and Features to Add

- [x] **STL Importing:** Allow users to import STL files into the PWA and then import them into projects.
- [x] **SVG Importing:** Allow users to import SVG files into the PWA and then import them into projects.
- [x] **3MF Exporting:** Allow users to toggle between exporting to 3MF or STL.
- [x] **Custom Fonts:** Allow users to import TTF files into the PWA and then use them into projects.
- [ ] **Adjustable Axes and Grid:** Additional controls for the axes and grid would be handy, possibly even tick marks and numerical labels.
- [x] **Replace textarea with a syntax-highlighting editor:** Migrated the editing surface to a custom CodeMirror 6 bundle for syntax highlighting, bracket matching, and structural editing.
- [x] **Improve 3D Lighting and Model Texturing:** Right now the lighting needs improvement and texturing the models would improve the preview.
- [ ] **Camera Movement Improvements:** Improve the camera movement, perhaps with translation accelleration.
- [ ] **Orthogonal Projection:** Add a button for toggling between perspective and orthogonal 3D projection.
- [x] **Add Support for Color:** Render script-defined `color()`, custom RGB, and alpha transparency natively via the 3MF pipeline.
- [x] **Improve Error Highlighting:** While there's basic error highlighting now, that should be refined further.
- [x] **Adjustable Editor/Preview Port Framing:** An adjustable, and persistant editor/preview port framing is needed.
- [x] **Add Optional Line Numbers:** Optional line numbers in the editor would be a welcome feature.
- [x] **Add a Settings Menu:** Add a settings menu to declutter the core interface.
- [x] **Project Name Field:** Add a project name field so saved .scad files will have that for the filename.
- [x] **Adjustable Editor Font Size:** An adjustable, and persistant font size for the editor would be welcome.
- [x] **Address Editor Word Wrap:** Word wrap needs to be disabled or made to be a configurable setting.
- [x] **Toggle for Console:** Add a toggle to hide/show the console.
- [x] **Help Button:** Add a Help button for communicating basic use and app information.
- [x] **Link to OpenSCAD Cheat Sheet:** The ability to pop-up the super handy OpenSCAD cheat sheet would be a nice feature to add.
- [ ] **Improve PWA Icon:** The icon is a little dark. It could use a snazzier icon.
- [x] **F5 to Preview:** Press F5 key to quickly initiate a preview, just like in OpenSCAD.  Message overlay indicating preview build in progress.
- [x] **Native Color & Material Support via 3MF:** Replace the legacy single-color `scad2stl` pipeline entirely, and shift output targets to the **3MF (3D Manufacturing Format)** specification to natively export color, multi-material, and geometry metadata directly from the WebAssembly core.
- [x] **Client-Side Archive Extraction (`fflate` + `ThreeMFLoader`):** Implement an in-memory zip-decompression layer that bridges `fflate` with the Three.js 3MF loader, allowing zipped 3MF models to be unpacked and loaded seamlessly on the fly with zero backend overhead.
- [x] **Dynamic Alpha Transparency & Shading:** Program a smart material processing engine that scans compiled vertex paths to honor script-defined opacity (`alpha` values), configure overlapping face transparency passes, and fall back gracefully to global workspace theme selections if no structural color is declared.
- [x] **Multi-Pass Modifier Shading Layer:** Capitalize on the new color pipeline to support advanced OpenSCAD design modifiers, adding script token pre-parsing that targets and renders ghost geometry (`%`) as translucent smoky glass (pale cyan) and highlights (`#`) as a glowing semi-transparent red alert mesh.

## Getting Started

### 🚀 Offline PWA & Data Privacy

This application is built as a fully standalone **Progressive Web App (PWA)**. 

- **App Installation:** You can install this editor directly to your device as a native-feeling application. Simply click the "Install" icon in your web browser's address bar (Chrome, Edge, Brave) or select "Add to Home Screen" (Safari/Mobile).
- **100% Offline Capable:** Once loaded or installed, the application utilizes a Service Worker to cache all necessary engine files, typography, and libraries. It can be launched and operated completely offline without an active internet connection.
- **Strict Data Privacy:** There are no backend servers, no cloud storage, and no telemetry. Every single keystroke, compilation, and STL export happens entirely client-side within your browser's local sandbox. Absolutely **zero** data is ever transmitted over the network, ensuring complete intellectual property protection and data privacy.

### Local Setup & Initialization

Whether installed as a PWA or loaded in the browser, the execution sequence initiates automatically upon boot:

1. **Environment Verification:** Outputs build configurations and instantiates the virtual WebAssembly (WASM) sandboxed engine.
2. **Workspace Seeding:** Initializes the CodeMirror 6 editor environment and automatically restores your previous session's code cache. If no previous session is found, it seeds a simple default starter geometry.
3. **Resource Provisioning:** Fetches and mounts required typography packages directly into the virtual memory filesystem, then restores any custom fonts, STLs, and SVGs from local storage before unlocking the compiler controls.
4. **Viewport Initialization:** Boots the WebGL/Three.js 3D workspace in the background so the camera, responsive grid, and lighting matrices are ready the moment the first compile finishes.

### Basic Use

- **Loading Files:** Click the **Open** button or press **[Ctrl] + [O]** to load `.scad` files into the editor workspace.
- **Saving Files:** Click the **Save** button or press **[Ctrl] + [S]** to download the current `.scad` code to your local machine.
- **Smart Code Editor:** The workspace features intelligent formatting. Press `Tab` or `Shift + Tab` to quickly indent or outdent multi-line blocks of code. The editor also features real-time syntax highlighting, toggleable bracket matching, and will automatically highlight the exact line of code if the compiler encounters a syntax error.
- **Previewing:** Click the **Preview** button, press **[F5]**, or use the **[Ctrl] + [Enter]** hotkey combo to compile your `.scad` code into a fast 3D preview in the right pane. A line-faithful error pre-pass runs first; if your code has a hard error, the preview halts and highlights the offending line. Otherwise the custom multi-pass compilation layer maps OpenSCAD design modifiers, rendering ghost geometry (`%`) as translucent smoky glass and highlights (`#`) as a red alert mesh.
- **Rendering:** Click the **Render** button or press **[F6]** to perform a formal, single-pass evaluation of your code. This computes a finalized solid geometry representation: elements marked with the ghost modifier (`%`) are completely ignored, and components with the highlight modifier (`#`) are processed as standard solid elements, preparing the workspace for a clean manufacturing export.
- **Exporting to STL:** Click the **Export** button or press **[F7]** to convert the currently rendered geometry into a binary `.stl` file and stream it straight to your local downloads folder. The exporter reorients the mesh back to OpenSCAD's native Z-up coordinate system so the result drops cleanly into 3D slicing software.
- **3D Viewport & Display:**
  - Click the **Solid / Wireframe** button to toggle the mesh rendering mode.
  - Click the **Change (Color)** button (the color swatch) to open the native color picker and dynamically change the 3D model's material color.
  - You can drag the center gutter left or right to seamlessly adjust the width between the code editor and the 3D viewport.
- **Workspace Settings (⚙️):** Click the Settings icon or press **[Ctrl] + [,]** to access Workspace Settings. Press **[F1]** to toggle the Help / OpenSCAD cheat-sheet overlay. Settings include:
  - **Editor Font Size:** Scale the code text up or down for readability.
  - **Toggle Line Numbers:** Show or hide the left-hand line number gutter.
  - **Toggle Bracket Matching:** Enable or disable bi-directional bracket matching.
  - **Toggle Active-Line Highlighting:** Enable or disable highlighting of the current editor line.
  - **Toggle Console:** Show or hide the terminal output box at the bottom of the screen.
  - **Toggle Console Debug:** Surface the verbose intermediate code emitted by each modifier pass.
  - **Reset Camera:** Instantly frame the 3D viewport camera to the current model's bounds.
  - **Manage Custom Fonts:** Add custom fonts for use in models.
  - **Manage STL Imports:** Import STL files for use in models. Note that STL files must be ASCII format, not binary format.
  - **Manage SVG Imports:** Add SVG files for use in models.
  - **View Licenses:** Read the full third-party open-source license and credits notice.

## Built With

- **WebAssembly (WASM)** - High-performance port of the native OpenSCAD engine.
- **Vanilla JavaScript, HTML5, & CSS3** - Lightweight PWA architecture optimized for offline use and instant paints.
- **Three.js** - High-performance WebGL graphics pipeline used to render the live 3D viewports and handle interactive camera manipulations.
- **CodeMirror 6** - The extensible editor framework powering in-browser code editing, syntax highlighting, bracket matching, and structural indentation, bundled from the `@codemirror/*` packages (view, state, commands, language, search, autocomplete, lint) and `@lezer/highlight`.
- **fflate** - High-speed, ultra-lightweight compression module for unzipping 3MF data packages in memory.
- **Liberation Fonts** - Open-source typeface families mounted directly into the application's virtual memory layout for 3D text configurations.

## Credits & Contributions

- **Mike Young** — Lead Architect & Creator.
- **Gemini (Flash, Thinking, & Pro)** — AI Engineering Assistant, Code Optimization, & Regex Architecture.
- **Claude** — Additional AI Engineering Assistant, instrumental in the migration toward multi-pass rendering.
- **[OpenSCAD WASM](https://github.com/openscad/openscad-wasm)** — The official, sandboxed WebAssembly port translating functional CAD code into raw geometries entirely client-side.
- **[Three.js (mrdoob)](https://github.com/mrdoob/three.js)** — Created by Ricardo Cabello (mrdoob), providing the high-performance WebGL 3D graphics pipeline, along with the essential `ThreeMFLoader`, `STLExporter`, and `OrbitControls` companion modules.
- **[CodeMirror (Marijn Haverbeke and others)](https://codemirror.net/)** — An extensible code editor component for the web, driving the application's core text editing, syntax highlighting, bracket matching, and multi-line formatting engine.
- **[fflate (Arjun Barrett)](https://github.com/101arrowz/fflate)** — A high-performance, ultra-lightweight compression library utilized in-memory to synchronously extract compiled 3MF web archive packages for the rendering viewport.
- **[Liberation Fonts (Red Hat / Liberation Project)](https://github.com/liberationfonts/liberation-fonts)** — A set of metric-compatible, open-source font families (Sans, Serif, and Mono) embedded into the WebAssembly memory filesystem to provide out-of-the-box structural text generation capabilities.

## License

This project is licensed under the **GNU General Public License v2.0 (GPL-2.0)** - see the [LICENSE](LICENSE) file for details. This license is required due to the upstream dependency on the GPL-licensed OpenSCAD WebAssembly engine.
