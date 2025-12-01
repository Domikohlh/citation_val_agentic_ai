// === CONFIGURATION ===
// ⚠️ IMPORTANT: Ensure this URL ends in '/validate'
const ENDPOINT_URL = 'https://undeprecatively-unpunctuated-kara.ngrok-free.dev/validate'; 
const UI_SIDEBAR_TITLE = 'Research Assistant';

// === MENU SETUP ===
function onOpen() {
  DocumentApp.getUi()
    .createMenu('CiVa- Research Validator')
    .addItem('⚙️ Set/Reset Drive Folder', 'resetFolderId')
    .addSeparator()
    .addItem('1. 📂 Sync & Audit Library (Librarian)', 'runLibrarianSync') 
    .addItem('2. ✅ Bulk Validate References (Validator)', 'validateReferenceList')
    .addItem('   ↳ 🔬 Deep Validate Selection (Single Item)', 'validateSelection')
    .addSeparator()
    .addItem('3. 🔎 Run Tracer Agent (Tracer)', 'startTracerAgent') 
    .addSeparator()
    .addItem('Clear Highlights', 'clearValidationColors')
    .addToUi();
}

// ==========================================
// ROBUST FETCH HELPER (With Logging)
// ==========================================
function fetchJson(url, options) {
  let response;
  try {
    // Log where we are connecting to
    console.log(`📡 Connecting to: ${url}`);
    
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    // This catches network errors (404, 500, DNS fail)
    console.error(`❌ Network Error: ${e.message}`);
    
    // If the server sent a text body with the 404/500, try to show it
    // (Google wraps the error, but sometimes the message is inside)
    throw new Error(`Server Connection Failed. Check Execution Logs. Error: ${e.message}`);
  }

  const text = response.getContentText();
  
  // Try to parse JSON
  try {
    return JSON.parse(text);
  } catch (e) {
    // LOG THE FULL RESPONSE TO THE CONSOLE
    console.error(`❌ Invalid JSON received. Raw Body:\n${text}`);
    
    // Throw a cleaner error for the UI, but keep the raw text in the logs
    throw new Error(`Server returned Text instead of JSON.\n\nFirst 100 chars: "${text.substring(0, 100)}..."\n\n(See View > Executions for full log)`);
  }
}

// ==========================================
// 0. MEMORY HELPER: SESSION-AWARE MANAGEMENT
// ==========================================
function getOrPromptFolderId() {
  const userProperties = PropertiesService.getUserProperties(); // Persistent Store
  const userCache = CacheService.getUserCache(); // Temporary Session Store
  const ui = DocumentApp.getUi();

  // 1. CHECK SESSION CACHE (Short Term Memory)
  // If found here, the user has already confirmed the folder in this session.
  // We return immediately without bothering them.
  const cachedId = userCache.get('SESSION_FOLDER_ID');
  if (cachedId) {
    return cachedId;
  }

  // 2. CHECK SAVED PROPERTY (Long Term Memory)
  const savedId = userProperties.getProperty('DRIVE_FOLDER_ID');

  if (savedId) {
    // We found an ID, but it's not in the Cache. This means it's a "New Session".
    // We ask the user ONE time to confirm.
    const response = ui.alert(
      'Resume Session?',
      `I found a saved Google Drive Folder from your last use.\n\nFolder ID: ${savedId}\n\nDo you want to use this folder?`,
      ui.ButtonSet.YES_NO
    );

    if (response === ui.Button.YES) {
      // User confirmed. Save to Cache for 6 hours (21600 seconds).
      // The script will now run silently until the cache expires or is reset.
      userCache.put('SESSION_FOLDER_ID', savedId, 21600); 
      return savedId;
    }
    // If NO, we fall through to the prompt below to enter a new one.
  }

  // 3. PROMPT FOR NEW (If no memory, or user said NO)
  const prompt = ui.prompt(
    'Connect Reference Library',
    'Please paste the Link (URL) or ID of the Google Drive folder containing your PDFs:',
    ui.ButtonSet.OK_CANCEL
  );

  if (prompt.getSelectedButton() !== ui.Button.OK) return null;
  
  let folderInput = prompt.getResponseText().trim();
  const match = folderInput.match(/folders\/([\w-]+)/);
  if (match) folderInput = match[1];

  // 4. SAVE (To Both Memories)
  if (folderInput) {
    // Save permanently for next time
    userProperties.setProperty('DRIVE_FOLDER_ID', folderInput);
    // Save temporarily so we don't ask again today
    userCache.put('SESSION_FOLDER_ID', folderInput, 21600); 
    
    ui.alert('✅ Connected', 'Folder saved! You won\'t be asked again during this session.', ui.ButtonSet.OK);
  }
  
  return folderInput;
}

function resetFolderId() {
  // Clear both Long Term and Short Term memory
  PropertiesService.getUserProperties().deleteProperty('DRIVE_FOLDER_ID');
  CacheService.getUserCache().remove('SESSION_FOLDER_ID');
  
  const ui = DocumentApp.getUi();
  ui.alert('Memory Cleared', 'The saved Folder ID has been removed. You will be prompted to enter a new one next time.', ui.ButtonSet.OK);
}

// ==========================================
// 1. LIBRARIAN AGENT (Sync & Audit)
// ==========================================
function runLibrarianSync() {
  const ui = DocumentApp.getUi();
  const doc = DocumentApp.getActiveDocument();
  const bodyText = doc.getBody().getText();
  // Auto-detect reference list at end of doc
  const refText = bodyText.substring(Math.max(0, bodyText.length - 5000)); 

  const folderId = getOrPromptFolderId();
  if (!folderId) return;

  showSidebar("⏳ Librarian is scanning your Drive and auditing PDFs...<br>This checks for missing files and valid content.");

  try {
    const SYNC_URL = ENDPOINT_URL.replace('/validate', '/librarian_sync');
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ 
        folderId: folderId,
        referenceText: refText
      }),
      muteHttpExceptions: true
    };

    const result = fetchJson(SYNC_URL, options);
    showAuditReport(result);

  } catch (e) {
    ui.alert("Sync Error", e.toString(), ui.ButtonSet.OK);
    hideSidebar();
  }
}

function showAuditReport(report) {
  let invalidHtml = '';
  if (report.invalid_pdfs && report.invalid_pdfs.length > 0) {
    invalidHtml = `<h4 style="color:#d93025; margin-bottom:5px;">⛔ Invalid / Empty PDFs</h4><ul style="margin-top:0;">`;
    report.invalid_pdfs.forEach(f => invalidHtml += `<li>${f}</li>`);
    invalidHtml += `</ul>`;
  }

  let missingHtml = '';
  if (report.missing_references && report.missing_references.length > 0) {
    missingHtml = `<h4 style="color:#e37400; margin-bottom:5px;">⚠️ Missing PDFs for:</h4><ul style="margin-top:0;">`;
    report.missing_references.forEach(r => missingHtml += `<li style="margin-bottom:5px; font-size:0.9em;">${r.substring(0,80)}...</li>`);
    missingHtml += `</ul>`;
  } else {
    missingHtml = `<div style="background:#e6f4ea; padding:10px; border-radius:5px; color:#188038; font-weight:bold;">✅ All References Covered!</div>`;
  }

  const html = HtmlService.createHtmlOutput(`
    <div style="font-family: sans-serif; padding: 15px;">
      <h3>📚 Library Audit Report</h3>
      <p><b>Valid PDFs Indexed:</b> ${report.valid_pdfs ? report.valid_pdfs.length : 0}</p>
      <hr>
      ${missingHtml}
      ${invalidHtml}
      <br><button onclick="google.script.host.close()" style="cursor:pointer; padding:8px 16px; background:#1a73e8; color:white; border:none; border-radius:4px;">Close</button>
    </div>
  `).setWidth(500).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, 'Librarian Audit');
  hideSidebar();
}

// ==========================================
// 2. VALIDATOR AGENT (Deep & Bulk)
// ==========================================

// --- DEEP VALIDATION (SINGLE) ---
function validateSelection() {
  const doc = DocumentApp.getActiveDocument();
  const ui = DocumentApp.getUi();
  const selection = doc.getSelection();

  if (!selection) {
    ui.alert('No text selected!', 'Please highlight a specific reference to validate.', ui.ButtonSet.OK);
    return;
  }

  let fullText = "";
  const ranges = selection.getRangeElements();
  ranges.forEach(range => {
    const el = range.getElement();
    if (el.editAsText) fullText += el.asText().getText(); 
  });
  fullText = fullText.trim();

  if (fullText.length < 10) return;

  showSidebar("🔬 Deep Validating...<br>Analysing claims, checking web sources, and verifying facts.");

  try {
    const result = callBackend(fullText); 
    
    if (result.error) {
      ui.alert('Error', result.error, ui.ButtonSet.OK);
      hideSidebar();
      return;
    }

    const color = result.verified ? '#006400' : (result.is_hallucination ? '#CC0000' : '#FF8800');
    ranges.forEach(range => {
       const el = range.getElement();
       if (el.editAsText) el.asText().setForegroundColor(color);
    });

    showDeepReport(result, fullText);

  } catch (e) {
    ui.alert('Connection Failed', e.toString(), ui.ButtonSet.OK);
    hideSidebar();
  }
}

function showDeepReport(result, citation) {
  const statusColor = result.verified ? '#006400' : (result.is_hallucination ? '#d93025' : '#e37400');
  const statusText = result.verified ? 'VERIFIED' : (result.is_hallucination ? 'FALSE CLAIM' : 'UNCERTAIN');
  
  let sourcesHtml = '<p>No specific sources returned.</p>';
  if (result.suggested_citations && result.suggested_citations.length > 0) {
    sourcesHtml = '<ul style="margin-top:0; padding-left:20px;">';
    result.suggested_citations.forEach(s => {
      sourcesHtml += `<li><a href="${s.url}" target="_blank">${s.title || 'Source Link'}</a><br><span style="font-size:0.85em; color:#666;">${s.snippet || ''}</span></li>`;
    });
    sourcesHtml += '</ul>';
  }

  const html = HtmlService.createHtmlOutput(`
    <div style="font-family: 'Google Sans', sans-serif; padding: 20px;">
      <h2 style="color:${statusColor}; margin-top:0;">${statusText}</h2>
      <div style="background:#f9f9f9; padding:10px; border-radius:5px; border-left:4px solid #ccc; margin-bottom:15px;">
        <i>"${citation}"</i>
      </div>
      <h3>🧠 AI Analysis</h3>
      <p style="white-space: pre-wrap;">${result.analysis}</p>
      <h3>🌐 Verified Sources</h3>
      ${sourcesHtml}
      <br>
      <button onclick="google.script.host.close()" style="background:#1a73e8; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Close Report</button>
    </div>
  `).setWidth(600).setHeight(700);

  DocumentApp.getUi().showModalDialog(html, 'Deep Validation Report');
  hideSidebar();
}

// --- BULK VALIDATION (LIST) ---
function validateReferenceList() {
  const ui = DocumentApp.getUi();
  const selection = DocumentApp.getActiveDocument().getSelection();

  if (!selection) {
    ui.alert('No text selected!', 'Please highlight the entire reference list.', ui.ButtonSet.OK);
    return;
  }

  let fullTextParts = [];
  let citationElements = [];
  const selectedRanges = selection.getRangeElements();

  selectedRanges.forEach(rangeElement => {
    const element = rangeElement.getElement();
    if (element.getType() === DocumentApp.ElementType.PARAGRAPH || element.getType() === DocumentApp.ElementType.LIST_ITEM) {
      const textElement = element.asText();
      const text = textElement.getText().trim();
      textElement.setForegroundColor(null); 
      if (text.length > 0) {
        fullTextParts.push(text);
        citationElements.push({ textElement, start: 0, end: text.length - 1 });
      }
    }
  });

  if (fullTextParts.length === 0) return;
  const citations = fullTextParts;
  
  showSidebar(`🚀 Validating ${citations.length} citations...`);
  
  let validationResults = [];
  const BATCH_SIZE = 5; 
  const batches = [];
  for (let i = 0; i < citations.length; i += BATCH_SIZE) {
    batches.push(citations.slice(i, i + BATCH_SIZE));
  }

  let processed = 0;

  try {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const requests = batch.map((citation) => ({
        url: ENDPOINT_URL, 
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ text: citation }), 
        muteHttpExceptions: true
      }));
      
      const responses = UrlFetchApp.fetchAll(requests);

      responses.forEach((response, idx) => {
        processed++;
        const result = JSON.parse(response.getContentText());
        const globalIdx = (b * BATCH_SIZE) + idx;
        const elementInfo = citationElements[globalIdx];

        let status = 'UNCERTAIN', color = '#FF8800';
        if (result.verified) { status = 'VERIFIED'; color = '#006400'; }
        else if (result.is_hallucination) { status = 'FALSE CLAIM'; color = '#CC0000'; }

        if (elementInfo) elementInfo.textElement.setForegroundColor(elementInfo.start, elementInfo.end, color);

        validationResults.push({
          citation: citations[globalIdx],
          status: status,
          analysis: result.analysis
        });
        
        updateSidebarProgress(processed, citations.length, `Validated: ${citations[globalIdx].substring(0, 30)}...`);
      });
    }
  } catch (e) {
    ui.alert("Validation Error", e.toString(), ui.ButtonSet.OK);
    return;
  }

  hideSidebar();
  showValidatorReport(validationResults, citations.length);
}

function showValidatorReport(results, total) {
  let htmlItems = '';
  let stats = { verified: 0, false: 0 };

  results.forEach((item, idx) => {
    if(item.status.includes('VERIFIED')) stats.verified++;
    if(item.status.includes('FALSE')) stats.false++;
    const color = item.status.includes('VERIFIED') ? '#006400' : (item.status.includes('FALSE') ? '#d93025' : '#e37400');
    
    htmlItems += `
      <div style="border:1px solid #eee; padding:10px; margin-bottom:10px; border-radius:5px; background:white;">
        <div style="color:${color}; font-weight:bold;">${idx+1}. ${item.status}</div>
        <div style="font-size:0.85em; color:#555; margin:5px 0;">${item.citation.substring(0,80)}...</div>
        <div style="background:#f9f9f9; padding:5px; font-size:0.9em;">${item.analysis}</div>
      </div>
    `;
  });

  const html = HtmlService.createHtmlOutput(`
    <div style="font-family:sans-serif; padding:15px;">
      <h3>Validation Results</h3>
      <p><b>${stats.verified} Verified</b> | <b>${stats.false} False</b></p>
      <hr>
      ${htmlItems}
    </div>
  `).setWidth(600).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, 'Validation Report');
}

// ==========================================
// 3. TRACER AGENT HELPER: CLEAN TEXT EXTRACTOR
// ==========================================
function getCleanManuscriptText(body) {
  let cleanText = "";
  // Exclude text that the Validator has colored
  const VALIDATOR_COLORS = ['#006400', '#cc0000', '#ff8800'];

  const paragraphs = body.getParagraphs();
  
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const text = p.getText();
    if (text.trim().length === 0) continue; 

    const color = p.editAsText().getForegroundColor(0);
    const hexColor = color ? color.toLowerCase() : null;

    if (!hexColor || !VALIDATOR_COLORS.includes(hexColor)) {
      cleanText += text + "\n";
    }
  }
  return cleanText;
}

// ==========================================
// 3.1 TRACER AGENT (Analysis)
// ==========================================
function startTracerAgent() {
  const ui = DocumentApp.getUi();
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  if (checkForValidationErrors(body)) {
    ui.alert('⛔ Tracer Stopped', 'Please resolve Red (False) citations first.', ui.ButtonSet.OK);
    return;
  }

  const folderId = getOrPromptFolderId();
  if (!folderId) return;

  showSidebar("⏳ Tracer Agent is scanning your manuscript...<br>Comparing against your PDF Library.");

  try {
    // Use the filtered text to avoid reading the bibliography
    const cleanText = getCleanManuscriptText(body);
    
    if (cleanText.length < 100) {
       ui.alert("Error", "No manuscript text found! Did you validate the whole document instead of just the references?", ui.ButtonSet.OK);
       hideSidebar();
       return;
    }

    const TRACER_ENDPOINT = ENDPOINT_URL.replace('/validate', '/trace'); 
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ 
        text: cleanText,
        folderId: folderId 
      }),
      muteHttpExceptions: true
    };

    const result = fetchJson(TRACER_ENDPOINT, options);

    if (result.status === 'complete') {
      const count = highlightSentences(result.report, body);
      showTracerSidebar(result.report, count);
    } else {
      ui.alert('Tracer Error', result.message || 'Unknown error.', ui.ButtonSet.OK);
      hideSidebar();
    }

  } catch (e) {
    ui.alert('Connection Error', e.toString(), ui.ButtonSet.OK);
    hideSidebar();
  }
}

// ==========================================
// SHARED UI HELPERS
// ==========================================

function callBackend(text) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  };
  return fetchJson(ENDPOINT_URL, options);
}

function highlightSentences(report, body) {
  let count = 0;
  
  const applyColor = (sentence, color) => {
    const safePattern = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 50);
    const foundRange = body.findText(safePattern);
    if (foundRange) {
      const element = foundRange.getElement();
      try {
        element.asText().setBackgroundColor(foundRange.getStartOffset(), foundRange.getEndOffsetInclusive(), color);
        return true;
      } catch(e) { return false; }
    }
    return false;
  };

  if (report.alerts) {
    report.alerts.forEach(alert => {
      let color = '#FFF2CC'; // Yellow
      if (alert.advice && alert.advice.includes('Plagiarism')) color = '#FCE8E6'; // Red
      if (applyColor(alert.sentence, color)) count++;
    });
  }
  return count;
}

function showTracerSidebar(report, count) {
  let cardsHtml = '';
  
  const critical = report.alerts ? report.alerts.filter(a => a.advice.includes('Critical')) : [];
  if (critical.length > 0) {
    cardsHtml += `<h4 style="margin:10px 0 5px; color:#d93025; border-bottom:1px solid #ddd;">⛔ Critical Risks (${critical.length})</h4>`;
    critical.forEach(item => cardsHtml += createCard(item, 'red'));
  }

  const warnings = report.alerts ? report.alerts.filter(a => !a.advice.includes('Critical')) : [];
  if (warnings.length > 0) {
    cardsHtml += `<h4 style="margin:15px 0 5px; color:#e37400; border-bottom:1px solid #ddd;">⚠️ Citation Needed (${warnings.length})</h4>`;
    warnings.forEach(item => cardsHtml += createCard(item, 'yellow'));
  }

  if (cardsHtml === '') cardsHtml = `<div style="text-align:center; padding:20px; color:#188038;"><h3>✅ Clean Trace</h3><p>No issues found.</p></div>`;

  const htmlContent = `
    <style>
      body { font-family: 'Google Sans', sans-serif; padding: 10px; background-color:#f9f9f9; }
      .card { background:white; padding:10px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1); margin-bottom:10px; border-left:4px solid #ccc; }
      .card-red { border-left-color: #d93025; }
      .card-yellow { border-left-color: #fbbc04; }
      .score { float:right; font-weight:bold; font-size:0.85em; }
      .text-snippet { font-style:italic; font-size:0.85em; color:#555; margin-bottom:5px; }
      .meta { font-size:0.8em; color:#777; margin-top:5px; }
    </style>
    <div style="margin-bottom:15px;"><h3 style="margin:0;">Tracer Analysis</h3><span style="font-size:0.85em;">${count} matches found.</span></div>
    ${cardsHtml}
  `;

  const html = HtmlService.createHtmlOutput(htmlContent).setTitle('Tracer Analysis').setWidth(350);
  DocumentApp.getUi().showSidebar(html);
}

function createCard(item, color) {
  const percent = item.score ? Math.round(item.score * 100) + '%' : 'N/A';
  return `
    <div class="card card-${color}">
      <div><span class="score" style="color:${color === 'red' ? '#d93025' : '#e37400'}">${percent}</span></div>
      <div class="text-snippet">"${item.sentence.substring(0, 60)}..."</div>
      <div style="font-weight:500; font-size:0.9em;">${item.advice}</div>
      <div class="meta"><b>Source:</b> ${item.source}</div>
    </div>
  `;
}

function showSidebar(msg) {
  const html = HtmlService.createHtmlOutput(`<p style="font-family:sans-serif; padding:10px;">${msg}</p>`).setTitle(UI_SIDEBAR_TITLE).setWidth(300);
  DocumentApp.getUi().showSidebar(html);
}

function hideSidebar() {
  DocumentApp.getUi().showSidebar(HtmlService.createHtmlOutput('').setTitle('').setHeight(1));
}

function updateSidebarProgress(current, total, text) {
  const pct = Math.round((current / total) * 100);
  const html = HtmlService.createHtmlOutput(`
    <style>body{font-family:sans-serif;padding:10px;}.bar{background:#eee;height:20px;border-radius:3px;margin:10px 0;}.fill{background:#4CAF50;height:100%;width:${pct}%;text-align:center;color:white;font-size:0.8em;line-height:20px;}</style>
    <div><b>Progress:</b> ${current}/${total}</div>
    <div class="bar"><div class="fill">${pct}%</div></div>
    <div style="font-size:0.85em;color:#666;">${text}</div>
  `).setTitle(UI_SIDEBAR_TITLE);
  DocumentApp.getUi().showSidebar(html);
}

function checkForValidationErrors(bodyElement) {
  const paragraphs = bodyElement.getParagraphs();
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].getText().length > 0) {
      if (paragraphs[i].editAsText().getForegroundColor(0) === '#CC0000') return true;
    }
  }
  return false;
}

function clearValidationColors() {
  const ui = DocumentApp.getUi();
  if (ui.alert('Clear All Colors?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  DocumentApp.getActiveDocument().getBody().editAsText().setForegroundColor(null).setBackgroundColor(null);
}
