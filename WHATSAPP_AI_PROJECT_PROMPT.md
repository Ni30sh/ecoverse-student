# Project Initiation Prompt: AI-Powered WhatsApp Business Assistant

## Project Overview
Build a robust, scalable WhatsApp Business Chatbot that leverages OpenAI's GPT models to provide intelligent, context-aware responses. The backend will be powered by ASP.NET Core Web API, using SQL Server for data persistence and WhatsApp Cloud API for communication.

## Technical Stack
- **Backend:** ASP.NET Core Web API (.NET 8+)
- **Language:** C#
- **Database:** SQL Server
- **ORM:** Entity Framework Core
- **External APIs:** WhatsApp Cloud API (Meta), OpenAI API
- **Communication:** REST APIs, JSON, Webhooks

## Implementation Roadmap

### Phase 1: Core Backend Infrastructure
1.  Initialize an ASP.NET Core Web API project.
2.  Configure Dependency Injection for services.
3.  Set up Entity Framework Core with SQL Server.
4.  Design and implement the Database Schema:
    *   **Users:** ID, Phone Number, Name, CreatedAt.
    *   **ChatHistory:** ID, UserID, MessageContent, Sender (User/AI), Timestamp.
    *   **Context:** ID, UserID, Summary, LastInteraction.
    *   **Feedback:** ID, MessageID, Rating, Comments.

### Phase 2: WhatsApp Cloud API Integration
1.  **Webhook Setup:** Create an endpoint to handle Meta's verification (GET) and incoming message notifications (POST).
2.  **Message Reception:** Parse incoming JSON from WhatsApp (text, media, location).
3.  **Message Transmission:** Implement a service to send messages via the WhatsApp Cloud API using `HttpClient`.

### Phase 3: OpenAI Integration & Logic
1.  Create an OpenAI Service to interact with Chat Completions API.
2.  **Prompt Engineering:** Design a system prompt that defines the bot's persona and rules.
3.  **Context Management:** Retrieve previous chat history from the database to provide context to OpenAI for coherent conversations.
4.  **Flow:**
    *   Receive WhatsApp Message -> Store in DB -> Fetch Context -> Send to OpenAI -> Receive Response -> Store Response -> Send to User via WhatsApp.

### Phase 4: Advanced Features
1.  **Context Memory:** Long-term memory management using the database.
2.  **Multimodal Support:**
    *   **Voice:** Integration with OpenAI Whisper for transcription.
    *   **Documents:** PDF/Doc reading and summarization.
    *   **Images:** Analysis using GPT-4o Vision.
3.  **FAQ Knowledge Base:** Implement a RAG (Retrieval-Augmented Generation) or a simple lookup for common school/business FAQs.
4.  **Human Handoff:** A mechanism to flag conversations for human intervention and notify an admin.

## Coding Standards & Guidelines
- Follow SOLID principles.
- Use Repository and Service patterns.
- Implement proper error handling and logging.
- Ensure secure handling of API keys using Environment Variables or Secret Manager.
- Use asynchronous programming (`async/await`) throughout.

---
**Initial Task:**
Please start by generating the ASP.NET Core project structure, the User/ChatHistory database models, and the initial Webhook Controller for WhatsApp verification.
