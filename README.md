# SCADLite

<a href="https://raw.githubusercontent.com/myoung8223/scadlite/refs/heads/main/title.png" target="_blank">
<img alt="image" src="https://raw.githubusercontent.com/myoung8223/scadlite/refs/heads/main/title.png" />
</a>

SCADLite is a lightweight, browser-optimized Progressive Web App (PWA) that pairs a feature-rich development workspace with a high-performance 3D viewport. It compiles and renders OpenSCAD geometry entirely client-side using WebAssembly (WASM) and functions 100% offline once installed. Write, preview, and iterate on 3D models instantly without local desktop installations. 

The core purpose of this project is to make OpenSCAD design fully accessible on web-based platforms, especially ChromeOS. OpenSCAD has tremendous potential in K-12 education, a domain currently dominated by Chromebooks in the United States. This app gives students and educators a zero-setup, privacy-first, free and open source, OpenSCAD design environment.

👉 **[Link to GitHub Pages-hosted PWA](https://myoung8223.github.io/scadlite)**

## Current Features

- **True Client-Side Compilation:** Leverages a browser-optimized WASM engine to compile `.scad` geometry on the fly with zero backend server dependencies.
- **Smart Micro-Editor (CodeJar + Prism.js):** A fluid text-editing interface equipped with real-time OpenSCAD syntax highlighting, bi-directional bracket matching, and optional line numbers.
- **Advanced Block Indentation:** Integrated keyboard interceptor handles block-level structural edits, letting you indent or outdent multiple lines of code simultaneously using standard `Tab` and `Shift + Tab` commands.
- **Privacy-First Offline Architecture:** Built as an installable PWA that caches its entire runtime locally. Works completely offline with absolutely no network telemetry, data tracking, or cloud storage—your designs stay 100% your own.
- **Interactive Split-Pane Workspace:** Features a fully adjustable, draggable center divider to let you seamlessly balance your screen real estate between code writing and 3D visualization.
- **Persistent Workspace Cache:** Automatically backs up your active script to `localStorage`, safely restoring your draft and layout configurations the exact millisecond you reload or reopen the application.
- **Automatic Preview on Load:** Intelligently triggers an immediate 3D scene compilation upon uploading any local `.scad` file, eliminating extra button clicks.
- **Dedicated Workspace Settings Panel (⚙️):** Quick-access configuration options to change font size, hide/show the console, toggle line numbers, or reset the 3D camera back to home view.
- **Streamlined Diagnostic Console:** A real-time terminal UI stripped of misleading native engine filesystem warnings, focusing on compilation and rendering information, and syntax errors.

## Improvements and Features to Add

- [x] **STL Importing:** Allow users to import STL files into the PWA and then import them into projects.
- [x] **SVG Importing:** Allow users to import SVG files into the PWA and then import them into projects.
- [x] **Custom Fonts:** Allow users to import TTF files into the PWA and then use them into projects.
- [ ] **Adjustable Axes and Grid:** Additional controls for the axes and grid would be handy, possibly even tick marks and numerical labels.
- [x] **Replace textarea with CodeJar:** Replace textarea with CodeJar for syntax highlighting and block character matching.
- [x] **Improve 3D Lighting and Model Texturing:** Right now the lighting needs improvement and texturing the models would improve the preview.
- [ ] **Camera Movement Improvements:** Improve the camera movement, perhaps with translation accelleration.
- [ ] **Orthogonal Projection:** Add a button for toggling between perspective and orthogonal 3D projection.
- [x] **Improve Error Highlighting:** While there's basic error highlighting now, that should be refined further.
- [x] **Adjustable Editor/Preview Port Framing:** An adjustable, and persistant editor/preview port framing is needed.
- [x] **Add Optional Line Numbers:** Optional line numbers in the editor would be a welcome feature.
- [x] **Add a Settings Menu:** Add a settings menu to declutter the core interface.
- [x] **Project Name Field:** Add a project name field so saved .scad files will have that for the filename.
- [x] **Adjustable Editor Font Size:** An adjustable, and persistant font size for the editor would be welcome.
- [x] **Address Editor Word Wrap:** Word wrap needs to be disabled or made to be a configurable setting.
- [x] **Toggle for Console:** Add a toggle to hide/show the console.
- [ ] **Help Button:** Add a Help button for communicating basic use and app information.
- [ ] **Link to OpenSCAD Cheat Sheet:** The ability to pop-up the super handy OpenSCAD cheat sheet would be a nice feature to add.
- [ ] **Improve PWA Icon:** The icon is a little dark. It could use a snazzier icon.
- [x] **F5 to Preview:** Press F5 key to quickly initiate a preview, just like in OpenSCAD.  Message overlay indicating preview build in progress.

## Getting Started

### 🚀 Offline PWA & Data Privacy

This application is built as a fully standalone **Progressive Web App (PWA)**. 

- **App Installation:** You can install this editor directly to your device as a native-feeling application. Simply click the "Install" icon in your web browser's address bar (Chrome, Edge, Brave) or select "Add to Home Screen" (Safari/Mobile).
- **100% Offline Capable:** Once loaded or installed, the application utilizes a Service Worker to cache all necessary engine files, typography, and libraries. It can be launched and operated completely offline without an active internet connection.
- **Strict Data Privacy:** There are no backend servers, no cloud storage, and no telemetry. Every single keystroke, compilation, and STL export happens entirely client-side within your browser's local sandbox. Absolutely **zero** data is ever transmitted over the network, ensuring complete intellectual property protection and data privacy.

### Local Setup & Initialization

Whether installed as a PWA or loaded in the browser, the execution sequence initiates automatically upon boot:

1. **Environment Verification:** Outputs build configurations and instantiates the virtual WebAssembly (WASM) sandboxed engine.
2. **Workspace Seeding:** Initializes the CodeJar editor environment and automatically restores your previous session's code cache. If no previous session is found, it seeds a simple default starter geometry.
3. **Resource Provisioning:** Fetches and mounts required typography packages directly into the virtual memory filesystem before unlocking the compiler controls.
4. **Viewport Initialization:** Boots the WebGL/Three.js 3D workspace in the background so the camera, responsive grid, and lighting matrices are ready the moment the first compile finishes.

### Basic Use

- **Loading Files:** Click the **Open** button or press **[Ctrl] + [O]** to load `.scad` files into the editor workspace.
- **Saving Files:** Click the **Save** button or press **[Ctrl] + [S]** to download the current `.scad` code to your local machine.
- **Smart Code Editor:** The workspace features intelligent formatting. Press `Tab` or `Shift + Tab` to quickly indent or outdent multi-line blocks of code. The editor also features real-time syntax highlighting, bi-directional bracket matching, and will automatically highlight the exact line of code if the compiler encounters a syntax error.
- **Previewing:** Click the **Preview** button, press **[F5]***, **[F6]**, or use the **[Ctrl] + [Enter]** hotkey combo to compile your `.scad` code into a 3D model displayed in the right pane.
- **3D Viewport & Display:** - Click the **Solid / Wireframe** button to toggle the mesh rendering mode.
  - Click the **Change (Color)** button (the color swatch) to open the native color picker and dynamically change the 3D model's material color.
  - You can drag the center gutter left or right to seamlessly adjust the width between the code editor and the 3D viewport.
- **Workspace Settings (⚙️):** Click the Settings icon, press **[Ctrl] + [,]** or **[F1]** to access Workspace Settings, including:
  - **Editor Font Size:** Scale the code text up or down for readability (line numbers will automatically sync).
  - **Toggle Line Numbers:** Show or hide the left-hand line number gutter.
  - **Toggle Console:** Show or hide the terminal output box at the bottom of the screen.
  - **Reset Camera:** Instantly snap the 3D viewport camera back to its default viewing distance and angle.
  - **Manage Custom Fonts:** Add custom fonts for use in models.
  - **Manage STL Imports:** Import STL files for use in models.  Note that STL files must be ASCII format, not binary format.
  - **Manage SVG Imports:** Add SVG files for use in models.
- **Exporting to STL:** Once a model is compiled, click the **Export STL** button or press **[F7]** to download the final 3D geometry file for slicing or sharing.

## Built With

- **WebAssembly (WASM)** - High-performance port of the native OpenSCAD engine.
- **Vanilla JavaScript, HTML5, & CSS3** - Lightweight PWA architecture optimized for offline use and instant paints.
- **CodeJar** - Micro-editor powering the in-browser coding and native block indentation experience.
- **Prism.js** - Extensible, lightweight syntax highlighter for real-time code tokenization.

## Credits & Contributions

- **Mike Young** — Lead Architect & Creator.
- **Gemini (Flash, Thinking, & Pro)** — AI Engineering Assistant, Code Optimization, & Regex Architecture.
- **[OpenSCAD WASM](https://github.com/openscad/openscad-wasm)** — The official, sandboxed WebAssembly port translating functional CAD code into raw geometries entirely client-side.
- **[scad2stl (Code for Fukui)](https://github.com/code4fukui/scad2stl)** — The precision runtime utility for handling script parsing and streaming compiled mesh translations safely out of the virtual WASM environment.
- **[Three.js (mrdoob)](https://github.com/mrdoob/three.js)** — Created by Ricardo Cabello (mrdoob), providing the high-performance WebGL 3D graphics pipeline, along with the essential `STLLoader` and `OrbitControls` companion modules.
- **[CodeJar (Anton Medvedev)](https://github.com/antonmedv/codejar)** — An embeddable, lightweight code editor for the browser, driving the application's core text editing, native block indentation, and multi-line formatting engine.
- **[Prism.js](https://github.com/PrismJS/prism)** — A robust, highly extensible syntax highlighting library used to provide real-time code tokenization and visual formatting for OpenSCAD scripts.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** - see the [LICENSE](LICENSE) file for details. This license is required due to the upstream dependency on the GPL-licensed OpenSCAD WebAssembly engine.
