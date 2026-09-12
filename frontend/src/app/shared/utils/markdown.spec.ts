import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders bold, italic and paragraphs', () => {
    const html = renderMarkdown('**жирный** и *курсив*');
    expect(html).toContain('<strong>жирный</strong>');
    expect(html).toContain('<em>курсив</em>');
  });

  it('renders lists', () => {
    const html = renderMarkdown('- один\n- два\n');
    expect(html).toContain('<li>один</li>');
    expect(html).toContain('<li>два</li>');
  });

  it('renders headings', () => {
    expect(renderMarkdown('# Заголовок')).toContain('<h1>Заголовок</h1>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('передай `x`')).toContain('<code>x</code>');
  });

  it('highlights code blocks in a registered language', () => {
    const html = renderMarkdown('```python\ndef f(): pass\n```');
    expect(html).toContain('class="language-python"');
    expect(html).toContain('<span class="hljs-keyword">def</span>');
  });

  it('highlights code blocks by auto-detection without a language tag', () => {
    expect(renderMarkdown('```\ndef f(): pass\n```')).toContain(
      '<span class="hljs-keyword">def</span>'
    );
  });

  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });
});
