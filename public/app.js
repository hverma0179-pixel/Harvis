const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const micButton = document.getElementById("micButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
const voiceSelect = document.getElementById("voiceSelect");
const orb = document.getElementById("aiOrb");
const stateText = document.getElementById("stateText");
const networkStatus = document.getElementById("networkStatus");
const modelName = document.getElementById("modelName");
const memoryLabel = document.getElementById("memoryLabel");
const searchLabel = document.getElementById("searchLabel");
const healthLine = document.getElementById("healthLine");
const quickPromptButtons = document.querySelectorAll(".quick-prompts button");

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let recognition = null;
let selectedVoice = null;
let voices = [];
let isBusy = false;

function setState(state, text) {
  orb.className = `orb ${state}`;
  stateText.textContent = text;
}

function setNetworkStatus(text, state = "ready") {
  networkStatus.className = `status-badge ${state}`;
  networkStatus.lastChild.textContent = text;
}

function sourceLabel(source) {
  try {
    const url = new URL(source.uri);
    return source.title ? `${source.title} - ${url.hostname}` : url.hostname;
  } catch {
    return source.title || source.uri;
  }
}

function addMessage(role, text, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role} ${options.extraClass || ""}`.trim();

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.appendChild(paragraph);

  if (options.usedSearch || options.sources?.length) {
    const meta = document.createElement("div");
    meta.className = "message-meta";

    if (options.usedSearch) {
      const chip = document.createElement("span");
      chip.textContent = options.sources?.length ? "Search grounded" : "Search checked";
      meta.appendChild(chip);
    }

    if (options.searchQueries?.length) {
      const query = document.createElement("span");
      query.textContent = options.searchQueries.slice(0, 2).join(" | ");
      meta.appendChild(query);
    }

    article.appendChild(meta);
  }

  if (options.sources?.length) {
    const list = document.createElement("div");
    list.className = "source-list";

    options.sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.href = source.uri;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${index + 1}. ${sourceLabel(source)}`;
      list.appendChild(link);
    });

    article.appendChild(list);
  }

  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showError(message) {
  addMessage("ai", message, { extraClass: "error" });
  setState("idle", "Ready, but something needs attention.");
}

function detectBestVoice(list) {
  const preferred = [
    "Microsoft Aria",
    "Microsoft Jenny",
    "Microsoft Guy",
    "Google US English",
    "Samantha",
    "Daniel"
  ];

  return (
    preferred.map((name) => list.find((voice) => voice.name.includes(name))).find(Boolean) ||
    list.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith("en")) ||
    list[0] ||
    null
  );
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    voiceSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Voice unavailable";
    voiceSelect.appendChild(option);
    stopButton.disabled = true;
    showError("Voice output is not supported in this browser.");
    return;
  }

  voices = window.speechSynthesis.getVoices();
  voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading voices...";
    voiceSelect.appendChild(option);
    return;
  }

  selectedVoice = detectBestVoice(voices);

  voices.forEach((voice, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = selectedVoice === voice;
    voiceSelect.appendChild(option);
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = selectedVoice;
  utterance.rate = 0.94;
  utterance.pitch = 0.92;
  utterance.volume = 1;

  utterance.onstart = () => setState("speaking", "Speaking...");
  utterance.onend = () => setState("idle", "Ready for your command.");
  utterance.onerror = () => showError("Voice playback failed.");

  window.speechSynthesis.speak(utterance);
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    modelName.textContent = data.model || "Gemini";
    memoryLabel.textContent = `${data.memoryEntries || 0} saved`;
    searchLabel.textContent = "Auto";
    healthLine.textContent = data.hasApiKey
      ? "HARVIS is connected and memory is local."
      : "Paste your Gemini key in .env to activate replies.";
    setNetworkStatus(data.hasApiKey ? "Online" : "Needs key", data.hasApiKey ? "ready" : "warn");
  } catch {
    healthLine.textContent = "Server is not reachable.";
    setNetworkStatus("Offline", "error");
  }
}

async function askHarvis(message) {
  if (!message || isBusy) return;

  isBusy = true;
  micButton.disabled = true;
  inputEl.disabled = true;
  addMessage("user", message);
  inputEl.value = "";
  setState("thinking", "Thinking...");
  searchLabel.textContent = "Checking";

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Backend failed to answer.");
    }

    const answer = data.answer || "I could not generate a clear response.";
    addMessage("ai", answer, {
      usedSearch: data.usedSearch,
      sources: data.sources || [],
      searchQueries: data.searchQueries || []
    });
    searchLabel.textContent = data.usedSearch ? "Grounded" : "Standby";
    speak(answer);
    loadHealth();
  } catch (error) {
    showError(error.message || "HARVIS backend is not reachable.");
    searchLabel.textContent = "Standby";
  } finally {
    isBusy = false;
    micButton.disabled = false;
    inputEl.disabled = false;

    if (!window.speechSynthesis?.speaking) {
      setState("idle", "Ready for your command.");
    }
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    micButton.disabled = true;
    micButton.title = "SpeechRecognition is not supported in this browser.";
    showError("Mic input is not supported here. Chrome or Edge works best.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => setState("listening", "Listening...");

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    askHarvis(transcript.trim());
  };

  recognition.onerror = (event) => {
    const reason = event.error === "not-allowed" ? "Microphone permission denied." : "Mic failed.";
    showError(`${reason} You can still type your message.`);
  };

  recognition.onend = () => {
    if (!isBusy && !window.speechSynthesis?.speaking) {
      setState("idle", "Ready for your command.");
    }
  };
}

micButton.addEventListener("click", () => {
  if (!recognition) {
    showError("Mic input is not supported in this browser.");
    return;
  }

  try {
    window.speechSynthesis?.cancel();
    recognition.start();
  } catch {
    setState("listening", "Already listening...");
  }
});

stopButton.addEventListener("click", () => {
  window.speechSynthesis?.cancel();
  recognition?.stop();
  setState("idle", "Speech stopped.");
});

clearButton.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  addMessage("ai", "Command log cleared. Systems online.");
  setState("idle", "Ready for your command.");
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  askHarvis(inputEl.value.trim());
});

voiceSelect.addEventListener("change", () => {
  selectedVoice = voices[Number(voiceSelect.value)] || selectedVoice;
});

quickPromptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    askHarvis(button.textContent.trim());
  });
});

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

loadVoices();
setupSpeechRecognition();
loadHealth();
setState("idle", "Ready for your command.");
