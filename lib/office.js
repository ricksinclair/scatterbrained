// Dependency-free text extraction from .docx / .pptx — both are ZIP containers of
// XML. We read just enough of the ZIP format to find the document parts, inflate them
// with Node's zlib (ZIP uses raw DEFLATE, method 8), and strip the XML to readable
// text. No external libraries, honoring the repo's no-deps rule. It is allowed to be
// approximate — this is a reader, not a fidelity-perfect converter.
import zlib from 'node:zlib';

// Parse a ZIP buffer into { name -> contentBuffer } for stored (0) and deflated (8)
// entries, by scanning local file headers (signature 0x04034b50). Good enough for the
// well-formed archives Word/PowerPoint emit; we don't need the central directory.
export function unzip(buf) {
  const files = {};
  let i = 0;
  const SIG = 0x04034b50;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== SIG) break;
    const method = buf.readUInt16LE(i + 8);
    let compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const flags = buf.readUInt16LE(i + 6);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    // Streaming archives set bit 3 (sizes in a trailing data descriptor, compSize=0).
    // We don't parse those; skip the entry rather than guess.
    if ((flags & 0x08) && compSize === 0) break;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    try {
      files[name] = method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp);
    } catch { /* skip unreadable entry */ }
    i = dataStart + compSize;
  }
  return files;
}

// Turn OOXML body XML into plain-ish text: paragraphs (<w:p>, <a:p>) and breaks become
// newlines, all other tags are dropped, entities decoded, runs of blank lines collapsed.
export function xmlToText(xml) {
  return String(xml)
    .replace(/<\/(w:p|a:p)>/g, '\n')                 // paragraph end → newline
    .replace(/<(w:br|a:br|w:tab)\b[^>]*\/?>/g, ' ')  // breaks / tabs → space
    .replace(/<[^>]+>/g, '')                          // drop remaining tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// docx → the single document body; pptx → every slide in order, separated by a rule.
export function extractText(files, kind) {
  if (kind === 'docx') {
    const doc = files['word/document.xml'];
    if (!doc) throw new Error('no word/document.xml');
    return xmlToText(doc.toString('utf8'));
  }
  if (kind === 'pptx') {
    const slides = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10)));
    if (!slides.length) throw new Error('no slides');
    return slides.map((n, k) => `— slide ${k + 1} —\n${xmlToText(files[n].toString('utf8'))}`).join('\n\n');
  }
  throw new Error('unsupported kind: ' + kind);
}
