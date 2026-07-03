import { z } from 'zod';

export const imageItemSchema = z.object({
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tags: z.array(z.string()),
});

export const imageSearchResponseSchema = z.object({
  items: z.array(imageItemSchema),
});

export type ImageItem = z.infer<typeof imageItemSchema>;
export type ImageSearchResponse = z.infer<typeof imageSearchResponseSchema>;
