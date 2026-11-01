import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import rewriteDocsLinks from './src/lib/remark-links.mjs';
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  markdown: { processor: unified({ remarkPlugins: [rewriteDocsLinks] }), shikiConfig: { theme: 'css-variables' } },
});
