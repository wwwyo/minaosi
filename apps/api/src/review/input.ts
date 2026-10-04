import { z } from 'zod';

export const ReviewProviderSchema = z.enum(['anthropic', 'openai', 'deepseek']);
export const ReviewModeSchema = z.enum(['default', 'byok']);
export const ModelSchema = z.string().regex(/^[@a-zA-Z0-9._:/-]{1,120}$/).refine(value => !value.includes('..'));

export const ReviewBlockSchema = z.object({
  index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  text: z.string(),
});

const BlocksSchema = z.array(ReviewBlockSchema).min(1).max(2000).superRefine((blocks, ctx) => {
  if (new Set(blocks.map(block => block.index)).size !== blocks.length) {
    ctx.addIssue({ code: 'custom', message: 'ブロック番号が重複しています' });
  }
  if (blocks.reduce((characters, block) => characters + block.text.length, 0) > 80_000) {
    ctx.addIssue({ code: 'custom', message: '原稿が大きすぎます' });
  }
});

export const ProviderReviewInputSchema = z.object({
  provider: ReviewProviderSchema,
  model: ModelSchema,
  blocks: BlocksSchema,
});

export const ReviewInputSchema = z.union([
  ProviderReviewInputSchema.extend({ mode: z.literal('byok').optional() }),
  z.object({ mode: z.literal('default'), blocks: BlocksSchema }),
]);

export type ReviewBlock = z.infer<typeof ReviewBlockSchema>;
export type ReviewProvider = z.infer<typeof ReviewProviderSchema>;
export type ReviewMode = z.infer<typeof ReviewModeSchema>;
export type ProviderReviewInput = z.infer<typeof ProviderReviewInputSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
