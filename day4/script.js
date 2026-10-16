const noteText = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const wordCount = document.getElementById("word-count");
const clearBtn = document.getElementById("clear-btn");
const themeToggle = document.getElementById("theme-toggle");

const DRAFT_KEY = "note-draft";
const THEME_KEY = "note-theme";

function updateCounts() {
  const text = noteText.value;
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  charCount.textContent = chars + " / 200 characters";
  wordCount.textContent = words + (words === 1 ? " word" : " words");

  charCount.classList.toggle("warning", chars > 180 && chars <= 200);
  charCount.classList.toggle("over", chars > 200);
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, noteText.value);
}

function clearNote() {
  noteText.value = "";
  localStorage.removeItem(DRAFT_KEY);
  updateCounts();
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}

noteText.addEventListener("input", () => {
  updateCounts();
  saveDraft();
});

noteText.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearNote();
});

clearBtn.addEventListener("click", clearNote);

themeToggle.addEventListener("click", () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
});

// On load: restore draft and theme, then update counters
const savedDraft = localStorage.getItem(DRAFT_KEY);
if (savedDraft !== null) noteText.value = savedDraft;
applyTheme(localStorage.getItem(THEME_KEY) === "dark");
updateCounts();