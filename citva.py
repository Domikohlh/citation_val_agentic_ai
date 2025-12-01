pip install functions_framework pyngrok scikit-learn chromadb newspaper3k lxml_html_clean 

#Libraries
import functions_framework
import vertexai
from vertexai.generative_models import GenerativeModel, Tool, GenerationConfig
from vertexai.language_models import TextEmbeddingModel # Added for VectorDB
from google import genai
from google.genai.types import GenerateContentConfig, Tool, GoogleSearch
from flask import jsonify, Flask, request
from pyngrok import ngrok, conf
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from pypdf import PdfReader
import chromadb # Added for VectorDB
from chromadb.config import Settings
import google.auth
import os
import io
import re
import uuid
from datetime import datetime
import requests
import json
import traceback
import tempfile
import time
from newspaper import Article, Config
import concurrent.futures
import gc

#Authorisation

#Use for Mac user
# If installed via Homebrew, it is usually here:
conf.get_default().ngrok_path = "/opt/homebrew/bin/ngrok" 

# OR if you put the file in the same folder as your script:
# conf.get_default().ngrok_path = "./ngrok"
# 1. Put your Ngrok Token here
NGROK_AUTH_TOKEN = "Enter your Ngrok Token"

# 2. Put your Google Cloud Project ID here
GOOGLE_PROJECT_ID = "Enter your Google Project ID (In Google Cloud)"

# 3. Paste the content of your Service Account JSON file here as a Dictionary
SERVICE_ACCOUNT_INFO = {
  "type": "service_account",
  "project_id": "PROJECT_ID",
  "private_key_id": "PRIVATE_KEY_ID",
  "private_key": "BEGINE_PRIVATE_KEY",
  "client_email": "CLIENT_EMAIL",
  "client_id": "CLIENT_ID",
  "auth_uri": "AUTH_URL",
  "token_uri": "TOKEN_URL",
  "auth_provider_x509_cert_url": "",
  "client_x509_cert_url": "",
  "universe_domain": "googleapis.com"
}

# ==========================================
# ⚙️ GLOBAL SETUP
# ==========================================

client = None 
creds = None
google_search_tool = None 
model_name = "gemini-2.5-flash"
CRED_FILE_PATH = "service_account_keys.json"

try:
    # 1. VALIDATE INPUTS
    if not all([NGROK_AUTH_TOKEN, GOOGLE_PROJECT_ID, SERVICE_ACCOUNT_INFO]):
        raise ValueError("Missing required secrets in the Configuration section.")

    # 2. CREATE LOCAL CREDENTIALS FILE
    # Some Google SDKs specifically look for the file path in env vars, 
    # so we dump the dictionary to a local file to ensure maximum compatibility.
    with open(CRED_FILE_PATH, "w") as f:
        json.dump(SERVICE_ACCOUNT_INFO, f)

    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.abspath(CRED_FILE_PATH)

    # 3. CREATE CREDENTIALS OBJECT
    # We load from the dictionary info directly for immediate use
    creds = service_account.Credentials.from_service_account_info(SERVICE_ACCOUNT_INFO)

    # 4. INITIALIZE VERTEX AI
    vertexai.init(
        project=GOOGLE_PROJECT_ID,
        location="us-central1",
        credentials=creds 
    )

    # 5. INITIALIZE GENAI CLIENT
    client = genai.Client(vertexai=True, project=GOOGLE_PROJECT_ID, location="us-central1")
    
    # 6. INITIALIZE TOOLS
    google_search_tool = Tool(google_search=GoogleSearch())

    # 7. SETUP NGROK
    # Kill any existing processes to prevent conflicts
    ngrok.kill()
    ngrok.set_auth_token(NGROK_AUTH_TOKEN)

    print("✅ Local Authentication, Client, and Search Tools initialized.")

except Exception as e:
    print(f"\n❌ AUTHENTICATION FAILED: {e}")
    traceback.print_exc()
    # Optional: Clean up the key file on failure if desired
    # if os.path.exists(CRED_FILE_PATH):
    #     os.remove(CRED_FILE_PATH)
    raise

# ==========================================
# 1. NEW CLASS: KNOWLEDGE BASE (VectorDB)
# ==========================================
class KnowledgeBase:
    def __init__(self, persist_path="./chroma_db"):
        self.chroma_client = chromadb.PersistentClient(path=persist_path)
        self.collection = self.chroma_client.get_or_create_collection(name="research_papers")
        try:
            self.embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")
        except Exception as e:
            print(f"❌ Critical Error initializing Embedding Model: {e}")
            raise e

    def get_embeddings(self, texts):
        """
        Convert text chunks into vector embeddings.
        FIX: Batches requests to avoid Vertex AI 20k token limit.
        """
        all_embeddings = []
        # Conservative batch size (5 chunks per call is safe)
        BATCH_SIZE = 5 
        
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            try:
                # 1. Call API for this small batch
                embeddings = self.embedding_model.get_embeddings(batch)
                # 2. Extract values
                all_embeddings.extend([e.values for e in embeddings])
                
                # Optional: Tiny sleep to be nice to the rate limiter
                time.sleep(0.2)
                
            except Exception as e:
                print(f"⚠️ Embedding API Error on batch {i}: {e}")
                # If a batch fails, we can't easily recover just that part without breaking 
                # the alignment between texts and vectors. 
                # We return an empty list to signal total failure for this document.
                return []

        return all_embeddings

    def is_indexed(self, file_id):
        result = self.collection.get(where={"file_id": str(file_id)}, limit=1)
        return len(result['ids']) > 0

    def add_document(self, file_id, filename, text_chunks):
        if not text_chunks: return
        
        # Calculate Embeddings
        vectors = self.get_embeddings(text_chunks)
        
        # SAFETY CHECK: Ensure we got vectors back and counts match
        if not vectors or len(vectors) != len(text_chunks):
            print(f"❌ Failed to generate embeddings for {filename}. Skipping DB insertion.")
            return

        # Generate IDs
        batch_ids = [f"{file_id}_{i}" for i in range(len(text_chunks))]
        batch_metadatas = [{"source": filename, "file_id": str(file_id)} for _ in text_chunks]
        
        try:
            self.collection.add(
                documents=text_chunks,
                embeddings=vectors,
                metadatas=batch_metadatas,
                ids=batch_ids
            )
        except Exception as e:
            print(f"ChromaDB Add Error: {e}")

    def query_similarity(self, query_text, n_results=3):
        # Generate single vector for query
        query_vec_list = self.get_embeddings([query_text])
        if not query_vec_list: return []
        
        results = self.collection.query(
            query_embeddings=query_vec_list,
            n_results=n_results
        )
        
        matches = []
        if results['documents']:
            for i in range(len(results['documents'][0])):
                matches.append({
                    "content": results['documents'][0][i],
                    "source": results['metadatas'][0][i]['source'],
                    "distance": results['distances'][0][i]
                })
        return matches

# ==========================================
# 2. HELPER FUNCTIONS (Existing logic maintained)
# ==========================================
def extract_text_from_response(response):
    """Safely extract text from the first candidate."""
    if not hasattr(response, 'candidates') or not response.candidates: return None
    candidate = response.candidates[0]
    if not hasattr(candidate, 'content') or not candidate.content.parts: return None
    part = candidate.content.parts[0]
    if hasattr(part, 'text') and part.text: return part.text.strip()
    return None

def extract_grounding_metadata(response):
    sources = []
    web_queries = []
    if hasattr(response, 'grounding_metadata') and response.grounding_metadata:
        metadata = response.grounding_metadata
        web_queries = getattr(metadata, 'web_search_queries', [])
        grounding_chunks = getattr(metadata, 'grounding_chunks', [])
        for chunk in grounding_chunks:
            if hasattr(chunk, 'web') and chunk.web:
                web = chunk.web
                sources.append({
                    "title": getattr(web, 'title', 'No title'),
                    "url": getattr(web, 'uri', ''),
                    "snippet": getattr(web, 'snippet', '')[:200] if hasattr(web, 'snippet') else ''
                })
    return sources, web_queries

# ==========================================
# 3. OBSERVABILITY FOR LOGGING AND TRACING
# ==========================================

class AgentObserver:
    def __init__(self, log_file="agent_trace.jsonl"):
        self.log_file = log_file
        # Create file if not exists
        if not os.path.exists(log_file):
            with open(log_file, 'w') as f: pass

    def start_trace(self, agent_name, intent):
        """Starts a new tracking session for a specific task."""
        trace_id = str(uuid.uuid4())[:8] # Short ID
        self._log(trace_id, agent_name, "START", f"Intent: {intent}")
        return trace_id

    def log_event(self, trace_id, agent_name, step, thought, status="INFO", duration=None):
        """
        Logs a specific step in the agent's thought process.
        """
        self._log(trace_id, agent_name, step, thought, status, duration)

    def log_error(self, trace_id, agent_name, step, error_msg):
        """
        Special formatting for errors.
        """
        self._log(trace_id, agent_name, step, f"ERROR: {error_msg}", status="ERROR")

    def _log(self, trace_id, agent_name, step, thought, status="INFO", duration=None):
        """Internal writer."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # 1. VISUAL CONSOLE OUTPUT (Human Readable)
        # Uses icons for quick scanning
        icon = "🟢" if status == "INFO" else "🔴" if status == "ERROR" else "🟡"
        dur_str = f"({duration:.2f}s)" if duration else ""
        
        print(f"{timestamp} | {trace_id} | {icon} [{agent_name}] {step}: {thought} {dur_str}")

        # 2. STRUCTURED FILE LOGGING (Machine Readable)
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "trace_id": trace_id,
            "agent": agent_name,
            "step": step,
            "thought": thought,
            "status": status,
            "duration_seconds": duration
        }
        
        try:
            with open(self.log_file, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            print(f"Logging failed: {e}")

# Initialize Global Observer
observer = AgentObserver()

# ==========================================
# 4. BRANCH VECTOR DB (In-Memory Staging)
# ==========================================
class BranchKnowledgeBase:
    """
    A temporary, in-memory VectorDB. 
    Used to hold PDF data while the Gatekeeper decides if it's valid.
    """
    def __init__(self):
        # EphemeralClient = In-Memory only. Disappears when script ends.
        self.client = chromadb.EphemeralClient()
        self.collection = self.client.get_or_create_collection(name="branch_staging")
        # Reuse the global embedding model logic (assuming TextEmbeddingModel is available)
        self.embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")

    def stage_document(self, file_id, filename, text_chunks):
        """Embeds and temporarily stores chunks in RAM."""
        try:
            # Generate Embeddings
            embeddings = []
            # Batch process for speed
            batch_size = 5
            for i in range(0, len(text_chunks), batch_size):
                batch = text_chunks[i:i+batch_size]
                emb_result = self.embedding_model.get_embeddings(batch)
                embeddings.extend([e.values for e in emb_result])

            ids = [f"{file_id}_{i}" for i in range(len(text_chunks))]
            metadatas = [{"source": filename, "file_id": file_id} for _ in text_chunks]

            self.collection.add(
                documents=text_chunks,
                embeddings=embeddings,
                metadatas=metadatas,
                ids=ids
            )
            return True, embeddings # Return embeddings so we can move them later without re-calculating
        except Exception as e:
            print(f"Branch Staging Error: {e}")
            return False, []

    def clear(self):
        """Wipes the branch DB."""
        self.client.delete_collection("branch_staging")

# ==========================================
# AGENT1: VALIDATOR BLOCK
# ==========================================

# Helper function to find the bibliography
def _extract_reference_section(text):
    """
    Scans the text for headers like 'References' or 'Bibliography'.
    If found, returns everything AFTER that header.
    If not found, returns the original text (assumes user highlighted the list).
    """
    # 1. Safety Check: If text is short (< 1000 chars), assume it's already a selection
    if len(text) < 1000:
        return text

    lower_text = text.lower()
    keywords = ["references", "bibliography", "works cited", "literature cited"]
    
    # Search from the END of the document backwards
    for word in keywords:
        idx = lower_text.rfind(word)
        if idx != -1:
            # Heuristic: Ensure this isn't just a mention in the text.
            # Usually these headers are on their own line or near the end.
            # We take the text starting from this keyword.
            print(f"✂️  Auto-detected '{word}' section. Trimming manuscript.")
            return text[idx:]
            
    return text

# VALIDATOR LOGIC
def core_validation_logic(user_text):
    """
    1. Validates text using Gemini.
    2. Scrapes the sources found (Memory Only).
    3. Embeds them into the VectorDB.
    """
    global client, google_search_tool, model_name
    
    # START LOGGING
    trace_id = observer.start_trace("Validator", "Validate Claim & Scrape Sources")
    observer.log_event(trace_id, "Validator", "Input", f"Received text length: {len(user_text)}")

    # Initialize WebReader without arguments (No Drive)
    reader = WebReader()
    
    # Lazy load KB
    kb = KnowledgeBase(persist_path="./chroma_db") 

    if not user_text: 
        observer.log_error(trace_id, "Validator", "Input Check", "Empty text received")
        return {"error": "Text is empty"}

    # Auto-extract Reference List if full doc is passed
    target_text = _extract_reference_section(user_text)
    observer.log_event(trace_id, "Validator", "Preprocessing", "Extracted/Trimmed Reference Section")

    # Agent prompt
    prompt = f"""
        Carefully analyze the following statement for factual accuracy using Google Search grounding.

        Statement to verify:
        "{target_text}" 

        Instructions:
        - Use search results to verify every factual claim.
        - If the statement is accurate and well-supported → respond with the original text followed by [VERIFIED] and list sources.
        - If any part is false, misleading, or unsupported → respond with [FALSE CLAIM DETECTED], explain the error, and provide the correct information with sources.
        - Cite sources or State rationale clearly in the response after verification.
        - For validation in batches, it is restricted to provide one to two sentences for the cite resources and rationale. 
        - For validation in single entry, provide a paragraph of your analysis and rationale. 
        """

    try:
        start_time = time.time()
        # 1. Gemini Search & Validation
        response = client.models.generate_content(
            model=model_name,
            contents=[prompt],
            config=GenerateContentConfig(tools=[google_search_tool], temperature=0.1)
        )
        
        text = extract_text_from_response(response)
        sources, web_queries = extract_grounding_metadata(response)
        
        observer.log_event(trace_id, "Validator", "Gemini Analysis", "Validation complete", duration=time.time()-start_time)
        
        captured_sources = []

        # 2. THE LEARNING LOOP (No Drive Uploads)
        if sources:
            observer.log_event(trace_id, "Validator", "Learning", f"Attempting to learn from {len(sources)} sources...")
            for src in sources:
                url = src.get('url')
                if url:
                    scrape_start = time.time()
                    status, title, full_content = reader.scrape_and_process(url)
                    
                    if status == 'success' and full_content:
                        # Add to VectorDB
                        if not kb.is_indexed(url):
                            chunks = [full_content[i:i+800] for i in range(0, len(full_content), 600)]
                            kb.add_document(file_id=url, filename=title, text_chunks=chunks)
                            captured_sources.append(title)
                            observer.log_event(trace_id, "Validator", "Embedding", f"Indexed: {title}", duration=time.time()-scrape_start)
                        else:
                            observer.log_event(trace_id, "Validator", "Embedding", f"Skipped (Already in DB): {title}")

        return {
            "analysis": text,
            "suggested_citations": sources,
            "saved_to_drive": captured_sources, 
            "is_hallucination": "FALSE" in (text.upper() if text else ""),
            "verified": "[VERIFIED]" in (text if text else "")
        }
        
    except Exception as e:
        traceback.print_exc()
        observer.log_error(trace_id, "Validator", "Execution Failed", str(e))
        return {"error": str(e)}

# ==========================================
# AGENT2: LIBRARIAN 
# ==========================================
class LibrarianAgent:
    def __init__(self, vertex_client, drive_creds, db_path="./chroma_db"):
        self.client = vertex_client
        self.drive_reader = DriveReader(drive_creds) 
        self.kb = KnowledgeBase(persist_path=db_path) 
        self.model_name = "gemini-2.5-flash"

    def _clean_pdf_text(self, text):
        # 1. CAP LENGTH
        text = text[:80000]
        # 2. STRIP BIBLIOGRAPHY ONLY
        lower_text = text.lower()
        keywords = ["references", "bibliography", "literature cited"]
        for word in keywords:
            search_start = int(len(lower_text) * 0.6)
            idx = lower_text.find(word, search_start)
            if idx != -1:
                return text[:idx]
        return text

    def _extract_pdf_metadata(self, first_page_text, filename):
        prompt = f"""
        Analyze text. Extract metadata.
        Filename: "{filename}"
        Text: "{first_page_text[:2000]}"
        Return JSON: {{ "title": "...", "authors": "...", "doi": "..." }}
        If missing, use "Unknown".
        """
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[prompt],
                config=GenerateContentConfig(response_mime_type="application/json")
            )
            return json.loads(response.text)
        except:
            return {"title": filename, "authors": "Unknown", "doi": "Unknown"}

    def _process_single_pdf(self, file, trace_id):
        try:
            start_time = time.time()
            # 1. READ
            full_text = self.drive_reader.read_pdf(file['id'])
            
            if len(full_text) < 100: 
                observer.log_event(trace_id, "Librarian", "Quality Check", f"Rejected {file['name']} (Empty/Scanned)", status="WARNING")
                return {"error": "empty_or_scanned", "filename": file['name']}

            # 2. METADATA
            meta = self._extract_pdf_metadata(full_text[:2000], file['name'])
            safe_title = str(meta.get('title') or file['name'])
            safe_authors = str(meta.get('authors') or "Unknown")
            safe_doi = str(meta.get('doi') or "Unknown")
            
            # 3. EMBEDDING
            if not self.kb.is_indexed(file['id']):
                clean_text = self._clean_pdf_text(full_text)
                chunks = [clean_text[i:i+800] for i in range(0, len(clean_text), 700)] 
                
                self.kb.add_document(
                    file_id=str(file['id']), 
                    filename=safe_title, 
                    text_chunks=chunks
                )
                observer.log_event(trace_id, "Librarian", "Ingest", f"Embedded: {safe_title}", duration=time.time()-start_time)
            else:
                observer.log_event(trace_id, "Librarian", "Check Index", f"Already Indexed: {safe_title}")
            
            # Return full metadata dictionary
            return {"title": safe_title, "authors": safe_authors, "doi": safe_doi}

        except Exception as e:
            observer.log_error(trace_id, "Librarian", "Process PDF", f"Error on {file['name']}: {str(e)}")
            return {"error": str(e), "filename": file['name']}

    def _validate_coverage_a2a(self, pdf_metadata_list, reference_list_text):
        inventory_items = []
        for p in pdf_metadata_list:
            inventory_items.append({
                "title": p.get('title', 'Unknown'),
                "authors": p.get('authors', 'Unknown')
            })
            
        inventory = json.dumps(inventory_items)
        if len(inventory) > 30000: inventory = json.dumps([p['title'] for p in inventory_items])
        
        prompt = f"""
        You are the Reference Auditor.
        Inventory: {inventory}
        Bibliography: "{reference_list_text}"
        Task: Which items in Bibliography are MISSING from Inventory?
        Return JSON: {{ "missing_references": [], "coverage_score": 0 }}
        """
        try:
            response = self.client.models.generate_content(
                model=self.model_name, contents=[prompt],
                config=GenerateContentConfig(response_mime_type="application/json")
            )
            return json.loads(response.text)
        except: return {"missing_references": [], "coverage_score": 0}

    def sync_and_audit(self, folder_id, reference_list_text):
        trace_id = observer.start_trace("Librarian", "Sync Drive & Audit")
        
        report = { "valid_pdfs": [], "invalid_pdfs": [], "missing_references": [] }
        # Separate list for full metadata objects (for internal use)
        inventory_metadata = [] 
        
        pdf_files = self.drive_reader.list_pdfs_in_folder(folder_id)
        observer.log_event(trace_id, "Librarian", "Scan", f"Found {len(pdf_files)} PDF candidates.")

        for file in pdf_files:
            res = self._process_single_pdf(file, trace_id)
            
            if res.get('error'):
                report['invalid_pdfs'].append(f"{res['filename']} ({res['error']})")
            else:
                # Add title to external report
                report['valid_pdfs'].append(res['title'])
                # Add full object to internal inventory for A2A
                inventory_metadata.append(res)
            
            gc.collect()

        if reference_list_text and len(inventory_metadata) > 0:
            observer.log_event(trace_id, "Librarian", "Audit", "Running A2A Audit...")
            # Pass inventory_metadata (list of dicts), NOT report['valid_pdfs'] (list of strings)
            audit_result = self._validate_coverage_a2a(inventory_metadata, reference_list_text)
            report['missing_references'] = audit_result.get('missing_references', [])
            report['coverage_score'] = audit_result.get('coverage_score', 0)

        observer.log_event(trace_id, "Librarian", "Complete", f"Processed {len(report['valid_pdfs'])} valid PDFs.")
        return report

# ==========================================
# AGENT 3: TRACER
# ==========================================
class TracerAgent:
    def __init__(self, vertex_client, db_path="./chroma_db"):
        self.client = vertex_client 
        self.model_name = "gemini-2.5-flash"
        self.kb = KnowledgeBase(persist_path=db_path)

    def _clean_manuscript(self, full_text):
        lines = full_text.split('\n')
        total_lines = len(lines)
        cutoff_index = total_lines
        keywords = ["references", "bibliography", "works cited"]
        for i, line in enumerate(lines):
            if i > total_lines * 0.5:
                if line.strip().lower().replace(':', '') in keywords:
                    cutoff_index = i
                    break
        return "\n".join(lines[:cutoff_index])

    def _consult_brain(self, sentence, source_text):
        prompt = f"""
        You are a Plagiarism & Citation Analyst.
        Manuscript: "{sentence}"
        Source: "{source_text}"
        Task: Label relationship.
        - "plagiarism_risk" (Direct copy/paste)
        - "citation_needed" (Paraphrase requiring citation)
        - "safe" (Unrelated)
        Label:
        """
        try:
            response = self.client.models.generate_content(
                model=self.model_name, contents=[prompt],
                config=GenerateContentConfig(temperature=0.0)
            )
            return {"type": response.text.strip().lower()}
        except: return {"type": "safe"}

    def run_agentic_trace(self, raw_manuscript_text):
        trace_id = observer.start_trace("Tracer", "Semantic Manuscript Analysis")
        report = {"alerts": [], "actions": []}
        
        clean_text = self._clean_manuscript(raw_manuscript_text)
        manuscript_sentences = [s.strip() for s in clean_text.split('.') if len(s) > 40]
        
        observer.log_event(trace_id, "Tracer", "Pre-process", f"Analyzing {len(manuscript_sentences)} sentences.")
        
        for sentence in manuscript_sentences:
            matches = self.kb.query_similarity(sentence, n_results=1)
            if not matches: continue
            
            top_match = matches[0]
            distance = top_match['distance']
            similarity_score = max(0, 1 - distance) 
            
            if distance < 0.6:
                # Optional: Log granular matches (can be verbose)
                # observer.log_event(trace_id, "Tracer", "Vector Match", f"Dist: {distance:.2f} on '{sentence[:30]}...'")
                pass

            # --- ADJUSTED THRESHOLDS ---
            if distance < 0.35: 
                observer.log_event(trace_id, "Tracer", "High Match", f"Found {similarity_score:.2f} match. Consulting Brain...")
                decision = self._consult_brain(sentence, top_match['content'])
                
                if decision['type'] in ['plagiarism_risk', 'citation_needed']:
                     advice_text = "Critical Match. Please paraphrase." if decision['type'] == 'plagiarism_risk' else "Strong match. Verify citation."
                     report['alerts'].append({
                         "sentence": sentence,
                         "source": top_match['source'],
                         "advice": advice_text,
                         "score": float(similarity_score)
                     })
                     observer.log_event(trace_id, "Tracer", "Alert Generated", f"Type: {decision['type']}")

            elif 0.35 <= distance < 0.50:
                 report['alerts'].append({
                     "sentence": sentence,
                     "source": top_match['source'],
                     "advice": "Thematic match detected. Ensure source is cited.",
                     "score": float(similarity_score)
                 })

        observer.log_event(trace_id, "Tracer", "Complete", f"Analysis done. Found {len(report['alerts'])} alerts.")
        return {"status": "complete", "report": report}

# ==========================================
# 3. HELPER CLASSES: DriveReader & WebScout
# ==========================================
class DriveReader:
    def __init__(self, credentials):
        self.service = build('drive', 'v3', credentials=credentials)

    def list_pdfs_in_folder(self, folder_id):
        try:
            results = self.service.files().list(
                q=f"'{folder_id}' in parents and mimeType='application/pdf' and trashed=false",
                fields="files(id, name)"
            ).execute()
            return results.get('files', [])
        except Exception as e:
            print(f"Drive Read Error: {e}")
            return []

    def read_pdf(self, file_id):
        try:
            request = self.service.files().get_media(fileId=file_id)
            file_stream = io.BytesIO()
            downloader = MediaIoBaseDownload(file_stream, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
            
            file_stream.seek(0)
            reader = PdfReader(file_stream)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text
        except Exception as e:
            return ""

class WebReader:
    def __init__(self):
        pass

    def scrape_and_process(self, url):
        try:
            print(f"👀 Reading: {url}")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            
            # 1. PDF Handling
            if url.lower().endswith('.pdf'):
                response = requests.get(url, headers=headers, timeout=10)
                if response.status_code == 200:
                    with io.BytesIO(response.content) as f:
                        reader = PdfReader(f)
                        # Extract text from all pages
                        text = " ".join([page.extract_text() for page in reader.pages if page.extract_text()])
                    
                    filename = f"PDF_Source_{url.split('/')[-1][-15:]}"
                    return 'success', filename, text

            # 2. HTML Handling(Abandoned)
            article = Article(url)
            article.download()
            article.parse()
            text = article.text
            title = article.title
            
            if len(text) > 300:
                return 'success', title, text
            else:
                return 'too_short', None, None

        except Exception as e:
            print(f"⚠️ Read Error on {url}: {e}")
            return 'error', None, None

# ==========================================
# 5. FLASK APP & ROUTES
# ==========================================
app = Flask(__name__)
# Initialize Tool and Model globally
google_search_tool = Tool(google_search=GoogleSearch())
model_name = "gemini-2.5-flash"

# Initialize Librarian Globally (alongside Validator)
librarian = None

# 1. Validator
@app.route('/validate', methods=['POST'])
def validate_research():
    try:
        data = request.get_json()
        user_text = data.get('text', '').strip()
        
        # Only run the Validator (The Brain)
        result = core_validation_logic(user_text) 
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
# Librarian
@app.route('/librarian_sync', methods=['POST'])
def librarian_sync_audit():
    global librarian, creds, client
    
    if librarian is None:
        librarian = LibrarianAgent(client, creds)

    try:
        data = request.get_json()
        folder_id = data.get('folderId')
        reference_text = data.get('referenceText', '') # Full bib text
        
        if not folder_id:
            return jsonify({"error": "No Folder ID"}), 400

        # Run the Sync & Audit
        report = librarian.sync_and_audit(folder_id, reference_text)
        
        return jsonify(report)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# Tracer
@app.route('/trace', methods=['POST'])
def trace_manuscript():
    global client, creds 
    try:
        # We no longer strictly need creds for Drive here, 
        # but client is needed for Vertex AI.
        if client is None:
             return jsonify({"error": "Vertex Client not initialized"}), 500

        data = request.get_json()
        full_text = data.get('text', '')
        
        # folderId is ignored now, but we keep the signature valid
        
        if not full_text:
            return jsonify({"error": "No text provided"}), 400

        # Initialize Tracer (Lightweight)
        tracer = TracerAgent(client, db_path="./chroma_db")
        
        print(f"🔎 Tracer started analysis...")
        analysis = tracer.run_agentic_trace(full_text)
        
        return jsonify(analysis)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ==========================================
# RUN SERVER
# ==========================================
if __name__ == "__main__":
    # Ensure ngrok is authenticated in setup_environment or here
    # ngrok.set_auth_token(NGROK_AUTH_TOKEN) 
    public_url = ngrok.connect(5000, bind_tls=True).public_url
    print("🚀 SERVER READY")
    print(f"   Validate: {public_url}/validate")
    print(f"   Trace:    {public_url}/trace")
    app.run(host="0.0.0.0", port=5000)

# ==========================================
# LOG READING 
# ==========================================
import pandas as pd
# Quick analysis of average processing time
df = pd.read_json("agent_trace.jsonl", lines=True)
print(df[df['step'] == 'Ingest']['duration_seconds'].mean())
