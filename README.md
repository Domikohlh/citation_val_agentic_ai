### README -- 
Hi, thank you for looking into Citva project. Please read this note before you run the code. Thank you! 

There are two scripts in this project:

1. citva.py (Python) - The main Agent and web-building blocks
- **DO NOT run the Python code in Kaggle Notebook as the kernel will crash!!!**

2. google_doc_appscript.js (JavaScript) - UI/UX for Google Doc

####Note **(All of the usage below are free for development, not production)**

- Create a project in Google cloud to get the project ID and Service Account JSON 
- Activate the Google Drive API in IAM management for the project 
- Create a ngrok account for web deployment and get the authorisation token

For utilisation in Google Doc:
- **RUN the Python code to generate the ngrok link first**
- Create a Google Drive folder and link it to the project email address. 
- Google Doc > Extension > App Scripts > google-doc-appscript > Code.gs 
- Past the link on the first line in the JavaScript

                                       const ENDPOINT_URL = "NGROK_LINK"



### Problem Statement -- 

Academic researchers are heavily relying on generative AI for literature research since GenAI becomes popular nowadays. However, AI hallucination is a critical problem due to the generation of non-existent research links without validation. Additionally, AI plagiarism also leads to an increasing trend of academic integrity issues and concerns of generative AI usage in academia, while researchers may incorrectly cite or quote their sentences that are not matching the citation contents. For instance, [A PhD student studies at the University of Hong Kong was reported in the usage of AI whereas some citations are invalid in their PhD thesis.] (https://hongkongfp.com/2025/11/10/university-of-hong-kong-probes-non-existent-ai-generated-references-in-paper-prof-says-content-not-fabricated/)

Therefore, this project aims to help researchers to validate their citation source and provide quotation advices.  

### Why agents? -- 

Manual literature fact check spends significant human time, especially in large research and literature review, which cites a large amount of papers. In addition to AI hallucinations, whereas GenAI is not able to validate the source or tailor for specific research. AI agent can automatically validate the citation lists to existing resources (Google Scholar) and provide quotation advisory in related sentences. 

### What you created --

This project aims to be lightweight and Google-native:

- The Brain (LLM): Gemini-2.5-Flash (Vertexai).
- The Hands (Tools): Google Workplace (Doc), Google Search.
- Orchestration: Three agentic AI are involved: (i) Validator; (ii) Librarian; (iii) Tracer.
- AppScripts for visualisation in Google Doc.

### Demo -- Show your solution 

### The Build -- 

Agent 1. Validator
- Validate the reference(s) in single/list entry ---- [✅]
- Large reference list is processed in batches ---- [✅]
- The references will be labelled in Green (Pass), Orange (Suspected), Red (Error) ---- [✅]
- A deep search in single entry can be used in red-labelled references to provide in-depth report ---- [✅]
- Ensure there is no repetitive citations in the list ---- [✅]

Agent 2. Librarian 
- Read the article PDF in Google Drive ---- [✅]
- Extract title and DOI from the reference list ---- [✅]
- Read, secure and embed the PDF in archive/main chomaDB while preventing prompt injection and filter invalid PDFs---- [✅]
- A2A protocol with Validator as a gatekeeper to further validate and align the reference list---- [✅]

Agent 3. Tracer
- Retrieve vectors from chomaDB ---- [✅]
- Match citations and plagiarisms from the vectors and manuscripts ---- [✅]
- *"cosine-similarity"* to quantify the matching scores ---- [✅]
- Advanced alignment with the similarity score to ensure good quality of results ---- [✅]

### If I had more time, this is what I'd do
- A more user-friendly Google Drive upload to avoid Service Account complications in Google Cloud for non-tech users. 
- Use of Semantic Scholar API to search for brief summary of articles to enhance the accuracy of validator.
- Implementation into MS system as most researchers prefer MS words. 
- Better UI/UX. 
- Improve the latency
