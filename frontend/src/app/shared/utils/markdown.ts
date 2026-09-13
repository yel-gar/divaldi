import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';

const languages: Record<string, LanguageFn> = {
  python,
  javascript,
  typescript,
  json,
  bash,
  sql,
  xml
};

for (const [name, language] of Object.entries(languages)) {
  hljs.registerLanguage(name, language);
}

const marked = new Marked(
  markedHighlight({
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code, Object.keys(languages)).value;
    }
  })
);

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}
