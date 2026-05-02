// ── Resume Studio — main.js (Ollama local AI, no API key needed) ──

const OLLAMA_URL = 'http://localhost:11434';
const MODEL      = 'llama3.2';

const doc        = document.getElementById('resume-doc');
const overlay    = document.getElementById('ai-overlay');
const overlayMsg = document.getElementById('overlay-msg');
const statusBar  = document.getElementById('toolbar-status');

// ──────────────────────────────────────────
// STARTUP — check if Ollama is already live
// ──────────────────────────────────────────
(async () => {
  const alive = await pingOllama();
  if (alive) {
    hidModal();
    updateStatusDot(true);
    startPolling();
  }
  // else: modal stays visible
})();

async function pingOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

window.checkOllamaAndProceed = async function () {
  const statusEl = document.getElementById('check-status');
  statusEl.className = 'check-status';
  statusEl.textContent = 'Checking connection...';

  const alive = await pingOllama();
  if (alive) {
    // Check if the model exists
    const hasModel = await checkModel();
    if (!hasModel) {
      statusEl.className = 'check-status error';
      statusEl.textContent = `Model "${MODEL}" not found — make sure the script finished fully.`;
      return;
    }
    statusEl.className = 'check-status ok';
    statusEl.textContent = 'Connected! Loading app...';
    setTimeout(() => { hidModal(); updateStatusDot(true); startPolling(); }, 800);
  } else {
    statusEl.className = 'check-status error';
    statusEl.textContent = 'Cannot reach Ollama — run the setup script first, then try again.';
  }
}

async function checkModel() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();
    return (data.models || []).some(m => m.name.startsWith(MODEL));
  } catch { return false; }
}

function hidModal() {
  document.getElementById('setup-modal').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

function copyCmd() {
  navigator.clipboard.writeText('bash setup.sh').then(() => {
    const btn = document.querySelector('.copy-cmd');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

// Live status dot — poll every 8s
function startPolling() {
  setInterval(async () => {
    updateStatusDot(await pingOllama());
  }, 8000);
}

function updateStatusDot(online) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className  = 'status-dot ' + (online ? 'online' : 'offline');
  text.textContent = online ? `Ollama · ${MODEL}` : 'Ollama offline';
}


// ──────────────────────────────────────────
// FILE UPLOAD
// ──────────────────────────────────────────
document.getElementById('upload-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showOverlay('Reading your file...');
  try {
    let text = '';
    if (file.type === 'text/plain') {
      text = await file.text();
    } else if (file.type === 'application/pdf') {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });

        // Sort items top-to-bottom, left-to-right using their transform positions
        const items = content.items
          .filter(it => it.str && it.str.trim())
          .map(it => ({
            str: it.str,
            x: it.transform[4],
            y: viewport.height - it.transform[5], // flip Y so top=0
            h: Math.abs(it.height) || 10,
            w: it.width
          }))
          .sort((a, b) => {
            // Group into lines: items within ~half a line-height are on the same line
            const lineThreshold = Math.min(a.h, b.h) * 0.6;
            if (Math.abs(a.y - b.y) < lineThreshold) return a.x - b.x;
            return a.y - b.y;
          });

        // Build text by detecting line breaks and word spacing
        let pageText = '';
        let prevItem = null;
        for (const item of items) {
          if (!prevItem) {
            pageText += item.str;
          } else {
            const sameLineThreshold = Math.min(item.h, prevItem.h) * 0.6;
            const onSameLine = Math.abs(item.y - prevItem.y) < sameLineThreshold;

            if (onSameLine) {
              // Check horizontal gap — insert space if items are not already adjacent
              const gap = item.x - (prevItem.x + prevItem.w);
              const spaceWidth = prevItem.h * 0.3; // approximate space width
              if (gap > spaceWidth) {
                pageText += ' ' + item.str;
              } else if (gap > -2) {
                pageText += item.str;
              } else {
                pageText += ' ' + item.str;
              }
            } else {
              // New line — use double newline for big vertical gaps (section breaks)
              const vertGap = item.y - prevItem.y;
              pageText += (vertGap > prevItem.h * 1.8 ? '\n\n' : '\n') + item.str;
            }
          }
          prevItem = item;
        }
        text += pageText + '\n\n';
      }
      // Clean up: remove repeated spaces, fix ligatures/common pdf artifacts
      text = text
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff')
        .replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/ﬅ/g, 'st')
        .replace(/\u2019/g, "'").replace(/\u2018/g, "'")
        .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
        .replace(/\u2013/g, '-').replace(/\u2014/g, '--')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .trim();
    }
    await parseAndRenderWithAI(text);
  } catch (err) {
    hideOverlay();
    setStatus('Error reading file — try again');
    console.error(err);
  }
  e.target.value = '';
});


// ──────────────────────────────────────────
// LINKEDIN → RESUME
// ──────────────────────────────────────────
async function generateFromLinkedin() {
  const input = document.getElementById('linkedin-input').value.trim();
  if (!input) return alert('Please paste your LinkedIn profile text first.');
  showOverlay('Generating resume with local AI...');

  const prompt = `You are a professional resume writer. Convert this LinkedIn profile text into a Jake-style resume HTML.

REQUIRED HTML — use ONLY these exact tags and classes:
<h1>Full Name</h1>
<div class="contact-line">email · phone · LinkedIn · Location</div>
<h2>Education</h2>
<div class="job-header"><span class="job-title">University Name</span><span class="job-date">Aug 2018 – May 2022</span></div>
<div class="company"><span>B.S. Computer Science</span><span>City, ST</span></div>
<h2>Experience</h2>
<div class="job-header"><span class="job-title">Software Engineer</span><span class="job-date">Jun 2022 – Present</span></div>
<div class="company"><span>Company Name</span><span>City, ST</span></div>
<ul><li>Past-tense action verb + what you did + result/impact</li></ul>
<h2>Projects</h2>
<div class="job-header"><span class="job-title">Project Name</span><span class="job-date">Jan 2023</span></div>
<div class="company"><span>Tech stack used</span><span></span></div>
<ul><li>What it does and how you built it</li></ul>
<h2>Technical Skills</h2>
<div class="skills-grid">
  <span class="skill-pill">Python</span><span class="skill-pill">JavaScript</span><span class="skill-pill">React</span>
</div>
Skills render as plain comma-separated text — no chips, no borders. Each category can be a separate line like:
<p><strong>Languages:</strong> <span class="skill-pill">Python</span><span class="skill-pill">Java</span></p>

RULES:
- No summary/objective section — Jake resumes start with Education or Experience
- Skills are plain comma-separated .skill-pill spans — no chips, no borders
- Every bullet starts with a past-tense action verb
- Return ONLY the HTML. No explanation. No markdown fences.

LINKEDIN TEXT:
${input}`;

  await streamToDoc(prompt);
  setStatus('Resume generated — edit freely or check ATS score');
}


// ──────────────────────────────────────────
// ATS SCORE
// ──────────────────────────────────────────

// Stored after each ATS analysis — used by Polish & Improve
let lastATSResult = null;
let lastJobDescription = '';

async function checkATS() {
  const jd  = document.getElementById('jd-input').value.trim();
  const txt = doc.innerText.trim();
  if (!jd)  return alert('Please paste a job description first.');
  if (!txt || txt.includes('Your resume will appear')) return alert('Add resume content first.');

  showOverlay('Analyzing ATS compatibility...');
  setStatus('Analyzing… this may take up to 60 seconds');

  // Ask the model for plain structured text — no JSON, no schema confusion
  const prompt = `You are an ATS expert. Compare this resume to the job description.

Reply in this EXACT format, filling in real values — nothing else:
SCORE: [number between 0 and 100]
GRADE: [one of: Weak, Fair, Good, Strong, Excellent]
SUMMARY: [one sentence]
TIP1: [specific improvement]
TIP2: [specific improvement]
TIP3: [specific improvement]

RESUME:
${txt.slice(0, 2500)}

JOB DESCRIPTION:
${jd.slice(0, 1500)}`;

  try {
    const raw = await callOllama(prompt);
    console.log('[ATS raw]', raw);

    const result = extractATSFields(raw);
    if (isNaN(result.score)) throw new Error('Could not find a score in the response');
    if (result.tips.length === 0) result.tips = ['Run again for more detailed tips'];

    lastATSResult = result;
    lastJobDescription = jd;
    renderScore(result);
    setStatus('ATS analysis complete — click "Polish & Improve" to fix the issues');
  } catch (e) {
    if (e.name === 'AbortError') {
      setStatus('ATS analysis timed out — try again');
      alert('The AI took too long to respond. Try again.');
    } else {
      setStatus('ATS analysis failed — try again');
      alert('Could not parse ATS result. Try again.\n\nDetail: ' + e.message);
    }
    console.error('ATS error:', e);
  }
  hideOverlay();
}

function renderScore(data) {
  const pct    = Math.round(Math.min(100, Math.max(0, data.score)));
  const circ   = 2 * Math.PI * 20;
  const offset = circ - (pct / 100) * circ;

  document.getElementById('score-arc').style.strokeDashoffset = offset;
  document.getElementById('score-num').textContent  = pct + '%';
  document.getElementById('score-grade').textContent = data.grade   || '—';
  document.getElementById('score-sub').textContent   = data.summary || '';

  const list = document.getElementById('tips-list');
  list.innerHTML = (data.tips || []).map(t => `<li>${t}</li>`).join('');
  document.getElementById('score-section').style.display = 'block';
}


// ──────────────────────────────────────────
// POLISH & IMPROVE
// ──────────────────────────────────────────
async function improveWithAI() {
  const currentHTML = doc.innerHTML.trim();
  const txt = doc.innerText.trim();
  if (!txt || txt.includes('Your resume will appear')) return alert('Add resume content first.');

  const hasATS = lastATSResult && lastATSResult.tips && lastATSResult.tips.length > 0;
  showOverlay(hasATS ? 'Improving based on ATS feedback...' : 'Polishing your resume...');

  const htmlGuide = `REQUIRED HTML — use ONLY these exact tags and classes:
<h1>Full Name</h1>
<div class="contact-line">email · phone · LinkedIn · Location</div>
<h2>Education</h2>
<div class="job-header"><span class="job-title">University Name</span><span class="job-date">Aug 2018 – May 2022</span></div>
<div class="company"><span>B.S. Computer Science</span><span>City, ST</span></div>
<h2>Experience</h2>
<div class="job-header"><span class="job-title">Software Engineer</span><span class="job-date">Jun 2022 – Present</span></div>
<div class="company"><span>Company Name</span><span>City, ST</span></div>
<ul><li>Past-tense action verb + what you did + result/impact</li></ul>
<h2>Projects</h2>
<div class="job-header"><span class="job-title">Project Name</span><span class="job-date">Jan 2023</span></div>
<div class="company"><span>Tech stack used</span><span></span></div>
<ul><li>What it does and how you built it</li></ul>
<h2>Technical Skills</h2>
<div class="skills-grid">
  <span class="skill-pill">Python</span><span class="skill-pill">JavaScript</span><span class="skill-pill">React</span>
</div>
Skills render as plain comma-separated text — no chips, no borders. Each category can be a separate line like:
<p><strong>Languages:</strong> <span class="skill-pill">Python</span><span class="skill-pill">Java</span></p>`;

  let prompt;

  if (hasATS) {
    const tipsBlock = lastATSResult.tips.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const jdSnippet = lastJobDescription ? `\n\nTARGET JOB DESCRIPTION:\n${lastJobDescription.slice(0, 1000)}` : '';

    prompt = `You are a professional resume coach. Rewrite the resume HTML below, improving it to address the ATS feedback.

ATS SCORE: ${lastATSResult.score}/100 (${lastATSResult.grade})
ISSUES TO FIX:
${tipsBlock}

RULES:
- Only improve wording, keywords, and bullet strength — keep all real facts
- Add missing keywords from the job description into bullets or skills naturally
- Start every bullet with a strong past-tense verb (Led, Built, Drove, Reduced, Increased)
- Quantify achievements where possible (%, $, numbers)
- Do NOT invent anything not already in the resume
- Return the COMPLETE resume HTML — every section, every job, every bullet${jdSnippet}

${htmlGuide}

Return ONLY the improved HTML. No explanation. No markdown fences. Do not truncate.

CURRENT RESUME HTML:
${currentHTML.slice(0, 4000)}`;

  } else {
    prompt = `You are a professional resume coach. Rewrite the resume HTML below with stronger language.

RULES:
- Start every bullet with a strong past-tense verb (Led, Built, Drove, Reduced, Increased, Delivered)
- Add quantified achievements where possible (%, $, numbers, timeframes)
- Cut filler words and passive voice
- Keep ALL real information — do not remove or invent anything
- Return the COMPLETE resume HTML — every section, every job, every bullet

${htmlGuide}

Return ONLY the improved HTML. No explanation. No markdown fences. Do not truncate.

CURRENT RESUME HTML:
${currentHTML.slice(0, 4000)}`;
  }

  await streamToDoc(prompt);

  if (hasATS) {
    setStatus('Resume improved — re-run ATS Score to see the difference');
  } else {
    setStatus('Resume polished — paste a job description and run ATS Score for targeted improvements');
  }
}


// ──────────────────────────────────────────
// JAKE RESUME FORMAT
// ──────────────────────────────────────────
async function formatJakeStyle() {
  const currentHTML = doc.innerHTML.trim();
  const txt = doc.innerText.trim();
  if (!txt || txt.includes('Your resume will appear')) return alert('Add resume content first.');
  showOverlay('Reformatting to Jake resume style...');

  const prompt = `You are a resume formatter. Reformat the resume HTML below into the clean Jake-style resume format.

RULES:
- Name centered at top, contact line centered below it
- Section headings: EXPERIENCE, EDUCATION, PROJECTS, TECHNICAL SKILLS (all caps)
- Every bullet starts with a strong past-tense action verb
- Dates right-aligned on same line as job title
- Company name italic, location right-aligned on same line
- NO chips, NO badges, NO bordered tags for skills — skills are plain comma-separated text using .skill-pill spans
- Group skills by category using a <p> with a <strong> label if categories exist
- Keep ALL content — do not drop any job, bullet, or section
- Return COMPLETE HTML — do not truncate

REQUIRED HTML — use ONLY these exact tags and classes:
<h1>Full Name</h1>
<div class="contact-line">email · phone · LinkedIn · Location</div>
<h2>Education</h2>
<div class="job-header"><span class="job-title">University Name</span><span class="job-date">Aug 2018 – May 2022</span></div>
<div class="company"><span>B.S. Computer Science</span><span>City, ST</span></div>
<h2>Experience</h2>
<div class="job-header"><span class="job-title">Software Engineer</span><span class="job-date">Jun 2022 – Present</span></div>
<div class="company"><span>Company Name</span><span>City, ST</span></div>
<ul><li>Past-tense action verb + what you did + result/impact</li></ul>
<h2>Projects</h2>
<div class="job-header"><span class="job-title">Project Name</span><span class="job-date">Jan 2023</span></div>
<div class="company"><span>Tech stack used</span><span></span></div>
<ul><li>What it does and how you built it</li></ul>
<h2>Technical Skills</h2>
<div class="skills-grid">
  <span class="skill-pill">Python</span><span class="skill-pill">JavaScript</span><span class="skill-pill">React</span>
</div>
Skills render as plain comma-separated text — no chips, no borders. Each category can be a separate line like:
<p><strong>Languages:</strong> <span class="skill-pill">Python</span><span class="skill-pill">Java</span></p>

Return ONLY the HTML. No explanation. No markdown fences.

CURRENT RESUME HTML:
${currentHTML.slice(0, 4000)}`;

  await streamToDoc(prompt);
  setStatus('Reformatted to Jake style');
}


// ──────────────────────────────────────────
// CORE AI HELPERS
// ──────────────────────────────────────────
async function parseAndRenderWithAI(text) {
  const prompt = `You are a resume formatter. Convert the resume text below into clean Jake-style resume HTML.

REQUIRED HTML — use ONLY these exact tags and classes:
<h1>Full Name</h1>
<div class="contact-line">email · phone · LinkedIn · Location</div>
<h2>Education</h2>
<div class="job-header"><span class="job-title">University Name</span><span class="job-date">Aug 2018 – May 2022</span></div>
<div class="company"><span>B.S. Computer Science</span><span>City, ST</span></div>
<h2>Experience</h2>
<div class="job-header"><span class="job-title">Software Engineer</span><span class="job-date">Jun 2022 – Present</span></div>
<div class="company"><span>Company Name</span><span>City, ST</span></div>
<ul><li>Past-tense action verb + what you did + result/impact</li></ul>
<h2>Projects</h2>
<div class="job-header"><span class="job-title">Project Name</span><span class="job-date">Jan 2023</span></div>
<div class="company"><span>Tech stack used</span><span></span></div>
<ul><li>What it does and how you built it</li></ul>
<h2>Technical Skills</h2>
<div class="skills-grid">
  <span class="skill-pill">Python</span><span class="skill-pill">JavaScript</span><span class="skill-pill">React</span>
</div>
Skills render as plain comma-separated text — no chips, no borders. Each category can be a separate line like:
<p><strong>Languages:</strong> <span class="skill-pill">Python</span><span class="skill-pill">Java</span></p>

RULES:
- Skills are plain comma-separated .skill-pill spans — no chips, no borders
- Every bullet starts with a past-tense action verb
- Dates right-aligned on same line as title
- Company italic, location right-aligned on same line
- Return COMPLETE HTML. No explanation. No markdown fences.

RESUME TEXT:
${text.slice(0, 3000)}`;

  await streamToDoc(prompt);
  setStatus('Resume loaded — edit freely or run an ATS check');
}

// Streaming render — tokens appear as they arrive
async function streamToDoc(prompt) {
  hidePlaceholder();
  doc.innerHTML = '<span class="streaming-dot"></span>';

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: true })
    });

    hideOverlay();

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

    let html = '';
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Ollama streams newline-delimited JSON objects
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.response) { html += obj.response; doc.innerHTML = html; }
          if (obj.done) break;
        } catch (_) {}
      }
    }
  } catch (err) {
    hideOverlay();
    doc.innerHTML = `<p style="color:#aaa;padding:20px;text-align:center">
      Could not reach Ollama: ${err.message}.<br>
      Make sure <code>ollama serve</code> is running.
    </p>`;
    updateStatusDot(false);
    console.error(err);
  }
}

// Extract ATS fields — handles JSON (complete or truncated) and plain text
function extractATSFields(raw) {
  const str = raw.replace(/```json|```/gi, '').trim();
  console.log('[extractATSFields input]', str);

  // Strategy 1: valid complete JSON
  try {
    const start = str.indexOf('{');
    const end   = str.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(str.slice(start, end + 1));
      if (typeof parsed.score === 'number') {
        console.log('[ATS] parsed via JSON', parsed);
        return {
          score:   parsed.score,
          grade:   parsed.grade   || '—',
          summary: parsed.summary || '',
          tips:    Array.isArray(parsed.tips) ? parsed.tips : []
        };
      }
    }
  } catch (_) {}

  // Strategy 2: truncated JSON — extract field by field with regex
  console.log('[ATS] falling back to regex extraction');

  const scoreM = str.match(/"score"\s*:\s*(\d+)/i) || str.match(/SCORE:\s*(\d+)/i);
  const score  = scoreM ? parseInt(scoreM[1], 10) : NaN;

  const gradeM = str.match(/"grade"\s*:\s*"([^"]+)"/i) || str.match(/GRADE:\s*(\w+)/i);
  const grade  = gradeM ? gradeM[1].trim() : '—';

  const sumM   = str.match(/"summary"\s*:\s*"([^"]+)"/i) || str.match(/SUMMARY:\s*(.+)/i);
  const summary = sumM ? sumM[1].trim() : '';

  // Pull all quoted strings from tips array (even if truncated)
  const tips = [];
  const tipsIdx = str.indexOf('"tips"');
  if (tipsIdx !== -1) {
    const after = str.slice(tipsIdx);
    const matches = [...after.matchAll(/"([^"]{15,})"/g)];
    // skip the key "tips" itself
    matches.forEach(m => { if (m[1] !== 'tips') tips.push(m[1].trim()); });
  }
  // fallback: TIP1 / TIP2 lines
  if (tips.length === 0) {
    const tipLines = str.match(/TIP\d:\s*(.+)/gi) || [];
    tipLines.forEach(t => { const m = t.match(/TIP\d:\s*(.+)/i); if (m) tips.push(m[1].trim()); });
  }

  console.log('[ATS] regex result', { score, grade, summary, tips });
  return { score, grade, summary, tips };
}

// Streaming-based — captures full response reliably even for slow models
async function callOllama(prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt, stream: true, num_predict: 512 }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

      let full = '';
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.response) full += obj.response;
          } catch (_) {}
        }
      }

      console.log('[Ollama raw]', full);
      return full;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}


// ──────────────────────────────────────────
// UI UTILITIES
// ──────────────────────────────────────────
function showOverlay(msg) { overlayMsg.textContent = msg; overlay.classList.add('active'); }
function hideOverlay()    { overlay.classList.remove('active'); }
function setStatus(msg)   { statusBar.textContent = msg; }

function hidePlaceholder() {
  const ph = document.getElementById('placeholder');
  if (ph) ph.remove();
}

function clearDoc() {
  doc.innerHTML = `<div class="placeholder-msg" id="placeholder">
    <div class="icon">📄</div>
    <p>Your resume will appear here</p>
    <em>Upload a file, paste LinkedIn text, or use the actions on the left</em>
  </div>`;
  document.getElementById('score-section').style.display = 'none';
  lastATSResult = null;
  lastJobDescription = '';
  setStatus('Start by uploading a resume or pasting LinkedIn text');
}

function copyText(e) {
  navigator.clipboard.writeText(doc.innerText).then(() => {
    const btn = e.target;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

function downloadPDF() {
  const source = document.getElementById('resume-doc');

  // Clone into a clean off-screen container with no app chrome
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    'width:210mm', 'background:#fff', 'z-index:-1'
  ].join(';');

  const clone = source.cloneNode(true);
  clone.style.cssText = [
    'width:210mm', 'min-height:297mm',
    'padding:15mm 18mm',
    'margin:0', 'border:none', 'border-radius:0', 'box-shadow:none',
    'font-family:"Times New Roman",Times,serif',
    'font-size:11pt', 'line-height:1.35', 'color:#000', 'background:#fff',
    'box-sizing:border-box'
  ].join(';');

  // Fix inline styles on child elements that might conflict
  clone.querySelectorAll('*').forEach(el => {
    el.style.fontFamily = '';   // let inherited Times New Roman apply
    el.style.boxShadow  = 'none';
    el.style.borderRadius = '0';
  });

  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  const opt = {
    margin: 0,
    filename: 'resume.pdf',
    image:      { type: 'jpeg', quality: 0.99 },
    html2canvas: { scale: 3, useCORS: true, letterRendering: true, logging: false },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(wrap).save().then(() => {
    document.body.removeChild(wrap);
  });
}