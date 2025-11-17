const md = window.markdownit({
  html: true,
  linkify: true,
  typographer: true
});

// Dodaj plugin dla przypisów
if (window.markdownitFootnote) {
  md.use(window.markdownitFootnote);
}
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// USTAW TU adres swojego Workera:
const PROXY_BASE_URL = 'https://epub.bogumilq.workers.dev';

const els = {
  urlInput: document.getElementById('urlInput'),
  fetchBtn: document.getElementById('fetchBtn'),
  titleInput: document.getElementById('titleInput'),
  authorInput: document.getElementById('authorInput'),
  descriptionInput: document.getElementById('descriptionInput'),
  sourceInput: document.getElementById('sourceInput'),
  pubDateInput: document.getElementById('publishedDateInput'),
  mdInput: document.getElementById('markdownInput'),
  preview: document.getElementById('preview'),
  previewContainer: document.querySelector('.preview-container'),
  coverFile: document.getElementById('coverFile'),
  genCoverBtn: document.getElementById('genCoverBtn'),
  coverCanvas: document.getElementById('coverCanvas'),
  coverPreview: document.getElementById('coverPreview'),
  dlMdBtn: document.getElementById('downloadMarkdownBtn'),
  dlEpubBtn: document.getElementById('downloadEpubBtn'),
  sendKindleBtn: document.getElementById('sendKindleBtn'),
  // Cover Presets
  presetGallery: document.getElementById('presetGallery'),
  bgColorInput: document.getElementById('bgColorInput'),
  textColorInput: document.getElementById('textColorInput'),
  fontSelect: document.getElementById('fontSelect'),
  titleSizeRange: document.getElementById('titleSizeRange'),
  authorSizeRange: document.getElementById('authorSizeRange'),
  titleSizeValue: document.getElementById('titleSizeValue'),
  authorSizeValue: document.getElementById('authorSizeValue'),
  generatePresetCoverBtn: document.getElementById('generatePresetCoverBtn'),
  resetPresetBtn: document.getElementById('resetPresetBtn'),
  coverPreviewLarge: document.getElementById('coverPreviewLarge'),
};

let coverImageBlob = null;
let lastContentHTML = '';
let selectedPreset = null;


// ====
// TOOLBAR: Formatowanie i statystyki
// ====

// Historia zmian (Undo/Redo)
let history = [];
let historyIndex = -1;
let isUndoRedo = false; // Flaga zapobiegająca dodawaniu do historii podczas undo/redo

// Zapisz stan do historii
function saveToHistory() {
  if (isUndoRedo) return; // Nie zapisuj podczas undo/redo
  
  const currentValue = els.mdInput.value;
  
  // Jeśli jesteśmy w środku historii, usuń wszystko po bieżącym indeksie
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }
  
  // Dodaj nowy stan (jeśli różni się od ostatniego)
  if (history.length === 0 || history[history.length - 1] !== currentValue) {
    history.push(currentValue);
    historyIndex = history.length - 1;
    
    // Ogranicz historię do 50 stanów (oszczędność pamięci)
    if (history.length > 50) {
    history.shift();
    historyIndex--;
    }
  }
  
  updateUndoRedoButtons();
}

// Cofnij
function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    isUndoRedo = true;
    els.mdInput.value = history[historyIndex];
    renderPreview();
    updateStats();
    updateUndoRedoButtons();
    isUndoRedo = false;
  }
}

// Przywróć
function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    isUndoRedo = true;
    els.mdInput.value = history[historyIndex];
    renderPreview();
    updateStats();
    updateUndoRedoButtons();
    isUndoRedo = false;
  }
}

// Aktualizuj stan przycisków Undo/Redo
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

// Event listenery dla Undo/Redo
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

// Zapisuj do historii przy każdej zmianie (z debounce)
let saveTimeout;
els.mdInput.addEventListener('input', () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToHistory();
  }, 500); // Zapisz po 500ms bezczynności
});

// Inicjalizacja historii (zapisz pusty stan)
saveToHistory();



// Funkcja pomocnicza: wstaw tekst w pozycji kursora
function insertAtCursor(textarea, before, after = '') {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const newText = before + selectedText + after;
  
  textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
  
  // Ustaw kursor po wstawionym tekście
  const newCursorPos = start + before.length + selectedText.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();
  
  // Odśwież preview
  renderPreview();
  updateStats();
}

// Funkcja pomocnicza: wstaw tekst na początku każdej linii zaznaczenia
function insertAtLineStart(textarea, prefix) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  // Znajdź początek i koniec linii
  let lineStart = start;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') {
    lineStart--;
  }
  
  let lineEnd = end;
  while (lineEnd < text.length && text[lineEnd] !== '\n') {
    lineEnd++;
  }
  
  // Pobierz zaznaczone linie
  const selectedLines = text.substring(lineStart, lineEnd);
  const lines = selectedLines.split('\n');
  
  // Dodaj prefix do każdej linii
  const newLines = lines.map(line => {
    // Jeśli linia już ma prefix, usuń go (toggle)
    if (line.startsWith(prefix)) {
    return line.substring(prefix.length);
    } else {
    return prefix + line;
    }
  });
  
  const newText = newLines.join('\n');
  
  textarea.value = text.substring(0, lineStart) + newText + text.substring(lineEnd);
  
  // Ustaw zaznaczenie
  textarea.setSelectionRange(lineStart, lineStart + newText.length);
  textarea.focus();
  
  // Odśwież preview
  renderPreview();
  updateStats();
}

// ====
// PRZYPISY (FOOTNOTES)
// ====

// Dodaj przypis
document.getElementById('footnoteBtn').addEventListener('click', () => {
  const footnoteText = prompt('Wpisz treść przypisu:');
  if (!footnoteText) return;
  
  // Znajdź najwyższy numer przypisu
  const markdown = els.mdInput.value;
  const footnoteRefs = markdown.match(/\[\^(\d+)\]/g) || [];
  const numbers = footnoteRefs.map(ref => parseInt(ref.match(/\d+/)[0]));
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  
  // Wstaw referencję w miejscu kursora
  insertAtCursor(els.mdInput, `[^${nextNumber}]`, '');
  
  // Dodaj definicję przypisu na końcu dokumentu
  const currentValue = els.mdInput.value;
  const footnoteDefinition = `\n\n[^${nextNumber}]: ${footnoteText}`;
  
  // Sprawdź, czy są już przypisy na końcu
  const lastFootnoteMatch = currentValue.match(/\[\^\d+\]:[^\n]*$/);
  if (lastFootnoteMatch) {
    // Dodaj po ostatnim przypisie
    els.mdInput.value = currentValue + footnoteDefinition;
  } else {
    // Dodaj z separatorem
    els.mdInput.value = currentValue + '\n\n---' + footnoteDefinition;
  }
  
  renderPreview();
  updateStats();
  saveToHistory();
});

// Porządkuj przypisy (renumeracja)
document.getElementById('reorderFootnotesBtn').addEventListener('click', () => {
  let content = els.mdInput.value;
  
  // Step 1: Split content into text and footnotes sections
  const parts = content.split('\n---\n');
  let textPart = parts[0] || '';
  let footnotesPart = parts[1] || '';
  
  // Step 2: Find all footnote references in the text
  const refsInText = [];
  const refRegex = /\[\^(\d+)\]/g;
  let match;
  while ((match = refRegex.exec(textPart)) !== null) {
    const num = match[1];
    if (!refsInText.includes(num)) {
    refsInText.push(num);
    }
  }
  
  if (refsInText.length === 0) {
    alert('Nie znaleziono przypisów do uporządkowania.');
    return;
  }
  
  // Step 3: Extract existing footnote definitions
  const footnoteDefinitions = new Map();
  const defRegex = /\[\^(\d+)\]:\s*(.+?)(?=\n\[\^|\n*$)/gs;
  let defMatch;
  while ((defMatch = defRegex.exec(footnotesPart)) !== null) {
    footnoteDefinitions.set(defMatch[1], defMatch[2].trim());
  }
  
  // Step 4: Replace references in text with temporary placeholders
  refsInText.forEach((oldNum, index) => {
    textPart = textPart.replace(new RegExp(`\\[\\^${oldNum}\\]`, 'g'), `[^TEMP${index}]`);
  });
  
  // Step 5: Replace placeholders with new sequential numbers
  refsInText.forEach((oldNum, index) => {
    const newNum = index + 1;
    textPart = textPart.replace(new RegExp(`\\[\\^TEMP${index}\\]`, 'g'), `[^${newNum}]`);
  });
  
  // Step 6: Rebuild footnotes section with only referenced footnotes
  const newFootnotes = [];
  refsInText.forEach((oldNum, index) => {
    const newNum = index + 1;
    const definition = footnoteDefinitions.get(oldNum);
    if (definition) {
    newFootnotes.push(`[^${newNum}]: ${definition}`);
    }
  });
  
  // Step 7: Reconstruct content
  if (newFootnotes.length > 0) {
    content = textPart + '\n\n---\n\n' + newFootnotes.join('\n\n');
  } else {
    content = textPart;
  }
  
  els.mdInput.value = content;
  renderPreview();
  updateStats();
  saveToHistory();
  
  alert(`Uporządkowano ${refsInText.length} przypisów.`);
});


// Pogrubienie
document.getElementById('boldBtn').addEventListener('click', () => {
  insertAtCursor(els.mdInput, '**', '**');
});

// Kursywa
document.getElementById('italicBtn').addEventListener('click', () => {
  insertAtCursor(els.mdInput, '*', '*');
});

// Przekreślenie
document.getElementById('strikeBtn').addEventListener('click', () => {
  insertAtCursor(els.mdInput, '~~', '~~');
});

// Nagłówek H1
document.getElementById('h1Btn').addEventListener('click', (e) => {
  e.preventDefault();
  insertAtLineStart(els.mdInput, '# ');
});

// Nagłówek H2
document.getElementById('h2Btn').addEventListener('click', (e) => {
  e.preventDefault();
  insertAtLineStart(els.mdInput, '## ');
});

// Nagłówek H3
document.getElementById('h3Btn').addEventListener('click', (e) => {
  e.preventDefault();
  insertAtLineStart(els.mdInput, '### ');
});

// Lista punktowana
document.getElementById('ulBtn').addEventListener('click', () => {
  insertAtLineStart(els.mdInput, '- ');
});

// Lista numerowana
document.getElementById('olBtn').addEventListener('click', () => {
  insertAtLineStart(els.mdInput, '1. ');
});

// Cytat
document.getElementById('quoteBtn').addEventListener('click', () => {
  insertAtLineStart(els.mdInput, '> ');
});

// Kod inline
document.getElementById('codeBtn').addEventListener('click', () => {
  insertAtCursor(els.mdInput, '`', '`');
});

// Link
document.getElementById('linkBtn').addEventListener('click', () => {
  const url = prompt('Wpisz URL:');
  if (url) {
    insertAtCursor(els.mdInput, '[', `](${url})`);
  }
});

// Separator
document.getElementById('hrBtn').addEventListener('click', () => {
  insertAtCursor(els.mdInput, '\n\n---\n\n');
});

// Usuń obrazy (już istniejące)
document.getElementById('removeImagesBtn').addEventListener('click', () => {
  let markdown = els.mdInput.value;
  
  // Usuń obrazy Markdown inline: ![alt](url)
  markdown = markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  
  // Usuń obrazy Markdown referencyjne: ![alt][id]
  markdown = markdown.replace(/!\[[^\]]*\]\[[^\]]+\]/g, '');
  
  // Usuń definicje referencji obrazków: [id]: url "title"
  markdown = markdown.replace(/^\[[^\]]+\]:\s+\S+.*$/gm, '');
  
  // Usuń obrazy HTML: <img...>
  markdown = markdown.replace(/<img[^>]*>/gi, '');
  
  // Usuń nadmiarowe puste linie (3+ → 2)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  
  els.mdInput.value = markdown.trim();
  renderPreview();
  updateStats();
});

// Wyczyść formatowanie
document.getElementById('clearFormattingBtn').addEventListener('click', () => {
  if (!confirm('Czy na pewno chcesz usunąć całe formatowanie Markdown? Ta operacja jest nieodwracalna.')) {
    return;
  }
  
  let text = els.mdInput.value;
  
  // Usuń nagłówki
  text = text.replace(/^#{1,6}\s+/gm, '');
  
  // Usuń pogrubienie i kursywę
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  
  // Usuń przekreślenie
  text = text.replace(/~~(.*?)~~/g, '$1');
  
  // Usuń kod inline
  text = text.replace(/`([^`]+)`/g, '$1');
  
  // Usuń bloki kodu
  text = text.replace(/```[\s\S]*?```/g, '');
  
  // Usuń cytaty
  text = text.replace(/^>\s+/gm, '');
  
  // Usuń listy
  text = text.replace(/^[\*\-\+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');
  
  // Usuń linki (zostaw tylko tekst)
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Usuń separatory
  text = text.replace(/^[\-\*_]{3,}$/gm, '');
  
  // Usuń nadmiarowe puste linie
  text = text.replace(/\n{3,}/g, '\n\n');
  
  els.mdInput.value = text.trim();
  renderPreview();
  updateStats();
});

// Statystyki
function updateStats() {
  const text = els.mdInput.value;
  
  // Liczba słów
  const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  
  // Liczba znaków
  const charsWithSpaces = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  
  // Czas czytania (250 słów/min)
  const readTime = Math.ceil(words / 250);
  
  // Aktualizuj UI
  document.getElementById('statsText').textContent = `${words} słów`;
  document.getElementById('statWords').textContent = words;
  document.getElementById('statCharsWithSpaces').textContent = charsWithSpaces;
  document.getElementById('statCharsNoSpaces').textContent = charsNoSpaces;
  document.getElementById('statReadTime').textContent = `${readTime} min`;
}

// Toggle panelu statystyk
document.getElementById('statsBtn').addEventListener('click', () => {
  const panel = document.getElementById('statsPanel');
  panel.classList.toggle('d-none');
});

// Aktualizuj statystyki przy każdej zmianie
els.mdInput.addEventListener('input', updateStats);

// Skróty klawiszowe
els.mdInput.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + B = Bold
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    document.getElementById('boldBtn').click();
  }
  
  // Ctrl/Cmd + I = Italic
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault();
    document.getElementById('italicBtn').click();
  }
});

els.mdInput.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + B = Bold
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    document.getElementById('boldBtn').click();
  }
  
  // Ctrl/Cmd + I = Italic
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault();
    document.getElementById('italicBtn').click();
  }
  
  // Ctrl/Cmd + Z = Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  
  // Ctrl/Cmd + Shift + Z = Redo (lub Ctrl/Cmd + Y)
  if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
    e.preventDefault();
    redo();
  }
});



// Inicjalizacja statystyk
updateStats();


// ==== COVER PRESETS ====
const coverPresets = [
  {
    name: 'Minimalist',
    bgColor: '#f5f5f5',
    textColor: '#1a1a1a',
    font: 'Georgia, serif',
  },
  {
    name: 'Classic',
    bgColor: '#2c1810',
    textColor: '#f4e4c1',
    font: "'Times New Roman', serif",
  },
  {
    name: 'Modern',
    bgColor: '#0a0e27',
    textColor: '#00d9ff',
    font: "'Roboto', sans-serif",
  },
  {
    name: 'Dark',
    bgColor: '#0d0d0d',
    textColor: '#e0e0e0',
    font: "'Helvetica Neue', sans-serif",
  },
  {
    name: 'Tech',
    bgColor: '#1a1a2e',
    textColor: '#16c79a',
    font: "'Roboto', sans-serif",
  },
  {
    name: 'Warm',
    bgColor: '#d4a574',
    textColor: '#3e2723',
    font: "'Merriweather', serif",
  },
];

// ==== INICJALIZACJA PRESETÓW ====
function initPresets() {
  els.presetGallery.innerHTML = '';

  coverPresets.forEach((preset, index) => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.style.backgroundColor = preset.bgColor;
    card.dataset.presetIndex = index;

    card.innerHTML = `
    <div class="preset-card-body">
    <div class="preset-title" style="color: ${preset.textColor}; font-family: ${preset.font};">Tytuł</div>
    <div class="preset-author" style="color: ${preset.textColor}; font-family: ${preset.font};">Autor</div>
    </div>
    <div class="preset-name">${preset.name}</div>
    `;

    card.addEventListener('click', () => selectPreset(index));
    els.presetGallery.appendChild(card);
  });
}

// ==== WYBÓR PRESETU ====
function selectPreset(index) {
  selectedPreset = coverPresets[index];

  // Aktualizuj UI
  document.querySelectorAll('.preset-card').forEach((card, i) => {
    card.classList.toggle('selected', i === index);
  });

  // Ustaw kolory i czcionkę
  els.bgColorInput.value = selectedPreset.bgColor;
  els.textColorInput.value = selectedPreset.textColor;
  els.fontSelect.value = selectedPreset.font;

  // Generuj podgląd
  generateCoverPreview();
}

// ==== GENERUJ PODGLĄD OKŁADKI ====
function generateCoverPreview() {
  const title = (els.titleInput.value || 'Tytuł e-booka').trim();
  const author = (els.authorInput.value || 'Autor').trim();
  const bgColor = els.bgColorInput.value;
  const textColor = els.textColorInput.value;
  const font = els.fontSelect.value;
  const titleSize = parseInt(els.titleSizeRange.value);
  const authorSize = parseInt(els.authorSizeRange.value);

  const canvas = els.coverCanvas;
  const ctx = canvas.getContext('2d');

  // Tło
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tekst
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Tytuł (wyżej - 35% zamiast 40%)
  const titleY = canvas.height * 0.35;
  ctx.font = `bold ${titleSize}px ${font}`;
  wrapText(ctx, title, canvas.width / 2, titleY, canvas.width - 200, titleSize * 1.3);

  // Autor
  const authorY = canvas.height * 0.55;
  ctx.font = `${authorSize}px ${font}`;
  ctx.fillText(author, canvas.width / 2, authorY);

  // Pokaż podgląd
  canvas.toBlob((blob) => {
    coverImageBlob = blob;
    els.coverPreviewLarge.src = URL.createObjectURL(blob);
    els.coverPreviewLarge.style.display = 'block';
  }, 'image/jpeg', 0.9);
}

// ==== ZAWIJANIE TEKSTU ====
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lines = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && n > 0) {
    lines.push(line);
    line = words[n] + ' ';
    } else {
    line = testLine;
    }
  }
  lines.push(line);

  // Wyśrodkuj pionowo
  const totalHeight = lines.length * lineHeight;
  let currentY = y - (totalHeight / 2) + (lineHeight / 2);

  lines.forEach(line => {
    ctx.fillText(line.trim(), x, currentY);
    currentY += lineHeight;
  });
}

// ==== EVENT LISTENERS - PRESETS ====
els.generatePresetCoverBtn.addEventListener('click', () => {
  generateCoverPreview();
});

els.resetPresetBtn.addEventListener('click', () => {
  selectedPreset = null;
  document.querySelectorAll('.preset-card').forEach(card => {
    card.classList.remove('selected');
  });
  els.bgColorInput.value = '#d3d3d3';
  els.textColorInput.value = '#0000';
  els.fontSelect.value = "'Merriweather', serif";
  els.titleSizeRange.value = 70;
  els.authorSizeRange.value = 40;
  els.titleSizeValue.textContent = '70';
  els.authorSizeValue.textContent = '40';
  els.coverPreviewLarge.style.display = 'none';
});

// Auto-update podglądu przy zmianie tytułu/autora
els.titleInput.addEventListener('input', () => {
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

els.authorInput.addEventListener('input', () => {
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

// Aktualizacja wartości suwaków
els.titleSizeRange.addEventListener('input', (e) => {
  els.titleSizeValue.textContent = e.target.value;
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

els.authorSizeRange.addEventListener('input', (e) => {
  els.authorSizeValue.textContent = e.target.value;
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

// Aktualizacja podglądu przy zmianie kolorów/czcionki
els.bgColorInput.addEventListener('input', () => {
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

els.textColorInput.addEventListener('input', () => {
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

els.fontSelect.addEventListener('change', () => {
  if (selectedPreset || els.coverPreviewLarge.style.display === 'block') {
    generateCoverPreview();
  }
});

// ==== SCROLL SYNC FLAGS ====
let isTextareaScrolling = false;
let isPreviewScrolling = false;

// ==== SCROLL SYNC ====
function syncPreviewToTextarea() {
  if (isPreviewScrolling) return;

  const textarea = els.mdInput;
  const previewContainer = els.previewContainer;

  if (!textarea || !previewContainer) return;

  const textareaScrollTop = textarea.scrollTop;
  const textareaScrollHeight = textarea.scrollHeight - textarea.clientHeight;
  const scrollRatio = textareaScrollHeight > 0 ? textareaScrollTop / textareaScrollHeight : 0;

  const previewScrollHeight = previewContainer.scrollHeight - previewContainer.clientHeight;
  const targetScrollTop = previewScrollHeight * scrollRatio;

  isTextareaScrolling = true;
  previewContainer.scrollTop = targetScrollTop;

  setTimeout(() => {
    isTextareaScrolling = false;
  }, 50);
}

function syncTextareaToPreview() {
  if (isTextareaScrolling) return;

  const textarea = els.mdInput;
  const previewContainer = els.previewContainer;

  if (!textarea || !previewContainer) return;

  const previewScrollTop = previewContainer.scrollTop;
  const previewScrollHeight = previewContainer.scrollHeight - previewContainer.clientHeight;
  const scrollRatio = previewScrollHeight > 0 ? previewScrollTop / previewScrollHeight : 0;

  const textareaScrollHeight = textarea.scrollHeight - textarea.clientHeight;
  const targetScrollTop = textareaScrollHeight * scrollRatio;

  isPreviewScrolling = true;
  textarea.scrollTop = targetScrollTop;

  setTimeout(() => {
    isPreviewScrolling = false;
  }, 50);
}

// ==== RENDER PREVIEW ====
function renderPreview() {
  const safeMd = els.mdInput.value;
  const html = md.render(safeMd);
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  const previewContainer = els.previewContainer;
  const currentScrollRatio = previewContainer.scrollHeight > previewContainer.clientHeight
    ? previewContainer.scrollTop / (previewContainer.scrollHeight - previewContainer.clientHeight)
    : 0;

  els.preview.innerHTML = clean;

  requestAnimationFrame(() => {
    const newScrollHeight = previewContainer.scrollHeight - previewContainer.clientHeight;
    previewContainer.scrollTop = newScrollHeight * currentScrollRatio;
  });
}

// ==== EVENT LISTENERS ====
els.mdInput.addEventListener('input', () => {
  renderPreview();
});

els.mdInput.addEventListener('scroll', () => {
  syncPreviewToTextarea();
});

els.previewContainer.addEventListener('scroll', () => {
  syncTextareaToPreview();
});

// ==== TOOLBAR: REMOVE IMAGES ====
const removeImagesBtn = document.getElementById('removeImagesBtn');

removeImagesBtn?.addEventListener('click', () => {
  const textarea = els.mdInput;
  let markdown = textarea.value;

  // Usuń obrazy Markdown inline: ![alt](url)
  markdown = markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Usuń obrazy Markdown referencyjne: ![alt][id]
  markdown = markdown.replace(/!\[[^\]]*\]\[[^\]]+\]/g, '');

  // Usuń definicje referencji obrazków: [id]: url "title"
  markdown = markdown.replace(/^\[[^\]]+\]:\s+\S+.*$/gm, '');

  // Usuń obrazy HTML: <img...>
  markdown = markdown.replace(/<img[^>]*>/gi, '');

  // Usuń nadmiarowe puste linie (3+ → 2)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  textarea.value = markdown;
  renderPreview();

  console.log('Usunięto wszystkie obrazy z tekstu');
});

// ==== EMBED IMAGES IN EPUB ====
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await blobToBase64(blob);
  } catch (e) {
    console.warn(`Nie udało się pobrać obrazu: ${url}`, e);
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getImageExtension(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return map[mimeType] || 'jpg';
}

async function extractAndEmbedImages(htmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const images = doc.querySelectorAll('img');

  const embeddedImages = [];
  let imageIndex = 0;

  for (const img of images) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) continue;

    const base64Data = await fetchImageAsBase64(src);
    if (!base64Data) continue;

    const match = base64Data.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) continue;

    const mimeType = match[1];
    const base64 = match[2];
    const ext = getImageExtension(mimeType);
    const filename = `image${imageIndex}.${ext}`;

    img.setAttribute('src', `images/${filename}`);

    embeddedImages.push({
    filename,
    mimeType,
    data: base64,
    });

    imageIndex++;
  }

  return {
    html: doc.body.innerHTML,
    images: embeddedImages,
  };
}

// ==== SPLIT MARKDOWN INTO CHAPTERS ====
function splitMarkdownIntoChapters(markdown, bookTitle) {
  const lines = markdown.split('\n');
  const chapters = [];
  let currentChapter = null;
  let currentContent = [];

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);

    if (h1Match || h2Match) {
    if (currentChapter) {
    currentChapter.content = currentContent.join('\n').trim();
    chapters.push(currentChapter);
    currentContent = [];
    }

    const title = h1Match ? h1Match[1] : h2Match[1];
    const level = h1Match ? 1 : 2;

    currentChapter = {
    title: title.trim(),
    level: level,
    content: '',
    };

    currentContent.push(line);
    } else {
    currentContent.push(line);
    }
  }

  if (currentChapter) {
    currentChapter.content = currentContent.join('\n').trim();
    chapters.push(currentChapter);
  } else if (currentContent.length > 0) {
    chapters.push({
    title: bookTitle || 'Chapter 1',
    level: 1,
    content: currentContent.join('\n').trim(),
    });
  }

  return chapters;
}

// ==== FETCH ARTICLE ====
els.fetchBtn.addEventListener('click', async () => {
  const url = els.urlInput.value.trim();
  if (!url) {
    alert('Podaj adres URL.');
    return;
  }

  els.fetchBtn.disabled = true;
  els.fetchBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Pobieranie...';

  els.titleInput.value = '';
  els.authorInput.value = '';
  els.descriptionInput.value = '';
  els.sourceInput.value = '';
  els.pubDateInput.value = '';
  els.mdInput.value = '';
  els.preview.innerHTML = '';

  try {
    const resp = await fetch(`${PROXY_BASE_URL}?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error(`Błąd proxy: ${resp.status}`);
    const data = await resp.json();

    if (data.error) {
    throw new Error(data.error);
    }

    if (data.title) {
    els.titleInput.value = data.title;
    }
    if (data.author) {
    els.authorInput.value = data.author;
    }
    if (data.excerpt) {
    els.descriptionInput.value = data.excerpt;
    }
    if (data.siteName) {
    els.sourceInput.value = data.siteName;
    }
    // Konwertuj ISO datetime na format yyyy-MM-dd
if (data.publishedTime) {
  const dateOnly = data.publishedTime.split('T')[0];
  els.pubDateInput.value = dateOnly;
} else {
  els.pubDateInput.value = '';
}

    lastContentHTML = data.contentHTML || '';
    const cleanHTML = DOMPurify.sanitize(lastContentHTML, { USE_PROFILES: { html: true } });
    const mdText = turndownService.turndown(cleanHTML);
    els.mdInput.value = mdText || '';

    renderPreview();

    els.mdInput.scrollTop = 0;
    els.previewContainer.scrollTop = 0;
  } catch (e) {
    console.error(e);
    alert(`Nie udało się pobrać artykułu: ${e.message}`);
  } finally {
    els.fetchBtn.disabled = false;
    els.fetchBtn.innerHTML = '<i class="bi bi-download"></i> Pobierz artykuł';
  }
});

// ==== COVER (tradycyjny) ====
els.coverFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  coverImageBlob = file;
  const url = URL.createObjectURL(file);
  els.coverPreview.src = url;
  els.coverPreview.style.display = 'block';
});

els.genCoverBtn.addEventListener('click', () => {
  const title = (els.titleInput.value || 'Bez tytułu').trim();
  const author = (els.authorInput.value || '').trim();
  const canvas = els.coverCanvas;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1b263b';
  ctx.fillRect(100, 100, canvas.width - 200, canvas.height - 200);

  ctx.fillStyle = '#e0e1dd';
  ctx.textAlign = 'center';

  fitText(ctx, title, canvas.width / 2, canvas.height / 2 - 100, canvas.width - 260, 'bold', 'Merriweather, serif');
  ctx.font = '36px "Merriweather", serif';
  ctx.fillText(author || '', canvas.width / 2, canvas.height / 2 + 40);

  canvas.toBlob((blob) => {
    coverImageBlob = blob;
    els.coverPreview.src = URL.createObjectURL(blob);
    els.coverPreview.style.display = 'block';
  }, 'image/jpeg', 0.9);
});

function fitText(ctx, text, x, y, maxWidth, weight = 'bold', family = 'serif') {
  let size = 80;
  while (size > 28) {
    ctx.font = `${weight} ${size}px ${family}`;
    const metrics = ctx.measureText(text);
    if (metrics.width <= maxWidth) break;
    size -= 2;
  }
  wrapText(ctx, text, x, y, maxWidth, 1.3);
}

// ==== DOWNLOAD MARKDOWN ====
els.dlMdBtn.addEventListener('click', () => {
  const blob = new Blob([els.mdInput.value || ''], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, safeFilename(`${els.titleInput.value || 'ebook'}.md`));
});

// ==== DOWNLOAD EPUB ====
els.dlEpubBtn.addEventListener('click', async () => {
  const title = (els.titleInput.value || 'Untitled').trim();
  const author = (els.authorInput.value || '').trim();
  const description = (els.descriptionInput.value || '').trim();
  const source = (els.sourceInput.value || '').trim();
  const pubDate = (els.pubDateInput.value || '').trim();
  const markdown = els.mdInput.value || '';

  const chapters = splitMarkdownIntoChapters(markdown, title);

  console.log(`Znaleziono ${chapters.length} rozdziałów:`, chapters.map(ch => `${ch.level === 1 ? 'H1' : 'H2'}: ${ch.title}`));

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml(), { compression: 'DEFLATE' });

  const oebps = zip.folder('OEBPS');
  const css = `
  body { font-family: serif; line-height: 1.5; padding: 0 0.5rem; }
  h1,h2,h3 { margin: 1.2em 0 0.6em; }
  img { max-width: 100%; height: auto; }
  `;
  oebps.file('styles.css', css);

  let hasCover = false;

  if (coverImageBlob) {
    const coverExt = 'jpg';
    const coverArrBuf = await coverImageBlob.arrayBuffer();
    oebps.file(`images/cover.${coverExt}`, coverArrBuf);
    oebps.file('cover.xhtml', coverXhtml(`images/cover.${coverExt}`));
    hasCover = true;
  }

  const processedChapters = [];
  const allEmbeddedImages = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const htmlContent = md.render(chapter.content);
    const sanitizedHtml = DOMPurify.sanitize(htmlContent, { USE_PROFILES: { html: true } });

    const { html: finalHtml, images: embeddedImages } = await extractAndEmbedImages(sanitizedHtml);

    processedChapters.push({
    ...chapter,
    html: finalHtml,
    filename: `chapter${i + 1}.xhtml`,
    });

    allEmbeddedImages.push(...embeddedImages);
  }

  const imagesFolder = oebps.folder('images');
  for (const img of allEmbeddedImages) {
    const binaryData = Uint8Array.from(atob(img.data), c => c.charCodeAt(0));
    imagesFolder.file(img.filename, binaryData);
  }

  for (const chapter of processedChapters) {
    oebps.file(chapter.filename, wrapXhtml(chapter.html, chapter.title));
  }

  oebps.file('toc.xhtml', tocXhtml(title, processedChapters));

  const uid = `urn:uuid:${cryptoRandomUuid()}`;

  const ncx = tocNcx(title, author, uid, processedChapters);
  oebps.file('toc.ncx', ncx);

  const opf = contentOpf({
    title,
    author,
    description,
    source,
    pubDate,
    hasCover,
    chapters: processedChapters,
    images: allEmbeddedImages,
    uid: uid,
  });
  oebps.file('content.opf', opf);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  saveAs(blob, safeFilename(`${title}.epub`));
});

// ==== HELPER FUNCTIONS ====
function safeFilename(name) {
  return name.replace(/[\/\\:*?"<>|]+/g, '_');
}

function containerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function wrapXhtml(innerHtml, chapterTitle = 'Chapter') {
  // Dekoduj encje HTML
  let processedHtml = decodeHtmlEntities(innerHtml);
  
  // Zamień <br> na <br/> (XHTML wymaga samozamykających się tagów)
  processedHtml = processedHtml.replace(/<br\s*>/gi, '<br/>');
  
  // Usuń <hr class="footnotes-sep"> wstawiane przez plugin (wszystkie warianty)
  processedHtml = processedHtml.replace(/<hr[^>]*class="footnotes-sep"[^>]*>/gi, '');
  
  // Zamień pozostałe <hr> na <hr/> (XHTML)
  processedHtml = processedHtml.replace(/<hr(\s+[^>]*)?>/gi, '<hr$1/>');
  
  // Napraw <img> bez zamknięcia (dodaj /> na końcu)
  processedHtml = processedHtml.replace(/<img([^>]*[^/])>/gi, '<img$1/>');
  
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pl">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(chapterTitle)}</title>
  <link rel="stylesheet" href="styles.css"/>
</head>
<body epub:type="bodymatter">
${processedHtml}
</body>
</html>`;
}

function coverXhtml(coverPath) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pl">
<head>
  <meta charset="utf-8"/>
  <title>Okładka</title>
  <style>html,body{margin:0;padding:0;height:100%}figure{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#000}</style>
</head>
<body>
  <figure>
    <img src="${coverPath}" alt="Okładka" role="doc-cover"/>
  </figure>
</body>
</html>`;
}

function tocXhtml(bookTitle, chapters) {
  let tocItems = '';
  let insideH1 = false;
  let h2Items = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];

    if (chapter.level === 1) {
    if (h2Items.length > 0) {
    tocItems += `    <ol>\n${h2Items.join('')}    </ol>\n    </li>\n`;
    h2Items = [];
    } else if (insideH1) {
    tocItems += `    </li>\n`;
    }

    tocItems += `    <li>\n    <a href="${chapter.filename}">${escapeXml(chapter.title)}</a>\n`;
    insideH1 = true;
    } else if (chapter.level === 2) {
    if (!insideH1 && h2Items.length === 0) {
    tocItems += `    <li><a href="${chapter.filename}">${escapeXml(chapter.title)}</a></li>\n`;
    } else {
    h2Items.push(`    <li><a href="${chapter.filename}">${escapeXml(chapter.title)}</a></li>\n`);
    }
    }
  }

  if (h2Items.length > 0) {
    tocItems += `    <ol>\n${h2Items.join('')}    </ol>\n    </li>\n`;
  } else if (insideH1) {
    tocItems += `    </li>\n`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pl">
<head>
  <meta charset="utf-8"/>
  <title>Spis treści</title>
  <link rel="stylesheet" href="styles.css"/>
</head>
<body>
  <h1>${escapeXml(bookTitle)}</h1>
  <nav epub:type="toc" role="doc-toc">
    <ol>
${tocItems}    </ol>
  </nav>
</body>
</html>`;
}

function tocNcx(bookTitle, author, uid, chapters) {
  let playOrder = 1;
  let navPoints = '';
  let navStack = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];

    if (chapter.level === 1) {
    while (navStack.length > 0) {
    navPoints += '  </navPoint>\n';
    navStack.pop();
    }

    navPoints += `  <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
    <navLabel>
    <text>${escapeXml(chapter.title)}</text>
    </navLabel>
    <content src="${chapter.filename}"/>
`;
    navStack.push(chapter);
    playOrder++;
    } else if (chapter.level === 2) {
    navPoints += `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
    <navLabel>
    <text>${escapeXml(chapter.title)}</text>
    </navLabel>
    <content src="${chapter.filename}"/>
    </navPoint>
`;
    playOrder++;
    }
  }

  while (navStack.length > 0) {
    navPoints += '  </navPoint>\n';
    navStack.pop();
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(bookTitle)}</text>
  </docTitle>
  ${author ? `<docAuthor>\n    <text>${escapeXml(author)}</text>\n  </docAuthor>` : ''}
  <navMap>
${navPoints}  </navMap>
</ncx>`;
}

function contentOpf({ title, author, description, source, pubDate, hasCover, chapters, images = [], uid }) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const manifestCoverItems = hasCover
    ? `    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cover-xhtml" href="cover.xhtml" media-type="application/xhtml+xml"/>
`
    : '';

  const manifestChapterItems = chapters.map((ch, idx) => 
    `    <item id="chapter${idx + 1}" href="${ch.filename}" media-type="application/xhtml+xml"/>`
  ).join('\n');

  const manifestImageItems = images.map((img, idx) => 
    `    <item id="img${idx}" href="images/${img.filename}" media-type="${img.mimeType}"/>`
  ).join('\n');

  const spineCoverItemRef = hasCover ? `    <itemref idref="cover-xhtml"/>\n` : '';

  const spineChapterItems = chapters.map((ch, idx) => 
    `    <itemref idref="chapter${idx + 1}"/>`
  ).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="pl">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${escapeXml(title || 'Untitled')}</dc:title>
    <dc:language>pl</dc:language>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}
    ${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ''}
    ${source ? `<dc:source>${escapeXml(source)}</dc:source>` : ''}
    ${pubDate ? `<dc:date>${escapeXml(pubDate)}</dc:date>` : ''}
    <meta property="dcterms:modified">${now}</meta>
    ${hasCover ? `<meta name="cover" content="cover-image"/>` : ''}
    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">tableOfContents</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">This publication conforms to WCAG 2.0 Level A.</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
  </metadata>
  <manifest>
${manifestChapterItems}
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
${manifestCoverItems}${manifestImageItems ? manifestImageItems + '\n' : ''}  </manifest>
  <spine toc="ncx">
${spineCoverItemRef}${spineChapterItems}
  </spine>
</package>`;
}

function escapeXml(s = '') {
  return s
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function decodeHtmlEntities(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

function cryptoRandomUuid() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ==== IMPORT DOCX ====
document.getElementById('docxInput').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // DODANE: Czyszczenie wszystkich pól przed importem
  els.titleInput.value = '';
  els.authorInput.value = '';
  els.descriptionInput.value = '';
  els.sourceInput.value = '';
  els.pubDateInput.value = '';
  els.mdInput.value = '';
  els.preview.innerHTML = '';
  lastContentHTML = '';
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({
      arrayBuffer: arrayBuffer
    });
    
    // Konwersja HTML na Markdown (prosty converter)
    let markdown = result.value
      .replace(/<h1>(.*?)<\/h1>/g, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/g, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/g, '### $1\n')
      .replace(/<h4>(.*?)<\/h4>/g, '#### $1\n')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<\/li>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<\/?ul>/g, '')
      .replace(/<\/?ol>/g, '');
    
    // ZMIENIONE: Usuń dodawanie do istniejącej treści, po prostu zastąp
    document.getElementById('markdownInput').value = markdown;
    
    // DODANE: Odśwież podgląd automatycznie
    renderPreview();
    
    // DODANE: Aktualizuj statystyki
    updateStats();
    
    // DODANE: Przewiń do góry
    els.mdInput.scrollTop = 0;
    els.previewContainer.scrollTop = 0;
    
    alert('✅ DOCX zaimportowany pomyślnie!');
    
    // Wyczyść input
    e.target.value = '';
  } catch (error) {
    console.error('Błąd importu:', error);
    alert('❌ Błąd importu DOCX: ' + error.message);
  }
});

// ==== WYSZUKIWANIE I ZAMIANA ====
let searchMatches = [];
let currentMatchIndex = -1;

// Toggle panelu wyszukiwania
els.searchBtn = document.getElementById('searchBtn');
els.searchPanel = document.getElementById('searchPanel');
els.searchInput = document.getElementById('searchInput');
els.searchResults = document.getElementById('searchResults');
els.searchPrevBtn = document.getElementById('searchPrevBtn');
els.searchNextBtn = document.getElementById('searchNextBtn');
els.toggleReplaceBtn = document.getElementById('toggleReplaceBtn');
els.closeSearchBtn = document.getElementById('closeSearchBtn');
els.replaceRow = document.getElementById('replaceRow');
els.replaceInput = document.getElementById('replaceInput');
els.replaceBtn = document.getElementById('replaceBtn');
els.replaceAllBtn = document.getElementById('replaceAllBtn');
els.searchCaseSensitive = document.getElementById('searchCaseSensitive');

els.searchBtn.addEventListener('click', () => {
  els.searchPanel.classList.toggle('d-none');
  if (!els.searchPanel.classList.contains('d-none')) {
    els.searchInput.focus();
  }
});

els.closeSearchBtn.addEventListener('click', () => {
  els.searchPanel.classList.add('d-none');
  clearSearchHighlights();
});

// Toggle wiersza zamiany
els.toggleReplaceBtn.addEventListener('click', () => {
  els.replaceRow.classList.toggle('d-none');
  const icon = els.toggleReplaceBtn.querySelector('i');
  if (els.replaceRow.classList.contains('d-none')) {
    icon.className = 'bi bi-chevron-down';
  } else {
    icon.className = 'bi bi-chevron-up';
  }
});

// Wyszukiwanie
function performSearch() {
  const searchTerm = els.searchInput.value;
  const text = els.mdInput.value;
  
  if (!searchTerm) {
    clearSearchHighlights();
    return;
  }
  
  const caseSensitive = els.searchCaseSensitive.checked;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  
  searchMatches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    searchMatches.push({
      index: match.index,
      length: match[0].length
    });
  }
  
  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    highlightMatches();
    scrollToMatch(currentMatchIndex);
    els.searchResults.textContent = `${currentMatchIndex + 1} z ${searchMatches.length}`;
  } else {
    els.searchResults.textContent = 'Nie znaleziono';
    currentMatchIndex = -1;
  }
}

function highlightMatches() {
  // Podświetlenie w textarea jest trudne, więc używamy selection
  // Alternatywnie można dodać overlay z podświetleniami
}

function scrollToMatch(index) {
  if (index < 0 || index >= searchMatches.length) return;
  
  const match = searchMatches[index];
  
  // Zaznacz tekst BEZ przenoszenia focusa
  els.mdInput.setSelectionRange(match.index, match.index + match.length);
  
  // Przewiń do zaznaczenia
  const lineHeight = 20; // przybliżona wysokość linii
  const lines = els.mdInput.value.substring(0, match.index).split('\n').length;
  els.mdInput.scrollTop = (lines - 5) * lineHeight;
}

function clearSearchHighlights() {
  searchMatches = [];
  currentMatchIndex = -1;
  els.searchResults.textContent = '';
}

// Nawigacja
els.searchNextBtn.addEventListener('click', () => {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  scrollToMatch(currentMatchIndex);
  els.searchResults.textContent = `${currentMatchIndex + 1} z ${searchMatches.length}`;
});

els.searchPrevBtn.addEventListener('click', () => {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  scrollToMatch(currentMatchIndex);
  els.searchResults.textContent = `${currentMatchIndex + 1} z ${searchMatches.length}`;
});

// Wyszukiwanie na bieżąco
els.searchInput.addEventListener('input', performSearch);
els.searchCaseSensitive.addEventListener('change', performSearch);

// Enter w polu wyszukiwania = następny wynik
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      els.searchPrevBtn.click();
    } else {
      els.searchNextBtn.click();
    }
  }
});

// Zamiana
els.replaceBtn.addEventListener('click', () => {
  if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;
  
  const match = searchMatches[currentMatchIndex];
  const text = els.mdInput.value;
  const newText = text.substring(0, match.index) + 
                  els.replaceInput.value + 
                  text.substring(match.index + match.length);
  
  els.mdInput.value = newText;
  renderPreview();
  updateStats();
  performSearch(); // Odśwież wyniki
});

els.replaceAllBtn.addEventListener('click', () => {
  const searchTerm = els.searchInput.value;
  const replaceTerm = els.replaceInput.value;
  
  if (!searchTerm) return;
  
  const caseSensitive = els.searchCaseSensitive.checked;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  
  const count = (els.mdInput.value.match(regex) || []).length;
  
  if (count > 0 && confirm(`Zamienić ${count} wystąpień?`)) {
    els.mdInput.value = els.mdInput.value.replace(regex, replaceTerm);
    renderPreview();
    updateStats();
    performSearch();
  }
});


// ==== INICJALIZACJA ====
window.addEventListener('load', () => {
  initPresets();

  if (els.mdInput.value) {
    renderPreview();
  }
  
  // ==== SEND TO KINDLE ====
  els.sendKindleBtn.addEventListener('click', () => {
    const modal = new bootstrap.Modal(document.getElementById('sendKindleModal'));
    
    // Załaduj zapisane dane z localStorage (jeśli istnieją)
    try {
      const savedUserEmail = localStorage.getItem('kindleUserEmail');
      const savedKindleEmail = localStorage.getItem('kindleEmail');
      
      if (savedUserEmail) {
        document.getElementById('userEmailInput').value = savedUserEmail;
      }
      if (savedKindleEmail) {
        document.getElementById('kindleEmailInput').value = savedKindleEmail;
      }
    } catch (e) {
      console.warn('Nie udało się załadować zapisanych danych:', e);
    }
    
    // Ustaw tytuł książki
    document.getElementById('bookTitleInput').value = els.titleInput.value || 'Ebook';
    
    modal.show();
  });

  // Obsługa wysyłki
  document.getElementById('sendKindleSubmitBtn').addEventListener('click', async () => {
    const userEmail = document.getElementById('userEmailInput').value.trim();
    const kindleEmail = document.getElementById('kindleEmailInput').value.trim();
    const bookTitle = document.getElementById('bookTitleInput').value.trim() || 'Ebook';
    const rememberEmails = document.getElementById('rememberEmailsCheckbox').checked;
    
    // Walidacja
    if (!userEmail || !kindleEmail) {
      alert('Wypełnij oba pola email!');
      return;
    }
    
    // Zapisz dane (jeśli zaznaczono)
    if (rememberEmails) {
      try {
        localStorage.setItem('kindleUserEmail', userEmail);
        localStorage.setItem('kindleEmail', kindleEmail);
      } catch (e) {
        console.warn('Nie udało się zapisać danych:', e);
      }
    }
    
    // Pokaż loader
    document.getElementById('sendKindleLoader').classList.remove('d-none');
    document.getElementById('sendKindleSuccess').classList.add('d-none');
    document.getElementById('sendKindleError').classList.add('d-none');
    document.getElementById('sendKindleSubmitBtn').disabled = true;
    
    try {
      // Generuj ePub (użyj tej samej logiki co w downloadEpubBtn)
      const title = (els.titleInput.value || 'Untitled').trim();
      const author = (els.authorInput.value || '').trim();
      const description = (els.descriptionInput.value || '').trim();
      const source = (els.sourceInput.value || '').trim();
      const pubDate = (els.pubDateInput.value || '').trim();
      const markdown = els.mdInput.value || '';
      
      const chapters = splitMarkdownIntoChapters(markdown, title);
      
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', containerXml(), { compression: 'DEFLATE' });
      
      const oebps = zip.folder('OEBPS');
      const css = `
      body { font-family: serif; line-height: 1.5; padding: 0 0.5rem; }
      h1,h2,h3 { margin: 1.2em 0 0.6em; }
      img { max-width: 100%; height: auto; }
      `;
      oebps.file('styles.css', css);
      
      let hasCover = false;
      
      if (coverImageBlob) {
        const coverExt = 'jpg';
        const coverArrBuf = await coverImageBlob.arrayBuffer();
        oebps.file(`images/cover.${coverExt}`, coverArrBuf);
        oebps.file('cover.xhtml', coverXhtml(`images/cover.${coverExt}`));
        hasCover = true;
      }
      
      const processedChapters = [];
      const allEmbeddedImages = [];
      
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const htmlContent = md.render(chapter.content);
        const sanitizedHtml = DOMPurify.sanitize(htmlContent, { USE_PROFILES: { html: true } });
        
        const { html: finalHtml, images: embeddedImages } = await extractAndEmbedImages(sanitizedHtml);
        
        processedChapters.push({
          ...chapter,
          html: finalHtml,
          filename: `chapter${i + 1}.xhtml`,
        });
        
        allEmbeddedImages.push(...embeddedImages);
      }
      
      const imagesFolder = oebps.folder('images');
      for (const img of allEmbeddedImages) {
        const binaryData = Uint8Array.from(atob(img.data), c => c.charCodeAt(0));
        imagesFolder.file(img.filename, binaryData);
      }
      
      for (const chapter of processedChapters) {
        oebps.file(chapter.filename, wrapXhtml(chapter.html, chapter.title));
      }
      
      oebps.file('toc.xhtml', tocXhtml(title, processedChapters));
      
      const uid = `urn:uuid:${cryptoRandomUuid()}`;
      
      const ncx = tocNcx(title, author, uid, processedChapters);
      oebps.file('toc.ncx', ncx);
      
      const opf = contentOpf({
        title,
        author,
        description,
        source,
        pubDate,
        hasCover,
        chapters: processedChapters,
        images: allEmbeddedImages,
        uid: uid,
      });
      oebps.file('content.opf', opf);
      
      const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
      
      // Wysyłka ePub przez Cloudflare Worker
const formData = new FormData();
formData.append('epub', epubBlob, `${safeFilename(bookTitle)}.epub`);
formData.append('userEmail', userEmail);
formData.append('kindleEmail', kindleEmail);
formData.append('bookTitle', bookTitle);

const response = await fetch(`${PROXY_BASE_URL}/send-to-kindle`, {
  method: 'POST',
  body: formData,
});

const result = await response.json();

if (!response.ok) {
  throw new Error(result.error || 'Nie udało się wysłać emaila');
}

// Sukces!
document.getElementById('sendKindleLoader').classList.add('d-none');
document.getElementById('sendKindleSuccess').classList.remove('d-none');

console.log('✅ ePub wysłany na Kindle:', result.messageId);
      
    } catch (error) {
      console.error('Błąd wysyłki:', error);
      document.getElementById('sendKindleLoader').classList.add('d-none');
      document.getElementById('sendKindleError').classList.remove('d-none');
      document.getElementById('sendKindleErrorMsg').textContent = error.message;
    } finally {
      document.getElementById('sendKindleSubmitBtn').disabled = false;
    }
  });
});