# HARVIS

HARVIS is a simple Jarvis-style assistant built from the PDF idea, but kept beginner-friendly.

It uses:

- Gemini API for all AI replies.
- Gemini Google Search grounding for current/latest questions.
- Browser microphone input through the Web Speech API.
- Browser voice output through speech synthesis.
- Local JSON memory in `memory/conversations.json`.
- `.env` support for `GEMINI_API_KEY`.

This is the simple version of the `ada_v2` idea from the guide. Instead of CAD generation, smart-home control, gesture control, face authentication, Playwright automation, and complex tooling, HARVIS focuses on the useful starter core: voice, memory, Gemini, search grounding, and a clean UI.

## Files

```text
harvis-ai/
  server.js                  Backend server and Gemini API calls
  package.json               Optional npm scripts
  .env.example               Copy this to .env
  README.md                  Run steps
  memory/
    conversations.json       Local memory file
  public/
    index.html               UI markup
    style.css                Futuristic styling
    app.js                   Chat, mic input, voice output, source display
```

## Where to paste your Gemini API key

Paste it in this file after you create it:

```text
C:\Users\HP\Documents\New project 6\harvis-ai\.env
```

The file should look like this:

```env
GEMINI_API_KEY=PASTE_YOUR_REAL_GEMINI_API_KEY_HERE
GEMINI_MODEL=gemini-2.5-flash
PORT=4173
```

Do not paste your key into `server.js`, `app.js`, or any browser file.

## Exact Windows run steps

1. Install Node.js 18 or newer if you do not already have it:

   https://nodejs.org/

2. Open VS Code.

3. Open this folder in VS Code:

   ```text
   C:\Users\HP\Documents\New project 6\harvis-ai
   ```

4. Open the VS Code terminal.

5. Create your `.env` file:

   ```powershell
   copy .env.example .env
   ```

6. Open `.env`:

   ```powershell
   notepad .env
   ```

7. Replace `paste_your_gemini_api_key_here` with your real Gemini API key, then save the file.

8. Start HARVIS:

   ```powershell
   node server.js
   ```

9. Open this URL in Chrome or Edge:

   ```text
   http://localhost:4173
   ```

10. Click `Speak` and allow microphone permission, or type in the input box.

11. Stop the server with `Ctrl+C` in the terminal.

## How web search works

HARVIS automatically enables Gemini Google Search grounding when your message looks current or live, such as:

- `latest AI news today`
- `current Gemini model news`
- `what is the latest Minecraft version`
- `today weather in Delhi`

No separate search API key is needed.

## Memory

Every exchange is saved locally here:

```text
C:\Users\HP\Documents\New project 6\harvis-ai\memory\conversations.json
```

To reset memory, stop the server and replace the file contents with:

```json
[]
```

## Troubleshooting

- If HARVIS says the API key is missing, check `.env`.
- If `node` is not recognized, install Node.js LTS and reopen VS Code.
- If the mic does not work, use Chrome or Edge and allow microphone access.
- If voice output sounds robotic, choose another voice from the `Voice` dropdown.
