import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectoryLoader } from "@langchain/classic/document_loaders/fs/directory";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..", "..", "..");

/**
 * Load unstructured documents from the local filesystem.
 * Supports TXT, PDF, and Markdown.
 */
export async function loadFileDocuments() {
  const docsPath = resolve(__dirname, "data", "unstructured");

  const loader = new DirectoryLoader(docsPath, {
    ".txt": (p) => new TextLoader(p),
    ".md": (p) => new TextLoader(p),
    ".markdown": (p) => new TextLoader(p),
    ".pdf": (p) => new PDFLoader(p)
  });

  try {
    const docs = await loader.load();
    return docs;
  } catch (err) {
    console.warn(
      `Warning: Failed to load unstructured documents from ${docsPath}:`,
      err.message || err
    );
    return [];
  }
}

