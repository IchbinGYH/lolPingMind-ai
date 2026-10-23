# lolPingMind-ai

Point at screen content with a ping. Ask AI to explain, extract, translate or troubleshoot it.

English | [简体中文](README.zh-CN.md)

lolPingMind-ai is a desktop screen assistant built on [lolPing](https://github.com/darrenprx/lolPing), the open-source desktop ping wheel by Danrui Meng. This is a separate derivative project, not an official lolPing release. It keeps the original wheel, animations, sounds, emotes and rooms, and adds screenshot actions, an answer window, local tasks and manual region selection.

The app does not read or modify League of Legends. Its AI actions work on visible desktop content, such as documents, diagrams, code, tables and error messages.

## What it can do

| Signal | Single-signal action |
| --- | --- |
| Enemy Missing, the yellow question mark | Explain the screenshot |
| Danger / Retreat | Identify risks and possible effects of the visible operation |
| Push | Suggest the next 1–3 concrete steps |
| On My Way | Save a local task and screenshot; optionally generate a short title |
| All In | Analyze diagrams, formulas or code with higher reasoning effort |
| Assist Me | Diagnose a problem and suggest a fix |
| Need Vision | Extract text, Markdown, CSV or LaTeX |
| Enemy Vision | Look up background and candidate sources using Wikipedia and Crossref |
| Bait | Examine assumptions, weaknesses and counterexamples |
| Upside-down Missing | Translate into Chinese or English and explain technical terms |
| Vision Cleared | Clear local marks, hide the assistant and cancel active and queued actions |
| Generic | Place an ordinary ping without an AI request |

Requests use the selected answer service. All In enables deeper reasoning and can take longer. The assistant returns content and suggestions; it does not execute commands or operate other applications for you.

## Run the project

This fork is distributed as source until its own installer release is published. The original project's installers do not contain these AI features. Run this source tree, or use a build explicitly published for lolPingMind-ai when one is available.

### Requirements

| Platform | Requirements and status |
| --- | --- |
| Windows | Windows 11 x64; Visual Studio 2022 with Desktop development with C++ for source builds. The AI workflow has been exercised on Windows. |
| macOS | macOS 13+ on Apple Silicon; Xcode Command Line Tools for source builds. The inherited port is experimental; this fork's AI workflow has not been checked on a real Mac. |
| Linux | x64, a genuine X11 session, compositor, C++20 compiler, XInput 2.1 and XTest. Experimental; Wayland and XWayland sessions are unsupported. See [Linux notes](docs/linux.md). |

All source builds require Node.js 22.12 or later and npm. Open a terminal in the downloaded project folder:

```sh
npm ci
npm run build:helper
npm run dev
```

If dependencies installed without downloading the Electron binary, run the installed package's downloader, then start again:

```sh
node node_modules/electron/install.js
npm run dev
```

On macOS, install the compiler tools with `xcode-select --install`. Allow Accessibility for the app or terminal hosting the input helper, and Screen Recording when macOS requests it. On Debian/Ubuntu, install `build-essential libx11-dev libxi-dev libxtst-dev` before building. Linux desktops also need a working tray; GNOME may need an AppIndicator extension.

### Configure your own answer service

Open Settings → Screen assistant. Choose one provider:

| Provider | Setup |
| --- | --- |
| DeepSeek | Select DeepSeek, enter your own API Key, save it, then use the connection test. The current implementation sends image requests to `api.deepseek.com` with model `deepseek-flash`. Your account must have access to that model and image requests. |
| Codex | Open and sign in to the Codex desktop app. Its command line tool must also be available. Select Codex and wait for the ready status. This integration uses your existing login and reuses one dedicated Codex CLI session; it does not type into the desktop app's chat box. |

No API Key, Codex account or paid service access is included. Each user configures their own account. Requests use that account's balance or service allowance. Saving, replacing, testing and deleting a DeepSeek Key are available in settings; the saved value is not shown back to the interface.

The DeepSeek connection test checks the models endpoint without sending an image. Codex mode currently uses GPT-6 Luna with low effort for ordinary requests and higher effort for All In. A ready indicator confirms local prerequisites, not that a later network request will succeed.

For classic signals without AI, select Classic pings only. Local On My Way tasks can be saved even when an answer service is unavailable.

## Quick start

1. Choose a configured answer service and enable All screen actions or Enemy Missing explanations only.
2. Bring the content you want to understand to the front.
3. Hold Alt, drag with the left mouse button to open the wheel, and release on a signal. Enemy Missing is the yellow question mark; with the default layout it is the leftward slice.
4. For a single signal, the app waits 1.2 seconds to combine nearby marks, then captures a fixed region around the wheel origin, about 960 × 620 display-independent pixels.
5. After capture, the answer window comes to the foreground and stays on top while the request runs. Read the result there, copy it, or use the same screenshot for another action.

The Chinese Enemy Missing question remains exactly `这个截图里的内容是什么意思`. Other signals use their own action prompts.

### Choose the screenshot area yourself

Place the same signal twice on the same display within 1.2 seconds. This replaces the pair's pending fixed crop with manual selection:

1. The app freezes a clean image of that display and opens the region selector.
2. Drag in any direction to draw a rectangle.
3. Drag inside to move it, or use the eight handles to resize it. Select again clears the rectangle.
4. Click Use this area or press Enter to submit. Esc or right-click cancels without sending the pair's image or falling back to a fixed crop.

The snapshot is taken before the selector appears. Ping graphics, the rectangle, handles and buttons are excluded from the image sent to AI. Keep the source content visible before placing the signals.

In All screen actions mode, every signal supports manual selection. Generic and Vision Cleared use image explanation when repeated; the first Vision Cleared still clears the workspace immediately. Enemy Missing only mode limits selection to that signal. Classic mode never opens the selector. Extra signals during selection do not open more selectors.

### Keyboard and wheel controls

| Task | Default control |
| --- | --- |
| Open ping wheel | Alt + left drag |
| Open emote wheel | Ctrl + left drag |
| Cancel a wheel | Release in its center, right-click, or Esc |
| Pause / resume | Ctrl + Alt + P |
| Open settings | Click the tray icon |
| Quit or restart the input helper | Tray context menu |
| Confirm a screenshot selection | Enter or Use this area |
| Cancel a screenshot selection | Esc, right-click, or Cancel |

On macOS, use Option for the ping key, Control for emotes, Control + Option + P to pause, and the menu bar icon for settings. All trigger keys and the pause shortcut can be customized. Alt + click to place the center signal is off by default.

The default wheel has eight slices: Danger, Push, On My Way, All In, Assist Me, Need Vision, Enemy Missing and Enemy Vision, clockwise from the top. In Settings → Wheel, drag additional signals onto a slice or the center. Emotes have their own eight-slot wheel.

## Answer window, queue and tasks

- History holds the latest 24 records in memory for the current run. Records show their action, screenshot, request and answer. Filter, select, delete individual records or clear history using Manage.
- Use the action controls on a screenshot to request another action without taking a new image. Extraction supports text, Markdown, CSV and LaTeX; translation offers automatic, Chinese and English targets. Results can be copied.
- At most one AI action runs and one follow-up waits. Different rapid marks merge into the latest action and location. A repeated identical pair opens selection. A manually confirmed follow-up waits for the active answer instead of starting another conversation or parallel request.
- Source lookup returns Wikipedia summaries and Crossref publication metadata with links. These are candidate sources, not verification that a claim is true or that a full paper has been read.
- On My Way first saves a local task and crop. If the selected service is available, it may send the crop to suggest a title, with an eight-second deadline. An unavailable service does not prevent local saving. You can rename, complete and delete tasks; a title you edit takes priority over a delayed suggestion.
- Up to 100 tasks persist across restarts. Deleting a task also deletes its local image. Clearing history or the workspace keeps saved tasks. Open the assistant from settings to view tasks without capturing anything.
- Vision Cleared cancels active and queued work and removes local marks. Closing the answer window is separate from deleting records or tasks.

## Other settings and rooms

Signal size, duration, volume, mute, wheel size, keep-last-ping, startup behavior and English / Simplified Chinese language settings remain available. Custom emote images and local sounds are supported. On Windows, Pause in fullscreen apps lets fullscreen applications keep their input; windowed games may require manual pause.

Rooms retain the original local-network and public-relay behavior. Create a room in Settings → Room, copy its code and share it with friends; they paste it into Join or use the tray's Join from clipboard. Up to eight members can share signals and emotes. Screen positions are mapped to the same numbered display, falling back to the primary display.

The initial room display name is generated from the local OS account name. Change it in Room settings before joining if you prefer another name. Mute, per-member rate limits and Allow internet connections control incoming signals and network use. Custom emote stills can be shared; animations and custom sounds remain local. Show friends' custom emotes controls still-image transfer in both directions.

Room members' signals do not trigger AI. Screenshots, AI requests, answers, API Keys and local tasks are not sent through rooms.

Room payloads are encrypted with a key derived from the room code. Members can see the shared display names and content. LAN peers can see local IP addresses; public relays can see IP addresses, an anonymous room identifier and message timing. Turn Allow internet connections off to use only the local network.

## Privacy and local data

### Network destinations

| Destination | When contacted and what is sent |
| --- | --- |
| `api.deepseek.com/chat/completions` | In DeepSeek mode: the confirmed or automatic crop, action prompt and your Key for authentication. On My Way may also request a task title. |
| `api.deepseek.com/models` | When you click the DeepSeek connection test; authentication, no screenshot. |
| Codex service through its installed CLI | In Codex mode: the crop and prompt, using your existing Codex login. |
| `en.wikipedia.org/w/api.php`, `zh.wikipedia.org/w/api.php`, `api.crossref.org/works` | Source lookup only: a model-generated search query, no API Key or image. Retrieved records are then supplied to the selected answer service with the crop. |
| Local network / configured public Nostr relays | While in a room: encrypted signals, emote stills and profile messages. See [relay list](src/main/relays.ts). |
| Source websites / upstream GitHub page | When you explicitly open a result or the Upstream project button in your browser. |

This fork's inherited automatic GitHub updater is disabled pending its own release configuration. It will not install the original lolPing releases. Source builds and packaging commands do not publish a release.

DeepSeek Keys are encrypted with Electron safeStorage and saved separately from settings. There is no plaintext fallback; Linux requires an available credential backend. AI images and answers are handled by the selected provider under that account's settings and policies. Clearing local history does not erase provider-side or Codex session history.

The selector keeps the full display snapshot in memory; only the chosen crop is sent or saved as a task. Ordinary screenshot history is in memory. The Codex integration writes temporary cropped JPEGs and answer files and removes them after the request.

### Data folders

The legacy `lolPing` folder and internal identifiers are intentionally retained so existing settings, keys, tasks and compatible room messages keep working after the visible rename.

| Platform | Settings folder |
| --- | --- |
| Windows | `%APPDATA%\lolPing` |
| macOS | `~/Library/Application Support/lolPing` |
| Linux | `$XDG_CONFIG_HOME/lolPing`, normally `~/.config/lolPing` |

Use Settings → App → Open settings folder to locate it. It may contain `settings.json`, `deepseek-api-key.enc`, `codex-question-session.json`, saved task images and metadata, custom emotes, caches and Electron profile data. Room codes and your chosen display name may be in settings.

Keep that folder, encrypted credential files, Codex credentials, personal screenshots, logs and local configuration out of source archives and Git commits. A fresh source checkout has no configured Key, user tasks or personal room profile; users supply their own credentials in settings. Do not share a copy of your configured app profile as a distribution.

## Troubleshooting and limitations

| Problem | Check |
| --- | --- |
| No AI action | Check the selected mode and provider. Generic is a normal ping on a single placement. Room signals and settings previews never start AI. |
| Missing Key or Codex not ready | Save your own Key, or open and sign in to Codex and ensure its CLI is available. |
| Slow or failed answer | Check network, account access and service allowance. All In takes longer; normal actions disable deep thinking. A connection test cannot guarantee a later image request. |
| Wrong or incomplete content | Bring the source to the front and use a repeated pair for a larger or more precise manual crop. The fixed crop may omit context or small text. |
| Cannot capture on a Mac | Check Screen Recording and Accessibility permissions. Unsigned or changed builds may need permissions granted again. |
| Ctrl + drag opens emotes while editing | Change or disable the emote trigger in Settings → Emotes. |
| Wheel missing over a game or administrator window | Pause in fullscreen apps, exclusive fullscreen and Windows integrity boundaries can prevent it. Try a normal window and review the trigger settings. |
| Linux shortcut conflict | Choose another trigger or change the desktop's Alt-drag shortcut. Wayland is unsupported. |

Whole-screen sharing includes normal ping overlays; sharing one application window may not. Capture selection is confined to the display where you placed the signals. Very small selections are rejected. AI may misread or misinterpret an image; source links are leads, not an automatic fact check.

## Development and builds

```sh
npm run typecheck
npm run test:helper
npm test
npm run build
```

Close the running app before rebuilding the native helper on Windows, because its executable may be in use.

| Command | Output / purpose |
| --- | --- |
| `npm run dev` | Run Electron with the development renderer |
| `npm run build` | Build main, preload and renderer files into `out/` |
| `npm start` | Run the built app |
| `npm run dist` | Build a Windows installer, `release/lolPingMind-ai-Setup-<version>.exe` |
| `npm run dist:mac` | On a Mac: `release/lolPingMind-ai-<version>-arm64.dmg` |
| `npm run dist:linux` | On Linux: AppImage and Debian package under `release/` |
| `npm run dev:site` | Run the inherited browser wheel demo; it does not include the desktop AI workflow |

Packaging targets do not imply that a public release already exists. The original release workflow is inherited and requires a separate review and fork-specific configuration before publication. Keep `out/`, `release/`, native builds and local user data out of Git.

Implementation: [main process](src/main), [shared settings / protocols / translations](src/shared), [answer UI](src/renderer/question), [region selector](src/renderer/capture), [native input helper](native/hook-helper). Read [AGENTS.md](AGENTS.md) before changing code. [Design notes](docs/design.md), [macOS notes](docs/design-macos.md) and [Linux notes](docs/linux.md) describe the inherited architecture and this fork's additions. Add behavior tests and exercise real input and windows on the affected OS.

## Credits and license

- Original project: [lolPing by darrenprx / Danrui Meng](https://github.com/darrenprx/lolPing). lolPingMind-ai builds on its input helper, wheel, overlays, settings, emotes and rooms. The original copyright and [MIT license](LICENSE) are retained.
- This fork adds AI providers, screenshot explanations and actions, streamed answers, local task management, queues, manual selection and the lolPingMind-ai interface branding.
- Ping and emote icons, animations and sounds are © Riot Games. They are not covered by the source-code MIT license. [Asset extraction tools](tools/extract-assets) document their origin and regeneration.

lolPingMind-ai is not affiliated with or endorsed by Riot Games, lolPing's original maintainer, OpenAI or DeepSeek. Product names and trademarks belong to their respective owners.
