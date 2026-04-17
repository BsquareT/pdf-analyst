import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

async function extractPptxText(buffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const sections = [];
  for (const fp of slideFiles) {
    const xml = await zip.files[fp].async('string');
    const matches = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)];
    const text = matches.map(m => m[1].trim()).filter(Boolean).join(' ');
    if (text.trim()) sections.push({ source: `Slide ${fp.match(/\d+/)[0]}`, text });
  }
  return { sections, totalPages: slideFiles.length };
}

async function extractPdfText(buffer) {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const pageTexts = [];
  await pdfParse(buffer, {
    pagerender: pageData => pageData.getTextContent().then(tc => {
      const text = tc.items.map(i => i.str).join(' ');
      pageTexts.push({ source: `Page ${pageData.pageNumber}`, text });
      return text;
    }),
  });
  return { sections: pageTexts, totalPages: pageTexts.length };
}

function chunkSections(sections, size = 3000, overlap = 300) {
  const chunks = [];
  for (const { source, text } of sections) {
    if (!text.trim()) continue;
    if (text.length <= size) { chunks.push({ source, text: text.trim() }); continue; }
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push({ source, text: text.slice(start, end).trim() });
      if (end === text.length) break;
      start += size - overlap;
    }
  }
  return chunks;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = formidable({ maxFileSize: 200 * 1024 * 1024 });
  let files;
  try { [, files] = await form.parse(req); } catch (e) { return res.status(400).json({ error: 'Upload failed: ' + e.message }); }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });

  const ext = path.extname(file.originalFilename || '').toLowerCase();
  const buffer = fs.readFileSync(file.filepath);

  try {
    const extracted = ext === '.pdf' ? await extractPdfText(buffer) : ext === '.pptx' ? await extractPptxText(buffer) : null;
    if (!extracted) return res.status(400).json({ error: 'Only PDF and PPTX supported.' });
    res.json({ chunks: chunkSections(extracted.sections), totalPages: extracted.totalPages });
  } catch (e) {
    res.status(500).json({ error: 'Extraction failed: ' + e.message });
  } finally {
    fs.unlinkSync(file.filepath);
  }
}
