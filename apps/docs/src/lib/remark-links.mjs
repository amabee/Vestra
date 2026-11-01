import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from './pages.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const docs = path.join(root, 'docs');
export default function rewriteDocsLinks() {
  return (tree, file) => {
    const walk = (node) => {
      if (node.type === 'link' && node.url && !/^(?:[a-z]+:|#|\/)/i.test(node.url)) {
        const [relative, hash] = node.url.split('#');
        const target = path.resolve(path.dirname(file.history[0]), relative);
        const id = path.relative(docs, target).replaceAll('\\', '/').replace(/\.md$/, '');
        const page = pages.find(p => p.id === id);
        if (page) node.url = '/' + page.path + '/' + (hash ? '#' + hash : '');
        else {
          const repoPath = path.relative(root, target).replaceAll('\\', '/');
          if (!repoPath.startsWith('..')) node.url = 'https://github.com/amabee/Vestra/' + (relative.endsWith('/') ? 'tree' : 'blob') + '/main/' + repoPath + (hash ? '#' + hash : '');
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
