import { parseAnswer } from './parseAnswer';

describe('parseAnswer', () => {
  test('plain prose → single paragraph segment', () => {
    expect(parseAnswer('Your MRR is $4,820 across 23 active subscriptions.'))
      .toEqual([
        {
          kind: 'paragraph',
          spans: [
            { bold: false, text: 'Your MRR is $4,820 across 23 active subscriptions.' },
          ],
        },
      ]);
  });

  test('multi-line prose → one paragraph per line', () => {
    expect(parseAnswer('First sentence.\nSecond sentence.')).toEqual([
      { kind: 'paragraph', spans: [{ bold: false, text: 'First sentence.' }] },
      { kind: 'paragraph', spans: [{ bold: false, text: 'Second sentence.' }] },
    ]);
  });

  test('single bullet → bullet segment with `- ` stripped', () => {
    expect(parseAnswer('- Acme Corp paid $1,840')).toEqual([
      {
        kind: 'bullet',
        spans: [{ bold: false, text: 'Acme Corp paid $1,840' }],
      },
    ]);
  });

  test('bullet with bold label and em-dash description (em-dash normalized to hyphen)', () => {
    expect(parseAnswer('- **Acme Corp** — $1,840')).toEqual([
      {
        kind: 'bullet',
        spans: [
          { bold: true, text: 'Acme Corp' },
          { bold: false, text: ' - $1,840' },
        ],
      },
    ]);
  });

  test('multiple bullets after a header paragraph', () => {
    const out = parseAnswer(
      'Your top 3 customers:\n- **Acme** — $1,840\n- **Globex** — $1,290\n- **Initech** — $980',
    );
    expect(out).toHaveLength(4);
    expect(out[0].kind).toBe('paragraph');
    expect(out[1].kind).toBe('bullet');
    expect(out[1].spans[0]).toEqual({ bold: true, text: 'Acme' });
    expect(out[3].spans[0]).toEqual({ bold: true, text: 'Initech' });
  });

  test('em-dash characters are normalized to hyphen across the content', () => {
    const out = parseAnswer('First — sentence.\n- **Label** — desc — more.');
    // Paragraph span should have hyphen, not em-dash
    expect(out[0].spans[0].text).toBe('First - sentence.');
    // Bullet's regular spans should have hyphen, not em-dash
    expect(out[1].spans[1].text).toBe(' - desc - more.');
  });

  test('multiple bolds in one line', () => {
    expect(parseAnswer('- **Acme** paid you **$1,840** total')).toEqual([
      {
        kind: 'bullet',
        spans: [
          { bold: true, text: 'Acme' },
          { bold: false, text: ' paid you ' },
          { bold: true, text: '$1,840' },
          { bold: false, text: ' total' },
        ],
      },
    ]);
  });

  test('unclosed ** is treated as literal (no crash)', () => {
    expect(parseAnswer('Acme Corp **partial')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { bold: false, text: 'Acme Corp ' },
          { bold: false, text: '**partial' },
        ],
      },
    ]);
  });

  test('empty lines are dropped', () => {
    expect(parseAnswer('First.\n\nSecond.')).toEqual([
      { kind: 'paragraph', spans: [{ bold: false, text: 'First.' }] },
      { kind: 'paragraph', spans: [{ bold: false, text: 'Second.' }] },
    ]);
  });

  test('empty input → no segments', () => {
    expect(parseAnswer('')).toEqual([]);
  });

  test('line starting with single dash (no space) is paragraph, not bullet', () => {
    expect(parseAnswer('-not a bullet')).toEqual([
      {
        kind: 'paragraph',
        spans: [{ bold: false, text: '-not a bullet' }],
      },
    ]);
  });
});
