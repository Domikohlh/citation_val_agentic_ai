{\rtf1\ansi\ansicpg1252\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww30040\viewh18980\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 // === CONFIGURATION ===\
const ENDPOINT_URL = 'https://undeprecatively-unpunctuated-kara.ngrok-free.dev/validate'; // \uc0\u8592  UPDATE THIS WHEN NGROK CHANGES\
const MAX_CITATION_LENGTH = 1000; // Max characters per citation line for processing\
// Split by two or more newlines, which typically separates bibliography entries.\
const CITATION_SPLIT_REGEX = /\\n\{2,\}/; \
const UI_SIDEBAR_TITLE = 'Citation Validation Progress';\
\
// Add menu when document opens\
function onOpen() \{\
  DocumentApp.getUi()\
    .createMenu('Research Validator')\
    .addItem('Validate Selected Text (Single Claim)', 'validateSelection')\
    .addSeparator()\
    .addItem('Validate Selected Reference List (Bulk)', 'validateReferenceList') \
    .addSeparator()\
    .addItem('Clear All Validation Colors', 'clearValidationColors')\
    .addToUi();\
\}\
\
// Helper to call the Python backend\
function callBackend(text) \{\
  const options = \{\
    method: 'post',\
    contentType: 'application/json',\
    payload: JSON.stringify(\{ text: text \}),\
    muteHttpExceptions: true,\
    headers: \{ 'User-Agent': 'Google-Apps-Script' \}\
  \};\
  const response = UrlFetchApp.fetch(ENDPOINT_URL, options);\
  const result = JSON.parse(response.getContentText());\
  return result;\
\}\
\
// Helper functions for UI (showSidebar, updateSidebarProgress, hideSidebar, showFinalReport)\
// --- [UI Helper functions omitted for brevity, they are the same as the previous correct version] ---\
\
// Helper to show the custom sidebar with the progress HTML\
function showSidebar(initialMessage) \{\
  const html = HtmlService.createHtmlOutput(`<p style="font-family: sans-serif;">$\{initialMessage\}</p>`)\
    .setTitle(UI_SIDEBAR_TITLE)\
    .setWidth(300);\
  DocumentApp.getUi().showSidebar(html);\
\}\
\
// Helper to update the sidebar with progress and a progress bar\
function updateSidebarProgress(current, total, currentItemText) \{\
  const percentage = Math.round((current / total) * 100);\
  const safeItemText = currentItemText.replace(/</g, "&lt;").replace(/>/g, "&gt;");\
\
  const htmlTemplate = `\
    <style>\
      body \{ font-family: sans-serif; padding: 10px; \}\
      .progress-bar-container \{ background-color: #f3f3f3; border-radius: 5px; overflow: hidden; margin-top: 10px; margin-bottom: 10px; \}\
      .progress-bar \{ height: 25px; background-color: #4CAF50; text-align: center; line-height: 25px; color: white; transition: width 0.3s; \}\
      .current-item \{ font-size: 0.9em; color: #555; white-space: pre-wrap; word-wrap: break-word; \}\
      .status \{ font-weight: bold; margin-top: 10px; \}\
    </style>\
    <div class="status">Citations Validated: $\{current\} / $\{total\} ($\{percentage\}%)</div>\
    <div class="progress-bar-container">\
      <div class="progress-bar" style="width: $\{percentage\}%;">$\{percentage\}%</div>\
    </div>\
    <div class="current-item">Processing: $\{safeItemText\}...</div>\
  `;\
  const html = HtmlService.createHtmlOutput(htmlTemplate)\
    .setTitle(UI_SIDEBAR_TITLE)\
    .setWidth(300);\
  DocumentApp.getUi().showSidebar(html);\
\}\
\
// Helper to hide the sidebar (by replacing it with a minimal, empty one)\
function hideSidebar() \{\
  const html = HtmlService.createHtmlOutput('').setTitle('').setHeight(1);\
  DocumentApp.getUi().showSidebar(html);\
\}\
\
// Helper to display the final comprehensive report via a pop-up dialog\
function showFinalReport(results, total) \{\
  let reportItemsHtml = '';\
  let verifiedCount = 0;\
  let falseCount = 0;\
  \
  results.forEach((item, index) => \{\
    const statusIcon = item.status.includes('VERIFIED') ? '\uc0\u9989 ' : (item.status.includes('FALSE') ? '\u10060 ' : '\u9888 \u65039 ');\
    const statusColor = item.status.includes('VERIFIED') ? '#006400' : (item.status.includes('FALSE') ? '#CC0000' : '#FF8800');\
    \
    if (item.status.includes('VERIFIED')) verifiedCount++;\
    if (item.status.includes('FALSE')) falseCount++;\
\
    // FIX: Ensure item.sources is checked for existence.\
    const sourcesHtml = item.sources && item.sources.length > 0 ? item.sources.map((s, i) =>\
        `<li><a href="$\{s.url\}" target="_blank" style="color:#2a6496;">$\{s.title || 'Source ' + (i+1)\}</a></li>` // Fix 2\
    ).join('') : 'No specific sources cited in this snippet.';\
\
    reportItemsHtml += `\
      <div style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px;">\
        <h4 style="margin: 0 0 5px 0; color: $\{statusColor\}; font-size: 1.1em;">\
          $\{index + 1\}. $\{item.status\} $\{statusIcon\}\
        </h4>\
        <p style="margin: 0 0 5px 0; font-size: 0.9em; font-style: italic; color: #555;">\
          <strong>Citation:</strong> $\{item.citation.substring(0, 150)\}...\
        </p>\
        <p style="margin: 0 0 5px 0; font-size: 0.95em;">\
          <strong>Analysis:</strong> $\{item.analysis.substring(0, 200)\}...\
        </p>\
        <p style="margin: 0 0 3px 0; font-size: 0.9em;"><strong>Sources Used:</strong></p>\
        <ul style="margin: 0; padding-left: 20px; font-size: 0.85em;">\
          $\{sourcesHtml\}\
        </ul>\
      </div>\
    `;\
  \});\
\
  const summaryHtml = `\
    <h3 style="color:#333;">Batch Validation Summary ($\{total\} Processed)</h3>\
    <p style="font-size: 1.1em; margin-top: 10px;">\
      <span style="color:#006400; font-weight: bold;">$\{verifiedCount\} Verified</span>,\
      <span style="color:#CC0000; font-weight: bold;">$\{falseCount\} False Claims</span>,\
      <span style="color:#FF8800; font-weight: bold;">$\{total - verifiedCount - falseCount\} Uncertain/Errors</span>\
    </p>\
    <hr style="margin: 15px 0;">\
  `;\
\
  const htmlOutput = HtmlService.createHtmlOutput(`\
    <div style="font-family: sans-serif; padding: 15px; max-height: 550px; overflow-y: scroll; background-color: #f9f9f9; border-radius: 8px;">\
      $\{summaryHtml\}\
      $\{reportItemsHtml\}\
    </div>\
  `)\
    .setWidth(650)\
    .setHeight(500);\
\
  DocumentApp.getUi().showModalDialog(htmlOutput, 'Batch Validation Results');\
\}\
\
\
function validateReferenceList() \{\
  const ui = DocumentApp.getUi();\
  const selection = DocumentApp.getActiveDocument().getSelection();\
\
  if (!selection) \{\
    ui.alert('No text selected!', 'Please highlight the entire reference list or block of citations you want to validate.', ui.ButtonSet.OK);\
    return;\
  \}\
\
  // Stores the text of each citation for processing\
  let fullTextParts = [];\
  // Stores the corresponding element/range info for later coloring (Fix 3)\
  let citationElements = []; \
\
  const selectedRanges = selection.getRangeElements();\
\
  selectedRanges.forEach(rangeElement => \{\
    let text = '';\
    const element = rangeElement.getElement();\
\
    // Only process Paragraphs or List Items\
    if (element.getType() === DocumentApp.ElementType.PARAGRAPH || element.getType() === DocumentApp.ElementType.LIST_ITEM) \{\
      const textElement = element.asText();\
      let start, end;\
\
      if (rangeElement.isPartial()) \{\
        start = rangeElement.getStartOffset();\
        end = rangeElement.getEndOffsetInclusive();\
        text = textElement.getText().substring(start, end + 1);\
      \} else \{\
        start = 0;\
        end = textElement.getText().length - 1;\
        text = textElement.getText();\
      \}\
      \
      // Clear previous color immediately\
      textElement.setForegroundColor(start, end, null); \
\
      if (text.trim().length > 0) \{\
        fullTextParts.push(text.trim());\
        // Store element information for highlighting later (Fix 3)\
        citationElements.push(\{\
            textElement: textElement,\
            start: start,\
            end: end\
        \});\
      \}\
    \}\
  \});\
  \
  // Join the parts using a guaranteed double newline (the delimiter for the regex)\
  const fullText = fullTextParts.join('\\n\\n'); \
\
  if (!fullText.trim()) \{\
    ui.alert('Empty selection', 'No text or valid paragraphs/list items found in the selection.', ui.ButtonSet.OK);\
    return;\
  \}\
\
  // 2. Split the Reference List into Individual Citations\
  let citations = fullText.trim().split(CITATION_SPLIT_REGEX)\
    .map(line => line.trim())\
    .filter(line => line.length > 20 && line.length < MAX_CITATION_LENGTH);\
\
  // CRITICAL FIX 1: The number of text parts stored in citationElements must match the number of parsed citations.\
  // This happens if the text parsing logic (split and filter) combined multiple text parts into one citation,\
  // or if the original selection had extra delimiters.\
  // The safest assumption is that each text part collected corresponds to one citation *attempt*.\
\
  if (citations.length !== citationElements.length) \{\
      ui.alert('Warning: Parsing Mismatch', `Highlighted text was split into $\{citations.length\} citations, but was extracted from $\{citationElements.length\} document elements. Highlighting may be inaccurate. Check that you are highlighting only one citation per paragraph/list item.`);\
      // Proceed with the smaller count to avoid index out of bounds errors\
      if (citations.length === 0) \{\
          ui.alert('Parsing Error', 'Could not identify any valid citations. Check formatting.');\
          return;\
      \}\
  \}\
\
  const totalCitations = citations.length;\
  let validatedCount = 0;\
  let validationResults = [];\
\
  // 3. Setup Progress Sidebar\
  showSidebar('Initializing batch validation...');\
\
  // 4. Process Citations One-by-One\
  for (let i = 0; i < totalCitations; i++) \{\
    const citation = citations[i];\
    validatedCount++;\
\
    const progressText = citation.substring(0, 100);\
    updateSidebarProgress(validatedCount, totalCitations, progressText);\
\
    try \{\
      const result = callBackend(citation);\
\
      let status, color;\
      if (result.error || result.analysis.includes("Analysis unavailable")) \{\
        status = 'Error/Skipped';\
        color = '#CC0000';\
      \} else if (result.verified === true) \{\
        status = 'VERIFIED';\
        color = '#006400';\
      \} else if (result.is_hallucination === true) \{\
        status = 'FALSE CLAIM DETECTED';\
        color = '#CC0000';\
      \} else \{\
        status = 'UNCERTAIN';\
        color = '#FF8800';\
      \}\
\
      // Add coloring info to the result object\
      let elementInfo = citationElements[i];\
      if (elementInfo) \{\
        validationResults.push(\{\
          citation: citation,\
          status: status,\
          color: color,\
          analysis: result.analysis || `Backend processing error: $\{result.error\}`,\
          sources: result.suggested_citations,\
          elementInfo: elementInfo // Stored for final highlighting (Fix 3)\
        \});\
      \}\
\
    \} catch (e) \{\
      // Handle connection errors\
      if (citationElements[i]) \{\
        validationResults.push(\{\
          citation: citation,\
          status: 'Connection Failed',\
          color: '#CC0000',\
          analysis: `Error contacting server: $\{e.toString()\}`,\
          sources: [],\
          elementInfo: citationElements[i] // Stored for final highlighting (Fix 3)\
        \});\
      \}\
    \}\
  \}\
\
  // 5. Final Report and Highlighting\
  hideSidebar();\
\
  // FIX 3: Apply color to the original document elements\
  validationResults.forEach(result => \{\
    if (result.elementInfo) \{\
      const \{ textElement, start, end \} = result.elementInfo;\
      textElement.setForegroundColor(start, end, result.color);\
    \}\
  \});\
\
  showFinalReport(validationResults, totalCitations);\
\}\
\
\
// Main function: Validate currently selected text (SINGLE CLAIM)\
function validateSelection() \{\
  const doc = DocumentApp.getActiveDocument();\
  const ui = DocumentApp.getUi();\
  const selection = doc.getSelection();\
\
  if (!selection) \{\
    ui.alert('No text selected!', 'Please highlight the text you want to fact-check.', ui.ButtonSet.OK);\
    return;\
  \}\
\
  const selectedRanges = selection.getRangeElements();\
  let fullText = '';\
  const elementsToColor = []; \
  \
  selectedRanges.forEach(rangeElement => \{\
    const text = rangeElement.getElement().asText();\
    if (rangeElement.isPartial()) \{\
      const start = rangeElement.getStartOffset();\
      const end = rangeElement.getEndOffsetInclusive();\
      fullText += text.getText().substring(start, end + 1);\
      elementsToColor.push(\{ textElement: text, start, end \});\
    \} else \{\
      fullText += text.getText();\
      elementsToColor.push(\{ textElement: text, start: 0, end: text.getText().length - 1 \});\
    \}\
  \});\
\
  if (!fullText.trim()) \{\
    ui.alert('Empty selection', 'No text found in the selection.', ui.ButtonSet.OK);\
    return;\
  \}\
  \
  ui.alert(\
    'Analyzing with Gemini 2.5 Flash + Google Search...',\
    'This takes 8\'9615 seconds.\\n\\nClick OK and wait for the result.',\
    ui.ButtonSet.OK\
  );\
\
  try \{\
    const result = callBackend(fullText.trim());\
\
    if (result.error) \{\
      ui.alert('Server Error', `Backend error: $\{result.error\}\\n\\nDetails: $\{result.details || 'N/A'\}`, ui.ButtonSet.OK);\
      return;\
    \}\
\
    elementsToColor.forEach(item => \{\
      item.textElement.setForegroundColor(item.start, item.end, null); \
    \});\
\
    let message = '';\
    let title = '';\
    let color = '#FF8800'; \
\
    if (result.verified === true) \{\
      color = '#006400'; \
      title = 'Verified & Grounded';\
      message = result.analysis || 'This claim is supported by web sources.';\
    \} else if (result.is_hallucination === true) \{\
      color = '#CC0000'; \
      title = 'FALSE CLAIM DETECTED';\
      message = result.analysis || 'This claim is inaccurate or unsupported.';\
    \} else \{\
      color = '#FF8800';\
      title = 'Uncertain / Needs Review';\
      message = result.analysis || 'Could not confidently verify this claim.';\
    \}\
\
    elementsToColor.forEach(item => \{\
      item.textElement.setForegroundColor(item.start, item.end, color); \
    \});\
\
    let citationFootnote = '';\
    if (result.suggested_citations && result.suggested_citations.length > 0) \{\
      const top3 = result.suggested_citations.slice(0, 3);\
      citationFootnote = top3.map((s, i) =>\
        `$\{i+1\}. $\{s.title || 'Source'\} \'97 $\{s.url || 'Link unavailable'\}`\
      ).join('\\n');\
      \
      const firstElement = selectedRanges[0].getElement();\
      const paragraph = firstElement.getParent();\
      \
      if (paragraph && paragraph.getType() === DocumentApp.ElementType.PARAGRAPH) \{\
        const footnote = paragraph.asParagraph().addFootnote(citationFootnote);\
        footnote.getFootnoteContents().setItalic(true).setForegroundColor('#555555');\
      \}\
    \}\
\
    const fullMessage = `$\{title\}\\n\\n$\{message\}\\n\\n$\{citationFootnote ? 'Sources:\\n' + citationFootnote : ''\}`;\
    ui.alert(title, fullMessage.trim(), ui.ButtonSet.OK);\
\
  \} catch (error) \{\
    console.error(error);\
    ui.alert(\
      'Connection Failed',\
      `Could not reach the validation server.\\n\\nError: $\{error.toString()\}\\n\\nCheck your ngrok URL and internet connection.`,\
      ui.ButtonSet.OK\
    );\
  \}\
\}\
\
// === BONUS: Clear all validation colors in the document ===\
function clearValidationColors() \{\
  const ui = DocumentApp.getUi();\
  const response = ui.alert(\
    'Clear All Validation Colors?',\
    'This will reset text colors in the entire document.\\n\\nContinue?',\
    ui.ButtonSet.YES_NO\
  );\
  if (response !== ui.Button.YES) return;\
  const body = DocumentApp.getActiveDocument().getBody();\
  const text = body.editAsText();\
  text.setForegroundColor(null); \
  ui.alert('All validation colors cleared!', '', ui.ButtonSet.OK);\
\}}