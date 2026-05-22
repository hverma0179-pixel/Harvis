const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MEMORY_FILE = path.join(ROOT_DIR, "memory", "conversations.json");
const ENV_FILE = path.join(ROOT_DIR, ".env");

loadEnvFile();

const PORT = Number(process.env.PORT || 4173);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_INSTRUCTION = [
  "You are HARVIS, a simple Jarvis-style AI assistant for a beginner project.",
  "Speak naturally, confidently, and briefly.",
  "Use recent local JSON memory only when it helps the current reply.",
  "If Google Search grounding is enabled for a current or latest question, use the grounded result and avoid guessing.",
  "If live search is not enabled or no source metadata is returned, be honest about uncertainty.",
  "Do not claim to control apps, smart-home devices, CAD tools, browsers, cameras, or face authentication.",
  "This project is inspired by ada_v2, but the current app only supports chat, voice, Gemini Search grounding, and JSON memory."
].join(" ");

const SEARCH_PATTERNS = [
  /\b(latest|current|today|tonight|now|live|recent|breaking|newest|updated|as of)\b/i,
  /\b(news|weather|price|stock|crypto|score|schedule|result|winner|ranking|version|release|launch|update)\b/i,
  /\b(search|google|look up|find online|web)\b/i,
  /\b(this week|this month|this year|right now)\b/i
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadEnvFile() {
  try {
    const raw = require("fs").readFileSync(ENV_FILE, "utf8");

    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) return;

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) return;

      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch {
    // The app can still start so the UI can show a helpful API-key message.
  }
}

function hasUsableApiKey() {
  const normalized = GEMINI_API_KEY.trim().toLowerCase();

  return (
    Boolean(normalized) &&
    !normalized.includes("paste") &&
    !normalized.includes("your_gemini") &&
    !normalized.includes("api_key_here")
  );
}

async function ensureMemoryFile() {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });

  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, "[]\n", "utf8");
  }
}

async function readMemory() {
  await ensureMemoryFile();

  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Memory file could not be read. Starting fresh.", error.message);
    return [];
  }
}

async function saveConversation(entry) {
  const history = await readMemory();
  history.push(entry);

  const cappedHistory = history.slice(-120);
  await fs.writeFile(MEMORY_FILE, JSON.stringify(cappedHistory, null, 2), "utf8");
}

function shouldUseWebSearch(message) {
  return SEARCH_PATTERNS.some((pattern) => pattern.test(message));
}

function getCurrentDateText() {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date());
}

function buildGeminiPayload(message, memory, useSearch) {
  const recentMemory = memory.slice(-8).map((item) => ({
    time: item.createdAt,
    user: item.user,
    harvis: item.assistant
  }));

  const prompt = [
    `Current date and time in India: ${getCurrentDateText()}`,
    "",
    "Recent local memory:",
    JSON.stringify(recentMemory, null, 2),
    "",
    useSearch
      ? "Google Search grounding is enabled for this request. Use it for current facts and do not invent live details."
      : "Google Search grounding is not enabled for this request. If the user asks for live or latest facts, say that live search is needed.",
    "",
    "User message:",
    message
  ].join("\n");

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.45,
      topP: 0.9,
      maxOutputTokens: 520
    }
  };

  if (useSearch) {
    payload.tools = [{ google_search: {} }];
  }

  return payload;
}

function extractGeminiResult(data) {
  const candidate = data?.candidates?.[0] || {};
  const parts = candidate?.content?.parts || [];
  const answer = parts.map((part) => part.text || "").join("\n").trim();
  const metadata = candidate.groundingMetadata || {};
  const chunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
  const seenUris = new Set();

  const sources = chunks
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri)
    .filter((web) => {
      if (seenUris.has(web.uri)) return false;
      seenUris.add(web.uri);
      return true;
    })
    .slice(0, 6)
    .map((web) => ({
      title: web.title || web.uri,
      uri: web.uri
    }));

  return {
    answer: answer || "I could not generate a clear response.",
    sources,
    searchQueries: metadata.webSearchQueries || []
  };
}

async function askGemini(message, memory, useSearch) {
  if (!hasUsableApiKey()) {
    const error = new Error(
      "Gemini API key missing. Create .env from .env.example and paste your key after GEMINI_API_KEY=."
    );
    error.statusCode = 500;
    throw error;
  }

  if (typeof fetch !== "function") {
    const error = new Error("Node.js 18 or newer is required because this app uses fetch().");
    error.statusCode = 500;
    throw error;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify(buildGeminiPayload(message, memory, useSearch))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage =
      data?.error?.message || `Gemini request failed with status ${response.status}`;
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    throw error;
  }

  return extractGeminiResult(data);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 64 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

async function handleAsk(req, res) {
  try {
    const body = await readJsonBody(req);
    const message = String(body?.message || "").trim();

    if (!message) {
      sendJson(res, 400, { error: "Message is required." });
      return;
    }

    const memory = await readMemory();
    const useSearch = shouldUseWebSearch(message);
    const result = await askGemini(message, memory, useSearch);

    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      user: message,
      assistant: result.answer,
      usedSearch: useSearch,
      sources: result.sources,
      searchQueries: result.searchQueries
    };

    await saveConversation(entry);

    sendJson(res, 200, {
      answer: result.answer,
      usedSearch: useSearch,
      sources: result.sources,
      searchQueries: result.searchQueries,
      memorySaved: true
    });
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, {
      error: error.message || "HARVIS could not answer right now."
    });
  }
}

async function handleHealth(_req, res) {
  const memory = await readMemory();

  sendJson(res, 200, {
    ok: true,
    name: "HARVIS",
    model: GEMINI_MODEL,
    hasApiKey: hasUsableApiKey(),
    memoryEntries: memory.length,
    memoryFile: "memory/conversations.json",
    search: "Gemini Google Search grounding"
  });
}

async function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const requestedPath = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[".html"]
    });
    res.end(fallback);
  }
}

async function route(req, res) {
  if (req.method === "POST" && req.url === "/api/ask") {
    await handleAsk(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    await handleHealth(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

ensureMemoryFile()
  .then(() => {
    const server = http.createServer((req, res) => {
      route(req, res).catch((error) => {
        console.error(error);
        sendJson(res, 500, { error: "HARVIS server error." });
      });
    });

    server.listen(PORT, () => {
      console.log(`HARVIS is online at http://localhost:${PORT}`);
      console.log(`Gemini model: ${GEMINI_MODEL}`);
      console.log(`Memory file: ${MEMORY_FILE}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize HARVIS:", error);
    process.exit(1);
  });
