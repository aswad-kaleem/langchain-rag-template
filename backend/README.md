# LangChain RAG Backend - Production-Ready Real-Time API

A production-grade, real-time LangChain RAG (Retrieval-Augmented Generation) backend built with Node.js, Fastify, OpenAI, and MySQL. This system demonstrates enterprise-level LangChain patterns with proper document loading, intelligent chunking, vector embeddings, conversational memory, and streaming responses.

## 🚀 Features

- **Real-time RAG Pipeline**: LangChain-based retrieval with OpenAI embeddings and FAISS vector store
- **Multi-Source Data Loading**: Supports unstructured files (TXT, PDF, Markdown) and structured MySQL database records
- **Conversational Memory**: Session-based chat history using LangChain's `RunnableWithMessageHistory`
- **Streaming Responses**: Server-Sent Events (SSE) for real-time token streaming
- **Production-Ready**: Proper error handling, logging, prompt injection protection, context overflow prevention
- **MySQL Integration**: Flexible database loader that adapts to your schema
- **Modern LangChain**: Uses latest LCEL (LangChain Expression Language) and Runnable patterns

## 📋 Prerequisites

- Node.js 18+ (LTS recommended)
- MySQL 8.0+ (or compatible database)
- OpenAI API key

## 🛠️ Installation

1. **Clone and install dependencies:**

```bash
npm install
```

2. **Set up environment variables:**

Create a `.env` file in the project root:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o-mini
OPENAI_TEMPERATURE=0.1

# Server Configuration
PORT=4000
NODE_ENV=development

# RAG Configuration
RAG_TOP_K=4
RAG_MAX_CONTEXT_CHARS=8000

# MySQL Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cs_management
DB_TABLE_NAME=knowledge_base
```

3. **Set up MySQL database:**

```sql
-- Create database (if it doesn't exist)
CREATE DATABASE IF NOT EXISTS cs_management;
USE cs_management;

-- Create knowledge base table (adjust schema to match your needs)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255),
  body TEXT,
  tags VARCHAR(255),
  source VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO knowledge_base (title, body, tags, source) VALUES
  ('Refund Policy', 'Our refund policy states that digital products are non-refundable except in cases of technical issues...', 'policy,refund', 'internal_policies'),
  ('Onboarding Process', 'New employees should complete the following steps: 1) Complete HR forms, 2) Attend orientation...', 'hr,onboarding', 'hr_docs'),
  ('API Documentation', 'The API endpoint /api/v1/users accepts GET and POST requests. Authentication is required...', 'api,technical', 'developer_docs');
```

**Note:** The loader is flexible and will work with tables that have different column names. It automatically maps common column names:
- `title`, `name`, `subject` → title
- `body`, `content`, `description`, `text` → body
- `tags`, `category` → tags
- `source`, `origin` → source

If your table has different columns, edit `src/rag/loaders/structuredLoader.js` to match your schema.

4. **Add unstructured documents (optional):**

Place your text files in `data/unstructured/`:
- `.txt` files
- `.md` / `.markdown` files
- `.pdf` files

## 🏃 Running the Server

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run start
```

The server will:
1. Connect to MySQL and load structured records
2. Load unstructured files from `data/unstructured/`
3. Chunk all documents intelligently
4. Generate embeddings using OpenAI
5. Build FAISS vector index
6. Start the Fastify server on port 4000 (or your configured PORT)

## 📡 API Usage

### POST /chat

Send questions and receive AI-powered answers using your RAG knowledge base.

**Request:**
```bash
curl -X POST "http://localhost:4000/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is our refund policy?",
    "sessionId": "user-123"
  }'
```

**Response:**
```json
{
  "answer": "According to our refund policy, digital products are non-refundable except in cases of technical issues..."
}
```

### Streaming Response (SSE)

Get real-time token streaming:

```bash
curl -N -X POST "http://localhost:4000/chat?stream=true" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Summarize the onboarding process",
    "sessionId": "user-123"
  }'
```

**SSE Event Format:**
```
data: {"event":"start"}

data: {"event":"token","data":"New"}
data: {"event":"token","data":" employees"}
data: {"event":"token","data":" should"}

data: {"event":"end"}
```

### Session Management

- **`sessionId`** (optional): Maintains conversational context across requests
- If omitted, each request is treated as a new conversation
- Same `sessionId` = shared conversation history

## 🏗️ Architecture

### Key Components

1. **Document Loaders** (`src/rag/loaders/`)
   - `fileLoader.js`: Loads TXT, PDF, Markdown files
   - `structuredLoader.js`: Queries MySQL and converts rows to LangChain Documents

2. **Vector Store** (`src/rag/vectorStore.js`)
   - Uses `RecursiveCharacterTextSplitter` for intelligent chunking
   - Generates embeddings via `OpenAIEmbeddings`
   - Builds FAISS index for fast similarity search

3. **RAG Chain** (`src/rag/ragChain.js`)
   - Implements LCEL pipeline with `RunnableSequence`
   - Retrieves top-k relevant documents
   - Injects context into guarded system prompt
   - Uses `RunnableWithMessageHistory` for conversational memory
   - Prevents hallucinations with strict instructions

4. **API Routes** (`src/api/chatRoute.js`)
   - Handles `/chat` endpoint
   - Supports JSON and SSE streaming responses
   - Manages session-based memory

5. **Database** (`src/db/mysql.js`)
   - Connection pooling for production scalability
   - Simple query abstraction

### LangChain Benefits

- **Abstraction**: No direct OpenAI API calls; LangChain handles retries, streaming, errors
- **Composability**: LCEL makes the RAG pipeline declarative and testable
- **Memory**: Built-in conversational history management
- **Vector Stores**: Easy to swap FAISS for Pinecone, Weaviate, etc.
- **Document Loaders**: Unified interface for heterogeneous data sources
- **Prompt Safety**: Template system prevents injection and context overflow

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *required* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model to use |
| `OPENAI_TEMPERATURE` | `0.1` | Model temperature (lower = more deterministic) |
| `PORT` | `4000` | Server port |
| `RAG_TOP_K` | `4` | Number of documents to retrieve per query |
| `RAG_MAX_CONTEXT_CHARS` | `8000` | Maximum context length to inject (prevents overflow) |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | *required* | MySQL password |
| `DB_NAME` | `cs_management` | Database name |
| `DB_TABLE_NAME` | `knowledge_base` | Table name to load from |

### Customizing MySQL Schema

If your table has different columns, edit `src/rag/loaders/structuredLoader.js`:

```javascript
const rows = await query(
  `
  SELECT
    id,
    your_title_column as title,
    your_content_column as body,
    your_tags_column as tags,
    your_source_column as source
  FROM \`${tableName}\`
  WHERE your_content_column IS NOT NULL
  `
);
```

## 🚀 Production Considerations

### Scaling Vector Store

For production at scale, consider migrating from FAISS to:
- **Pinecone**: Managed vector database
- **Weaviate**: Self-hosted or cloud vector DB
- **Qdrant**: High-performance vector search

Simply swap the vector store class in `src/rag/vectorStore.js`:

```javascript
import { Pinecone } from "@langchain/pinecone";
// Replace FaissStore.fromDocuments with Pinecone.fromDocuments
```

### Session Storage

Current implementation uses in-memory session store. For production:
- Use Redis-backed chat history
- Implement database-backed sessions
- Add session expiration/TTL

### Monitoring

- Add request logging middleware
- Track token usage and costs
- Monitor retrieval quality (top-k relevance)
- Set up error alerting

## 📝 Example Queries

```bash
# Ask about policies
curl -X POST "http://localhost:4000/chat" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is our refund policy?", "sessionId": "user-123"}'

# Follow-up question (uses conversation history)
curl -X POST "http://localhost:4000/chat" \
  -H "Content-Type: application/json" \
  -d '{"question": "Are there any exceptions?", "sessionId": "user-123"}'

# Technical question
curl -X POST "http://localhost:4000/chat" \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I authenticate with the API?", "sessionId": "user-456"}'
```

## 🐛 Troubleshooting

**MySQL connection errors:**
- Verify credentials in `.env`
- Ensure MySQL is running: `mysql -u root -p`
- Check database exists: `SHOW DATABASES;`

**No documents loaded:**
- Check `data/unstructured/` has files
- Verify MySQL table has rows: `SELECT COUNT(*) FROM knowledge_base;`
- Check server logs for warnings

**OpenAI API errors:**
- Verify `OPENAI_API_KEY` is set correctly
- Check API quota/billing
- Review error logs for specific error messages

## 📚 Learn More

- [LangChain Documentation](https://js.langchain.com/)
- [LangChain RAG Tutorial](https://js.langchain.com/docs/use_cases/question_answering/)
- [Fastify Documentation](https://www.fastify.io/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

## 📄 License

MIT
