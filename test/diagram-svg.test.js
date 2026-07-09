import { describe, it, expect } from 'vitest';
import { rewriteSentinels, fitSvg, sanitizeSvg, prepareSvg } from '../public/lib/diagram-svg.js';
import { SENTINELS } from '../public/lib/puml-theme.js';

describe('diagram-svg — sentinel → CSS var rewrite', () => {
  it('rewrites fill, stroke and style-block occurrences, case-insensitively', () => {
    const svg = '<svg><rect fill="#0A0B04"/><line stroke="#0a0b09"/><text style="fill:#0A0B01;stroke:#0A0B08"/></svg>';
    const out = rewriteSentinels(svg);
    expect(out).toContain('fill="var(--accent)"');
    expect(out).toContain('stroke="rgb(var(--edge-rgb))"');
    expect(out).toContain('fill:var(--ink)');
    expect(out).toContain('stroke:var(--line)');
    expect(out).not.toMatch(/#0A0B0[1489]/i);
  });
  it('rewrites node-label sentinels to node vars and color-mix fills', () => {
    const out = rewriteSentinels('<rect fill="#0A0C10" stroke="#0A0B10"/>');
    expect(out).toContain('color-mix(in srgb, var(--node-insight) 18%, transparent)');
    expect(out).toContain('stroke="var(--node-insight)"');
  });
  it('every SENTINELS entry round-trips', () => {
    const svg = Object.keys(SENTINELS).map((h) => `<rect fill="${h}"/>`).join('');
    const out = rewriteSentinels(svg);
    for (const [hex, v] of Object.entries(SENTINELS)) {
      expect(out).toContain(v);
      expect(out.toUpperCase()).not.toContain(hex.toUpperCase());
    }
  });
});

describe('diagram-svg — fitSvg', () => {
  it('drops fixed width/height from the root, keeps viewBox, adds the class', () => {
    const out = fitSvg('<svg xmlns="x" width="732px" height="410px" viewBox="0 0 732 410"><rect width="7"/></svg>');
    expect(out).toContain('class="sb-diagram"');
    expect(out).toContain('viewBox="0 0 732 410"');
    expect(out).not.toMatch(/<svg[^>]*\swidth=/);
    expect(out).toContain('<rect width="7"/>');   // inner elements untouched
  });
});

describe('diagram-svg — sanitizer (SVG lands in innerHTML)', () => {
  it('strips <script> and <foreignObject>', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><foreignObject><body/></foreignObject><rect/></svg>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('foreignObject');
    expect(out).toContain('<rect/>');
  });
  it('strips on* handlers', () => {
    const out = sanitizeSvg('<svg><rect onclick="evil()" onmouseover=\'x\' fill="#111"/></svg>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('fill="#111"');
  });
  it('keeps http(s)/fragment links, drops javascript: and file:', () => {
    const out = sanitizeSvg('<svg><a href="https://ok.example">x</a><a href="javascript:evil()">y</a><a xlink:href="file:///etc/passwd">z</a><a href="#frag">f</a></svg>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('href="#frag"');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('file://');
  });
});

describe('diagram-svg — prepareSvg pipeline', () => {
  it('rewrites + sanitizes + fits in one pass', () => {
    const out = prepareSvg('<svg width="10" height="10" viewBox="0 0 10 10"><script>x</script><rect fill="#0A0B04" onload="p()"/></svg>');
    expect(out).toContain('class="sb-diagram"');
    expect(out).toContain('var(--accent)');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onload');
  });
});
