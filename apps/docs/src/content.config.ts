import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
const docs = defineCollection({
  loader: glob({ base: '../../docs', pattern: ['website/**/*.md', 'extension-quickstart.md', 'native-manga-sdk.md'] }),
  schema: z.object({ title: z.string().optional(), description: z.string().optional() }),
});
export const collections = { docs };
