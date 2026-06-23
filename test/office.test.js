import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { unzip, xmlToText, extractText } from '../lib/office.js';

// Build a minimal ZIP (local headers only, no central directory) with deflated entries,
// matching what unzip() scans for. Enough to exercise the extractor end-to-end.
function makeZip(entries) {
  const chunks = [];
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);              // version
    h.writeUInt16LE(0, 6);              // flags
    h.writeUInt16LE(8, 8);              // method: deflate
    h.writeUInt32LE(0, 14);            // crc (unused by reader)
    h.writeUInt32LE(comp.length, 18);  // compressed size
    h.writeUInt32LE(data.length, 22);  // uncompressed size
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);            // extra len
    chunks.push(h, nameBuf, comp);
  }
  return Buffer.concat(chunks);
}

describe('unzip', () => {
  it('round-trips deflated entries by name', () => {
    const zip = makeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x>hi</x>' });
    const files = unzip(zip);
    expect(files['a.txt'].toString('utf8')).toBe('hello');
    expect(files['dir/b.xml'].toString('utf8')).toBe('<x>hi</x>');
  });
});

describe('xmlToText', () => {
  it('turns paragraphs into newlines and strips tags + entities', () => {
    const xml = '<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p>';
    expect(xmlToText(xml)).toBe('Hello & welcome\nLine two');
  });
});

describe('extractText', () => {
  it('extracts docx body text', () => {
    const doc = '<w:document><w:body><w:p><w:r><w:t>Cooperative bylaws</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Article I</w:t></w:r></w:p></w:body></w:document>';
    const files = unzip(makeZip({ 'word/document.xml': doc }));
    expect(extractText(files, 'docx')).toBe('Cooperative bylaws\nArticle I');
  });
  it('extracts pptx slides in numeric order with separators', () => {
    const slide = (t) => `<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`;
    const files = unzip(makeZip({
      'ppt/slides/slide10.xml': slide('Tenth'),
      'ppt/slides/slide2.xml': slide('Second'),
      'ppt/slides/slide1.xml': slide('First'),
    }));
    const out = extractText(files, 'pptx');
    expect(out).toContain('— slide 1 —\nFirst');
    expect(out.indexOf('Second')).toBeLessThan(out.indexOf('Tenth'));   // slide2 before slide10
  });
  it('throws on missing parts', () => {
    expect(() => extractText({}, 'docx')).toThrow();
    expect(() => extractText({}, 'pptx')).toThrow();
  });
});
